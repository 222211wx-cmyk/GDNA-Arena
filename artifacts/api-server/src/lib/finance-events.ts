import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { splitNet7030 } from "./finance-ledger";

type System = Record<"clearing" | "revenue" | "fees" | "taxes" | "refunds" | "agora" | "server", string>;
type TransactionClient = { query: <T = any>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };

/**
 * Pure accounting helpers used by the simulation and ledger tests.
 *
 * Historical journal rows may have been created by the retired payment
 * provider integration. These helpers intentionally deal only in ledger
 * amounts and never contact an external payment provider.
 */
export function paymentPlan(gross: number, fee: number, tax: number) {
  const net = Math.max(0, gross - fee - tax);
  const split = splitNet7030(net);
  return { net, ...split, fee, tax };
}

export function paymentPostingAmounts(gross: number, fee: number, tax: number, beneficiary: number, platform: number) {
  return { clearing: -gross, fees: fee, taxes: tax, beneficiary, platform };
}

export function refundPostingAmounts(beneficiary: number, platform: number) {
  return { beneficiary: -beneficiary, platform: -platform, clearing: beneficiary + platform };
}

export function refundPlan(originalNet: number, refundedGross: number, gross: number) {
  return Math.min(originalNet, Math.floor((originalNet * refundedGross) / gross));
}

export function refundDelta(
  originalBeneficiary: number,
  originalPlatform: number,
  gross: number,
  cumulativeRefunded: number,
  alreadyBeneficiary: number,
  alreadyPlatform: number,
) {
  const targetBeneficiary = Math.min(originalBeneficiary, Math.floor((originalBeneficiary * cumulativeRefunded) / gross));
  const targetPlatform = Math.min(originalPlatform, Math.floor((originalPlatform * cumulativeRefunded) / gross));
  return {
    beneficiary: Math.max(0, targetBeneficiary - alreadyBeneficiary),
    platform: Math.max(0, targetPlatform - alreadyPlatform),
  };
}

/**
 * Return the system wallets used by the durable ledger.
 *
 * The existing entity kinds are retained so historical balances and journal
 * references remain attached to the same wallets. They are storage labels,
 * not external-provider clients or money movement.
 */
export async function systemWallets(currency: string, suppliedClient?: TransactionClient): Promise<System> {
  const owned = !suppliedClient;
  const client = suppliedClient ?? await pool.connect();
  const result = {} as System;
  try {
    if (owned) await client.query("BEGIN");
    for (const [key, name] of Object.entries({
      clearing: "stripe_clearing",
      revenue: "platform_revenue",
      fees: "stripe_fees",
      taxes: "stripe_taxes",
      refunds: "stripe_refunds",
      agora: "agora_estimated_cost",
      server: "server_estimated_cost",
    })) {
      const entity = await client.query<{ id: string }>("SELECT id FROM finance_entities WHERE kind=$1 LIMIT 1", [name]);
      const entityId = entity.rows[0]?.id ?? crypto.randomUUID();
      if (!entity.rows[0]) {
        await client.query(
          "INSERT INTO finance_entities (id,kind,display_name) VALUES ($1,$2,$3)",
          [entityId, name, name],
        );
      }
      const wallet = await client.query<{ id: string }>(
        "SELECT id FROM wallets WHERE entity_id=$1 AND asset='fiat' AND currency=$2",
        [entityId, currency],
      );
      const walletId = wallet.rows[0]?.id ?? crypto.randomUUID();
      if (!wallet.rows[0]) {
        await client.query(
          "INSERT INTO wallets (id,entity_id,asset,currency) VALUES ($1,$2,'fiat',$3)",
          [walletId, entityId, currency],
        );
      }
      result[key as keyof System] = walletId;
    }
    if (owned) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (owned) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (owned) (client as any).release();
  }
}