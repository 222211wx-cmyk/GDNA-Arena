import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
export async function reconcileFinance(): Promise<number> {
  const checks = [
    ["stale_payout_reservation","SELECT id FROM payout_requests WHERE status='reserved' AND created_at < now()-interval '15 minutes'"],
    ["negative_spendable_balance","SELECT id FROM wallets WHERE available_minor-reserved_minor<0"],
    ["journal_imbalance","SELECT j.id FROM journals j JOIN journal_entries e ON e.journal_id=j.id GROUP BY j.id,e.currency HAVING SUM(e.amount_minor)<>0"],
  ]; let count=0;
  for (const [kind,q] of checks) { const r=await pool.query(q); for (const row of r.rows) { const x=await pool.query("INSERT INTO reconciliation_issues (id,kind,source_ref,details) VALUES ($1,$2,$3,'{}') ON CONFLICT (kind,source_ref) DO NOTHING",[crypto.randomUUID(),kind,row.id]); count += x.rowCount ?? 0; } } return count;
}
export function startFinanceReconciliationJob() { const timer=setInterval(()=>reconcileFinance().catch((err)=>logger.error({err},"Finance reconciliation failed")),15*60_000); timer.unref(); }