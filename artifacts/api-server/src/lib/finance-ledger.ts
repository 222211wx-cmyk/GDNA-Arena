import crypto from "node:crypto";
import { pool } from "@workspace/db";

export type Posting = { walletId: string; amountMinor: number; currency: string };
type TransactionClient = { query: <T = any>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };
export const CURRENT_TERMS_VERSION = "finance-life-path-60-40";

export function splitNet7030(netMinor: number): { beneficiaryMinor: number; platformMinor: number } {
  if (!Number.isSafeInteger(netMinor) || netMinor < 0) throw new Error("netMinor must be a non-negative integer");
  // Floor the platform share; residual always belongs to the beneficiary, deterministically.
  const platformMinor = Number(BigInt(netMinor) * 40n / 100n);
  return { beneficiaryMinor: netMinor - platformMinor, platformMinor };
}
export function remainingManualPayable(allocations: Array<{ amountMinor:number; refundedMinor:number }>, reservedMinor:number): number {
  return Math.max(0, allocations.reduce((sum,a)=>sum+Math.max(0,a.amountMinor-a.refundedMinor),0)-reservedMinor);
}
export function isOperationalAllocation(allocation:{status:string;paymentRef:string}):boolean {
  return ["confirmed","refunded","reversed"].includes(allocation.status) && !allocation.paymentRef.startsWith("simulation:");
}

export async function postJournal(input: {
  sourceRef: string; idempotencyKey: string; kind: string; entries: Posting[];
  reversalOfId?: string; metadata?: Record<string, unknown>; client?: TransactionClient;
}): Promise<{ id: string; duplicate: boolean }> {
  if (!input.entries.length || input.entries.some((x) => !Number.isSafeInteger(x.amountMinor) || !/^[a-z]{3,12}$/.test(x.currency))) {
    throw new Error("Invalid postings");
  }
  const sums = new Map<string, number>();
  for (const entry of input.entries) sums.set(entry.currency, (sums.get(entry.currency) ?? 0) + entry.amountMinor);
  if ([...sums.values()].some((value) => value !== 0)) throw new Error("Journal postings must balance by currency");
  const ownedClient = !input.client;
  const client = input.client ?? await pool.connect();
  try {
    if (ownedClient) await client.query("BEGIN");
    // An advisory lock makes idempotency deterministic even before unique-index conflict resolution.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`finance:${input.idempotencyKey}`]);
    const prior = await client.query<{ id: string }>("SELECT id FROM journals WHERE idempotency_key=$1", [input.idempotencyKey]);
    if (prior.rows[0]) { if (ownedClient) await client.query("COMMIT"); return { id: prior.rows[0].id, duplicate: true }; }
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO journals (id, source_ref, idempotency_key, kind, reversal_of_id, metadata)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [id, input.sourceRef, input.idempotencyKey, input.kind, input.reversalOfId ?? null, JSON.stringify(input.metadata ?? {})]);
    for (const entry of input.entries) {
      const wallet = await client.query<{ currency: string }>("SELECT currency FROM wallets WHERE id=$1 FOR UPDATE", [entry.walletId]);
      if (!wallet.rows[0] || wallet.rows[0].currency !== entry.currency) throw new Error("Posting wallet/currency mismatch");
      await client.query(`INSERT INTO journal_entries (id,journal_id,wallet_id,amount_minor,currency) VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), id, entry.walletId, entry.amountMinor, entry.currency]);
      await client.query("UPDATE wallets SET available_minor=available_minor+$1 WHERE id=$2", [entry.amountMinor, entry.walletId]);
    }
    if (ownedClient) await client.query("COMMIT");
    return { id, duplicate: false };
  } catch (error) {
    if (ownedClient) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { if (ownedClient) (client as any).release(); }
}

export async function reverseJournal(journalId: string, idempotencyKey: string, suppliedClient?: TransactionClient): Promise<{ id: string; duplicate: boolean }> {
  const client=suppliedClient??pool;
  const result = await client.query<{ source_ref: string; kind: string }>("SELECT source_ref, kind FROM journals WHERE id=$1", [journalId]);
  if (!result.rows[0]) throw new Error("Journal not found");
  const entries = await client.query<Posting>("SELECT wallet_id AS \"walletId\", amount_minor::int AS \"amountMinor\", currency FROM journal_entries WHERE journal_id=$1", [journalId]);
  return postJournal({
    sourceRef: `reversal:${result.rows[0].source_ref}`, idempotencyKey, kind: `${result.rows[0].kind}_reversal`,
    reversalOfId: journalId, entries: entries.rows.map((e) => ({ ...e, amountMinor: -e.amountMinor })), client:suppliedClient,
  });
}

export async function requireAdmin(userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  const result = await pool.query<{ is_admin: boolean }>("SELECT is_admin FROM users WHERE id=$1", [userId]);
  return result.rows[0]?.is_admin === true;
}