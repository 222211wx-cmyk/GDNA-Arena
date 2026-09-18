import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { clipFile } from "../lib/clip-storage.js";
import { runApprovedClipCleanup } from "../lib/clip-approved-cleanup.js";
import { approvedCleanupStorage } from "../lib/clip-approved-cleanup-gcs.js";

async function readBounded(path: string, max: number) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > max) throw new Error("INVALID_INPUT_FILE_SIZE");
    const bytes = await file.readFile();
    if (bytes.length > max) throw new Error("INVALID_INPUT_FILE_SIZE");
    return bytes;
  } finally { await file.close(); }
}

async function main() {
  const { values } = parseArgs({
    options: {
      report: { type: "string" }, approval: { type: "string" },
      "execute-approved-generations": { type: "boolean" }, help: { type: "boolean" },
    },
    strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log("Operator-only signed cleanup; no automatic listing or bucket-wide deletion.\nUsage: clips:cleanup-approved --report FILE --approval FILE --execute-approved-generations");
    return;
  }
  if (!values.report || !values.approval || values["execute-approved-generations"] !== true) throw new Error("EXPLICIT_REPORT_APPROVAL_AND_EXECUTION_FLAG_REQUIRED");
  const [reportBytes, envelopeBytes] = await Promise.all([
    readBounded(values.report, 128 * 1024 * 1024), readBounded(values.approval, 256 * 1024),
  ]);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  const root = clipFile("");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000,
    application_name: "clip-storage-explicitly-approved-cleanup",
    options: "-c search_path=public -c idle_in_transaction_session_timeout=60000",
  });
  try {
    const result = await runApprovedClipCleanup({ pool, storage: approvedCleanupStorage(root), reportBytes, envelopeBytes });
    console.log(JSON.stringify(result));
    if (result.rejected || result.deferred) process.exitCode = 2;
  } finally { await pool.end(); }
}
main().catch(() => {
  // SQL/storage errors can contain connection/request data. Details of accepted
  // actions are in the audit table, not dumped into operator terminal logs.
  console.error("Approved cleanup failed closed. Verify provisioning, ownership, signature, report freshness, references and metadata; inspect the cleanup audit before retrying.");
  process.exitCode = 1;
});