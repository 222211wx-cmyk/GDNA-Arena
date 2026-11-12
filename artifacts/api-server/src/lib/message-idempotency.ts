import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const CLIENT_MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Optional client expectation, never an authentication identity. */
export function senderExpectationMatches(expected: unknown, authenticated: number) {
  return expected === undefined || (Number.isSafeInteger(expected) && expected === authenticated);
}
export function messageRequestHash(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/** Call inside the same transaction as message INSERT. Lock is sender-scoped;
 * the unique constraint is a second line of defence, not a check-then-insert race. */
export async function messageReplay(client: PoolClient, sender: number, id: string, hash: string) {
  await client.query("SELECT pg_advisory_xact_lock(47202,$1::int)", [sender]);
  const { rows } = await client.query(
    "SELECT request_hash,message FROM dm_send_receipts WHERE sender_id=$1 AND client_message_id=$2::uuid", [sender, id]);
  if (!rows.length) return { conflict: false, message: null };
  return { conflict: rows[0].request_hash !== hash, message: rows[0].message };
}

export async function saveMessageReceipt(client: PoolClient, sender: number, id: string, hash: string, message: unknown) {
  await client.query(`INSERT INTO dm_send_receipts(sender_id,client_message_id,request_hash,message)
    VALUES($1,$2::uuid,$3,$4::jsonb)`, [sender, id, hash, JSON.stringify(message)]);
}
