/*
 * Notification clicks are registered before Firebase is loaded.  A cold
 * service-worker start can receive a click while the compat scripts are still
 * being evaluated, and registering this listener afterwards loses that click.
 */
if (typeof self.addEventListener === "function") {
  self.addEventListener("notificationclick", (event) => {
    // notificationclick is the one worker event whose lifetime must explicitly
    // cover all focus, navigation, and decline-request work.
    event.waitUntil(handleNotificationClick(event));
  });
}

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyDgro5MZqUTSrOzgJPRlEgve2j-88TDnFQ",
  authDomain: "helixly-b7653.firebaseapp.com",
  projectId: "helixly-b7653",
  storageBucket: "helixly-b7653.firebasestorage.app",
  messagingSenderId: "630195919424",
  appId: "1:630195919424:web:1693e46da2370942115da5"
});
const messaging = firebase.messaging();

const CALL_TTL_MS = 30_000;
const INCOMING_CALL_TAG = "gdna-incoming-call";
const MISSED_CALL_TAG = "gdna-missed-call";
const ICON_FILE = "icon.png";

/*
 * FCM data values are strings, while a few test/dev callers invoke the
 * callback with ordinary objects.  Keep this boundary deliberately tolerant:
 * malformed push data must result in a harmless generic notification rather
 * than a worker exception.
 */
function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function notificationData(payload) {
  const source = asObject(payload);
  const data = asObject(source.data);
  const notification = asObject(source.notification);
  // Canonical data wins over the notification envelope.  The latter remains
  // supported for old FCM sends during the server migration.
  return Object.assign({}, source, notification, data);
}

function readCallId(value) {
  const id = text(value && (value.callId || value.roomId || value.call_id || value.id));
  // The ID is copied into URLs and request paths below.  Restricting it here
  // also prevents a legacy payload from escaping the app's route.
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : "";
}

function readExpiry(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const number = Number(raw);
    if (!Number.isFinite(number)) return null;
    return number < 1_000_000_000_000 ? number * 1000 : number;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function callType(value) {
  return text(value).toUpperCase().replace(/[-\s]/g, "_");
}

function isMissedCall(data) {
  const type = callType(data.type || data.event);
  return type === "MISSED_CALL" || type === "MISSED" || type === "CALL_MISSED" ||
    type === "DECLINED_CALL" || type === "CALL_DECLINED";
}

function isTerminalCall(data) {
  const type = callType(data.type || data.event);
  return type === "CALL_ENDED" || type === "ENDED_CALL" || type === "CALL_TERMINAL" ||
    type === "DECLINED_CALL" || type === "CALL_DECLINED";
}

function assetUrl(file) {
  const scope = self.registration && self.registration.scope;
  if (typeof URL === "function" && typeof scope === "string" && scope) {
    try {
      return new URL(file, scope).toString();
    } catch {
      // Fall through to the root-relative artifact path.
    }
  }
  return "/" + file.replace(/^\/+/, "");
}

function tagForCall(callId) {
  return INCOMING_CALL_TAG + "-" + callId;
}

function missedTagForCall(callId) {
  return callId ? MISSED_CALL_TAG + "-" + callId : MISSED_CALL_TAG;
}

function notificationCallData(data, callId, kind, expiresAt) {
  return {
    callId: callId || undefined,
    // Preserve roomId for old foreground clients, but never use it in
    // preference to the canonical callId when one is present.
    roomId: callId || undefined,
    fromName: text(data.fromName || data.callerName || data.caller),
    type: text(data.type || data.event),
    kind,
    expiresAt: expiresAt || undefined,
  };
}

function closeCallNotifications(callId) {
  if (!callId || !self.registration || typeof self.registration.getNotifications !== "function") {
    return Promise.resolve();
  }
  const tag = tagForCall(callId);
  let result;
  try {
    result = self.registration.getNotifications({ tag });
  } catch (error) {
    return Promise.reject(error);
  }
  return Promise.resolve(result).then(notifications => {
    if (!Array.isArray(notifications)) return;
    notifications.forEach(notification => {
      if (notification && typeof notification.close === "function") notification.close();
    });
  });
}

function scheduleCallExpiry(callId, expiresAt) {
  if (!callId || !Number.isFinite(expiresAt)) return Promise.resolve();
  const delay = Math.max(0, expiresAt - Date.now());
  // A timer is intentionally bounded by the invitation's server expiry.  It
  // only closes a stale browser notification; the authenticated server remains
  // the source of truth for call state. Returning this promise lets Firebase
  // keep the background callback alive through the bounded close attempt.
  return new Promise(resolve => {
    setTimeout(() => {
      closeCallNotifications(callId).catch(() => {}).then(resolve, resolve);
    }, delay);
  });
}

function incomingOptions(data, callId, expiresAt) {
  const fromName = text(data.fromName || data.callerName || data.caller);
  const title = text(data.title || data.notificationTitle) ||
    (fromName ? "مكالمة واردة من " + fromName : "مكالمة جديدة");
  const body = text(data.body || data.notificationBody) ||
    (fromName ? "لديك مكالمة واردة" : "مكالمة فيديو واردة");
  return {
    body,
    icon: assetUrl(ICON_FILE),
    tag: tagForCall(callId),
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    // `answer` is only a navigation intent.  The authenticated app resumes
    // the invitation and decides whether it can answer it.
    actions: [
      { action: "answer", title: "الرد" },
      { action: "decline", title: "رفض" },
    ],
    data: notificationCallData(data, callId, "incoming", expiresAt),
  };
}

function missedOptions(data, callId) {
  const fromName = text(data.fromName || data.callerName || data.caller);
  const title = text(data.title) || (fromName ? "مكالمة فائتة من " + fromName : "مكالمة فائتة");
  const body = text(data.body) || "لديك مكالمة فائتة";
  // Missed calls intentionally have no actions.  Clicking the body opens the
  // missed-call inbox and can never answer a call.
  return {
    body,
    icon: assetUrl(ICON_FILE),
    tag: missedTagForCall(callId),
    data: notificationCallData(data, callId, "missed", null),
  };
}

function showGenericNotification(data, payload) {
  const source = asObject(payload);
  const notification = asObject(source.notification);
  const title = text(data.title) || text(notification.title) || "مكالمة جديدة";
  const body = text(data.body) || text(notification.body) || "مكالمة فيديو فائتة";
  // Keep ordinary non-call FCM notifications compatible with the original
  // worker.  Call-specific affordances are only emitted for a validated ID.
  return self.registration.showNotification(title, {
    body,
    icon: "/icon.png",
  });
}

function handleBackgroundMessage(payload) {
  const data = notificationData(payload);
  const callId = readCallId(data);
  if (isTerminalCall(data)) {
    return callId ? closeCallNotifications(callId).catch(() => {}) : Promise.resolve();
  }
  if (!callId) {
    if (isMissedCall(data)) {
      return self.registration.showNotification(text(data.title) || "مكالمة فائتة", missedOptions(data, ""));
    }
    return showGenericNotification(data, payload);
  }

  const now = Date.now();
  if (isMissedCall(data)) {
    // A missed push supersedes the ringing notification for this exact call.
    // Wait for the close before showing the passive inbox notification so the
    // old actionable card cannot remain visible above it.
    return closeCallNotifications(callId).catch(() => {}).then(() => self.registration.showNotification(
      text(data.title) || "مكالمة فائتة",
      missedOptions(data, callId),
    ));
  }

  const expiresAt = readExpiry(data.expiresAt);
  // The server's invitation is authoritative at 30 seconds. A malformed or
  // clock-skewed future expiry must not make the worker wait longer than that.
  const effectiveExpiry = expiresAt === null
    ? now + CALL_TTL_MS
    : Math.min(expiresAt, now + CALL_TTL_MS);
  // Never render a call whose server invitation is already gone.
  if (effectiveExpiry <= now) {
    return closeCallNotifications(callId).catch(() => {});
  }
  // Remove a previous card before replacing it with the latest invitation.
  return closeCallNotifications(callId).catch(() => {}).then(() => {
    const shown = self.registration.showNotification(
      text(data.title) || (text(data.fromName || data.callerName)
        ? "مكالمة واردة من " + text(data.fromName || data.callerName)
        : "مكالمة جديدة"),
      incomingOptions(data, callId, effectiveExpiry),
    );
    const expiryClose = scheduleCallExpiry(callId, effectiveExpiry);
    // Keep the callback alive until both display and best-effort expiry close
    // have settled. This is bounded by the 30-second server policy.
    return Promise.all([Promise.resolve(shown), expiryClose]).then(results => results[0]);
  });
}

function appUrl(route, params) {
  const scope = self.registration && self.registration.scope;
  const base = typeof scope === "string" && scope
    ? scope
    : (self.location && self.location.href) || "/";
  const cleanRoute = String(route || "").replace(/^\/+/, "");
  if (typeof URL !== "function") {
    const root = typeof base === "string" && /^https?:\/\//.test(base)
      ? base.replace(/[^/]*$/, "")
      : "/";
    const path = root === "/" ? "/" + cleanRoute : root + cleanRoute;
    const query = Object.keys(params || {}).flatMap(key => {
      const value = params[key];
      return value === undefined || value === null || value === ""
        ? []
        : [encodeURIComponent(key) + "=" + encodeURIComponent(String(value))];
    }).join("&");
    return query ? path + "?" + query : path;
  }
  let url;
  try {
    url = new URL(cleanRoute, base);
  } catch {
    // VM/unit-test harnesses do not always provide a worker location.  The
    // placeholder is replaced by a real same-origin base in every browser.
    url = new URL(cleanRoute, "https://worker.invalid/");
  }
  Object.keys(params || {}).forEach(key => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function appRoute(callId, action) {
  const params = {};
  if (callId) params.callId = callId;
  if (action) params.action = action;
  return appUrl("messages", params);
}

function missedCallsUrl() {
  return appUrl("missed-calls");
}

function focusOrOpen(url) {
  const windows = self.clients && typeof self.clients.matchAll === "function"
    ? self.clients.matchAll({ type: "window", includeUncontrolled: true })
    : Promise.resolve([]);
  return Promise.resolve(windows).then(clientList => {
    const sameOrigin = Array.isArray(clientList) ? clientList.filter(client => {
      if (typeof URL !== "function") return true;
      try {
        return new URL(client.url).origin === new URL(url).origin;
      } catch {
        return false;
      }
    }) : [];
    const client = sameOrigin[0];
    if (client) {
      const navigation = typeof client.navigate === "function"
        ? Promise.resolve(client.navigate(url)).catch(() => {})
        : Promise.resolve();
      return navigation.then(() => typeof client.focus === "function" ? client.focus() : client);
    }
    return self.clients && typeof self.clients.openWindow === "function"
      ? self.clients.openWindow(url)
      : undefined;
  });
}

function declineCall(callId) {
  const endpoint = appUrl("api/call/decline", { id: callId });
  if (typeof fetch !== "function") return Promise.reject(new Error("Fetch is unavailable"));
  return fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  }).then(response => {
    if (!response || response.ok !== true) {
      throw new Error("Call decline request failed");
    }
    return response;
  });
}

function handleNotificationClick(event) {
  const notification = event.notification || {};
  const data = asObject(notification.data);
  const callId = readCallId(data);
  const action = text(event.action).toLowerCase();
  const answerAction = action === "answer" || action === "incominganswer";
  const declineAction = action === "decline" || action === "incomingdecline";
  const incoming = data.kind === "incoming" || (callId && !isMissedCall(data));
  const missed = data.kind === "missed" || isMissedCall(data);
  if (typeof notification.close === "function") notification.close();

  if (missed) return focusOrOpen(missedCallsUrl());
  if (!callId || !incoming) return focusOrOpen(appUrl("messages"));

  const expiresAt = readExpiry(data.expiresAt);
  if ((answerAction || declineAction) && expiresAt !== null && expiresAt <= Date.now()) {
    // An old action must never answer or decline a new/current call. A passive
    // route is still useful when another tab is already open and also makes
    // expiry visible instead of silently dropping the user's click.
    return focusOrOpen(appRoute(callId));
  }

  if (answerAction) {
    // The app sends call-resume only after this URL is handled by the
    // authenticated websocket hook.  The worker never answers from a push.
    return focusOrOpen(appRoute(callId, "answer"));
  }

  if (declineAction) {
    return declineCall(callId)
      .then(() => focusOrOpen(appRoute(callId)))
      .catch(() => {
        // A rejected/expired session or a transient network error must remain
        // actionable: the authenticated app can perform the WS decline.
        return focusOrOpen(appRoute(callId, "decline"));
      });
  }

  // A body click is deliberately passive.  The app may resume and render the
  // incoming banner, but it cannot auto-answer from this route.
  return focusOrOpen(appRoute(callId));
}

messaging.onBackgroundMessage((payload) => handleBackgroundMessage(payload));