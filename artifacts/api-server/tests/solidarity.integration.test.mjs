import assert from "node:assert/strict";
import test from "node:test";

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
  const supporters = await Promise.all(["s1", "s2", "s3"].map(tag => citizen(tag, cookies)));
  // Duplicate and concurrent support requests cannot create another supporter or award.
  const supportResponses = await Promise.all([...supporters.map(u => api(`/solidarity/initiatives/${initiative.id}/support`, { method: "POST", headers: auth(u.cookie) })), api(`/solidarity/initiatives/${initiative.id}/support`, { method: "POST", headers: auth(supporters[0].cookie) })]);
  assert.equal(supportResponses.filter(r => r.status === 200).length, 3);
  assert.equal(supportResponses.filter(r => r.status === 409).length, 1);
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
  // A room-scoped create is never allowed for a non-member.
  const outsider = await citizen("outsider", cookies);
  const group = await body(await api("/messages/rooms", { method: "POST", headers: auth(creator.cookie), body: JSON.stringify({ type: "group", roomName: "Scoped community" }) }), 201);
  await body(await api("/solidarity/initiatives", { method: "POST", headers: auth(outsider.cookie), body: JSON.stringify({ ...payload, roomId: group.room.id }) }), 403);
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