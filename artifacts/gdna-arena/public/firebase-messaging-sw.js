/* Optional Firebase Messaging worker. It deliberately has no Audio APIs. */

const workerUrl = new URL(self.location.href);
const firebaseConfig = (() => {
  try { return JSON.parse(workerUrl.searchParams.get("firebaseConfig") || "null"); } catch { return null; }
})();

function callIdFrom(data) {
  return typeof data?.roomId === "string" ? data.roomId : null;
}

function closeCallNotification(callId) {
  if (!callId) return Promise.resolve();
  return self.registration.getNotifications({ tag: `gdna-call-${callId}` })
    .then(notifications => notifications.forEach(notification => notification.close()));
}

// Install this before Firebase imports: click actions must work even while the
// messaging SDK is being initialized during a cold service-worker start.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const callId = event.notification.data?.callId;
  if (!callId) return;
  // The page performs a canonical authenticated call-resume before applying
  // either action. Nothing in a notification payload is treated as permission.
  const action = event.notification.data?.kind === "missed"
    ? ""
    : event.action === "decline" ? "decline" : "answer";
  const target = new URL(
    `messages?callId=${encodeURIComponent(callId)}${action ? `&action=${encodeURIComponent(action)}` : ""}`,
    self.registration.scope,
  ).toString();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const client = windows.find(item => new URL(item.url).origin === self.location.origin);
    return client ? client.focus().then(() => client.navigate(target)) : clients.openWindow(target);
  }));
});

if (firebaseConfig) {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(payload => {
    const data = payload.data || {};
    const callId = callIdFrom(data);
    const type = data.type;
    if (type === "CALL_ENDED") {
      return closeCallNotification(callId);
    }
    if (type === "MISSED_CALL" && callId) {
      // The backend intentionally sends this data-only payload. Replace any
      // still-ringing invitation with a passive Arabic missed-call notice.
      return closeCallNotification(callId).then(() => self.registration.showNotification(
        data.title || (data.callerName ? `مكالمة فائتة من ${data.callerName}` : "مكالمة فائتة"),
        {
          body: data.body || "لديك مكالمة فائتة",
          tag: `gdna-missed-call-${callId}`,
          renotify: true,
          requireInteraction: false,
          data: { callId, kind: "missed" },
        },
      ));
    }
    if (type !== "INCOMING_CALL" || !callId) {
      return undefined;
    }
    const expiresAt = typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return closeCallNotification(callId);
    const title = data.callerName ? `مكالمة واردة من ${data.callerName}` : "مكالمة واردة";
    const options = {
      body: "مكالمة صوتية أو مرئية واردة",
      icon: data.callerAvatar || undefined,
      tag: `gdna-call-${callId}`,
      renotify: true,
      requireInteraction: true,
      data: { callId, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 30_000 },
      actions: [{ action: "answer", title: "رد" }, { action: "decline", title: "رفض" }],
    };
    return self.registration.showNotification(title, options).then(() => {
      // Browsers may suspend this worker before the timer fires, but the timer
      // bounds notifications on active workers while terminal pushes close them.
      const lifespan = Number.isFinite(expiresAt)
        ? Math.max(0, Math.min(30_000, expiresAt - Date.now()))
        : 30_000;
      setTimeout(() => { void closeCallNotification(callId); }, lifespan);
    });
  });
}