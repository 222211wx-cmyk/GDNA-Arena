import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCallFirebase,
  fetchMissedCalls,
  markMissedCallsSeen as markSeen,
  type FirebaseStatus,
  type MissedCall,
  PUSH_LOGOUT_EVENT,
} from "@/lib/call-firebase";
import {
  createBrowserCallPush,
  type BrowserCallPushSession,
} from "@/lib/browser-call-push";

export function useCallPush(
  user: { id: number } | null,
  resumeCall: (callId: string) => void,
  terminalCall: (callId: string, status: string) => void,
) {
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatus>("loading");
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushReason, setPushReason] = useState<string | null>(null);
  const [missedCalls, setMissedCalls] = useState<MissedCall[]>([]);
  const [missedCallsLoading, setMissedCallsLoading] = useState(false);
  const [missedCallsError, setMissedCallsError] = useState(false);
  const firebaseRef = useRef<Awaited<ReturnType<typeof createCallFirebase>> | null>(null);
  const browserPushRef = useRef<BrowserCallPushSession | null>(null);
  const pushCleanupRef = useRef<((revoke?: boolean) => Promise<void>) | null>(null);
  const sessionGenerationRef = useRef(0);
  const resumeRef = useRef(resumeCall);
  const terminalRef = useRef(terminalCall);
  resumeRef.current = resumeCall;
  terminalRef.current = terminalCall;

  useEffect(() => {
    const handleLogout = () => {
      // Logout is the only client lifecycle event that revokes a device. A
      // regular component/tab teardown intentionally leaves the registration
      // alive so background FCM remains available after a reload.
      const cleanup = pushCleanupRef.current;
      pushCleanupRef.current = null;
      const browserCleanup = browserPushRef.current?.cleanup;
      browserPushRef.current = null;
      sessionGenerationRef.current += 1;
      void cleanup?.(true);
      void browserCleanup?.(true);
    };
    window.addEventListener(PUSH_LOGOUT_EVENT, handleLogout);
    return () => window.removeEventListener(PUSH_LOGOUT_EVENT, handleLogout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const generation = ++sessionGenerationRef.current;
    // Never render one citizen's missed calls while the next Firebase session
    // is being established.
    setMissedCalls([]);
    setMissedCallsError(false);
    setPushEnabled(false);
    setPushReason(null);
    if (!user) {
      setFirebaseStatus("disabled");
      setFirebaseError(null);
      setMissedCalls([]);
      setMissedCallsLoading(false);
      return;
    }
    setFirebaseStatus("loading");
    setFirebaseError(null);
    setMissedCallsLoading(true);
    const loadMissedCallsFromAuthority = async () => {
      try {
        const missed = await fetchMissedCalls();
        if (!cancelled) {
          setMissedCalls(missed.items);
          setMissedCallsError(false);
        }
      } catch (error) {
        if (!cancelled) {
          setMissedCallsError(true);
          setFirebaseError(error instanceof Error ? error.message : "Missed calls could not be loaded");
        }
      } finally {
        if (!cancelled) setMissedCallsLoading(false);
      }
    };
    const loadStandardWebPush = async () => {
      const browserPush = await createBrowserCallPush(
        callId => resumeRef.current(callId),
        (callId, status) => terminalRef.current(callId, status),
        () => !cancelled && generation === sessionGenerationRef.current,
      );
      if (cancelled || generation !== sessionGenerationRef.current) {
        await browserPush.cleanup();
        return;
      }
      browserPushRef.current = browserPush;
      setNotificationPermission(browserPush.permission);
      setPushEnabled(browserPush.enabled);
      setPushReason(browserPush.reason ?? null);
      setFirebaseStatus(browserPush.enabled ? "ready" : "disabled");
    };
    void createCallFirebase(
      (callId, _fromName) => resumeRef.current(callId),
      (callId, status) => terminalRef.current(callId, status),
      items => {
        if (!cancelled) {
          setMissedCalls(items);
          setMissedCallsLoading(false);
          setMissedCallsError(false);
        }
      },
      error => {
        if (!cancelled) {
          setFirebaseStatus("error");
          setFirebaseError(error.message);
        }
      },
    ).then(async firebase => {
      if (cancelled) { if (firebase.enabled) await firebase.cleanup(); return; }
      firebaseRef.current = firebase;
      if (!firebase.enabled) {
        // FCM is optional. When it is off, use standards-based Web Push without
        // loading Firebase or creating a Firebase authentication session.
        setFirebaseError(null);
        await Promise.all([loadStandardWebPush(), loadMissedCallsFromAuthority()]);
        return;
      }
      setPushEnabled(firebase.pushEnabled);
      setPushReason(firebase.pushReason ?? null);
      await firebase.ready;
      if (cancelled || generation !== sessionGenerationRef.current) {
        await firebase.cleanup();
        return;
      }
      setFirebaseStatus("ready");
      // Firestore's missed-call snapshot is the optional live subscription and
      // already supplied the initial list; avoid an identical REST request.
      // Permission prompts are only made by enableCallNotifications. A prior
      // grant, however, should restore this account's FCM registration.
      if (firebase.pushEnabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const result = await firebase.enableMessaging();
        if (typeof result !== "string" && (cancelled || generation !== sessionGenerationRef.current)) {
          await result.cleanup();
          return;
        }
        if (!cancelled && typeof result !== "string") {
          pushCleanupRef.current = result.cleanup;
          setNotificationPermission(result.permission);
        }
      }
    }).catch(async error => {
      if (!cancelled) {
        setFirebaseStatus("error");
        setFirebaseError(error instanceof Error ? error.message : "Firebase call notifications failed");
        setPushEnabled(false);
        setPushReason(error instanceof Error ? error.message : "Background notifications could not start");
        // A Firebase failure must not hide durable missed-call history.
        await loadMissedCallsFromAuthority();
      }
    });
    return () => {
      cancelled = true;
      const pushCleanup = pushCleanupRef.current;
      pushCleanupRef.current = null;
      void pushCleanup?.();
      const firebase = firebaseRef.current;
      firebaseRef.current = null;
      if (firebase?.enabled) void firebase.cleanup();
      const browserPush = browserPushRef.current;
      browserPushRef.current = null;
      void browserPush?.cleanup();
    };
  }, [user?.id]);

  const enableCallNotifications = useCallback(async () => {
    const browserPush = browserPushRef.current;
    if (browserPush?.enabled) {
      try {
        const permission = await browserPush.enable();
        setNotificationPermission(permission);
        if (permission === "denied") {
          setPushReason("Call notification permission was denied in browser settings");
        } else if (permission === "granted") {
          setPushEnabled(true);
          setPushReason(null);
        }
        return permission;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Background call notifications are unavailable";
        setPushEnabled(false);
        setPushReason(reason);
        setFirebaseError(reason);
        return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
      }
    }
    const firebase = firebaseRef.current;
    if (!firebase?.enabled) {
      setPushEnabled(false);
      setPushReason(firebase?.pushReason ?? firebase?.reason ?? "Call notifications are not configured");
      return notificationPermission;
    }
    if (!firebase.pushEnabled) {
      setPushEnabled(false);
      setPushReason(firebase.pushReason ?? "Background call notifications are not configured");
      return notificationPermission;
    }
    const existing = pushCleanupRef.current;
    if (existing) return notificationPermission;
    const generation = sessionGenerationRef.current;
    let result: Awaited<ReturnType<typeof firebase.enableMessaging>>;
    try {
      result = await firebase.enableMessaging();
    } catch (error) {
      setPushEnabled(false);
      setPushReason(error instanceof Error ? error.message : "Background call notifications are unavailable");
      return notificationPermission;
    }
    if (generation !== sessionGenerationRef.current) {
      if (typeof result !== "string") await result.cleanup();
      throw new Error("Call notification session changed");
    }
    if (typeof result === "string") {
      setNotificationPermission(result);
      return result;
    }
    setNotificationPermission(result.permission);
    pushCleanupRef.current = result.cleanup;
    return result.permission;
  }, [notificationPermission]);

  const markMissedCallsSeen = useCallback(async (ids?: string[]) => {
    const selected = ids?.length ? ids : missedCalls.filter(item => !item.isSeen).map(item => item.id);
    if (!selected.length) return;
    await markSeen(selected);
    setMissedCalls(items => items.map(item => selected.includes(item.id) ? { ...item, isSeen: true } : item));
  }, [missedCalls]);

  const refreshMissedCalls = useCallback(async () => {
    if (!user) return;
    setMissedCallsLoading(true);
    setMissedCallsError(false);
    try {
      const missed = await fetchMissedCalls();
      setMissedCalls(missed.items);
    } catch (error) {
      setMissedCallsError(true);
      setFirebaseError(error instanceof Error ? error.message : "Missed calls could not be loaded");
    } finally {
      setMissedCallsLoading(false);
    }
  }, [user?.id]);

  return {
    firebaseStatus, firebaseError, notificationPermission, enableCallNotifications,
    missedCalls, missedCallCount: missedCalls.filter(item => !item.isSeen).length, markMissedCallsSeen,
    missedCallsLoading, missedCallsError, refreshMissedCalls,
    pushEnabled, pushReason,
  };
}