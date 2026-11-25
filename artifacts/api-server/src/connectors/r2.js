// Connector: R2 (the foundation). Confirms the object, optionally copies it, and returns a time-limited link.
// R2 stays the source of truth: this connector never moves data out of R2.
import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, r2Config } from "../lib/r2-storage.js";

export default {
  name: "r2",
  envVars: ["R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
  configured: () => Boolean(r2Config()),
  async send(ctx, opts = {}) {
    const cfg = r2Config();
    const head = await r2Client().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: ctx.key }));
    let key = ctx.key;
    if (opts.destKey) {
      if ((head.ContentLength ?? 0) > 5 * 1024 ** 3) throw new Error("R2 server-side copy is limited to 5 GiB; omit destKey");
      key = String(opts.destKey).replace(/^\/+/, "");
      await r2Client().send(new CopyObjectCommand({ Bucket: cfg.bucket, Key: key, CopySource: `${cfg.bucket}/${encodeURIComponent(ctx.key).replace(/%2F/g, "/")}` }));
    }
    // signed here (not via signR2Get) because that helper only accepts clips/ keys; clips config is untouched
    const url = await getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(ctx.fileName)}` }), { expiresIn: 3600 });
    return { ok: true, key, size: head.ContentLength, url, expiresInSeconds: 3600 };
  },
};
