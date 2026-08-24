import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const requireFromDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = requireFromDb("pg");
const requireFromApi = createRequire(new URL("../package.json", import.meta.url));
const { WebSocket } = requireFromApi("ws");

const base = (process.env.API_BASE_URL ?? "http://localhost:80/api").replace(/\/$/, "");
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function api(path, options = {}) {
  return fetch(`${base}${path}`, { redirect: "manual", ...options, headers: { "content-type": "application/json", ...options.headers } });
}
async function body(response, status) {
  assert.equal(response.status, status, await response.status === status ? "" : await response.text());
  return response.json();
}
async function citizen(tag, cookies) {
  // 20-character maximum is deliberately respected for production validation.
  const username = `${tag}${suffix}`.slice(0, 20);
  const response = await api("/auth/register", { method: "POST", body: JSON.stringify({ username, password: "solidarity-safe-password", birthDate: "1990-01-01" }) });
  const data = await body(response, 201);
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  cookies.push(cookie);
  return { username, cookie, id: data.id };
}
const auth = cookie => ({ cookie });
async function dbClient() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

test("solidarity domains, cooldown, unique completion rewards, and scoped creation", async (t) => {
  const cookies = [];
  t.after(async () => { await Promise.allSettled(cookies.map(cookie => api("/auth/me", { method: "DELETE", headers: auth(cookie) }))); });
  const domains = ["future", "justice", "culture", "education", "health", "environment", "technology", "community"];
  // Each domain uses a separate citizen so the creation cooldown is not a confounder.
  await Promise.all(domains.map(async (domain, i) => {
    const u = await citizen(`d${i}`, cookies);
    await body(await api("/solidarity/initiatives", { method: "POST", headers: auth(u.cookie), body: JSON.stringify({ title: `Help ${domain}`, body: "A practical, respectful civic initiative.", domain, targetSupport: 3 }) }), 201);
  }));
  const creator = await citizen("owner", cookies);
  const payload = { title: "Concurrent civic help", body: "Coordinate a useful and safe community effort.", domain: "community", targetSupport: 3 };
  const attempts = await Promise.all([1, 2, 3].map(() => api("/solidarity/initiatives", { method: "POST", headers: auth(creator.cookie), body: JSON.stringify(payload) })));
  assert.equal(attempts.filter(r => r.status === 201).length, 1);
  assert.equal(attempts.filter(r => r.status === 429).length, 2);
  const initiative = await (await attempts.find(r => r.status === 201).json()).initiative;
  for (const invalidTarget of [2, 3.5, 1001]) {
    await body(await api("/solidarity/initiatives", {
      method: "POST",
      headers: auth(creator.cookie),
      body: JSON.stringify({ ...payload, targetSupport: invalidTarget }),
    }), 400);
  }
  const supporters = await Promise.all(["s1", "s2", "s3"].map(tag => citizen(tag, cookies)));
  // Duplicate and concurrent support requests cannot create another supporter or award.
  const supportResponses = await Promise.all([...supporters.map(u => api(`/solidarity/initiatives/${initiative.id}/support`, { method: "POST", headers: auth(u.cookie) })), api(`/solidarity/initiatives/${initiative.id}/support`, { method: "POST", headers: auth(supporters[0].cookie) })]);
  assert.ok(supportResponses.every(r => r.status === 200 || r.status === 409));
  const listing = await body(await api("/solidarity/initiatives", { headers: auth(creator.cookie) }), 200);
  const completed = listing.initiatives.find(i => i.id === initiative.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.supportCount, 3);
  const profile = await body(await api("/solidarity/status", { headers: auth(creator.cookie) }), 200);
  assert.equal(profile.profile.initiativesCompleted, 1);
  assert.equal(profile.profile.score, 10);
  const supporterProfile = await body(await api("/solidarity/status", { headers: auth(supporters[0].cookie) }), 200);
  assert.equal(supporterProfile.profile.supportsCompleted, 1);
  assert.equal(supporterProfile.profile.score, 5);
  const notifications = await body(await api("/notifications", { headers: auth(creator.cookie) }), 200);
  assert.equal(notifications.notifications.filter(n => n.type === "solidarity_completed").length, 1);
  const sql = await dbClient();
  t.after(async () => {
    try {
      const ids = [creator.id, ...supporters.map(u => u.id)];
      await sql.query("DELETE FROM solidarity_reward_ledger WHERE user_id=ANY($1)", [ids]);
      await sql.query("DELETE FROM solidarity_supports WHERE user_id=ANY($1)", [ids]);
      await sql.query("DELETE FROM solidarity_initiatives WHERE creator_id=$1", [creator.id]);
      await sql.query("DELETE FROM citizen_solidarity_profiles WHERE user_id=ANY($1)", [ids]);
    } finally {
      await sql.end();
    }
  });
  const firstState = await sql.query("SELECT xp FROM users WHERE id=$1", [creator.id]);
  await sql.query("UPDATE solidarity_initiatives SET created_at=created_at-interval '2 minutes' WHERE id=$1", [initiative.id]);
  const second = await body(await api("/solidarity/initiatives", { method: "POST", headers: auth(creator.cookie), body: JSON.stringify({ ...payload, title: "Second genuine completion" }) }), 201);
  await Promise.all(supporters.map(u => api(`/solidarity/initiatives/${second.initiative.id}/support`, { method: "POST", headers: auth(u.cookie) })));
  const creatorAfter = await body(await api("/solidarity/status", { headers: auth(creator.cookie) }), 200);
  const supporterAfter = await body(await api("/solidarity/status", { headers: auth(supporters[0].cookie) }), 200);
  assert.equal(creatorAfter.profile.initiativesCompleted, 2);
  assert.equal(supporterAfter.profile.supportsCompleted, 2);
  assert.equal(creatorAfter.profile.score, 10);
  assert.equal(supporterAfter.profile.score, 5);
  const secondState = await sql.query("SELECT xp FROM users WHERE id=$1", [creator.id]);
  assert.equal(secondState.rows[0].xp, firstState.rows[0].xp);
  const ledgers = await sql.query(
    `SELECT user_id,role,COUNT(*)::int AS count FROM solidarity_reward_ledger
     WHERE user_id=ANY($1) GROUP BY user_id,role`, [[creator.id, ...supporters.map(u => u.id)]]);
  assert.ok(ledgers.rows.every(row => row.count === 1));
  // A room-scoped create is never allowed for a non-member.
  const outsider = await citizen("outsider", cookies);
  const group = await body(await api("/messages/rooms", { method: "POST", headers: auth(creator.cookie), body: JSON.stringify({ type: "group", roomName: "Scoped community" }) }), 201);
  await body(await api("/solidarity/initiatives", { method: "POST", headers: auth(outsider.cookie), body: JSON.stringify({ ...payload, roomId: group.room.id }) }), 403);
});

function socket(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, { headers: { cookie } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}
function waitFor(ws, type, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`No ${type} frame`)); }, timeout);
    const handler = raw => { const value = JSON.parse(raw.toString()); if (value.type === type) { cleanup(); resolve(value); } };
    const cleanup = () => { clearTimeout(timer); ws.off("message", handler); };
    ws.on("message", handler);
  });
}

test("blocked WebSocket calls create no signaling state or callee delivery", async (t) => {
  const cookies = [];
  t.after(async () => { await Promise.allSettled(cookies.map(cookie => api("/auth/me", { method: "DELETE", headers: auth(cookie) }))); });
  const caller = await citizen("wscaller", cookies), target = await citizen("wstarget", cookies);
  const callerWs = await socket(caller.cookie), targetWs = await socket(target.cookie);
  t.after(() => { callerWs.close(); targetWs.close(); });
  const callerRegistered = waitFor(callerWs, "registered"), targetRegistered = waitFor(targetWs, "registered");
  callerWs.send(JSON.stringify({ type: "register" }));
  targetWs.send(JSON.stringify({ type: "register" }));
  await Promise.all([callerRegistered, targetRegistered]);
  await body(await api(`/solidarity/blocks/${target.id}`, { method: "POST", headers: auth(caller.cookie) }), 200);
  const incoming = [];
  targetWs.on("message", raw => { if (JSON.parse(raw.toString()).type === "call-incoming") incoming.push(raw); });
  const callId = `blocked-${suffix}`;
  const callerBlocked = waitFor(callerWs, "call-blocked");
  callerWs.send(JSON.stringify({ type: "call-offer", to: target.username, offer: null, callId, from: caller.username, video: false }));
  const blockedFrame = await callerBlocked;
  assert.equal(blockedFrame.callId, callId);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(incoming.length, 0);
  // No active call record exists: a follow-on answer receives no acceptance.
  targetWs.send(JSON.stringify({ type: "call-answer", to: caller.username, answer: null, callId }));
  await new Promise(resolve => setTimeout(resolve, 100));
  await body(await api(`/rtc/agora-token?channel=${encodeURIComponent(callId)}`, { headers: auth(caller.cookie) }), 403);
  await body(await api(`/solidarity/blocks/${target.id}`, { method: "DELETE", headers: auth(caller.cookie) }), 200);
  await body(await api(`/solidarity/blocks/${caller.id}`, { method: "POST", headers: auth(target.cookie) }), 200);
  const reverseId = `reverse-${suffix}`;
  const reverseBlocked = waitFor(callerWs, "call-blocked");
  callerWs.send(JSON.stringify({ type: "call-offer", to: target.username, offer: null, callId: reverseId, from: caller.username, video: false }));
  assert.equal((await reverseBlocked).callId, reverseId);
  await body(await api(`/rtc/agora-token?channel=${encodeURIComponent(reverseId)}`, { headers: auth(caller.cookie) }), 403);
});

test("status privacy, blocks, reply/reaction room scoping, and community counts", async (t) => {
  const cookies = [];
  t.after(async () => { await Promise.allSettled(cookies.map(cookie => api("/auth/me", { method: "DELETE", headers: auth(cookie) }))); });
  const a = await citizen("alice", cookies), b = await citizen("bob", cookies), c = await citizen("cara", cookies);
  await body(await api("/solidarity/status", { method: "PUT", headers: auth(b.cookie), body: JSON.stringify({ status: "focused", statusVisible: false }) }), 200);
  let citizens = await body(await api("/citizens?search=" + encodeURIComponent(b.username), { headers: auth(a.cookie) }), 200);
  assert.equal(citizens.citizens.find(x => x.username === b.username).solidarityStatus, null);
  await body(await api("/solidarity/status", { method: "PUT", headers: auth(b.cookie), body: JSON.stringify({ status: "focused", statusVisible: true }) }), 200);
  citizens = await body(await api("/citizens?search=" + encodeURIComponent(b.username), { headers: auth(a.cookie) }), 200);
  assert.equal(citizens.citizens.find(x => x.username === b.username).solidarityStatus, "focused");
  const direct = await body(await api("/messages/rooms", { method: "POST", headers: auth(a.cookie), body: JSON.stringify({ targetUsername: b.username }) }), 201);
  const sent = await body(await api(`/messages/rooms/${direct.room.id}/send`, { method: "POST", headers: auth(a.cookie), body: JSON.stringify({ content: "Please review this thoughtful plan." }) }), 201);
  await body(await api(`/messages/rooms/${direct.room.id}/messages/${sent.message.id}/reaction`, { method: "PUT", headers: auth(b.cookie), body: JSON.stringify({ reaction: "support" }) }), 200);
  await body(await api(`/solidarity/blocks/${a.id}`, { method: "POST", headers: auth(b.cookie) }), 200);
  const detail = await body(await api(`/messages/rooms/${direct.room.id}`, { headers: auth(a.cookie) }), 200);
  assert.equal(detail.room.blocked, true);
  assert.equal(detail.room.blockedByMe, false);
  await body(await api(`/messages/rooms/${direct.room.id}/send`, { method: "POST", headers: auth(a.cookie), body: JSON.stringify({ content: "This must be blocked after consent changes." }) }), 403);
  await body(await api(`/messages/rooms/${direct.room.id}/messages/${sent.message.id}/reaction`, { method: "PUT", headers: auth(a.cookie), body: JSON.stringify({ reaction: "listen" }) }), 403);
  await body(await api("/messages/rooms", { method: "POST", headers: auth(a.cookie), body: JSON.stringify({ targetUsername: b.username }) }), 403);
  const group = await body(await api("/messages/rooms", { method: "POST", headers: auth(c.cookie), body: JSON.stringify({ type: "group", roomName: "Initiative community" }) }), 201);
  await body(await api(`/messages/rooms/${group.room.id}/join`, { method: "POST", headers: auth(a.cookie) }), 200);
  const root = await body(await api(`/messages/rooms/${group.room.id}/send`, { method: "POST", headers: auth(a.cookie), body: JSON.stringify({ content: "A substantive first message for the group." }) }), 201);
  const reply = await body(await api(`/messages/rooms/${group.room.id}/send`, { method: "POST", headers: auth(a.cookie), body: JSON.stringify({ content: "A scoped reply follows the first message.", replyToId: root.message.id }) }), 201);
  await body(await api(`/messages/rooms/${direct.room.id}/send`, { method: "POST", headers: auth(b.cookie), body: JSON.stringify({ content: "Blocked rooms cannot be used as a reply target.", replyToId: root.message.id }) }), 403);
  const groupDetail = await body(await api(`/messages/rooms/${group.room.id}`, { headers: auth(a.cookie) }), 200);
  assert.equal(groupDetail.messages.find(m => m.id === reply.message.id).replyTo.id, root.message.id);
  const communities = await body(await api("/messages/communities", { headers: auth(a.cookie) }), 200);
  assert.equal(typeof communities.communities.find(x => x.id === group.room.id).activeInitiativeCount, "number");
});