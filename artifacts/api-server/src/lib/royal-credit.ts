import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { FINANCE_SIMULATION_MODE } from "./finance-simulation";

export const ROYAL_RESERVE_SECONDS = 7_200;
export const ROYAL_RESERVE_MINUTES = 120;
export const ROYAL_RESERVE_VALID_HOURS = 48;
export const ROYAL_PACKAGE_COST_MINOR = 1_500;
export const ROYAL_MAX_REPAYMENT_MINOR = 100_000;
export const ROYAL_MAX_PAID_SECONDS = 365 * 24 * 60 * 60;

type Queryable = {
  query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

type CreditRow = {
  paid_seconds: string | number;
  reserve_seconds: string | number;
  reserve_expires_at: Date | string | null;
  debt_minor: string | number;
};

export class RoyalCreditConflict extends Error {}

function integer(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Royal credit balance is outside the supported safe integer range");
  }
  return parsed;
}

function payloadHash(payload: object): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function ensureAccount(db: Queryable, userId: number): Promise<void> {
  await db.query(
    "INSERT INTO royal_credit_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
}

async function lockAccount(db: Queryable, userId: number): Promise<CreditRow> {
  await ensureAccount(db, userId);
  const result = await db.query<CreditRow>(
    `SELECT paid_seconds, reserve_seconds, reserve_expires_at, debt_minor
     FROM royal_credit_accounts WHERE user_id=$1 FOR UPDATE`,
    [userId],
  );
  if (!result.rows[0]) throw new Error("Royal credit account unavailable");
  return result.rows[0];
}

export async function getRoyalCredit(userId: number, now = new Date()) {
  await ensureAccount(pool, userId);
  const result = await pool.query<CreditRow>(
    `SELECT paid_seconds, reserve_seconds, reserve_expires_at, debt_minor
     FROM royal_credit_accounts WHERE user_id=$1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Royal credit account unavailable");
  const paidSeconds = integer(row.paid_seconds);
  const storedReserveSeconds = integer(row.reserve_seconds);
  const expiresAt = row.reserve_expires_at ? new Date(row.reserve_expires_at) : null;
  const reserveSeconds = expiresAt && expiresAt.getTime() > now.getTime() ? storedReserveSeconds : 0;
  const debtMinor = integer(row.debt_minor);
  return {
    balanceMinutes: Math.floor(paidSeconds / 60),
    reserveMinutes: Math.floor(reserveSeconds / 60),
    reserveExpiresAt: reserveSeconds > 0 && expiresAt ? expiresAt.toISOString() : null,
    debtMinor,
    currency: "MAD" as const,
    canActivate: paidSeconds === 0 && reserveSeconds === 0 && debtMinor === 0,
    simulated: true as const,
  };
}

export async function hasUsableRoyalCredit(userId: number): Promise<boolean> {
  await ensureAccount(pool, userId);
  const result = await pool.query<{ funded: boolean }>(
    `SELECT (paid_seconds > 0 OR
      (reserve_seconds > 0 AND reserve_expires_at IS NOT NULL AND reserve_expires_at > NOW())) AS funded
     FROM royal_credit_accounts WHERE user_id=$1`,
    [userId],
  );
  return result.rows[0]?.funded === true;
}

async function priorResponse(
  db: Queryable,
  userId: number,
  action: "reserve" | "repay",
  key: string,
  hash: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.query<{ payload_hash: string; response: Record<string, unknown> }>(
    `SELECT payload_hash, response FROM royal_credit_idempotency
     WHERE user_id=$1 AND action=$2 AND idempotency_key=$3`,
    [userId, action, key],
  );
  const prior = result.rows[0];
  if (!prior) return null;
  if (prior.payload_hash !== hash) {
    throw new RoyalCreditConflict("Idempotency key was already used with a different payload");
  }
  return prior.response;
}

export async function activateRoyalReserve(userId: number, idempotencyKey: string) {
  const hash = payloadHash({ idempotencyKey });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await lockAccount(client, userId);
    const prior = await priorResponse(client, userId, "reserve", idempotencyKey, hash);
    if (prior) {
      await client.query("COMMIT");
      return prior as { accepted: true; idempotencyKey: string };
    }
    const paid = integer(account.paid_seconds);
    const debt = integer(account.debt_minor);
    const unexpiredReserve = account.reserve_expires_at
      && new Date(account.reserve_expires_at).getTime() > Date.now()
      && integer(account.reserve_seconds) > 0;
    if (paid > 0) throw new RoyalCreditConflict("Paid credit must be depleted before reserve activation");
    if (debt > 0) throw new RoyalCreditConflict("Outstanding Royal Reserve debt must be repaid first");
    if (unexpiredReserve) throw new RoyalCreditConflict("Royal Reserve credit is already active");

    const response = { accepted: true as const, idempotencyKey };
    await client.query(
      `UPDATE royal_credit_accounts
       SET reserve_seconds=$2, reserve_expires_at=NOW() + INTERVAL '48 hours',
           debt_minor=$3, updated_at=NOW()
       WHERE user_id=$1`,
      [userId, ROYAL_RESERVE_SECONDS, ROYAL_PACKAGE_COST_MINOR],
    );
    await client.query(
      `INSERT INTO debt_log (id,user_id,cost_minor,action,idempotency_key,metadata)
       VALUES ($1,$2,$3,'reserve_granted',$4,$5::jsonb)`,
      [crypto.randomUUID(), userId, ROYAL_PACKAGE_COST_MINOR, idempotencyKey,
        JSON.stringify({ reserveSeconds: ROYAL_RESERVE_SECONDS, validHours: ROYAL_RESERVE_VALID_HOURS, simulated: true })],
    );
    await client.query(
      `INSERT INTO royal_credit_idempotency
       (user_id,action,idempotency_key,payload_hash,response)
       VALUES ($1,'reserve',$2,$3,$4::jsonb)`,
      [userId, idempotencyKey, hash, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function royalRepaymentSandboxEnabled(
  simulationMode = FINANCE_SIMULATION_MODE,
  nodeEnv = process.env.NODE_ENV,
  sandboxFlag = process.env.ROYAL_CREDIT_SANDBOX,
): boolean {
  return simulationMode
    && (nodeEnv === "development" || nodeEnv === "test")
    && sandboxFlag === "true";
}

export async function repayRoyalCredit(userId: number, amountMinor: number, idempotencyKey: string) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > ROYAL_MAX_REPAYMENT_MINOR) {
    throw new RoyalCreditConflict(`amountMinor must be an integer from 1 to ${ROYAL_MAX_REPAYMENT_MINOR}`);
  }
  if (!royalRepaymentSandboxEnabled()) {
    throw new RoyalCreditConflict("Pending trusted payment settlement");
  }
  const hash = payloadHash({ amountMinor, idempotencyKey });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await lockAccount(client, userId);
    const prior = await priorResponse(client, userId, "repay", idempotencyKey, hash);
    if (prior) {
      await client.query("COMMIT");
      return prior;
    }
    const debtBefore = integer(account.debt_minor);
    const debtAppliedMinor = Math.min(debtBefore, amountMinor);
    const remainderMinor = amountMinor - debtAppliedMinor;
    const paidSecondsAdded = Math.floor(remainderMinor * 24 / 5);
    const paidBefore = integer(account.paid_seconds);
    if (!Number.isSafeInteger(paidSecondsAdded) || paidBefore + paidSecondsAdded > ROYAL_MAX_PAID_SECONDS) {
      throw new RoyalCreditConflict("Royal paid credit cannot exceed one year");
    }
    const response = {
      accepted: true,
      idempotencyKey,
      debtAppliedMinor,
      paidMinutesAdded: Math.floor(paidSecondsAdded / 60),
      simulated: true,
    };
    await client.query(
      `UPDATE royal_credit_accounts
       SET debt_minor=debt_minor-$2, paid_seconds=paid_seconds+$3, updated_at=NOW()
       WHERE user_id=$1`,
      [userId, debtAppliedMinor, paidSecondsAdded],
    );
    await client.query(
      `INSERT INTO debt_log (id,user_id,cost_minor,action,idempotency_key,metadata)
       VALUES ($1,$2,$3,'debt_repaid',$4,$5::jsonb)`,
      [crypto.randomUUID(), userId, -debtAppliedMinor, idempotencyKey,
        JSON.stringify({ amountMinor, debtAppliedMinor, remainderMinor, paidSecondsAdded, simulated: true })],
    );
    await client.query(
      `INSERT INTO royal_credit_idempotency
       (user_id,action,idempotency_key,payload_hash,response)
       VALUES ($1,'repay',$2,$3,$4::jsonb)`,
      [userId, idempotencyKey, hash, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeRoyalCreditSeconds(userId: number, requestedSeconds: number, callId?: string) {
  if (!Number.isSafeInteger(requestedSeconds) || requestedSeconds <= 0) {
    throw new Error("requestedSeconds must be a positive safe integer");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2500ms'");
    await client.query("SET LOCAL statement_timeout = '3s'");
    const account = await lockAccount(client, userId);
    const paid = integer(account.paid_seconds);
    const reserve = account.reserve_expires_at
      && new Date(account.reserve_expires_at).getTime() > Date.now()
      ? integer(account.reserve_seconds)
      : 0;
    const paidDebit = Math.min(paid, requestedSeconds);
    const reserveDebit = Math.min(reserve, requestedSeconds - paidDebit);
    const consumedSeconds = paidDebit + reserveDebit;
    await client.query(
      `UPDATE royal_credit_accounts
       SET paid_seconds=paid_seconds-$2,
           reserve_seconds=CASE
             WHEN reserve_expires_at IS NULL OR reserve_expires_at <= NOW() THEN 0
             ELSE reserve_seconds-$3
           END,
           reserve_expires_at=CASE
             WHEN reserve_expires_at IS NULL OR reserve_expires_at <= NOW() OR reserve_seconds-$3 <= 0
             THEN NULL ELSE reserve_expires_at
           END,
           updated_at=NOW()
       WHERE user_id=$1`,
      [userId, paidDebit, reserveDebit],
    );
    if (consumedSeconds > 0) {
      const auditId = crypto.randomUUID();
      await client.query(
        `INSERT INTO debt_log (id,user_id,cost_minor,action,idempotency_key,metadata)
         VALUES ($1,$2,0,'call_usage',$3,$4::jsonb)`,
        [auditId, userId, `call-usage:${auditId}`, JSON.stringify({
          callId: callId ?? null,
          requestedSeconds,
          consumedSeconds,
          paidSeconds: paidDebit,
          reserveSeconds: reserveDebit,
        })],
      );
    }
    await client.query("COMMIT");
    return { consumedSeconds, exhausted: consumedSeconds < requestedSeconds || paidDebit + reserveDebit === paid + reserve };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}