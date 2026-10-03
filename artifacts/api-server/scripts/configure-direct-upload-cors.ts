/** Explicit operator action; never runs during app startup. Preserves existing rules. */
import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { r2Client, r2Config } from "../src/lib/r2-storage";

async function main() {
  const config = r2Config();
  if (!config) throw new Error("Storage configuration unavailable");
  const origins = process.argv.slice(2).map(value => new URL(value).origin);
  if (!origins.length) throw new Error("Supply verified app origins");
  const current = await r2Client().send(new GetBucketCorsCommand({ Bucket: config.bucket }))
    .catch(error => {
      if (error.name === "NoSuchCORSConfiguration") return { CORSRules: [] };
      throw error;
    });
  const rules = (current.CORSRules ?? []).filter(rule => rule.ID !== "helixly-direct-upload");
  rules.push({
    ID: "helixly-direct-upload", AllowedOrigins: [...new Set(origins)],
    AllowedMethods: ["PUT", "GET", "HEAD"], AllowedHeaders: ["Content-Type", "If-None-Match"],
    ExposeHeaders: ["ETag"], MaxAgeSeconds: 3600,
  });
  await r2Client().send(new PutBucketCorsCommand({ Bucket: config.bucket, CORSConfiguration: { CORSRules: rules } }));
  console.log("Direct upload CORS rule saved; other rules preserved.");
}
main().catch(error => {
  console.error("CORS configuration failed:", error.name, error.$metadata?.httpStatusCode ?? "");
  process.exitCode = 1;
});