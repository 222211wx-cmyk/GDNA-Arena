// Live UI/media verification through Chromium's DevTools protocol.
// Start Chromium with fake camera/microphone and remote-debugging-port=9222.
// Media, signaling, TURN and Agora remain real; no app API/SDK is mocked.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import WebSocket from "ws";

const origin = process.env.MEDIA_TEST_ORIGIN ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const globalMode = process.env.GLOBAL_CALL_TEST === "1";
const backgroundMode = process.env.BACKGROUND_CALL_TEST === "1";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
let id = 0;
const pending = new Map();
ws.on("message", raw => {
  const message = JSON.parse(raw.toString());
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id); clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const current = ++id;
    pending.set(current, { resolve, reject, timer: setTimeout(() => {
      pending.delete(current); reject(new Error(`CDP timeout: ${method}`));
    }, 45_000) });
    ws.send(JSON.stringify({ id: current, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(page, expression) {
  const result = await command("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  }, page.sessionId);
  if (result.exceptionDetails) throw new Error("Browser evaluation failed: " +
    (result.exceptionDetails.exception?.description?.split("\n")[0] ?? "unknown"));
  return result.result.value;
}
async function wait(page, expression, label, timeout = 35_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expression)) return;
    await pause(300);
  }
  throw new Error(`Timed out: ${label}`);
}
const probe = `(() => {
  localStorage.setItem('gdna_lang','en');
  window.__mediaPeers = [];
  window.__callChannels = [];
  window.__deviceKeyReady = false;
  window.__browserPushBound = false;
  window.__ringNodes = 0;
  window.__notificationCount = 0;
  const oscillatorStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function(...args) {
    window.__ringNodes++; return oscillatorStart.apply(this,args);
  };
  const NativeNotification = window.Notification;
  if (NativeNotification) window.Notification = new Proxy(NativeNotification, {
    construct(target,args) { window.__notificationCount++; return new target(...args); },
    get(target,key) { const value=Reflect.get(target,key); return typeof value==='function' ? value.bind(target) : value; }
  });
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(Original, {construct(target,args) {
    const pc = new target(...args); window.__mediaPeers.push(pc); return pc;
  }});
  const originalFetch = window.fetch;
  window.fetch = function(input,...rest) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (/agora[-/]token/.test(url.pathname)) window.__callChannels.push(url.searchParams.get('channel'));
    const result = originalFetch.call(this,input,...rest);
    if (url.pathname.endsWith('/messages/e2e/key') && rest[0]?.method === 'PUT') {
      void result.then(r => { if(r.ok) window.__deviceKeyReady = true; });
    }
    if (url.pathname.endsWith('/browser-push/subscriptions') && rest[0]?.method === 'POST') {
      void result.then(r => { if(r.ok) window.__browserPushBound = true; });
    }
    return result;
  };
})()`;
async function page(normalProfile = false) {
  const { browserContextId } = normalProfile ? {} : await command("Target.createBrowserContext");
  await command("Browser.grantPermissions", {
    browserContextId, origin, permissions: ["audioCapture", "videoCapture", "notifications"],
  });
  const { targetId } = await command("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  const p = { browserContextId, sessionId, targetId };
  await command("Page.enable", {}, sessionId);
  await command("Page.addScriptToEvaluateOnNewDocument", { source: probe }, sessionId);
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await command("Page.navigate", { url: `${origin}${globalMode || backgroundMode ? "/" : "/messages"}` }, sessionId);
  await wait(p, "document.readyState === 'complete'", "initial page");
  return p;
}
async function api(p, path, method = "GET", body) {
  return evaluate(p, `(async () => {
    const r = await fetch(${JSON.stringify(`/api${path}`)}, {method:${JSON.stringify(method)},
      credentials:'include', headers:{'content-type':'application/json'},
      ${body ? `body:${JSON.stringify(JSON.stringify(body))},` : ""}});
    if (!r.ok) throw new Error('API ${method} ${path} status '+r.status);
    return r.json();
  })()`);
}
async function navigateRoom(p, room) {
  await command("Page.navigate", { url: `${origin}/messages?roomId=${room}` }, p.sessionId);
  await wait(p, "!!document.querySelector('button[title] svg.lucide-video')", "conversation video-call button");
  await pause(1500); // Let authenticated WS and device-key registration finish.
}
async function click(p, selector) {
  await evaluate(p, `(() => {const b=document.querySelector(${JSON.stringify(selector)}); if(!b || b.disabled)throw new Error('button unavailable'); b.click();})()`);
}
async function navigateGlobal(p, path) {
  await command("Page.navigate", { url: `${origin}${path}` }, p.sessionId);
  await wait(p, "window.__deviceKeyReady === true", "root device readiness without visiting Messages");
  assert.equal(await evaluate(p, "location.pathname"), path);
  await wait(p, "!!document.querySelector('[data-testid=\"enable-call-alerts-button\"]')", "global Enable Call Alerts control");
  // Dispatch a trusted input gesture; never bypass the browser autoplay policy.
  const bounds = await evaluate(p, "(() => {const r=document.querySelector('[data-testid=\"enable-call-alerts-button\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await command("Input.dispatchMouseEvent", {type:"mousePressed",button:"left",clickCount:1,...bounds}, p.sessionId);
  await command("Input.dispatchMouseEvent", {type:"mouseReleased",button:"left",clickCount:1,...bounds}, p.sessionId);
}
async function rejectGlobalInvite(caller, callee, path) {
  await evaluate(caller, "document.querySelector('button[title] svg.lucide-video').closest('button').click()");
  await wait(callee, "!!document.querySelector('[data-testid=\"incoming-call-modal\"]')", `incoming call on ${path}`);
  assert.equal(await evaluate(callee, "location.pathname"), path);
  await wait(callee, "window.__ringNodes > 0", "audible global ringtone oscillator");
  assert.equal(await evaluate(callee, "!!document.querySelector('[data-testid=\"button-answer-call\"]')"), true);
  await click(callee, '[data-testid="button-decline-call"]');
  await wait(callee, "!document.querySelector('[data-testid=\"incoming-call-modal\"]')", "global Reject");
  await wait(caller, "!document.querySelector('[data-testid=\"button-cancel-call\"]')", "caller stops ringing");
  await pause(2500);
  console.log(`GLOBAL_POPUP_PASS ${path}`);
}
async function mediaStats(p) {
  return evaluate(p, `(async () => {
    const stats={audioBytes:0,videoBytes:0,framesDecoded:0,audioEnergy:0,audioSamples:0,connections:[],turnConfigured:false};
    for (const pc of window.__mediaPeers ?? []) {
      stats.connections.push(pc.connectionState);
      stats.turnConfigured ||= (pc.getConfiguration().iceServers || []).some(server =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /turns?:.*helixly/.test(url)));
      for (const report of (await pc.getStats()).values()) if(report.type==='inbound-rtp') {
        if(report.kind==='audio') {stats.audioBytes+=report.bytesReceived||0; stats.audioEnergy+=report.totalAudioEnergy||0; stats.audioSamples+=report.totalSamplesReceived||0;}
        if(report.kind==='video') {stats.videoBytes+=report.bytesReceived||0; stats.framesDecoded+=report.framesDecoded||0;}
      }
    }
    stats.channels=[...new Set(window.__callChannels)];
    stats.rendered=[...document.querySelectorAll('video')].map(v=>({width:v.videoWidth,height:v.videoHeight,paused:v.paused,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,enabled:t.enabled,ready:t.readyState}))}));
    return stats;
  })()`);
}
const pages = [];
try {
  for (let i = 0; i < 2; i++) {
    const p = await page(backgroundMode && i === 1); pages.push(p);
    p.username = `mediaqa${randomBytes(5).toString("hex")}`;
    await api(p, "/auth/register", "POST", {
      username: p.username, password: randomBytes(24).toString("hex"), birthDate: "1990-01-01",
    });
    p.registered = true;
  }
  const [caller, callee] = pages;
  const created = await api(caller, "/messages/rooms", "POST", { targetUsername: callee.username });
  await navigateRoom(caller, created.room.id);
  if (backgroundMode) {
    await navigateGlobal(callee, "/");
    try {
      await wait(callee, "(async()=>!!(await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()))()", "real browser Push subscription", 22000);
      await wait(callee, "window.__browserPushBound", "authenticated server push binding", 10000);
    } catch {
      const alert = await evaluate(callee, "document.querySelector('[data-testid=\"global-call-alerts\"]')?.innerText || document.body.innerText.slice(-1100)");
      console.log("BACKGROUND_REGISTRATION_UNAVAILABLE", alert);
      throw new Error("This Chromium environment could not obtain a real browser push subscription; closed-app delivery is not verified.");
    }
    // Leave the application entirely. The JSON page runs no app code or call
    // socket, but lets CDP inspect this origin's OS notification registration.
    await command("Page.navigate", {url:`${origin}/api/browser-push/config`}, callee.sessionId);
    await wait(callee, "document.readyState==='complete' && !window.__deviceKeyReady", "app and its WebSocket are closed");
    await pause(1500);
    await evaluate(caller, "document.querySelector('button[title] svg.lucide-video').closest('button').click()");
    await wait(caller, "window.__callChannels.length > 0", "current background call identity");
    const backgroundCallId = await evaluate(caller, "window.__callChannels.at(-1)");
    await wait(callee, `(async()=> (await (await navigator.serviceWorker.getRegistration()).getNotifications()).some(n=>n.data?.callId===${JSON.stringify(backgroundCallId)}))()`, "real Web Push outside app", 25000);
    console.log("PASS: actual Web Push displayed an OS notification while no callee app page or call socket was open.");
    await click(caller, '[data-testid="button-cancel-call"]');
    await wait(callee, `(async()=> (await (await navigator.serviceWorker.getRegistration()).getNotifications()).every(n=>n.data?.callId!==${JSON.stringify(backgroundCallId)}))()`, "terminal push closes this call's notification", 20000);
    console.log("PASS: caller cancellation removed the background notification.");
  } else {
  if (globalMode) {
    await navigateGlobal(callee, "/");
    await rejectGlobalInvite(caller, callee, "/");
    await navigateGlobal(callee, "/hub");
  } else await navigateRoom(callee, created.room.id);
  await evaluate(caller, "document.querySelector('button[title] svg.lucide-video').closest('button').click()");
  await wait(callee, "!!document.querySelector('[data-testid=\"incoming-call-modal\"]')", "real incoming call popup");
  assert.equal(await evaluate(callee, "!!document.querySelector('[data-testid=\"button-decline-call\"]')"), true);
  if (globalMode) assert.equal(await evaluate(callee, "location.pathname"), "/hub");
  // No callee media acquisition before explicit consent.
  // The SDK briefly opens/closes a capability-probe peer on module load;
  // that is not a media join. No live peer or channel token before Answer.
  const preAnswer = await mediaStats(callee);
  assert.equal(preAnswer.connections.filter(state => state !== "closed").length, 0);
  assert.equal(preAnswer.channels.length, 0);
  await click(callee, '[data-testid="button-answer-call"]');
  for (const p of pages) await wait(p,
    "!!document.querySelector('[data-testid=\"call-timer\"]')",
    "connected media timer", 45_000);
  const before = await Promise.all(pages.map(mediaStats));
  await pause(5000);
  const after = await Promise.all(pages.map(mediaStats));
  for (let i = 0; i < 2; i++) {
    assert.ok(after[i].audioBytes > before[i].audioBytes, `peer ${i} receives audio packets`);
    assert.ok(after[i].videoBytes > before[i].videoBytes, `peer ${i} receives video packets`);
    assert.ok(after[i].framesDecoded > before[i].framesDecoded, `peer ${i} decodes video frames`);
    assert.ok(after[i].audioSamples > before[i].audioSamples, `peer ${i} decodes audio samples`);
    assert.equal(after[i].turnConfigured, true, `peer ${i} has the existing custom TURN relay configured`);
  }
  if (!globalMode) assert.equal(after[0].channels.length, 1);
  assert.equal(after[1].channels.length, 1);
  assert.deepEqual(after[0].channels.slice(-1), after[1].channels, "same Agora channel on both peers");
  console.log("BIDIRECTIONAL_MEDIA", JSON.stringify(after.map(({channels,...stats})=>stats)));
  await mkdir("/tmp/gdna-media-evidence", { recursive: true });
  for (let i = 0; i < 2; i++) {
    const shot = await command("Page.captureScreenshot", { format: "jpeg", quality: 85 }, pages[i].sessionId);
    await writeFile(`/tmp/gdna-media-evidence/peer-${i}.jpg`, Buffer.from(shot.data,"base64"));
  }
  await click(caller, '[data-testid="button-mute-call"]');
  await wait(caller, "document.querySelector('[data-testid=\"button-mute-call\"]').getAttribute('aria-pressed') === 'true'", "microphone mute completes");
  await click(caller, '[data-testid="button-mute-call"]');
  await wait(caller, "document.querySelector('[data-testid=\"button-mute-call\"]').getAttribute('aria-pressed') === 'false'", "microphone resumes");
  await click(caller, '[data-testid="button-camera-call"]');
  await wait(caller, "document.querySelector('[data-testid=\"button-camera-call\"]').getAttribute('aria-pressed') === 'true'", "camera off completes");
  await click(caller, '[data-testid="button-camera-call"]');
  await wait(caller, "document.querySelector('[data-testid=\"button-camera-call\"]').getAttribute('aria-pressed') === 'false'", "camera resumes");
  for (const p of pages) {
    assert.equal(await evaluate(p, "document.body.innerText.includes('مفتاح الوسائط غير متاح')"), false, "ordinary media controls must not trigger encryption-key errors");
  }
  await click(caller, '[data-testid="button-end-call"]');
  for (const p of pages) await wait(p, "!document.querySelector('[data-testid=\"call-timer\"]')", "hangup clears connected call");
  await wait(caller, "!document.querySelector('[data-testid=\"button-end-call\"]') && !document.querySelector('[data-testid=\"button-cancel-call\"]')", "caller returns idle");
  await pause(2000);
  if (globalMode) await navigateGlobal(callee, `/citizen/${callee.username}`);
  await evaluate(caller, "document.querySelector('button[title] svg.lucide-video').closest('button').click()");
  await wait(callee, "!!document.querySelector('[data-testid=\"incoming-call-modal\"]')", "second invite for Reject");
  if (globalMode) assert.equal(await evaluate(callee, "location.pathname"), `/citizen/${callee.username}`);
  await click(callee, '[data-testid="button-decline-call"]');
  await wait(callee, "!document.querySelector('[data-testid=\"incoming-call-modal\"]')", "Reject dismisses popup");
  await wait(caller, "!document.querySelector('[data-testid=\"button-cancel-call\"]')", "Reject stops caller ringing");
  console.log("PASS: popup, explicit Answer/Reject, bidirectional decoded audio/video, same Agora channel, timer, mute/camera, hangup.");
  if (globalMode) console.log("PASS: callee never visited Messages; received popup on home, arena hub, and profile; Answer on arena connected real media.");
  if (globalMode) {
    const pushState = await evaluate(callee, `(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return {workerActive:!!r?.active, subscribed:!!(await r?.pushManager.getSubscription())};
    })()`);
    console.log("BACKGROUND_PUSH_CAPABILITY", JSON.stringify(pushState));
  }
  }
} catch (error) {
  console.error(error.message);
  for (let i = 0; i < pages.length; i++) {
    console.error(`peer ${i} media`, JSON.stringify(await mediaStats(pages[i]).catch(() => null)));
    console.error(`peer ${i} UI`, await evaluate(pages[i], "document.body.innerText.slice(-2400)").catch(() => "unavailable"));
  }
  process.exitCode = 1;
} finally {
  for (const p of pages) {
    if (p.registered) await api(p, "/auth/me", "DELETE").catch(() => {});
    if (p.browserContextId) await command("Target.disposeBrowserContext", { browserContextId: p.browserContextId }).catch(() => {});
    else await command("Target.closeTarget", {targetId:p.targetId}).catch(() => {});
  }
  ws.close();
}