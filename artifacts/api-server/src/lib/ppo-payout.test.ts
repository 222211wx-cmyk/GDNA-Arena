import assert from "node:assert/strict";
import test from "node:test";
import { withPpoTransaction } from "./ppo-transaction.js";
import { allocatePpoWalletCoins } from "./ppo-wallet-allocation.js";

test("PPO wallet allocation conserves a one-coin payout across equal shares", () => {
  const payout = allocatePpoWalletCoins(1, [
    { id: 1, shareRate: 50 },
    { id: 2, shareRate: 50 },
  ]);

  assert.deepEqual(payout, [1, 0]);
  assert.equal(payout.reduce((sum, amount) => sum + amount, 0), 1);
});

test("PPO wallet allocation uses largest remainder for small unequal splits", () => {
  const payout = allocatePpoWalletCoins(1, [
    { id: 1, shareRate: 34 },
    { id: 2, shareRate: 33 },
    { id: 3, shareRate: 33 },
  ]);

  assert.deepEqual(payout, [1, 0, 0]);
  assert.equal(payout.reduce((sum, amount) => sum + amount, 0), 1);
});

test("a mid-distribution failure rolls the PPO transaction back", async () => {
  const calls: string[] = [];
  const client = {
    query: async (statement: string) => {
      calls.push(statement);
      return {};
    },
    release: () => calls.push("RELEASE"),
  };
  const pool = { connect: async () => client };

  await assert.rejects(
    withPpoTransaction(pool, async activeClient => {
      await activeClient.query("UPDATE users SET balance = balance + 1");
      throw new Error("transaction history insert failed");
    }),
    /transaction history insert failed/,
  );

  assert.deepEqual(calls, [
    "BEGIN",
    "UPDATE users SET balance = balance + 1",
    "ROLLBACK",
    "RELEASE",
  ]);
});