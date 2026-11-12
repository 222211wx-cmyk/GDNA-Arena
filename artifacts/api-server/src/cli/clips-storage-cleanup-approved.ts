import { open, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { getApprovedClipCleanupStatus, formatApprovedClipCleanupStatus } from "../lib/clip-approved-cleanup-status.js";

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
      status: { type: "boolean" }, json: { type: "boolean" }, output: { type: "string" },
      "approval-id": { type: "string" }, "object-name": { type: "string" },
    },
    strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log("Operator-only signed cleanup; no automatic listing or bucket-wide deletion.\nUsage: clips:cleanup-approved --report FILE --approval FILE --execute-approved-generations\nRead-only: clips:cleanup-approved --status [--approval-id UUID] [--object-name NAME] [--json] [--output NEW_JSON_FILE]");
    return;
  }
  if (values.status) {
    if (values.report !== undefined || values.approval !== undefined || values["execute-approved-generations"] !== undefined) {
      throw new Error("STATUS_CANNOT_EXECUTE");
    }
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000,
      application_name: "clip-storage-read-only-status",
      options: "-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=60000",
    });
    try {
      const report = await getApprovedClipCleanupStatus(pool, {
        approvalId: values["approval-id"], objectName: values["object-name"],
      });
      const json = JSON.stringify(report, null, 2) + "\n";
      if (values.output !== undefined) await writeFile(values.output, json, { flag: "wx", mode: 0o600 });
      console.log(values.json ? json.trimEnd() : formatApprovedClipCleanupStatus(report));
    } finally { await pool.end(); }
    return;
  }
  if (values.json !== undefined || values.output !== undefined || values["approval-id"] !== undefined || values["object-name"] !== undefined) {
    throw new Error("STATUS_FLAG_REQUIRED");
  }
  if (!values.report || !values.approval || values["execute-approved-generations"] !== true) throw new Error("EXPLICIT_REPORT_APPROVAL_AND_EXECUTION_FLAG_REQUIRED");
  const [reportBytes, envelopeBytes] = await Promise.all([
    readBounded(values.report, 128 * 1024 * 1024), readBounded(values.approval, 256 * 1024),
  ]);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  // Status mode returns before any storage/executor module is imported.
  const [{ clipFile }, { runApprovedClipCleanup }, { approvedCleanupStorage }] = await Promise.all([
    import("../lib/clip-storage.js"),
    import("../lib/clip-approved-cleanup.js"),
    import("../lib/clip-approved-cleanup-gcs.js"),
  ]);
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
  console.error("Approved cleanup command failed closed. Check --help, database access/provisioning and output file permissions. Execution additionally requires valid ownership, signature, fresh report and matching references/metadata. No error details are exported.");
  process.exitCode = 1;
});
