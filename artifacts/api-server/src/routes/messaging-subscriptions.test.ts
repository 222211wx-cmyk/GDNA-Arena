import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "@workspace/db";
import router from "./messaging-subscriptions";
import { requireMessagingSubscription } from "../middleware/require-messaging-subscription";

// Exercise the real middleware/route handlers without starting an app or touching a DB.
test("manual subscription: admin-only, strict input, audited grant/revoke, authoritative sends", async () => {
  let active = false;
  let freeMessagesUsed = 10;
  let admin = false;
  const audit: unknown[][] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("SELECT is_admin")) return { rows: [{ is_admin: admin }] };
    if (sql.includes("SELECT has_active_subscription")) return { rows: [{ has_active_subscription: active, free_messages_used: freeMessagesUsed }] };
    if (sql.startsWith("UPDATE users")) active = values[1] === true;
    if (sql.startsWith("INSERT INTO messaging_subscription_audit")) audit.push(values);
    return { rows: [] };
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  Object.assign(pool, { query, connect: async () => ({ query, release() {} }) });
  const response = () => ({
    statusCode: 200, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  });
  const request = (userId?: number, body: unknown = {}) => ({
    session: { userId }, body, params: { id: "42" },
    log: { info() {}, error() {} },
  });
  const patch = router.stack.find((layer: any) =>
    layer.route?.path === "/admin/messaging-subscriptions/:id")!.route!;
  const runPatch = async (req: any) => {
    const res = response();
    let permitted = false;
    await patch.stack[0].handle(req, res as any, () => { permitted = true; });
    if (permitted) await patch.stack[1].handle(req, res as any, () => {});
    return res;
  };
  const send = async (userId?: number) => {
    const res = response();
    let allowed = false;
    await requireMessagingSubscription(request(userId, { hasActiveSubscription: true }) as any, res as any, () => { allowed = true; });
    return { res, allowed };
  };
  const readStatus = async (userId: number) => {
    const res = response();
    await router.stack.find((layer: any) => layer.route?.path === "/messages/subscription")!
      .route!.stack[0].handle(request(userId) as any, {
        ...res, setHeader() {},
        json(body: unknown) { res.body = body; return this; },
      } as any, () => {});
    return res.body;
  };
  try {
    assert.equal((await runPatch(request(undefined, { hasActiveSubscription: true }))).statusCode, 401);
    assert.equal((await runPatch(request(7, { hasActiveSubscription: true }))).statusCode, 403);
    assert.equal(audit.length, 0);
    assert.equal((await send()).res.statusCode, 401);
    assert.equal((await send(42)).res.statusCode, 403, "client claim cannot grant sending");
    assert.deepEqual((await send(42)).res.body, {
      code: "MESSAGING_SUBSCRIPTION_REQUIRED", error: "Contactez l'AMIS pour activer",
    });
    freeMessagesUsed = 9;
    assert.equal((await send(42)).allowed, true, "one trial send available without activation");
    assert.deepEqual(await readStatus(42), {
      hasActiveSubscription: false, canSendMessages: true, freeMessagesRemaining: 1,
    });
    freeMessagesUsed = 10;
    assert.deepEqual(await readStatus(42), {
      hasActiveSubscription: false, canSendMessages: false, freeMessagesRemaining: 0,
    });
    admin = true;
    assert.equal((await runPatch(request(7, { hasActiveSubscription: "true" }))).statusCode, 400);
    assert.equal((await runPatch(request(7, { hasActiveSubscription: true, isAdmin: true }))).statusCode, 400);
    assert.equal((await runPatch(request(7, { hasActiveSubscription: true }))).statusCode, 200);
    assert.equal((await send(42)).allowed, true);
    assert.deepEqual(await readStatus(42), {
      hasActiveSubscription: true, canSendMessages: true, freeMessagesRemaining: 0,
    });
    assert.deepEqual(audit[0], [7, 42, false, true]);
    assert.equal((await runPatch(request(7, { hasActiveSubscription: false }))).statusCode, 200);
    assert.equal((await send(42)).allowed, false, "revoked stale clients are blocked");
    assert.deepEqual(audit[1], [7, 42, true, false]);
    Object.assign(pool, { query: async () => { throw new Error("database unavailable"); } });
    assert.equal((await send(42)).res.statusCode, 503, "database failure fails closed");
  } finally {
    Object.assign(pool, { query: originalQuery, connect: originalConnect });
  }
});