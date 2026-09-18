import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { clipFile } from "../lib/clip-storage.js";
import { collectClipInventory, readClipReferences } from "../lib/clip-storage-inventory.js";
import { MIN_ORPHAN_AGE_DAYS, reconcileClipStorage } from "../lib/clip-storage-reconciliation.js";

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      "min-age-days": { type: "string", default: String(MIN_ORPHAN_AGE_DAYS) },
      "max-objects": { type: "string", default: "100000" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log("Read-only clip storage reconciliation. No apply/enqueue/delete mode.\nUsage: clips:reconcile --output NEW_FILE [--min-age-days 30] [--max-objects 100000]");
    return;
  }
  if (!values.output) throw new Error("--output NEW_FILE is required");
  const minAgeDays = Number(values["min-age-days"]);
  const maxObjects = Number(values["max-objects"]);
  if (!Number.isSafeInteger(minAgeDays) || minAgeDays < MIN_ORPHAN_AGE_DAYS ||
      minAgeDays > 36500) throw new Error("min-age-days must be an integer between 30 and 36500");
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) throw new Error("Invalid max-objects");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const root = clipFile("");
  const scope = { bucket: root.bucket.name, prefix: root.name };
  if (!scope.bucket || !scope.prefix.endsWith("/clips/") ||
      scope.prefix.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Invalid clip storage scope");
  }
  const startedAt = new Date().toISOString();
  const objects = await collectClipInventory(async pageToken => {
    const [files, nextQuery] = await root.bucket.getFiles({
      prefix: scope.prefix, autoPaginate: false, maxResults: 1000, pageToken,
      versions: false,
    });
    return {
      objects: files.map(file => {
        if (!file.name.startsWith(scope.prefix)) throw new Error("Storage returned object outside clip prefix");
        const metadata = file.metadata;
        return {
          name: file.name.slice(scope.prefix.length),
          generation: metadata.generation === undefined ? undefined : String(metadata.generation),
          size: metadata.size === undefined ? undefined : String(metadata.size),
          timeCreated: metadata.timeCreated,
          updated: metadata.updated,
        };
      }),
      nextPageToken: nextQuery?.pageToken,
    };
  }, maxObjects);
  // Deliberately avoid importing app startup, schema initialization or workers.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1, connectionTimeoutMillis: 10_000,
    application_name: "clip-storage-reconciliation-read-only",
    options: "-c default_transaction_read_only=on",
  });
  try {
    const client = await pool.connect();
    let references;
    try { references = await readClipReferences(client); }
    finally { client.release(); }
    const report = reconcileClipStorage({ objects, ...references, scope, startedAt, minAgeDays });
    // Never overwrite an earlier operator report; restrict access to object names.
    await writeFile(values.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ mode: report.mode, summary: report.summary }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  // Avoid dumping connection configuration or signed/authenticated request data.
  console.error(`Reconciliation failed; no usable report. ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});