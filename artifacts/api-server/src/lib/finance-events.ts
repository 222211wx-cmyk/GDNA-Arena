import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { getUncachableStripeClient } from "../stripeClient";
import { postJournal, splitNet7030 } from "./finance-ledger";

type System = Record<"clearing"|"revenue"|"fees"|"taxes"|"refunds"|"agora"|"server", string>;
type TransactionClient = { query: <T = any>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };
export function paymentPlan(gross: number, fee: number, tax: number) {
  const net = Math.max(0, gross - fee - tax); const split = splitNet7030(net);
  return { net, ...split, fee, tax };
}
export function paymentPostingAmounts(gross:number,fee:number,tax:number,beneficiary:number,platform:number) {
  return {clearing:-gross,fees:fee,taxes:tax,beneficiary,platform};
}
export function refundPostingAmounts(beneficiary:number,platform:number) {
  return {beneficiary:-beneficiary,platform:-platform,clearing:beneficiary+platform};
}
export function refundPlan(originalNet: number, refundedGross: number, gross: number) {
  return Math.min(originalNet, Math.floor((originalNet * refundedGross) / gross));
}
export function refundDelta(originalBeneficiary:number, originalPlatform:number, gross:number, cumulativeRefunded:number, alreadyBeneficiary:number, alreadyPlatform:number) {
  const targetBeneficiary=Math.min(originalBeneficiary,Math.floor(originalBeneficiary*cumulativeRefunded/gross));
  const targetPlatform=Math.min(originalPlatform,Math.floor(originalPlatform*cumulativeRefunded/gross));
  return { beneficiary:Math.max(0,targetBeneficiary-alreadyBeneficiary),platform:Math.max(0,targetPlatform-alreadyPlatform) };
}
/** Reconciliation outcomes are handled outcomes, not retryable failures. */
export function webhookReceiptOutcome(outcome: "accounted" | "reconciled" | "unexpected"): "completed" | "retry" {
  return outcome === "unexpected" ? "retry" : "completed";
}
export function payoutTransition(status:string): "paid"|"failed"|null {
  if(status==="paid") return "paid";
  if(["failed","canceled"].includes(status)) return "failed";
  return null;
}
export async function settleStripePayout(payoutId:string, status:string, eventId:string):Promise<boolean> {
  const target=payoutTransition(status); if(!target) return false;
  const client=await pool.connect();
  try { await client.query("BEGIN");
    const request=await client.query<{id:string;wallet_id:string;amount_minor:string;currency:string;status:string}>(
      "SELECT id,wallet_id,amount_minor,currency,status FROM payout_requests WHERE stripe_payout_id=$1 FOR UPDATE",[payoutId]);
    const p=request.rows[0]; if(!p || ["paid","failed"].includes(p.status)) { await client.query("COMMIT"); return false; }
    const wallet=await client.query<{id:string}>("SELECT id FROM wallets WHERE id=$1 FOR UPDATE",[p.wallet_id]); if(!wallet.rows[0]) throw new Error("Payout wallet missing");
    const amount=Number(p.amount_minor); const sys=await systemWallets(p.currency,client);
    if(target==="paid") {
      await postJournal({sourceRef:`stripe:payout:${payoutId}:settled`,idempotencyKey:`stripe:${eventId}:settlement`,kind:"payout_settlement",entries:[
        {walletId:p.wallet_id,amountMinor:-amount,currency:p.currency},{walletId:sys.clearing,amountMinor:amount,currency:p.currency}],metadata:{stripePayoutId:payoutId,eventId},client});
      // postJournal debits available; restore it because this evidence settles
      // a prior reservation, then move reserved funds to the paid bucket.
      const moved=await client.query<{id:string}>("UPDATE wallets SET available_minor=available_minor+$1,reserved_minor=reserved_minor-$1,paid_minor=paid_minor+$1 WHERE id=$2 AND reserved_minor>=$1 RETURNING id",[amount,p.wallet_id]);
      if(!moved.rows[0]) throw new Error("Payout reservation is missing");
    } else {
      await postJournal({sourceRef:`stripe:payout:${payoutId}:released`,idempotencyKey:`stripe:${eventId}:release`,kind:"payout_release",entries:[
        {walletId:p.wallet_id,amountMinor:amount,currency:p.currency},{walletId:sys.clearing,amountMinor:-amount,currency:p.currency}],metadata:{stripePayoutId:payoutId,eventId},client});
      const released=await client.query<{id:string}>("UPDATE wallets SET reserved_minor=reserved_minor-$1 WHERE id=$2 AND reserved_minor>=$1 RETURNING id",[amount,p.wallet_id]);
      if(!released.rows[0]) throw new Error("Payout reservation is missing");
    }
    await client.query("UPDATE payout_requests SET status=$1,updated_at=now() WHERE id=$2",[target,p.id]);
    await client.query("COMMIT"); return true;
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; } finally { client.release(); }
}
export async function systemWallets(currency: string, suppliedClient?: TransactionClient): Promise<System> {
  const owned = !suppliedClient; const client = suppliedClient ?? await pool.connect(); const result = {} as System;
  try { if (owned) await client.query("BEGIN");
    for (const [key, name] of Object.entries({ clearing:"stripe_clearing", revenue:"platform_revenue", fees:"stripe_fees", taxes:"stripe_taxes", refunds:"stripe_refunds", agora:"agora_estimated_cost", server:"server_estimated_cost" })) {
      let entity = await client.query("SELECT id FROM finance_entities WHERE kind=$1 LIMIT 1", [name]);
      const entityId = entity.rows[0]?.id ?? crypto.randomUUID();
      if (!entity.rows[0]) await client.query("INSERT INTO finance_entities (id,kind,display_name) VALUES ($1,$2,$3)", [entityId,name,name]);
      let wallet = await client.query("SELECT id FROM wallets WHERE entity_id=$1 AND asset='fiat' AND currency=$2", [entityId,currency]);
      const walletId = wallet.rows[0]?.id ?? crypto.randomUUID();
      if (!wallet.rows[0]) await client.query("INSERT INTO wallets (id,entity_id,asset,currency) VALUES ($1,$2,'fiat',$3)", [walletId,entityId,currency]);
      result[key as keyof System] = walletId;
    } if (owned) await client.query("COMMIT"); return result;
  } catch (e) { if (owned) await client.query("ROLLBACK").catch(()=>undefined); throw e; } finally { if (owned) (client as any).release(); }
}
async function paymentFacts(paymentIntentId: string) {
  const stripe = await getUncachableStripeClient(); const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand:["latest_charge.balance_transaction"] });
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  if (!charge || !bt || typeof bt.fee !== "number" || typeof bt.net !== "number") return null;
  return { pi, charge, gross: pi.amount_received, fee: bt.fee, net: bt.net, tax: 0, currency: pi.currency, beneficiaryId: pi.metadata.beneficiaryId, payerUserId: Number(pi.metadata.payerUserId) };
}
export async function processStripeEvent(event: { id:string; type:string; data:{object:any} }): Promise<void> {
  // A failed handler deletes its processing receipt; a receipt only becomes
  // complete after the durable application accounting below succeeds.
  const receipt = await pool.query(`INSERT INTO webhook_receipts (id,stripe_event_id,type,status) VALUES ($1,$2,$3,'processing')
    ON CONFLICT (stripe_event_id) DO UPDATE SET status='processing',processed_at=now() WHERE webhook_receipts.status='failed' RETURNING id`, [crypto.randomUUID(),event.id,event.type]);
  if (!receipt.rows[0]) return;
  try {
  const complete = async () => pool.query("UPDATE webhook_receipts SET status='completed',processed_at=now() WHERE id=$1",[receipt.rows[0].id]);
  const object = event.data.object;
  if (event.type === "payment_intent.succeeded") {
    const facts = await paymentFacts(object.id);
    if (!facts || !facts.beneficiaryId || !Number.isSafeInteger(facts.payerUserId)) { await issue("missing_payment_facts", object.id, { event: event.id }); await complete(); return; }
    const beneficiary = await pool.query("SELECT b.*,w.id AS wallet_id FROM beneficiaries b JOIN wallets w ON w.entity_id=b.entity_id AND w.asset='fiat' AND w.currency=$2 WHERE b.id=$1", [facts.beneficiaryId,facts.currency]);
    if (!beneficiary.rows[0]) { await issue("missing_beneficiary_wallet",object.id,{}); await complete(); return; }
    const sys = await systemWallets(facts.currency); const plan=paymentPlan(facts.gross,facts.fee,facts.tax);
    const signs=paymentPostingAmounts(facts.gross,facts.fee,facts.tax,plan.beneficiaryMinor,plan.platformMinor);
    await postJournal({ sourceRef:`stripe:pi:${object.id}`,idempotencyKey:`stripe:${event.id}`,kind:"payment_success",entries:[
       {walletId:sys.clearing,amountMinor:signs.clearing,currency:facts.currency},{walletId:sys.fees,amountMinor:signs.fees,currency:facts.currency},
       {walletId:sys.taxes,amountMinor:signs.taxes,currency:facts.currency},{walletId:sys.revenue,amountMinor:signs.platform,currency:facts.currency},{walletId:beneficiary.rows[0].wallet_id,amountMinor:signs.beneficiary,currency:facts.currency},
    ],metadata:{stripeEventId:event.id,paymentIntentId:object.id}});
    await pool.query("INSERT INTO payment_allocations (id,payment_ref,beneficiary_id,policy_id,amount_minor,currency,status) SELECT $1,$2,$3,id,$4,$5,'confirmed' FROM split_policies WHERE active=true ORDER BY version DESC LIMIT 1 ON CONFLICT (payment_ref,beneficiary_id) DO NOTHING", [crypto.randomUUID(),object.id,facts.beneficiaryId,plan.beneficiaryMinor,facts.currency]);
    await pool.query("INSERT INTO invoices (id,reference,user_id,payment_ref,amount_minor,currency,tax_status) VALUES ($1,$2,$3,$4,$5,$6,'confirmed') ON CONFLICT (payment_ref) DO NOTHING", [crypto.randomUUID(),`INV-${object.id}`,facts.payerUserId,object.id,facts.gross,facts.currency]);
  } else if (event.type === "charge.refunded" || event.type === "refund.updated") {
    const stripe=await getUncachableStripeClient();
    const chargeId=event.type==="charge.refunded" ? object.id : object.charge;
    const charge=await stripe.charges.retrieve(chargeId,{expand:["balance_transaction"]});
    const piId=typeof charge.payment_intent==="string"?charge.payment_intent:charge.payment_intent?.id;
    if (!piId || !charge.amount || typeof charge.amount_refunded!=="number") { await issue("refund_missing_payment",object.id,{}); }
    else {
      const client=await pool.connect();
      try { await client.query("BEGIN");
      // This row lock serializes all cumulative refund snapshots for one payment.
      const allocation=await client.query<{beneficiary_id:string;amount_minor:string;refunded_minor:string;currency:string}>("SELECT beneficiary_id,amount_minor,refunded_minor,currency FROM payment_allocations WHERE payment_ref=$1 LIMIT 1 FOR UPDATE",[piId]);
      const original=await client.query<{platform:string}>("SELECT ABS(e.amount_minor)::text platform FROM journals j JOIN journal_entries e ON e.journal_id=j.id JOIN wallets w ON w.id=e.wallet_id JOIN finance_entities f ON f.id=w.entity_id WHERE j.source_ref=$1 AND f.kind='platform_revenue' LIMIT 1",[`stripe:pi:${piId}`]);
      if(!allocation.rows[0]||!original.rows[0]) { await client.query("ROLLBACK"); await issue("refund_without_payment_allocation",object.id,{paymentIntentId:piId}); }
      else {
        const a=allocation.rows[0], beneficiaryTotal=Number(a.amount_minor), platformTotal=Number(original.rows[0].platform);
        const already=Number(a.refunded_minor); const cumulative=Math.min(charge.amount,charge.amount_refunded);
        // Allocation tracks beneficiary reversal. Existing refund journals track
        // platform reversals exactly, avoiding duplicate/out-of-order over-credit.
        const previousPlatform=await client.query<{n:string}>(`SELECT COALESCE(SUM(je.amount_minor),0)::text n FROM journals j JOIN journal_entries je ON je.journal_id=j.id JOIN wallets w ON w.id=je.wallet_id JOIN finance_entities f ON f.id=w.entity_id WHERE j.kind='refund_share_reversal' AND j.metadata->>'paymentIntentId'=$1 AND f.kind='platform_revenue'`,[piId]);
         const clean=refundDelta(beneficiaryTotal,platformTotal,charge.amount,cumulative,already,Math.max(0,-Number(previousPlatform.rows[0].n)));
        if(clean.beneficiary||clean.platform) {
          const beneficiaryWallet=await client.query<{id:string}>("SELECT w.id FROM beneficiaries b JOIN wallets w ON w.entity_id=b.entity_id AND w.asset='fiat' AND w.currency=$2 WHERE b.id=$1",[a.beneficiary_id,a.currency]);
          if(!beneficiaryWallet.rows[0]) { await issue("refund_missing_beneficiary_wallet",object.id,{paymentIntentId:piId}); }
          else { const sys=await systemWallets(a.currency,client); const signs=refundPostingAmounts(clean.beneficiary,clean.platform);
            await postJournal({sourceRef:`stripe:refund:${object.id}`,idempotencyKey:`stripe:${event.id}`,kind:"refund_share_reversal",entries:[
               {walletId:beneficiaryWallet.rows[0].id,amountMinor:signs.beneficiary,currency:a.currency},{walletId:sys.revenue,amountMinor:signs.platform,currency:a.currency},
               {walletId:sys.clearing,amountMinor:signs.clearing,currency:a.currency},
            ],metadata:{stripeEventId:event.id,paymentIntentId:piId,cumulativeRefunded:cumulative},client});
            await client.query("UPDATE payment_allocations SET refunded_minor=refunded_minor+$1,status=CASE WHEN refunded_minor+$1>=amount_minor THEN 'reversed' ELSE 'refunded' END WHERE payment_ref=$2 AND beneficiary_id=$3",[clean.beneficiary,piId,a.beneficiary_id]);
          }
        }
        // A refund balance transaction is the only authority for fee recovery.
        // Principal/share reversals above remain defensible without it.
        const refundId=event.type==="refund.updated"?object.id:null;
        if(refundId){ const refund=await stripe.refunds.retrieve(refundId,{expand:["balance_transaction"]}); if(typeof refund.balance_transaction!=="object") await issue("refund_fee_recovery_unknown",refundId,{paymentIntentId:piId}); }
        else await issue("refund_fee_recovery_unknown",object.id,{paymentIntentId:piId});
        await client.query("COMMIT");
      }
      } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; } finally { client.release(); }
    }
  } else if (event.type.startsWith("charge.dispute.")) {
    await issue("stripe_dispute",object.id,{status:object.status,event:event.type});
  } else if (event.type.startsWith("payout.")) {
    await settleStripePayout(object.id,object.status,event.id);
  } else if (event.type.startsWith("transfer.")) {
    await issue("stripe_transfer_event",object.id,{status:object.status,event:event.type});
  }
  await complete();
  } catch (error) {
    await pool.query("DELETE FROM webhook_receipts WHERE id=$1 AND status='processing'",[receipt.rows[0].id]).catch(()=>undefined);
    throw error;
  }
}
export async function issue(kind:string, sourceRef:string, details:unknown) { await pool.query("INSERT INTO reconciliation_issues (id,kind,source_ref,details) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (kind,source_ref) DO NOTHING",[crypto.randomUUID(),kind,sourceRef,JSON.stringify(details)]); }