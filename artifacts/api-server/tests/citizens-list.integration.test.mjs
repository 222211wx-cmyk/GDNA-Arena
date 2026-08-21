/**
 * Integration tests for GET /api/citizens — Task #138
 *
 * Verifies:
 *   1. Erased accounts (password_hash = 'DELETED') are excluded from results.
 *   2. Active accounts are discoverable.
 *   3. Pagination (limit + offset) works correctly.
 *   4. Case-insensitive search filter works.
 *   5. Backwards-compatible defaults — existing callers without new params are unaffected.
 *
 * Requires DATABASE_URL and a running API server at API_BASE_URL
 * (defaults to http://localhost:80/api).
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const requireFromDb = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const { Client } = requireFromDb("pg");

const apiBaseUrl = (
  process.env.API_BASE_URL ?? "http://localhost:80/api"
).replace(/\/$/, "");

function sessionCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "registration must establish a session cookie");
  return setCookie.split(";", 1)[0];
}

async function request(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, {
    redirect: "manual",
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function register(username) {
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password: "disposable-citizens-test-pw",
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return {
    cookie: sessionCookie(response),
    body: await response.json(),
  };
}

// ── test 1: active citizen appears in GET /citizens ───────────────────────────
test("an active citizen is discoverable via GET /citizens", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `active${suffix}`;

  const { cookie } = await register(username);
  t.after(async () => {
    await request("/auth/me", { method: "DELETE", headers: { cookie } }).catch(() => {});
  });

  // Search by exact username to isolate the result in a busy test DB
  const res = await request(`/citizens?search=${encodeURIComponent(username)}&limit=5`);
  assert.equal(res.status, 200, await res.clone().text());
  const { citizens } = await res.json();
  assert.ok(
    citizens.some((c) => c.username === username),
    `active citizen "${username}" must appear in /citizens`,
  );
});

// ── test 2: erased citizen is excluded from GET /citizens ─────────────────────
test("an erased citizen is excluded from GET /citizens", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `erase${suffix}`;

  const { cookie, body: registrationBody } = await register(username);
  const citizenId = registrationBody.id;

  // Delete the account — this anonymises the row (password_hash = 'DELETED')
  const deletion = await request("/auth/me", {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(deletion.status, 200, await deletion.text());

  // Verify the row is still in the DB (soft-delete / anonymisation, not hard-delete)
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(() => client.end());

  const row = await client.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [citizenId],
  );
  assert.equal(row.rowCount, 1, "row must remain in DB after erasure");
  assert.equal(row.rows[0].password_hash, "DELETED", "password_hash must be DELETED");

  // Now the erased username is `deleted_user_<id>` — should NOT appear
  const erasedUsername = `deleted_user_${citizenId}`;
  const res = await request(`/citizens?search=${encodeURIComponent(erasedUsername)}&limit=10`);
  assert.equal(res.status, 200, await res.clone().text());
  const { citizens } = await res.json();
  assert.ok(
    citizens.every((c) => c.username !== erasedUsername),
    `erased citizen "${erasedUsername}" must NOT appear in /citizens`,
  );
});

// ── test 3: pagination — offset advances correctly ────────────────────────────
test("pagination offset produces non-overlapping pages", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const prefix = `pg${suffix}`;
  const registrations = await Promise.all(
    Array.from({ length: 5 }, (_, index) => register(`${prefix}${index}`)),
  );
  t.after(async () => {
    await Promise.allSettled(registrations.map(({ cookie }) =>
      request("/auth/me", { method: "DELETE", headers: { cookie } })));
  });

  // Page 1: limit=2 offset=0
  const page1Res = await request(`/citizens?search=${prefix}&limit=2&offset=0`);
  assert.equal(page1Res.status, 200);
  const { citizens: page1 } = await page1Res.json();

  // Page 2: limit=2 offset=2
  const page2Res = await request(`/citizens?search=${prefix}&limit=2&offset=2`);
  assert.equal(page2Res.status, 200);
  const { citizens: page2 } = await page2Res.json();

  // No row should appear on both pages
  const page1Ids = new Set(page1.map((c) => c.id));
  const overlap = page2.filter((c) => page1Ids.has(c.id));
  assert.equal(overlap.length, 0, "pages must not overlap");

  // Position numbers must be continuous across pages
  if (page1.length === 2 && page2.length > 0) {
    assert.equal(page1[1].position, 2, "last position on page 1 must be 2");
    assert.equal(page2[0].position, 3, "first position on page 2 must be 3");
  }
});

// ── test 4: backwards-compatible defaults ─────────────────────────────────────
test("GET /citizens with no params returns citizens array (backwards compat)", async () => {
  const res = await request("/citizens");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.citizens), "must return { citizens: [] }");
});

// ── test 5: search filter is case-insensitive ─────────────────────────────────
test("search filter is case-insensitive", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `SrchTest${suffix}`;

  const { cookie } = await register(username);
  t.after(async () => {
    await request("/auth/me", { method: "DELETE", headers: { cookie } }).catch(() => {});
  });

  // Search with all-lower version of the mixed-case username
  const res = await request(`/citizens?search=${encodeURIComponent(username.toLowerCase())}&limit=5`);
  assert.equal(res.status, 200);
  const { citizens } = await res.json();
  assert.ok(
    citizens.some((c) => c.username === username),
    "case-insensitive search must find the citizen",
  );
});
