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
      password: "disposable-archon-profile-test-pw",
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

test("a guest can view only the public fields of an initiated Archon profile", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `archon${suffix}`;
  const user = await register(username);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  t.after(async () => {
    await client.query("DELETE FROM archon_sessions WHERE user_id = $1", [user.id]);
    await client.query("DELETE FROM users WHERE id = $1", [user.id]);
    await client.end();
  });

  await client.query(
    `INSERT INTO archon_sessions (
       user_id, volontas, resilentia, intellectus, disciplina,
       societas, abundantia, auctoritas, archon_code, archetype,
       ai_profile, answers, is_active
     ) VALUES ($1, 80, 70, 90, 60, 50, 40, 75, $2, $3, $4, $5, true)`,
    [
      user.id,
      "ARCH-TEST-PUBLIC-SOV",
      "THE SOVEREIGN",
      JSON.stringify({
        archetype_declaration: "The empire recognizes this citizen.",
        imperial_decree: "private decree",
        shadow_mission: "private mission",
        "30_day_protocol": "private protocol",
      }),
      JSON.stringify({ Q7: "private answer" }),
    ],
  );

  const response = await request(`/archon/profile/${encodeURIComponent(username)}`);
  assert.equal(response.status, 200, await response.clone().text());

  const body = await response.json();
  assert.equal(body.archonCode, "ARCH-TEST-PUBLIC-SOV");
  assert.equal(body.archetype, "THE SOVEREIGN");
  assert.equal(body.overallScore, 66);
  assert.equal(body.archetypeDeclaration, "The empire recognizes this citizen.");
  assert.deepEqual(Object.keys(body).sort(), [
    "archetype",
    "archetypeDeclaration",
    "archonCode",
    "dimensions",
    "overallScore",
  ]);
  assert.equal(body.imperial_decree, undefined);
  assert.equal(body.shadow_mission, undefined);
  assert.equal(body["30_day_protocol"], undefined);
  assert.equal(body["90_day_expansion"], undefined);
  assert.equal(body["1_year_sovereignty"], undefined);
  assert.equal(body.daily_directive, undefined);
  assert.equal(body.answers, undefined);
});

test("an uninitiated citizen returns a public 404 rather than an auth challenge", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `pending${suffix}`;
  const user = await register(username);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  t.after(async () => {
    await client.query("DELETE FROM users WHERE id = $1", [user.id]);
    await client.end();
  });

  const response = await request(`/archon/profile/${encodeURIComponent(username)}`);
  assert.equal(response.status, 404, await response.clone().text());
  assert.notEqual(response.status, 401);
});