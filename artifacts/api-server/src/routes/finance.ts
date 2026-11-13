import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { CURRENT_TERMS_VERSION, requireAdmin, splitNet7030 } from "../lib/finance-ledger";
import { reconcileFinance } from "../jobs/finance-reconciliation";
import { FINANCE_SIMULATION_MODE, simulatePayment, simulateRefund } from "../lib/finance-simulation";
import { encryptPayoutDetails, maskAccount } from "../lib/payout-crypto";

const router: IRouter = Router();
const money = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const currency = (value: unknown) => typeof value === "string" && /^[a-z]{3}$/.test(value);
const user = (req: any) => req.session?.userId as number | undefined;
async function ownedBeneficiary(userId: number, beneficiaryId: string) {
  const r = await pool.query("SELECT * FROM beneficiaries WHERE id=$1 AND owner_user_id=$2", [beneficiaryId, userId]);
  return r.rows[0];
}
const asNumber = (value: unknown) => {
  const n = Number(value); return Number.isSafeInteger(n) ? n : 0;
};
async function beneficiaryView(userId: number, beneficiaryId?: string) {
  const result = await pool.query(`SELECT b.*,e.kind AS "ownerType",e.display_name AS "displayName",t.terms_version AS "termsVersion",t.accepted_at AS "termsAcceptedAt"
    FROM beneficiaries b JOIN finance_entities e ON e.id=b.entity_id
    LEFT JOIN LATERAL (SELECT * FROM terms_acceptances WHERE beneficiary_id=b.id ORDER BY accepted_at DESC LIMIT 1) t ON true
    WHERE b.owner_user_id=$1 ${beneficiaryId ? "AND b.id=$2" : ""} ORDER BY b.created_at DESC`, beneficiaryId ? [userId, beneficiaryId] : [userId]);
  return result.rows.map((b) => {
    const requirements = Array.isArray(b.requirements) ? b.requirements : [];
    // Keep the established response shape for existing clients, but never
    // expose or use a historical external-account identifier.
    const status = b.status === "disabled" ? "disabled" : "pending";
    return { id: b.id, status, ownerType: b.ownerType, displayName: b.displayName, termsAccepted: b.termsVersion === CURRENT_TERMS_VERSION,
      termsVersion: b.termsVersion ?? null, termsAcceptedAt: b.termsAcceptedAt ?? null,
      country: b.country ?? null, chargesEnabled: false, payoutsEnabled: false, requirementsDue: requirements, requirements,
      canPayout: false, eligibilityConfirmed: false, restrictionReason: "Finance is simulation-only; external payouts are disabled" };
  });
}
async function admin(req: any, res: any): Promise<number | null> {
  const id = user(req); if (!(await requireAdmin(id))) { res.status(403).json({ error: "Admin session required" }); return null; } return id!;
}

router.get("/finance/wallet", async (req, res): Promise<void> => {
  const id = user(req); if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const result = await pool.query(`SELECT w.id,w.asset,w.currency,w.available_minor,w.reserved_minor,w.pending_minor,w.paid_minor,w.income_minor,w.expense_minor
    FROM wallets w JOIN finance_entities e ON e.id=w.entity_id WHERE e.user_id=$1 ORDER BY w.asset,w.currency`, [id]);
  const wallets = result.rows.map((w) => ({ id: w.id, asset: w.asset, currency: w.currency, availableMinor: asNumber(w.available_minor), reservedMinor: asNumber(w.reserved_minor), pendingMinor: asNumber(w.pending_minor), paidMinor: asNumber(w.paid_minor), incomeMinor: asNumber(w.income_minor), expenseMinor: asNumber(w.expense_minor) }));
  const fiatWallet = wallets.find((w) => w.asset === "fiat");
  const coins = wallets.find((w) => w.asset === "coin");
  const entries = await pool.query(`SELECT je.id,j.kind,je.amount_minor,je.currency,j.created_at FROM journal_entries je JOIN journals j ON j.id=je.journal_id
    JOIN wallets w ON w.id=je.wallet_id JOIN finance_entities e ON e.id=w.entity_id WHERE e.user_id=$1 ORDER BY je.created_at DESC LIMIT 100`, [id]);
  const beneficiaries = await beneficiaryView(id);
  res.json({ coinBalance: coins?.availableMinor ?? 0, coins: { balance: coins?.availableMinor ?? 0 }, fiat: { available: fiatWallet?.availableMinor ?? 0, pending: fiatWallet?.pendingMinor ?? 0, reserved: fiatWallet?.reservedMinor ?? 0, paid: fiatWallet?.paidMinor ?? 0, income: fiatWallet?.incomeMinor ?? 0, expense: fiatWallet?.expenseMinor ?? 0, currency: fiatWallet?.currency ?? "usd" },
    entries: entries.rows.map((e) => ({ id: e.id, type: e.kind, amountMinor: asNumber(e.amount_minor), currency: e.currency, description: e.kind, createdAt: e.created_at.toISOString(), immutable: true })), wallets, beneficiary: beneficiaries[0] ?? { status: "none" }, beneficiaries });
});
router.get("/finance/terms", async (_req, res): Promise<void> => {
  res.json({
    currentVersion: CURRENT_TERMS_VERSION,
    termsVersion: CURRENT_TERMS_VERSION,
    simulation: true,
    moneyMovementEnabled: false,
    operatingMode: "simulation",
  });
});
router.post("/finance/beneficiaries/accept-terms", async (req, res): Promise<void> => {
  const id = user(req); const { ownerType, entityType, displayName, legalName, country, accepted, termsVersion } = req.body ?? {};
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const kind = ownerType ?? entityType;
  if (!accepted || !["user", "citizen", "event", "company"].includes(kind) || typeof country !== "string" || !/^[A-Za-z]{2}$/.test(country) || typeof (displayName ?? legalName) !== "string" || !(displayName ?? legalName).trim() || (termsVersion && termsVersion !== CURRENT_TERMS_VERSION)) { res.status(400).json({ error: "Acceptance, supported owner type, legal name, country, and current terms version are required", termsVersion: CURRENT_TERMS_VERSION }); return; }
  const client = await pool.connect(); let beneficiaryId: string;
  try {
    await client.query("BEGIN");
    const entity = await client.query("SELECT id FROM finance_entities WHERE user_id=$1 AND kind=$2 LIMIT 1 FOR UPDATE", [id, kind]);
    const entityId = entity.rows[0]?.id ?? crypto.randomUUID();
    if (!entity.rows[0]) await client.query("INSERT INTO finance_entities (id,kind,user_id,display_name,country) VALUES ($1,$2,$3,$4,$5)", [entityId, kind, id, (displayName ?? legalName).trim(), country.toUpperCase()]);
    const existing = await client.query("SELECT id FROM beneficiaries WHERE entity_id=$1 FOR UPDATE", [entityId]); beneficiaryId = existing.rows[0]?.id ?? crypto.randomUUID();
    if (!existing.rows[0]) await client.query("INSERT INTO beneficiaries (id,owner_user_id,entity_id,type,status,country) VALUES ($1,$2,$3,$4,'pending',$5)", [beneficiaryId, id, entityId, kind, country.toUpperCase()]);
    for (const [asset, c] of [["coin", "coin"], ["fiat", "usd"]] as const) await client.query("INSERT INTO wallets (id,entity_id,asset,currency) VALUES ($1,$2,$3,$4) ON CONFLICT (entity_id,asset,currency) DO NOTHING", [crypto.randomUUID(), entityId, asset, c]);
    const ipHash = crypto.createHash("sha256").update(String(req.ip)).digest("hex");
    await client.query(`INSERT INTO terms_acceptances (id,beneficiary_id,terms_version,accepted_by_user_id,ip_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (beneficiary_id,terms_version) DO NOTHING`, [crypto.randomUUID(), beneficiaryId, CURRENT_TERMS_VERSION, id, ipHash]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  res.status(201).json({ beneficiary: (await beneficiaryView(id, beneficiaryId))[0] });
});
router.post("/finance/connect/onboarding", async (req, res): Promise<void> => {
  const id = user(req); let beneficiaryId = req.body?.beneficiaryId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (typeof beneficiaryId !== "string") beneficiaryId = (await beneficiaryView(id))[0]?.id;
  const beneficiary = typeof beneficiaryId === "string" ? await ownedBeneficiary(id, beneficiaryId) : null;
  if (!beneficiary || beneficiary.type === "infrastructure_cost_center") { res.status(400).json({ error: "Invalid beneficiary" }); return; }
  const accepted = await pool.query("SELECT id FROM terms_acceptances WHERE beneficiary_id=$1 AND terms_version=$2", [beneficiaryId, CURRENT_TERMS_VERSION]);
  if (!accepted.rows[0]) { res.status(409).json({ error: "Current terms must be accepted before onboarding", termsVersion: CURRENT_TERMS_VERSION }); return; }
  await pool.query("UPDATE beneficiaries SET status='pending' WHERE id=$1", [beneficiaryId]);
  // Preserve the response shape used by existing clients while making the
  // retired onboarding action an explicit no-op.
  res.json({
    url: `/finance/simulated-connect?beneficiaryId=${encodeURIComponent(beneficiaryId)}`,
    simulated: true,
    disabled: true,
    code: "FINANCE_SIMULATION_ONLY",
    message: "Finance is simulation-only; no external account was created",
  });
});
router.post("/finance/connect/refresh", async (req, res): Promise<void> => {
  const id = user(req); let beneficiaryId = req.body?.beneficiaryId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (typeof beneficiaryId !== "string") beneficiaryId = (await beneficiaryView(id))[0]?.id;
  if (!beneficiaryId) { res.status(404).json({ error: "Beneficiary not found" }); return; }
  const beneficiary = await ownedBeneficiary(id, beneficiaryId);
  if (!beneficiary) { res.status(404).json({ error: "Beneficiary not found" }); return; }
  res.json({
    beneficiary: (await beneficiaryView(id, beneficiaryId))[0],
    url: null,
    simulated: true,
    disabled: true,
    code: "FINANCE_SIMULATION_ONLY",
  });
});
router.post("/finance/checkout", async (req, res): Promise<void> => {
  const id = user(req);
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.status(410).json({
    error: "Checkout is disabled; use the simulation payment endpoint",
    code: "FINANCE_SIMULATION_ONLY",
    disabled: true,
    simulation: true,
    moneyMovementEnabled: false,
  });
});
router.post("/finance/payouts", async (req, res): Promise<void> => {
  const id = user(req);
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.status(409).json({
    error: "Operational payouts are disabled; submit a manual payout request",
    code: "FINANCE_SIMULATION_ONLY",
    disabled: true,
    simulated: true,
    moneyMovementEnabled: false,
  });
});
router.post("/finance/simulation/payments", async(req,res):Promise<void>=>{
  const id=user(req); if(!id){res.status(401).json({error:"Not authenticated"});return;}
  if(!FINANCE_SIMULATION_MODE){res.status(404).json({error:"Simulation endpoint disabled"});return;}
  const {beneficiaryId,amountMinor,currency:c,description,idempotencyKey}=req.body??{};
  if(typeof beneficiaryId!=="string"||!money(amountMinor)||!currency(c)||typeof description!=="string"||typeof idempotencyKey!=="string"||idempotencyKey.length<8){res.status(400).json({error:"Invalid simulation payment"});return;}
  try { const result=await simulatePayment({userId:id,beneficiaryId,amountMinor,currency:c,description,idempotencyKey}); res.status(201).json({payment:{id:`simulation:${idempotencyKey}`,amountMinor,currency:c,status:"simulated",simulated:true,...result}}); }
  catch(error){req.log.warn({err:error},"Simulation payment rejected");res.status(409).json({error:error instanceof Error?error.message:"Simulation failed"});}
});
router.post("/finance/simulation/refunds",async(req,res):Promise<void>=>{
  const id=user(req); if(!id){res.status(401).json({error:"Not authenticated"});return;} if(!FINANCE_SIMULATION_MODE){res.status(404).json({error:"Simulation endpoint disabled"});return;}
  const {journalId,idempotencyKey}=req.body??{}; if(typeof journalId!=="string"||typeof idempotencyKey!=="string"){res.status(400).json({error:"journalId and idempotencyKey required"});return;}
  try{const result=await simulateRefund({userId:id,journalId,idempotencyKey});res.status(201).json({refund:{journalId:result.id,reversalOf:journalId,duplicate:result.duplicate,simulated:true}});}catch(error){res.status(409).json({error:error instanceof Error?error.message:"Refund failed"});}
});
router.put("/finance/beneficiaries/:id/payout-details",async(req,res):Promise<void>=>{
  const id=user(req); if(!id){res.status(401).json({error:"Not authenticated"});return;} const beneficiaryId=String(req.params.id);
  const beneficiary=await ownedBeneficiary(id,beneficiaryId); if(!beneficiary||!["event","company"].includes(beneficiary.type)){res.status(403).json({error:"Manual bank details are limited to owned event/company beneficiaries"});return;}
  const {accountHolder,bankName,accountNumber,routingCode}=req.body??{}; if(![accountHolder,bankName,accountNumber].every(x=>typeof x==="string"&&x.trim())){res.status(400).json({error:"Invalid payout details"});return;}
  const secret=process.env.SESSION_SECRET??(process.env.NODE_ENV==="production"?"":"gdna-arena-dev-secret"); if(!secret){res.status(503).json({error:"Secure payout storage unavailable"});return;}
  const encrypted=encryptPayoutDetails({accountHolder,bankName,accountNumber,routingCode:typeof routingCode==="string"?routingCode:null},secret); const detailId=crypto.randomUUID(),masked=maskAccount(accountNumber);
  const r=await pool.query(`INSERT INTO beneficiary_payout_details (id,beneficiary_id,encrypted_payload,masked_account,updated_by_user_id) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (beneficiary_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,masked_account=excluded.masked_account,updated_by_user_id=excluded.updated_by_user_id,updated_at=now() RETURNING id,masked_account`,[detailId,beneficiaryId,encrypted,masked,id]);
  await pool.query("INSERT INTO admin_audit_events (id,admin_user_id,action,target_ref,metadata) VALUES ($1,$2,'update_payout_details',$3,'{}')",[crypto.randomUUID(),id,beneficiaryId]);
  res.json({payoutDetails:{id:r.rows[0].id,beneficiaryId,maskedAccount:r.rows[0].masked_account}});
});
router.post("/finance/manual-payouts",async(req,res):Promise<void>=>{
  const id=user(req); if(!id){res.status(401).json({error:"Not authenticated"});return;} const {beneficiaryId,period,currency:c}=req.body??{};
  const verification=await pool.query("SELECT status,name_matches FROM royal_verifications WHERE user_id=$1",[id]);
  if(verification.rows[0]?.status!=="verified"||verification.rows[0]?.name_matches!==true){res.status(409).json({error:"Royal account verification and matching bank-holder name are required. Earnings remain frozen."});return;}
  if(typeof beneficiaryId!=="string"||typeof period!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)||!currency(c)){res.status(400).json({error:"Invalid monthly payout request"});return;}
   if(FINANCE_SIMULATION_MODE){res.status(409).json({error:"Manual payout requests are disabled in finance simulation mode.",simulated:true,code:"FINANCE_SIMULATION_ONLY"});return;}
  const client=await pool.connect(); try { await client.query("BEGIN");
  // Serializes every period for this beneficiary/currency so concurrent requests
  // can only reserve the balance once.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`manual-payout:${beneficiaryId}:${c}`]);
  const b=await client.query("SELECT * FROM beneficiaries WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",[beneficiaryId,id]); if(!b.rows[0]||!["event","company"].includes(b.rows[0].type)){await client.query("ROLLBACK");res.status(403).json({error:"Owned event/company beneficiary required"});return;}
  const details=await client.query("SELECT id FROM beneficiary_payout_details WHERE beneficiary_id=$1 FOR UPDATE",[beneficiaryId]); if(!details.rows[0]){await client.query("ROLLBACK");res.status(409).json({error:"Encrypted payout details required"});return;}
  const totals=await client.query(`SELECT COALESCE(SUM(p.amount_minor-p.refunded_minor),0)::bigint payable FROM payment_allocations p WHERE p.beneficiary_id=$1 AND p.currency=$2 AND p.status IN ('confirmed','refunded','reversed') AND p.payment_ref NOT LIKE 'simulation:%'`,[beneficiaryId,c]);
  const committed=await client.query(`SELECT COALESCE(SUM(reserved_minor),0)::bigint committed FROM manual_payout_requests WHERE beneficiary_id=$1 AND currency=$2 AND operational_verified=true AND status IN ('pending','approved','paid')`,[beneficiaryId,c]);
  const amountMinor=Math.max(0,asNumber(totals.rows[0].payable)-asNumber(committed.rows[0].committed)); if(amountMinor<=0){await client.query("ROLLBACK");res.status(409).json({error:"No payable 70% ledger allocation available"});return;}
  const requestId=crypto.randomUUID(); const r=await client.query(`INSERT INTO manual_payout_requests (id,beneficiary_id,payout_details_id,period,amount_minor,reserved_minor,currency,requested_by_user_id,operational_verified) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,true)
    ON CONFLICT (beneficiary_id,period,currency) DO NOTHING RETURNING *`,[requestId,beneficiaryId,details.rows[0].id,period,amountMinor,c,id]); if(!r.rows[0]){await client.query("ROLLBACK");res.status(409).json({error:"Monthly payout already requested"});return;}
  await client.query("COMMIT");res.status(201).json({payout:{id:requestId,status:"pending",provider:"redotpay_manual",amountMinor,currency:c,period,automated:false,reservedMinor:amountMinor}});
  } catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;} finally{client.release();}
});
router.get("/finance/manual-payouts",async(req,res):Promise<void>=>{
  const id=user(req);if(!id){res.status(401).json({error:"Not authenticated"});return;}
  const r=await pool.query(`SELECT m.*,d.masked_account FROM manual_payout_requests m JOIN beneficiaries b ON b.id=m.beneficiary_id
    JOIN beneficiary_payout_details d ON d.id=m.payout_details_id WHERE b.owner_user_id=$1 ORDER BY m.created_at DESC`,[id]);
  res.json({payouts:r.rows.map(x=>({id:x.id,beneficiaryId:x.beneficiary_id,status:x.status,provider:x.provider,amountMinor:asNumber(x.amount_minor),currency:x.currency,period:x.period,maskedAccount:x.masked_account,automated:false,createdAt:x.created_at.toISOString()}))});
});
router.get("/finance/admin/manual-payouts",async(req,res):Promise<void>=>{
  if(!(await admin(req,res)))return;const r=await pool.query(`SELECT m.*,d.masked_account,e.display_name FROM manual_payout_requests m JOIN beneficiaries b ON b.id=m.beneficiary_id JOIN finance_entities e ON e.id=b.entity_id JOIN beneficiary_payout_details d ON d.id=m.payout_details_id ORDER BY m.created_at DESC`);
  res.json({payouts:r.rows.map(x=>({id:x.id,beneficiaryId:x.beneficiary_id,displayName:x.display_name,status:x.status,provider:x.provider,amountMinor:asNumber(x.amount_minor),currency:x.currency,period:x.period,maskedAccount:x.masked_account,automated:false,createdAt:x.created_at.toISOString()}))});
});
router.patch("/finance/admin/manual-payouts/:id",async(req,res):Promise<void>=>{
  const adminId=await admin(req,res);if(!adminId)return;const status=req.body?.status,note=typeof req.body?.note==="string"?req.body.note.slice(0,500):null;
  if(FINANCE_SIMULATION_MODE){res.status(409).json({error:"Manual payout approval and payment are disabled in finance simulation mode.",simulated:true,code:"FINANCE_SIMULATION_ONLY"});return;}
  const from:Record<string,string[]>={approved:["pending"],rejected:["pending"],paid:["approved"]};if(!from[status]){res.status(400).json({error:"Invalid status"});return;}
  const r=await pool.query("UPDATE manual_payout_requests SET status=$1,reviewed_by_user_id=$2,review_note=$3,updated_at=now() WHERE id=$4 AND status=ANY($5) AND ($1='rejected' OR operational_verified=true) RETURNING *",[status,adminId,note,String(req.params.id),from[status]]);
  if(!r.rows[0]){res.status(409).json({error:"Invalid or already-applied transition"});return;}await pool.query("INSERT INTO admin_audit_events (id,admin_user_id,action,target_ref,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)",[crypto.randomUUID(),adminId,`manual_payout_${status}`,String(req.params.id),JSON.stringify({note})]);
  res.json({payout:{id:r.rows[0].id,status:r.rows[0].status,provider:r.rows[0].provider,amountMinor:asNumber(r.rows[0].amount_minor),currency:r.rows[0].currency,period:r.rows[0].period,automated:false}});
});
router.get("/finance/invoices", async (req, res): Promise<void> => { const id = user(req); if (!id) { res.status(401).json({ error: "Not authenticated" }); return; } const r = await pool.query("SELECT id,reference,amount_minor,currency,created_at FROM invoices WHERE user_id=$1 ORDER BY created_at DESC", [id]); const invoices = r.rows.map((x) => ({ id: x.id, reference: x.reference, amountMinor: asNumber(x.amount_minor), currency: x.currency, status: "paid", createdAt: x.created_at.toISOString(), pdfUrl: null, description: `Confirmed payment ${x.reference}` })); res.json({ invoices, total: invoices.length }); });
router.get("/finance/admin/dashboard", async (req, res): Promise<void> => { if (!(await admin(req,res))) return; const r = await pool.query("SELECT currency,SUM(available_minor)::text AS available,SUM(reserved_minor)::text AS reserved FROM wallets WHERE asset='fiat' GROUP BY currency"); const issues = await pool.query("SELECT COUNT(*)::int AS count FROM reconciliation_issues WHERE status='open'"); res.json({ fiat: r.rows, openReconciliationIssues: issues.rows[0].count }); });
router.post("/finance/admin/costs/meter", async (req, res): Promise<void> => { const adminId = await admin(req,res); if (!adminId) return; const { provider, metric, quantity, unit, sourceRef, observedAt } = req.body ?? {}; if (![provider,metric,unit,sourceRef].every((x) => typeof x === "string") || !Number.isSafeInteger(quantity) || quantity < 0) { res.status(400).json({ error: "Invalid usage record" }); return; } const rate = await pool.query("SELECT * FROM rate_cards WHERE provider=$1 AND metric=$2 AND unit=$3 AND effective_at<=now() ORDER BY version DESC,effective_at DESC LIMIT 1", [provider,metric,unit]); if (!rate.rows[0]) { res.status(409).json({ error: "No effective rate card; cost cannot be settled" }); return; } const amountMinor = quantity * asNumber(rate.rows[0].unit_price_minor); const usageId = crypto.randomUUID(); await pool.query("INSERT INTO provider_usage_records (id,provider,metric,quantity,unit,source_ref,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (source_ref) DO NOTHING", [usageId,provider,metric,quantity,unit,sourceRef,observedAt ? new Date(observedAt) : new Date()]); await pool.query("INSERT INTO provider_cost_records (id,usage_record_id,cost_center_entity_id,amount_minor,currency,estimated,rate_card_version) SELECT $1,$2,e.id,$3,$4,true,$5 FROM finance_entities e WHERE e.kind='infrastructure_cost_center' LIMIT 1", [crypto.randomUUID(),usageId,amountMinor,rate.rows[0].currency,rate.rows[0].version]); await pool.query("INSERT INTO admin_audit_events (id,admin_user_id,action,target_ref) VALUES ($1,$2,'meter_usage',$3)", [crypto.randomUUID(),adminId,sourceRef]); res.status(201).json({ estimated: true, amountMinor, currency: rate.rows[0].currency, rateCardVersion: rate.rows[0].version }); });
router.post("/finance/admin/reconcile", async (req, res): Promise<void> => { const adminId = await admin(req,res); if (!adminId) return; const issuesCreated=await reconcileFinance(); await pool.query("INSERT INTO admin_audit_events (id,admin_user_id,action,target_ref) VALUES ($1,$2,'reconcile','finance')", [crypto.randomUUID(),adminId]); res.json({ issuesCreated }); });
export { splitNet7030 };
export default router;
