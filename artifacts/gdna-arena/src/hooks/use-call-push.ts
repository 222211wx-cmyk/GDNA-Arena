import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCallFirebase,
  fetchMissedCalls,
  markMissedCallsSeen as markSeen,
  type FirebaseStatus,
  type MissedCall,
} from "@/lib/call-firebase";

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
  const [missedCalls, setMissedCalls] = useState<MissedCall[]>([]);
  const firebaseRef = useRef<Awaited<ReturnType<typeof createCallFirebase>> | null>(null);
  const pushCleanupRef = useRef<(() => Promise<void>) | null>(null);
  const sessionGenerationRef = useRef(0);
  const resumeRef = useRef(resumeCall);
  const terminalRef = useRef(terminalCall);
  resumeRef.current = resumeCall;
  terminalRef.current = terminalCall;

  useEffect(() => {
    let cancelled = false;
    const generation = ++sessionGenerationRef.current;
    // Never render one citizen's missed calls while the next Firebase session
    // is being established.
    setMissedCalls([]);
    if (!user) {
      setFirebaseStatus("disabled");
      setFirebaseError(null);
      setMissedCalls([]);
      return;
    }
    setFirebaseStatus("loading");
    setFirebaseError(null);
    void createCallFirebase(
      callId => resumeRef.current(callId),
      (callId, status) => terminalRef.current(callId, status),
      items => { if (!cancelled) setMissedCalls(items); },
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
        setFirebaseStatus("disabled");
        setFirebaseError(firebase.reason);
        return;
      }
      await firebase.ready;
      if (cancelled || generation !== sessionGenerationRef.current) {
        await firebase.cleanup();
        return;
      }
      setFirebaseStatus("ready");
      try {
        const missed = await fetchMissedCalls();
        if (!cancelled) setMissedCalls(missed.items);
      } catch (error) {
        if (!cancelled) {
          setFirebaseStatus("error");
          setFirebaseError(error instanceof Error ? error.message : "Missed calls could not be loaded");
        }
        return;
      }
      // Permission prompts are only made by enableCallNotifications. A prior
      // grant, however, should restore this account's FCM registration.
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
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
    }).catch(error => {
      if (!cancelled) {
        setFirebaseStatus("error");
        setFirebaseError(error instanceof Error ? error.message : "Firebase call notifications failed");
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
    };
  }, [user?.id]);

  const enableCallNotifications = useCallback(async () => {
    const firebase = firebaseRef.current;
    if (!firebase?.enabled) throw new Error("Call notifications are not configured");
    const existing = pushCleanupRef.current;
    if (existing) return notificationPermission;
    const generation = sessionGenerationRef.current;
    const result = await firebase.enableMessaging();
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

  return {
    firebaseStatus, firebaseError, notificationPermission, enableCallNotifications,
    missedCalls, missedCallCount: missedCalls.filter(item => !item.isSeen).length, markMissedCallsSeen,
  };
}