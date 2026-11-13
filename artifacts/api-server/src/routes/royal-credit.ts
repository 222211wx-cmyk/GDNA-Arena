import { Router, type IRouter } from "express";
import {
  ROYAL_PACKAGE_COST_MINOR,
  ROYAL_MAX_REPAYMENT_MINOR,
  ROYAL_RESERVE_MINUTES,
  ROYAL_RESERVE_VALID_HOURS,
  RoyalCreditConflict,
  activateRoyalReserve,
  getRoyalCredit,
  repayRoyalCredit,
  royalRepaymentSandboxEnabled,
} from "../lib/royal-credit";

const router: IRouter = Router();
const userId = (req: any): number | null => req.session?.userId ?? null;
const validKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

router.get("/billing/credit", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json({
    credit: await getRoyalCredit(id),
    policy: {
      reserveMinutes: ROYAL_RESERVE_MINUTES,
      validHours: ROYAL_RESERVE_VALID_HOURS,
      packageCostMinor: ROYAL_PACKAGE_COST_MINOR,
      repaymentSandboxEnabled: royalRepaymentSandboxEnabled(),
    },
  });
});

router.post("/billing/reserve", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { accepted, idempotencyKey } = req.body ?? {};
  if (accepted !== true || !validKey(idempotencyKey)) {
    res.status(400).json({ error: "Explicit acceptance and idempotencyKey are required" });
    return;
  }
  try {
    res.status(201).json(await activateRoyalReserve(id, idempotencyKey));
  } catch (error) {
    if (error instanceof RoyalCreditConflict) {
      res.status(409).json({ error: error.message, simulated: true });
      return;
    }
    throw error;
  }
});

router.post("/billing/repay", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { amountMinor, idempotencyKey } = req.body ?? {};
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0
      || amountMinor > ROYAL_MAX_REPAYMENT_MINOR || !validKey(idempotencyKey)) {
    res.status(400).json({
      error: `An integer amountMinor from 1 to ${ROYAL_MAX_REPAYMENT_MINOR} and idempotencyKey are required`,
    });
    return;
  }
  if (!royalRepaymentSandboxEnabled()) {
    res.status(409).json({ error: "Pending trusted payment settlement", simulated: true });
    return;
  }
  try {
    res.status(201).json(await repayRoyalCredit(id, amountMinor, idempotencyKey));
  } catch (error) {
    if (error instanceof RoyalCreditConflict) {
      res.status(409).json({ error: error.message, simulated: true });
      return;
    }
    throw error;
  }
});

export default router;
