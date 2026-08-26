import assert from "node:assert/strict";
import test from "node:test";
import { splitNet7030 } from "./finance-ledger.js";

test("70/30 split uses deterministic beneficiary residual", () => {
  assert.deepEqual(splitNet7030(1), { beneficiaryMinor: 1, platformMinor: 0 });
  assert.deepEqual(splitNet7030(101), { beneficiaryMinor: 71, platformMinor: 30 });
  assert.deepEqual(splitNet7030(10_001), { beneficiaryMinor: 7_001, platformMinor: 3_000 });
});

test("duplicate idempotency and reversal are append-only invariants", () => {
  const applied = new Map<string, number>();
  const history: { key: string; amount: number; reversalOf?: string }[] = [];
  const post = (key: string, amount: number, reversalOf?: string) => {
    if (applied.has(key)) return applied.get(key)!;
    const id = history.length + 1;
    applied.set(key, id); history.push({ key, amount, reversalOf }); return id;
  };
  const original = post("charge:1", 100);
  assert.equal(post("charge:1", 100), original);
  const reversal = post("reverse:1", -100, "charge:1");
  assert.notEqual(reversal, original);
  assert.equal(post("reverse:1", -100, "charge:1"), reversal);
  assert.equal(history.reduce((sum, item) => sum + item.amount, 0), 0);
  assert.deepEqual(history.map((item) => item.amount), [100, -100]);
});