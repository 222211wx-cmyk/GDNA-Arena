import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function selectedServiceAccount() {
  if (typeof process.env.FIREBASE_SERVICE_ACCOUNT === "string") {
    return process.env.FIREBASE_SERVICE_ACCOUNT.trim();
  }
  if (typeof process.env.FIREBASE_SERVICE_ACCOUNT_JSON === "string") {
    return process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
  }
  return "";
}

function parseServiceAccount(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" ||
      typeof value.project_id !== "string" ||
      typeof value.client_email !== "string" ||
      typeof value.private_key !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

const raw = selectedServiceAccount();
if (!raw) {
  console.log(JSON.stringify({ enabled: false, reason: "Firebase service account is not configured" }));
  process.exit(0);
}

const serviceAccount = parseServiceAccount(raw);
if (!serviceAccount) {
  console.log(JSON.stringify({ enabled: false, reason: "Firebase service account is invalid" }));
  process.exitCode = 1;
} else {
  let app;
  try {
    app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
    const db = getFirestore(app);
    const callId = `probe-${randomUUID().replaceAll("-", "")}`;
    const ref = db.collection("callInvites").doc(callId);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    try {
      await ref.create({
        fromId: 0,
        fromName: "server-probe",
        toId: 0,
        status: "ringing",
        type: "voice",
        createdAt: new Date(),
        expiresAt,
        deferredMedia: true,
      });
      const readBack = await ref.get();
      if (!readBack.exists || readBack.data()?.status !== "ringing") {
        throw new Error("Diagnostic Firestore document could not be read back");
      }
      // This is the exact bounded expiry query used by the server sweep. It
      // verifies that the deployed composite index is available without
      // touching any production invitation after the diagnostic document is
      // removed below.
      await db.collection("callInvites")
        .where("status", "==", "ringing")
        .where("expiresAt", "<=", new Date())
        .orderBy("expiresAt")
        .limit(1)
        .get();
    } finally {
      await ref.delete().catch(() => {});
    }
    console.log(JSON.stringify({ enabled: true, firestore: "read-write-delete", expiryIndex: true }));
  } catch {
    process.exitCode = 1;
    console.error(JSON.stringify({ enabled: false, reason: "Firebase diagnostic probe failed" }));
  } finally {
    if (app) await app.delete().catch(() => {});
  }
}