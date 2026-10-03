import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { postJournal, reverseJournal, splitNet7030 } from "./finance-ledger";
import { systemWallets } from "./finance-events";

/**
 * Finance is deliberately simulation-only.
 *
 * This is a code-level invariant rather than an environment-controlled mode:
 * no deployment flag can turn on remote money movement accidentally.
 */
export function financeOperatingMode() {
  return { simulation: true, moneyMovementEnabled: false, operatingMode: "simulation" as const };
}

export const FINANCE_SIMULATION_MODE = true;
export const FINANCE_MONEY_MOVEMENT_ENABLED = false;

export function simulationRefundNeeded(status:string,amountMinor:number,refundedMinor:number):boolean {
  return status==="simulated" && refundedMinor<amountMinor;
}
export async function simulatePayment(input:{userId:number;beneficiaryId:string;amountMinor:number;currency:string;idempotencyKey:string;description:string}) {
  await pool.query("INSERT INTO split_policies (id,version,platform_bps,beneficiary_bps,active) VALUES ($1,2,4000,6000,true) ON CONFLICT (version) DO NOTHING",[crypto.randomUUID()]);
  const owned=await pool.query("SELECT b.id,w.id wallet_id FROM beneficiaries b JOIN wallets w ON w.entity_id=b.entity_id AND w.asset='fiat' AND w.currency=$3 WHERE b.id=$1 AND b.owner_user_id=$2",[input.beneficiaryId,input.userId,input.currency]);
  if(!owned.rows[0]) throw new Error("Owned beneficiary fiat wallet not found");
  const prior=await pool.query("SELECT id FROM journals WHERE idempotency_key=$1",[input.idempotencyKey]);
  if(prior.rows[0]) return {journalId:prior.rows[0].id,duplicate:true};
  const sys=await systemWallets(input.currency); const split=splitNet7030(input.amountMinor);
  const posted=await postJournal({sourceRef:`simulation:payment:${input.idempotencyKey}`,idempotencyKey:input.idempotencyKey,kind:"simulation_payment",entries:[
    {walletId:sys.clearing,amountMinor:-input.amountMinor,currency:input.currency},
    {walletId:owned.rows[0].wallet_id,amountMinor:split.beneficiaryMinor,currency:input.currency},
    {walletId:sys.revenue,amountMinor:split.platformMinor,currency:input.currency},
  ],metadata:{simulation:true,description:input.description}});
  await pool.query(`INSERT INTO payment_allocations (id,payment_ref,beneficiary_id,policy_id,amount_minor,currency,status)
    SELECT $1,$2,$3,id,$4,$5,'simulated' FROM split_policies WHERE version=2
    ON CONFLICT (payment_ref,beneficiary_id) DO NOTHING`,[crypto.randomUUID(),`simulation:${input.idempotencyKey}`,input.beneficiaryId,split.beneficiaryMinor,input.currency]);
  return {journalId:posted.id,duplicate:posted.duplicate,...split};
}
export async function simulateRefund(input:{userId:number;journalId:string;idempotencyKey:string}) {
  const client=await pool.connect(); try { await client.query("BEGIN");
  const own=await client.query(`SELECT j.id,j.source_ref FROM journals j JOIN journal_entries e ON e.journal_id=j.id JOIN wallets w ON w.id=e.wallet_id
    JOIN finance_entities f ON f.id=w.entity_id WHERE j.id=$1 AND f.user_id=$2 AND j.kind='simulation_payment' LIMIT 1`,[input.journalId,input.userId]);
  if(!own.rows[0]) throw new Error("Simulation payment not found");
  const paymentRef=String(own.rows[0].source_ref).replace("simulation:payment:","simulation:");
  const allocation=await client.query<{amount_minor:string;refunded_minor:string;status:string}>("SELECT amount_minor,refunded_minor,status FROM payment_allocations WHERE payment_ref=$1 FOR UPDATE",[paymentRef]);
  const a=allocation.rows[0]; if(!a) throw new Error("Simulation allocation not found");
  if(!simulationRefundNeeded(a.status,Number(a.amount_minor),Number(a.refunded_minor))) {
    const prior=await client.query<{id:string}>("SELECT id FROM journals WHERE reversal_of_id=$1 ORDER BY created_at LIMIT 1",[input.journalId]);
    if(!prior.rows[0]) throw new Error("Simulation allocation is reversed but reversal journal is missing");
    await client.query("COMMIT"); return {id:prior.rows[0].id,duplicate:true};
  }
  const result=await reverseJournal(input.journalId,input.idempotencyKey,client);
  const reversal=await client.query<{reversal_of_id:string|null}>("SELECT reversal_of_id FROM journals WHERE id=$1",[result.id]);
  if(reversal.rows[0]?.reversal_of_id!==input.journalId) throw new Error("Idempotency key belongs to another journal");
  await client.query("UPDATE payment_allocations SET refunded_minor=amount_minor,status='reversed' WHERE payment_ref=$1",[paymentRef]);
  await client.query("COMMIT"); return result;
  } catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;} finally{client.release();}
}