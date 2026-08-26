import assert from "node:assert/strict";
import test from "node:test";
import { paymentPlan, paymentPostingAmounts, refundPostingAmounts, refundPlan, refundDelta, webhookReceiptOutcome, payoutTransition } from "./finance-events.js";
import { splitNet7030, remainingManualPayable, isOperationalAllocation } from "./finance-ledger.js";
import { financeOperatingMode, stripeWebhookEnabled, simulationRefundNeeded } from "./finance-simulation.js";

test("confirmed payment uses authoritative net and exact residual split", () => {
  assert.deepEqual(paymentPlan(10_001, 301, 0), { net: 9_700, beneficiaryMinor: 6_790, platformMinor: 2_910, fee: 301, tax: 0 });
});
test("partial refund reverses proportionally without exceeding original net", () => {
  assert.equal(refundPlan(700, 25, 100), 175);
  assert.equal(refundPlan(700, 999, 100), 700);
});
test("dispute and payout retry keys are naturally idempotent", () => {
  const seen = new Set<string>(); const once = (key:string) => !seen.has(key) && (seen.add(key), true);
  assert.equal(once("payout:reserve:1"), true); assert.equal(once("payout:reserve:1"), false);
  assert.equal(once("dispute:hold:1"), true); assert.equal(once("dispute:hold:1"), false);
});
test("simulation postings balance in integer minor units",()=>{
  const gross=101,split=splitNet7030(gross);
  assert.equal(-gross+split.beneficiaryMinor+split.platformMinor,0);
  assert.deepEqual(split,{beneficiaryMinor:71,platformMinor:30});
});
test("full refund reverses all original beneficiary and platform shares",()=>{
  assert.deepEqual(refundDelta(700,300,1000,1000,0,0),{beneficiary:700,platform:300});
});
test("two partial refunds reach full amount without over-reversal",()=>{
  const first=refundDelta(700,300,1000,400,0,0);
  assert.deepEqual(first,{beneficiary:280,platform:120});
  const second=refundDelta(700,300,1000,1000,first.beneficiary,first.platform);
  assert.deepEqual(second,{beneficiary:420,platform:180});
  assert.deepEqual(refundDelta(700,300,1000,1000,700,300),{beneficiary:0,platform:0});
});
test("out-of-order cumulative refund cannot over-refund",()=>{
  // A later 80% snapshot has already reversed 560/240; an older 40% event is a no-op.
  assert.deepEqual(refundDelta(700,300,1000,400,560,240),{beneficiary:0,platform:0});
});
test("reconciliation outcomes complete webhook receipts while unexpected errors retry",()=>{
  assert.equal(webhookReceiptOutcome("reconciled"),"completed");
  assert.equal(webhookReceiptOutcome("accounted"),"completed");
  assert.equal(webhookReceiptOutcome("unexpected"),"retry");
});
test("simulation mode gates Stripe webhook before any credential access",()=>{
  assert.equal(stripeWebhookEnabled(true),false);
  assert.equal(stripeWebhookEnabled(false),true);
});
test("serialized cumulative snapshots compute a single second delta",()=>{
  const first=refundDelta(700,300,1000,600,0,0);
  const second=refundDelta(700,300,1000,600,first.beneficiary,first.platform);
  assert.deepEqual(second,{beneficiary:0,platform:0});
});
test("payout terminal transitions are idempotent terminal states",()=>{
  assert.equal(payoutTransition("paid"),"paid");
  assert.equal(payoutTransition("failed"),"failed");
  assert.equal(payoutTransition("canceled"),"failed");
  assert.equal(payoutTransition("pending"),null);
});
test("manual payable subtracts partial refunds and existing reservations once",()=>{
  assert.equal(remainingManualPayable([{amountMinor:700,refundedMinor:200},{amountMinor:300,refundedMinor:300}],100),400);
});
test("live payment credits shares and fees while debiting clearing",()=>{
  const p=paymentPostingAmounts(1000,30,0,679,291);
  assert.deepEqual(p,{clearing:-1000,fees:30,taxes:0,beneficiary:679,platform:291});
  assert.equal(Object.values(p).reduce((a,b)=>a+b,0),0);
  const r=refundPostingAmounts(679,291);
  assert.deepEqual(r,{beneficiary:-679,platform:-291,clearing:970});
  assert.equal(Object.values(r).reduce((a,b)=>a+b,0),0);
});
test("simulation refund state prevents second reversal with a new key",()=>{
  assert.equal(simulationRefundNeeded("simulated",700,0),true);
  assert.equal(simulationRefundNeeded("reversed",700,700),false);
  assert.equal(simulationRefundNeeded("simulated",700,700),false);
});
test("manual payout eligibility excludes simulation allocations",()=>{
  assert.equal(isOperationalAllocation({status:"simulated",paymentRef:"simulation:test"}),false);
  assert.equal(isOperationalAllocation({status:"confirmed",paymentRef:"simulation:test"}),false);
  assert.equal(isOperationalAllocation({status:"confirmed",paymentRef:"pi_live"}),true);
  assert.equal(isOperationalAllocation({status:"refunded",paymentRef:"pi_live"}),true);
});
test("money movement requires both exact acknowledgements",()=>{
  assert.deepEqual(financeOperatingMode({}),{simulation:true,moneyMovementEnabled:false,operatingMode:"simulation"});
  assert.equal(financeOperatingMode({FINANCE_LIVE_MODE:"I_UNDERSTAND_REAL_MONEY_WILL_MOVE"}).moneyMovementEnabled,false);
  assert.deepEqual(financeOperatingMode({
    FINANCE_LIVE_MODE:"I_UNDERSTAND_REAL_MONEY_WILL_MOVE",
    FINANCE_STRIPE_CONNECT_READY:"I_HAVE_TESTED_STRIPE_CONNECT_END_TO_END",
  }),{simulation:false,moneyMovementEnabled:true,operatingMode:"live"});
});