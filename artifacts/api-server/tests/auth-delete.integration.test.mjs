import assert from "node:assert/strict";
import test from "node:test";

const apiBaseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000/api")
  .replace(/\/$/, "");

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

test("a citizen can erase their account and can no longer log in", async () => {
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
  assert.equal(registration.status, 201, await registration.text());
  const cookie = sessionCookie(registration);

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
});