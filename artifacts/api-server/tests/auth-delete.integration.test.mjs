import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const requireFromDbPackage = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const { Client } = requireFromDbPackage("pg");

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
      ...options.headers,
    },
  });
}

test("a citizen can log out and the former session cannot load their account", async () => {
  const username = `logout${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = "disposable-logout-password";

  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(registration.status, 201, await registration.text());
  const cookie = sessionCookie(registration);

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 200, await logout.text());
  assert.match(
    logout.headers.get("set-cookie") ?? "",
    /connect\.sid=;/,
    "logout must clear the session cookie",
  );

  const formerSession = await request("/auth/me", {
    headers: { cookie },
  });
  assert.equal(formerSession.status, 401, await formerSession.text());

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200, await login.text());

  const cleanup = await request("/auth/me", {
    method: "DELETE",
    headers: { cookie: sessionCookie(login) },
  });
  assert.equal(cleanup.status, 200, await cleanup.text());
});

test("a citizen can erase their account and can no longer log in", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the erasure integration test");
  const username = `erase${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = "disposable-account-password";

  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      birthDate: "1990-01-01",
    }),
  });
  const registrationBody = await registration.text();
  assert.equal(registration.status, 201, registrationBody);
  const citizen = JSON.parse(registrationBody);
  const cookie = sessionCookie(registration);

  const dna = await request(`/genome/citizen/${citizen.id}`);
  assert.equal(dna.status, 200, await dna.text());

  const tournament = await request("/games/globalstar/tournament", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(tournament.status, 200, await tournament.text());

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => {
    await client.end();
  });
  const ownedSnapshot = await client.query(
    `SELECT id, match_id, username
     FROM gs_players
     WHERE user_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [citizen.id],
  );
  assert.equal(ownedSnapshot.rowCount, 1, "tournament must create a user-owned player snapshot");
  assert.equal(ownedSnapshot.rows[0].username, username);

  const unownedSnapshot = await client.query(
    `INSERT INTO gs_players (match_id, username, is_user, score, placement)
     VALUES ($1, $2, false, 0, 100)
     RETURNING id`,
    [ownedSnapshot.rows[0].match_id, username],
  );

  const historicalSnapshot = await client.query(
    `INSERT INTO gs_players (match_id, username, is_user, score, placement)
     VALUES ($1, $2, true, 0, 99)
     RETURNING id`,
    [ownedSnapshot.rows[0].match_id, username],
  );

  const deletion = await request("/auth/me", {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(deletion.status, 200, await deletion.text());

  const deletedSession = await request("/auth/me", {
    headers: { cookie },
  });
  assert.equal(deletedSession.status, 401, await deletedSession.text());

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 401, await login.text());

  const anonymousName = `deleted_user_${citizen.id}`;
  const storedDna = await client.query(
    `SELECT username, dna_string FROM citizen_dna WHERE citizen_id = $1`,
    [citizen.id],
  );
  assert.equal(storedDna.rowCount, 1);
  assert.equal(storedDna.rows[0].username, anonymousName);
  assert.equal(
    storedDna.rows[0].dna_string.slice(56),
    "AAAAAAAA",
    "erasure must remove the sovereignty gene derived from the old username",
  );

  const storedOwnedSnapshot = await client.query(
    `SELECT username FROM gs_players WHERE id = $1`,
    [ownedSnapshot.rows[0].id],
  );
  assert.equal(storedOwnedSnapshot.rows[0].username, anonymousName);

  const storedUnownedSnapshot = await client.query(
    `SELECT username, user_id FROM gs_players WHERE id = $1`,
    [unownedSnapshot.rows[0].id],
  );
  assert.equal(storedUnownedSnapshot.rows[0].username, username);
  assert.equal(storedUnownedSnapshot.rows[0].user_id, null);

  const storedHistoricalSnapshot = await client.query(
    `SELECT username, user_id FROM gs_players WHERE id = $1`,
    [historicalSnapshot.rows[0].id],
  );
  assert.equal(storedHistoricalSnapshot.rows[0].username, username);
  assert.equal(storedHistoricalSnapshot.rows[0].user_id, null);

  const erasedDna = await request(`/genome/citizen/${citizen.id}`);
  assert.equal(erasedDna.status, 404, await erasedDna.text());
});
