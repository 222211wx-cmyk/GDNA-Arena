import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { parseServiceAccount, selectServiceAccount } from "../src/lib/firebase-service-account.mjs";

const raw = selectServiceAccount(process.env);
if (!raw) {
  console.log(JSON.stringify({ enabled: false, reason: "Firebase service account is not configured" }));
  process.exit(0);
}

const { account: serviceAccount, error: parseError } = parseServiceAccount(raw);
if (!serviceAccount) {
  console.log(JSON.stringify({ enabled: false, reason: parseError }));
  process.exitCode = 1;
} else {
  let app;
  try {
    app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
    // Real FCM API validation without delivering unsolicited notifications.
    // Success verifies send authorization, not browser receipt.
    try {
      await getMessaging(app).send({
        topic: "gdna-call-diagnostics",
        data: { type: "DIAGNOSTIC", title: "FCM validation" },
      }, true);
      console.log(JSON.stringify({ fcm: "dry-run-accepted", delivered: false }));
    } catch {
      console.error(JSON.stringify({ fcm: "dry-run-failed", delivered: false }));
      process.exitCode = 1;
    }
    // Useful while replacement web configuration/rules are still pending:
    // validate the supplied server credential without writing any documents.
    if (process.argv.includes("--fcm-only")) {
      await app.delete().catch(() => {});
      process.exit(process.exitCode ?? 0);
    }
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