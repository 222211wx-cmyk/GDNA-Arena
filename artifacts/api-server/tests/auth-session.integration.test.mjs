import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const requireFromDbPackage = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = requireFromDbPackage("pg");
const base = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const days = 30 * 24 * 60 * 60;
function assertRememberedCookie(setCookie) {
  // express-session serializes the cookie as Expires rather than Max-Age.
  assert.ok(setCookie?.startsWith("connect.sid="));
  const expires = /(?:^|; )Expires=([^;]+)/.exec(setCookie)?.[1];
  assert.ok(expires, "session cookie needs a persistent expiration");
  assert.ok(Date.parse(expires) > Date.now() + (days - 60) * 1000);
}

async function request(path, options = {}) {
  return fetch(`${base}${path}`, {
    redirect: "manual",
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
}

test("remembered session survives independent requests, rolls its cookie and is stored in Postgres", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required for session integration test");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const username = `persist${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = "integration-password-123";
  let cookie;
  let sid;
  try {
    const registered = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, birthDate: "1990-01-01" }),
    });
    assert.equal(registered.status, 201, await registered.text());
    cookie = registered.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    // A second login with leading/trailing whitespace and a different case
    // must resolve to the SAME account, and rotate the session identifier.
    const login = await request("/auth/login", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ username: `  ${username.toUpperCase()}  `, password, rememberMe: true }),
    });
    assert.equal(login.status, 200, login.ok ? undefined : await login.text());
    const user = await login.json();
    const loginCookie = login.headers.get("set-cookie") ?? "";
    assertRememberedCookie(loginCookie);
    const rotated = loginCookie.split(";", 1)[0];
    assert.notEqual(rotated, cookie, "login must rotate the old session");
    cookie = rotated;
    sid = decodeURIComponent(cookie.split("=", 2)[1]).slice(2).split(".", 1)[0];

    const stored = await db.query(
      `SELECT expire, expire > NOW() AS valid FROM user_sessions WHERE sid = $1 AND (sess->>'userId')::int = $2`,
      [sid, user.id],
    );
    assert.equal(stored.rows.length, 1, "remembered identity must live in the durable store");
    assert.equal(stored.rows[0].valid, true, "remembered DB session must be unexpired according to Postgres");
    assert.ok(new Date(stored.rows[0].expire).valueOf() > Date.now() + 29 * 86400_000);

    const me = await request("/auth/me", { headers: { cookie } });
    assert.equal(me.status, 200, me.ok ? undefined : await me.text());
    assert.equal((await me.json()).id, user.id);
    assertRememberedCookie(me.headers.get("set-cookie"));
    const renewed = me.headers.get("set-cookie").split(";", 1)[0];
    assert.equal(renewed, cookie, "rolling expiry should not silently rotate or replace the session ID");
    cookie = renewed;
    const recheck = await request("/auth/me", { headers: { cookie } });
    assert.equal(recheck.status, 200, recheck.ok ? undefined : await recheck.text());
    const afterMe = await db.query(
      `SELECT expire, expire > NOW() AS valid FROM user_sessions WHERE sid = $1 AND (sess->>'userId')::int = $2`,
      [sid, user.id],
    );
    assert.equal(afterMe.rows.length, 1, "GET /me must not remove the server-side session");
    assert.equal(afterMe.rows[0].valid, true, "GET /me must not expire session in Postgres");
    assert.ok(new Date(afterMe.rows[0].expire).valueOf() > Date.now() + 29 * 86400_000, "GET /me must keep the DB expiry rolling");
  } finally {
    try {
      if (cookie) {
        const erased = await request("/auth/me", { method: "DELETE", headers: { cookie } });
        if (erased.status !== 200) {
          // If this session failed between requests, revoke via a fresh login
          // so disposable integration accounts do not remain in the database.
          const again = await request("/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password, rememberMe: true }),
          });
          assert.equal(again.status, 200, await again.text());
          const fresh = again.headers.get("set-cookie")?.split(";", 1)[0];
          assert.ok(fresh);
          const cleanup = await request("/auth/me", { method: "DELETE", headers: { cookie: fresh } });
          assert.equal(cleanup.status, 200, await cleanup.text());
        }
      }
    } finally {
      await db.end();
    }
  }
});