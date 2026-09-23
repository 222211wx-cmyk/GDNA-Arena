import { Router, type IRouter } from "express";
import { CLIENT_MESSAGE_ID, messageRequestHash, messageReplay, saveMessageReceipt } from "../lib/message-idempotency";
import { expectedSenderGuard } from "../lib/message-sender-guard";
import { eq, desc, sql, and, ne, gt } from "drizzle-orm";
import multer from "multer";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { db, dmRooms, dmRoomMembers, dmMessages, usersTable, pool as _pool } from "@workspace/db";
import {
  gcsChatStorage,
  getChatObject,
  deleteChatObject,
  chatObjectStream,
  migrateLegacyChatUploads,
} from "../lib/chatStorage";
import { validateContent } from "../lib/moderate";
import { isStarAccount, generateStarReply, hasStarInvite, type StarDef } from "./stars";
import { broadcastMessageToRoom, broadcastRoomEvent } from "../lib/signaling";
import { notifyMessageRecipients } from "../lib/message-push";
import { citizenProjection } from "../lib/citizen-projection";
import {
  authorizeMessageUpload,
  MAX_ENCRYPTED_ATTACHMENT_BYTES,
  messageUploadByteLimit,
  MessageUploadPolicyError,
  type MessageUploadIntent,
} from "../lib/message-upload-policy";
import {
  SendArenaWithdrawRequestBody,
  SendArenaWithdrawRequestResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const pool = _pool!;
const typingLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => String(req.session?.userId ?? "anonymous"),
  message: { error: "Typing updates are too frequent" } });
const reportLimit = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => String(req.session?.userId ?? "anonymous"),
  message: { error: "Too many reports. Please try later." } });

// Content-free typing metadata is delivered through the existing authenticated /api/ws.
router.post("/messages/rooms/:id/typing", typingLimit, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const roomId = Number(req.params.id);
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  if (!Number.isSafeInteger(roomId) || roomId <= 0 || typeof req.body?.typing !== "boolean") {
    res.status(400).json({ error: "Invalid typing update" }); return;
  }
  if (!await getMembership(roomId, userId)) { res.status(403).json({ error: "Access denied" }); return; }
  if (await directRoomUnavailable(roomId, userId)) { res.status(403).json({ error: "Conversation unavailable" }); return; }
  await broadcastRoomEvent(roomId, { type: "chat-typing", userId, typing: req.body.typing });
  res.json({ success: true });
});

router.post("/messages/rooms/:id/report", reportLimit, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const roomId = Number(req.params.id);
  const reason = req.body?.reason;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  if (!Number.isSafeInteger(roomId) || roomId <= 0 || typeof reason !== "string" ||
      reason.trim().length < 5 || reason.length > 1000) {
    res.status(400).json({ error: "Provide a reason between 5 and 1000 characters" }); return;
  }
  if (!await getMembership(roomId, userId)) { res.status(403).json({ error: "Access denied" }); return; }
  // No decrypted message/attachment is collected. Reporter consciously submits only a reason.
  const result = await pool.query(
    `INSERT INTO dm_safety_reports(room_id,reporter_id,reason) VALUES($1,$2,$3)
     ON CONFLICT(room_id,reporter_id) DO UPDATE SET reason=EXCLUDED.reason RETURNING id`,
    [roomId, userId, reason.trim()]);
  res.status(201).json({ reportId: result.rows[0].id });
});

router.get("/messages/safety-reports", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const [user] = await db.select({ admin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.admin) { res.status(403).json({ error: "Admin required" }); return; }
  const result = await pool.query("SELECT * FROM dm_safety_reports ORDER BY created_at DESC LIMIT 100");
  res.json({ reports: result.rows });
});
const CHAT_MODERATION_BUDGET_MS = 300;
const E2E_PREFIX = "e2e:v1:";
const MAX_E2E_CONTENT_LENGTH = 96_000;
const MAX_E2E_DEVICES = 8;
const E2E_DEVICE_TTL = "90 days";
const MESSAGE_EXPIRY_HOURS = new Set([1, 6, 12, 24, 168, 720, 2160]);
const ARENA_WITHDRAW_GAMES = {
  "neon-racer": "Neon Racer",
  "crypto-clash": "Crypto Clash",
  "arena-strike": "Arena Strike",
  globalstar: "GlobalStar",
} as const;

// Direct messages must not wait on a variable-latency external moderation
// request before appearing in the active conversation. validateContent performs
// its local blocklist, spam, and trivial-content checks synchronously before
// awaiting OpenAI; after that budget we preserve the guardian's established
// fail-open behavior for unavailable moderation rather than reintroducing a
// visible multi-second delivery delay.
async function validateChatContent(content: string, allowTrivial: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      validateContent(content, { allowTrivial }),
      new Promise<{ ok: true }>(resolve => {
        timer = setTimeout(() => resolve({ ok: true }), CHAT_MODERATION_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Attachment URL validator ───────────────────────────────────────────────────
// Accepts https URLs and our own uploaded-attachment paths (/api/messages/files/…)
export function isValidAttachmentUrl(url: string): boolean {
  if (typeof url !== "string" || url.length > 2000) return false;
  if (/^\/api\/messages\/files\/[A-Za-z0-9._-]+$/.test(url)) return true;
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

// ── Chat attachment uploads (gallery, camera, files, voice notes) ─────────────
// Attachments live in Replit App Storage (GCS bucket) so they survive
// production republishes. The legacy local dir is kept read-only as a
// fallback for files uploaded before the migration.
const legacyChatUploadsDir = path.join(process.cwd(), "uploads", "chat");

// Strict MIME → extension matrix. The stored extension is ALWAYS chosen by the
// server from this map — never from the client filename — so active content
// (.html, .svg, .js …) can never be persisted or served with a dangerous type.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/webm": ".weba",
  "audio/ogg": ".ogg", "audio/wav": ".wav",
  "application/pdf": ".pdf", "text/plain": ".txt", "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  // E2E attachments arrive as opaque ciphertext bytes.
  "application/octet-stream": ".enc",
};
// Types safe to render inline; everything else is forced to download
const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp)|video\/|audio\/)/;

const mimeForExt = (ext: string): string =>
  Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";

// One-time, idempotent rescue of any pre-migration files still on local disk.
// Runs in the background at boot; already-migrated objects are skipped.
migrateLegacyChatUploads(legacyChatUploadsDir, mimeForExt).catch(e =>
  console.error("Legacy chat upload migration error:", e));

// Uploads STREAM directly into the bucket (no memory buffering, no local disk).
// Filename/extension is ALWAYS server-chosen from MIME_EXT — never the client name.
function chatUploadFor(intent: MessageUploadIntent) {
  return multer({
    storage: gcsChatStorage(
      (mimetype) => {
        const ext = MIME_EXT[mimetype] ?? ".bin";
        return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      },
      (mimetype) => messageUploadByteLimit(intent, mimetype),
    ),
    // The storage engine applies the narrower MIME/declared-kind bound while
    // streaming. This outer cap is defense-in-depth for all attachment types.
    limits: { fileSize: MAX_ENCRYPTED_ATTACHMENT_BYTES },
    fileFilter: (_req, file, cb) => {
      if (MIME_EXT[file.mimetype]) cb(null, true);
      else cb(new Error("نوع الملف غير مسموح"));
    },
  });
}

// Per-user upload rate limit (in-memory): max 15 uploads / 10 minutes
const uploadHistory = new Map<number, number[]>();
function uploadAllowed(userId: number): boolean {
  const now = Date.now();
  const recent = (uploadHistory.get(userId) ?? []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 15) { uploadHistory.set(userId, recent); return false; }
  recent.push(now);
  uploadHistory.set(userId, recent);
  return true;
}

// POST /messages/upload — upload one attachment, returns its URL + kind
router.post("/messages/upload", async (req, res): Promise<void> => {
  const uploaderId = req.session?.userId;
  if (!uploaderId) { res.status(401).json({ error: "Login required" }); return; }
  let intent: MessageUploadIntent;
  try {
    intent = await authorizeMessageUpload(req.query, uploaderId, getMembership);
  } catch (error) {
    if (error instanceof MessageUploadPolicyError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!uploadAllowed(uploaderId)) {
    res.status(429).json({ error: "تجاوزت الحد المسموح من الملفات — حاول بعد قليل ⏳" }); return;
  }
  chatUploadFor(intent).single("file")(req, res, (err) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE"
        ? 413
        : err.message?.includes("غير مسموح") ? 400 : 500;
      if (status === 500) console.error("Chat attachment upload to object storage failed:", err);
      res.status(status).json({ error: status === 500 ? "فشل رفع الملف — حاول مرة أخرى" : (err.message ?? "Upload failed") });
      return;
    }
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const mime = req.file.mimetype;
    const kind = intent.encryptedImage || mime.startsWith("image/") ? "image"
      : mime.startsWith("video/") ? "video"
      : mime.startsWith("audio/") ? "audio" : "file";
    res.json({
      url: `/api/messages/files/${req.file.filename}`,
      kind,
      name: req.file.originalname,
      size: req.file.size,
    });
  });
});

// GET /messages/files/:name — serve an uploaded attachment (login required)
router.get("/messages/files/:name", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: "Bad name" }); return; }

  // A private attachment is readable only while it belongs to a message in a
  // room the current citizen is still a member of. Knowing a random filename
  // is never sufficient authorization.
  const attachmentUrl = `/api/messages/files/${name}`;
  const authorized = await pool.query(
    `SELECT 1
     FROM dm_messages m
     JOIN dm_room_members rm ON rm.room_id = m.room_id
     WHERE rm.user_id = $1
       AND (m.file_url = $2 OR m.audio_url = $2 OR m.video_url = $2)
     LIMIT 1`,
    [userId, attachmentUrl],
  );
  if (authorized.rows.length === 0) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Content-Type derives from the server-chosen extension only; never sniff.
  const mime = mimeForExt(path.extname(name).toLowerCase());
  const setSecurityHeaders = () => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (!INLINE_SAFE.test(mime)) res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  };

  try {
    const file = await getChatObject(name);
    if (file) {
      setSecurityHeaders();
      chatObjectStream(file)
        .on("error", (e) => {
          console.error("Chat attachment stream error:", e);
          if (!res.headersSent) res.status(500).json({ error: "Read failed" });
          else res.destroy();
        })
        .pipe(res);
      return;
    }
  } catch (e) {
    console.error("Chat attachment lookup failed:", e);
    res.status(500).json({ error: "Storage unavailable" }); return;
  }

  // Legacy fallback: files uploaded before the object-storage migration
  const filePath = path.join(legacyChatUploadsDir, name);
  if (!filePath.startsWith(legacyChatUploadsDir) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  setSecurityHeaders();
  res.sendFile(filePath);
});

// ── Helper: get membership row (null if not a member) ─────────────────────────
async function getMembership(roomId: number, userId: number) {
  const [row] = await db.select()
    .from(dmRoomMembers)
    .where(and(eq(dmRoomMembers.roomId, roomId), eq(dmRoomMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}
async function isBlockedPair(a: number, b: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM citizen_blocks
     WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1`,
    [a, b],
  );
  return result.rows.length > 0;
}

async function directRoomUnavailable(roomId: number, userId: number): Promise<boolean> {
  const members = await pool.query<{ user_id: number }>(
    `SELECT m.user_id FROM dm_room_members m JOIN dm_rooms r ON r.id=m.room_id
     WHERE m.room_id=$1 AND r.type='direct'`, [roomId]);
  if (members.rows.length !== 2) return false;
  const peer = members.rows.find(m => m.user_id !== userId)?.user_id;
  // Always recompute from canonical visibility/mutual-friend policy. A historic
  // membership is not permission to contact someone after they revoke access.
  return peer !== undefined && !(await citizenProjection(peer, userId))?.canMessage;
}

type RsaPublicJwk = {
  kty: "RSA";
  n: string;
  e: string;
  alg: "RSA-OAEP-256";
  ext: true;
  key_ops: ["encrypt", "wrapKey"];
};

function normalizeRsaPublicJwk(value: unknown): RsaPublicJwk | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = value as Record<string, unknown>;
  if (
    key.kty !== "RSA" ||
    typeof key.n !== "string" || key.n.length < 300 || key.n.length > 800 ||
    typeof key.e !== "string" || key.e.length < 2 || key.e.length > 16 ||
    !/^[A-Za-z0-9_-]+$/.test(key.n) ||
    !/^[A-Za-z0-9_-]+$/.test(key.e)
  ) return null;
  return {
    kty: "RSA",
    n: key.n,
    e: key.e,
    alg: "RSA-OAEP-256",
    ext: true,
    key_ops: ["encrypt", "wrapKey"],
  };
}

function publicKeyFingerprint(key: RsaPublicJwk): string {
  const canonical = JSON.stringify({ kty: key.kty, n: key.n, e: key.e });
  return createHash("sha256").update(canonical).digest("base64url");
}

type E2eEnvelopeRecipient = {
  userId: number;
  deviceId: string;
  fingerprint: string;
};

function parseE2eEnvelope(value: string): {
  recipients: E2eEnvelopeRecipient[];
} | null {
  if (!value.startsWith(E2E_PREFIX) || value.length > MAX_E2E_CONTENT_LENGTH) return null;
  const encoded = value.slice(E2E_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const envelope = JSON.parse(decoded) as Record<string, unknown>;
    if (
      envelope.v !== 1 ||
      envelope.alg !== "RSA-OAEP-256/A256GCM" ||
      typeof envelope.iv !== "string" ||
      typeof envelope.ciphertext !== "string" ||
      !envelope.keys ||
      typeof envelope.keys !== "object" ||
      Array.isArray(envelope.keys)
    ) return null;
    const entries = Object.entries(envelope.keys as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 256) return null;
    const recipients: E2eEnvelopeRecipient[] = [];
    for (const [rawRecipient, rawEntry] of entries) {
      const match = /^(\d+)\.([A-Za-z0-9_-]{16,80})$/.exec(rawRecipient);
      if (!match) return null;
      const userId = Number(match[1]);
      const deviceId = match[2];
      if (!Number.isInteger(userId) || userId <= 0) return null;
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;
      const entry = rawEntry as Record<string, unknown>;
      if (
        typeof entry.wrappedKey !== "string" ||
        entry.wrappedKey.length < 100 ||
        entry.wrappedKey.length > 1000 ||
        typeof entry.fingerprint !== "string" ||
        entry.fingerprint.length < 20 ||
        entry.fingerprint.length > 100
      ) return null;
      recipients.push({ userId, deviceId, fingerprint: entry.fingerprint });
    }
    return { recipients };
  } catch {
    return null;
  }
}

// ── Browser E2E public keys ───────────────────────────────────────────────────
// Only public RSA keys are stored. Private device keys never leave IndexedDB in
// the citizen's browser, and message/call secrets are opaque to this server.
router.put("/messages/e2e/key", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(deviceId)) {
    res.status(400).json({ error: "Invalid E2E device id" }); return;
  }
  const publicKey = normalizeRsaPublicJwk(req.body?.publicKey);
  if (!publicKey) { res.status(400).json({ error: "Invalid E2E public key" }); return; }
  const fingerprint = publicKeyFingerprint(publicKey);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
    await client.query(
      `DELETE FROM dm_user_e2ee_keys WHERE updated_at < now() - $1::interval`,
      [E2E_DEVICE_TTL],
    );
    const existing = await client.query(
      `SELECT 1 FROM dm_user_e2ee_keys WHERE user_id=$1 AND device_id=$2`,
      [userId, deviceId],
    );
    if (!existing.rows.length) {
      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dm_user_e2ee_keys WHERE user_id=$1`,
        [userId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= MAX_E2E_DEVICES) {
        await client.query("ROLLBACK");
        res.status(409).json({
          code: "SECURE_DEVICE_CAPACITY",
          error: "Secure device limit reached; revoke an old device first",
          maxDevices: MAX_E2E_DEVICES,
        });
        return;
      }
    }
    await client.query(
      `INSERT INTO dm_user_e2ee_keys (user_id, device_id, public_key, fingerprint, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (user_id, device_id) DO UPDATE
         SET public_key = EXCLUDED.public_key,
             fingerprint = EXCLUDED.fingerprint,
             updated_at = now()`,
      [userId, deviceId, JSON.stringify(publicKey), fingerprint],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  res.json({ deviceId, publicKey, fingerprint });
});

router.get("/messages/e2e/devices", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const result = await pool.query(
    `SELECT device_id, fingerprint, updated_at
     FROM dm_user_e2ee_keys
     WHERE user_id=$1 AND updated_at >= now() - $2::interval
     ORDER BY updated_at DESC`,
    [userId, E2E_DEVICE_TTL],
  );
  res.json({ devices: result.rows });
});

router.delete("/messages/e2e/devices/:deviceId", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const deviceId = String(req.params.deviceId ?? "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(deviceId)) {
    res.status(400).json({ error: "Invalid E2E device id" }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
    const removed = await client.query(
      `DELETE FROM dm_user_e2ee_keys WHERE user_id=$1 AND device_id=$2 RETURNING device_id`,
      [userId, deviceId],
    );
    await client.query("COMMIT");
    if (!removed.rows.length) { res.status(404).json({ error: "Secure device not found" }); return; }
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.get("/messages/rooms/:id/e2e-keys", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: "Invalid room ID" }); return;
  }
  if (!await getMembership(roomId, userId)) {
    res.status(403).json({ error: "Access denied — not a member of this room" }); return;
  }
  if (await directRoomUnavailable(roomId, userId)) {
    res.status(403).json({ error: "Messaging is unavailable in this conversation" }); return;
  }
  const result = await pool.query<{
    user_id: number;
    device_id: string | null;
    public_key: RsaPublicJwk | null;
    fingerprint: string | null;
  }>(
    `SELECT m.user_id, k.device_id, k.public_key, k.fingerprint
     FROM dm_room_members m
     LEFT JOIN dm_user_e2ee_keys k
       ON k.user_id = m.user_id
      AND k.updated_at >= now() - $2::interval
     WHERE m.room_id = $1
     ORDER BY m.user_id`,
    [roomId, E2E_DEVICE_TTL],
  );
  res.json({
    keys: result.rows
      .filter((row): row is typeof row & { device_id: string; public_key: RsaPublicJwk; fingerprint: string } =>
        !!row.device_id && !!row.public_key && !!row.fingerprint)
      .map(row => ({
        userId: row.user_id,
        deviceId: row.device_id,
        publicKey: row.public_key,
        fingerprint: row.fingerprint,
      })),
    missingUserIds: [...new Set(result.rows.filter(row => !row.public_key).map(row => row.user_id))],
  });
});

router.get("/messages/e2e/users/:username/key", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const username = String(req.params.username ?? "").trim();
  if (!username || username.length > 80) {
    res.status(400).json({ error: "Invalid citizen" }); return;
  }
  const target = await pool.query<{
    id: number;
    device_id: string | null;
    public_key: RsaPublicJwk | null;
    fingerprint: string | null;
  }>(
    `SELECT u.id, k.device_id, k.public_key, k.fingerprint
     FROM users u
     LEFT JOIN dm_user_e2ee_keys k
       ON k.user_id = u.id
      AND k.updated_at >= now() - $2::interval
     WHERE lower(u.username) = lower($1)
     ORDER BY k.updated_at DESC`,
    [username, E2E_DEVICE_TTL],
  );
  const row = target.rows[0];
  if (!row) { res.status(404).json({ error: "Citizen not found" }); return; }
  if (await isBlockedPair(userId, row.id)) {
    res.status(403).json({ error: "Communication is unavailable for this citizen" }); return;
  }
  if (!row.public_key || !row.fingerprint || !row.device_id) {
    res.status(409).json({ error: "Citizen has not enabled secure messaging yet" }); return;
  }
  res.json({
    userId: row.id,
    keys: target.rows
      .filter((item): item is typeof item & {
        device_id: string;
        public_key: RsaPublicJwk;
        fingerprint: string;
      } => !!item.device_id && !!item.public_key && !!item.fingerprint)
      .map(item => ({
        userId: item.id,
        deviceId: item.device_id,
        publicKey: item.public_key,
        fingerprint: item.fingerprint,
      })),
  });
});

// Member metadata is calculated server-side. In particular, a private
// solidarity status is never returned to another citizen, and block direction
// is explicit so clients need not infer it from contact availability.
type DirectMemberState = MemberRow & {
  blocked?: boolean;
  blockedByMe?: boolean;
  solidarityStatus?: string | null;
  solidarityStatusVisible?: boolean;
};
async function enrichDirectMembers(members: MemberRow[], viewerId: number, direct: boolean): Promise<DirectMemberState[]> {
  if (!direct) return members;
  const ids = members.map(m => m.userId);
  const state = await pool.query<{user_id:number;status:string;status_visible:boolean}>(
    "SELECT user_id,status,status_visible FROM citizen_solidarity_profiles WHERE user_id = ANY($1)", [ids]);
  const profiles = new Map(state.rows.map(row => [row.user_id, row]));
  const peerIds = ids.filter(id => id !== viewerId);
  let blockedRows: { blocker_id: number; blocked_id: number }[] = [];
  if (peerIds.length) {
    blockedRows = (await pool.query<{blocker_id:number;blocked_id:number}>(
      `SELECT blocker_id,blocked_id FROM citizen_blocks
       WHERE (blocker_id=$1 AND blocked_id=ANY($2)) OR (blocked_id=$1 AND blocker_id=ANY($2))`,
      [viewerId, peerIds],
    )).rows;
  }
  return members.map(member => {
    const p = profiles.get(member.userId);
    const isViewer = member.userId === viewerId;
    const blockedByMe = !isViewer && blockedRows.some(row => row.blocker_id === viewerId && row.blocked_id === member.userId);
    const blocked = !isViewer && blockedRows.some(row =>
      (row.blocker_id === viewerId && row.blocked_id === member.userId) ||
      (row.blocked_id === viewerId && row.blocker_id === member.userId));
    return {
      ...member,
      blocked,
      blockedByMe,
      solidarityStatusVisible: p?.status_visible ?? true,
      solidarityStatus: (isViewer || p?.status_visible) ? (p?.status ?? "available") : null,
    };
  });
}

// ── Per-room unread count for one user (messages from others after their cursor)
async function unreadCount(roomId: number, userId: number, lastReadAt: Date | null): Promise<number> {
  const cursor = lastReadAt ?? new Date(0);
  const [r] = await db.select({ cnt: sql<number>`count(*)::int` })
    .from(dmMessages)
    .where(and(
      eq(dmMessages.roomId, roomId),
      ne(dmMessages.userId, userId),
      gt(dmMessages.createdAt, cursor),
    ));
  return r?.cnt ?? 0;
}

// Privacy: read cursors are only useful when both sides have receipts enabled.
// A member who disables receipts neither shares their cursor nor sees peers'
// cursors. Their own cursor is kept for the viewer themself (it only drives
// their private unread badge).
type MemberRow = typeof dmRoomMembers.$inferSelect;
async function hideReadCursors<T extends MemberRow>(members: T[], viewerId: number): Promise<T[]> {
  const otherIds = members.map(m => m.userId).filter(id => id !== viewerId);
  if (otherIds.length === 0) return members;
  const r = await pool.query(
    `SELECT user_id, read_receipts FROM dm_user_settings WHERE user_id = ANY($1)`,
    [[viewerId, ...otherIds]]);
  const receiptsByUser = new Map<number, boolean>(
    r.rows.map((row: { user_id: number; read_receipts: boolean }) => [row.user_id, row.read_receipts]));
  const viewerShares = receiptsByUser.get(viewerId) ?? true;
  return members.map(m => {
    if (m.userId === viewerId) return m;
    const peerShares = receiptsByUser.get(m.userId) ?? true;
    return viewerShares && peerShares ? m : { ...m, lastReadAt: null };
  });
}

// ── GET /messages/rooms — list my rooms, newest-activity first ────────────────
// Sort order: descending by the latest message timestamp in each room; rooms
// with no messages fall back to their creation timestamp so they still appear
// in a deterministic position rather than floating at an unpredictable spot.
// Membership authorisation, read-receipt privacy, muted state, and the
// response shape are preserved exactly as before.
router.get("/messages/rooms", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const myMemberships = await db.select()
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));

  if (myMemberships.length === 0) { res.json({ rooms: [] }); return; }

  // muted flag lives in a raw column (added by DDL, not in the drizzle schema)
  const mutedRes = await pool.query(
    `SELECT room_id FROM dm_room_members WHERE user_id = $1 AND muted`, [userId]);
  const mutedSet = new Set<number>(mutedRes.rows.map((r: { room_id: number }) => r.room_id));

  const roomIds = myMemberships.map(m => m.roomId);

  // Fetch the latest-message timestamp for every room in one query.
  // Rooms with no messages yield NULL — we'll fall back to room.created_at.
  const latestMsgRes = await pool.query<{ room_id: number; latest_at: Date | null }>(
    `SELECT room_id, MAX(created_at) AS latest_at
     FROM dm_messages
     WHERE room_id = ANY($1)
     GROUP BY room_id`,
    [roomIds],
  );
  const latestMsgByRoom = new Map<number, Date | null>(
    latestMsgRes.rows.map((r) => [r.room_id, r.latest_at]),
  );

  const roomData = await Promise.all(myMemberships.map(async (membership) => {
    const { roomId, lastReadAt } = membership;
    const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
    if (!room) return null;
    const rawMembers = await hideReadCursors(
      await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId)), userId);
    const members = await enrichDirectMembers(rawMembers, userId, room.type === "direct");
    const [lastMsg] = await db.select().from(dmMessages)
      .where(eq(dmMessages.roomId, roomId))
      .orderBy(desc(dmMessages.createdAt)).limit(1);
    const cnt = await unreadCount(roomId, userId, lastReadAt ?? null);
    // Stable sort key: latest message time, or room creation time as fallback.
    const latestAt = latestMsgByRoom.get(roomId) ?? room.createdAt;
    const peerState = room.type === "direct" ? members.find(member => member.userId !== userId) : undefined;
    return {
      ...room, members, lastMessage: lastMsg ?? null, unreadCount: cnt, muted: mutedSet.has(roomId),
      blocked: peerState?.blocked ?? false,
      blockedByMe: peerState?.blockedByMe ?? false,
      _latestAt: latestAt,
    };
  }));

  // Sort newest-activity first, then strip the internal sort key before responding.
  const sorted = (roomData.filter(Boolean) as NonNullable<typeof roomData[number]>[])
    .sort((a, b) => {
      const ta = a._latestAt ? new Date(a._latestAt).getTime() : 0;
      const tb = b._latestAt ? new Date(b._latestAt).getTime() : 0;
      return (tb - ta) || (b.id - a.id);
    })
    .map(({ _latestAt: _unused, ...rest }) => rest);

  res.json({ rooms: sorted });
});

// ── POST /messages/rooms — create or find DM room ────────────────────────────
router.post("/messages/rooms", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const { targetUsername, targetUserId, roomName, type = "direct", icon = "💬" } = req.body as {
    targetUsername?: string; targetUserId?: number; roomName?: string; type?: string; icon?: string;
  };

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  if (type === "direct") {
    if ((targetUserId !== undefined && (!Number.isSafeInteger(targetUserId) || targetUserId <= 0)) ||
        (targetUserId === undefined && (typeof targetUsername !== "string" || !targetUsername.trim()))) {
      res.status(400).json({ error: "A valid recipient is required" }); return;
    }
    const [target] = await db.select().from(usersTable)
      .where(targetUserId !== undefined ? eq(usersTable.id, targetUserId) : eq(usersTable.username, targetUsername!)).limit(1);
    if (!target) { res.status(404).json({ error: "Citizen not found" }); return; }
    if (target.id === userId) { res.status(400).json({ error: "Cannot DM yourself" }); return; }
    if (!(await citizenProjection(target.id, userId))?.canMessage) {
      res.status(403).json({ error: "Direct messaging is unavailable for this citizen" }); return;
    }

    const client = await pool.connect();
    let roomId: number;
    let created = false;
    try {
      await client.query("BEGIN");
      // Same canonical sorted pair key as arena-withdraw. IDs/history stay numeric and intact.
      await client.query("SELECT pg_advisory_xact_lock($1::integer,$2::integer)",
        [Math.min(userId, target.id), Math.max(userId, target.id)]);
      const existing = await client.query<{ id: number }>(
        `SELECT r.id FROM dm_rooms r JOIN dm_room_members m ON m.room_id=r.id
         WHERE r.type='direct' GROUP BY r.id HAVING COUNT(*)=2
         AND COUNT(DISTINCT m.user_id) FILTER (WHERE m.user_id=$1 OR m.user_id=$2)=2
         ORDER BY r.id LIMIT 1`, [userId, target.id]);
      roomId = existing.rows[0]?.id;
      if (!roomId) {
        // Membership/key mutation shares the E2EE serialization lock.
        await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
        const inserted = await client.query<{ id: number }>(
          "INSERT INTO dm_rooms(type,created_by) VALUES('direct',$1) RETURNING id", [userId]);
        roomId = inserted.rows[0].id;
        await client.query(
          "INSERT INTO dm_room_members(room_id,user_id,username) VALUES($1,$2,$3),($1,$4,$5)",
          [roomId, userId, me.username, target.id, target.username]);
        created = true;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
    res.status(created ? 201 : 200).json({ room });
  } else {
    const [room] = await db.insert(dmRooms).values({
      type: "group", name: roomName ?? "Group Room", icon, createdBy: userId,
    }).returning();
    await db.insert(dmRoomMembers).values({ roomId: room.id, userId: me.id, username: me.username });
    res.status(201).json({ room });
  }
});

// ── POST /messages/arena-withdraw — send a fixed prize request to Arena admin ─
router.post("/messages/arena-withdraw", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }

  const parsed = SendArenaWithdrawRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid game" });
    return;
  }

  const [me] = await db.select().from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(401).json({ error: "Login required" }); return; }

  const [arenaAdmin] = await db.select().from(usersTable)
    .where(and(eq(usersTable.isAdmin, true), ne(usersTable.id, userId)))
    .orderBy(usersTable.id)
    .limit(1);
  if (!arenaAdmin) {
    res.status(503).json({ error: "إدارة Arena غير متاحة حالياً" });
    return;
  }
  if (!(await citizenProjection(arenaAdmin.id, userId))?.canMessage) {
    res.status(403).json({ error: "Direct messaging is unavailable for this citizen" }); return;
  }

  const content = `طلب جائزة من ${ARENA_WITHDRAW_GAMES[parsed.data.gameId]}`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize find-or-create by the canonical citizen/admin pair so parallel
    // requests cannot split the same direct conversation into duplicate rooms.
    const lockKeyA = Math.min(userId, arenaAdmin.id);
    const lockKeyB = Math.max(userId, arenaAdmin.id);
    await client.query(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      [lockKeyA, lockKeyB],
    );

    const existingRoom = await client.query<{ id: number }>(
      `SELECT r.id
       FROM dm_rooms r
       JOIN dm_room_members m ON m.room_id = r.id
       WHERE r.type = 'direct'
       GROUP BY r.id
       HAVING COUNT(*) = 2
          AND COUNT(DISTINCT m.user_id) FILTER (
            WHERE m.user_id = $1 OR m.user_id = $2
          ) = 2
       ORDER BY r.id
       LIMIT 1`,
      [userId, arenaAdmin.id],
    );

    let roomId = existingRoom.rows[0]?.id;
    if (!roomId) {
      const createdRoom = await client.query<{ id: number }>(
        `INSERT INTO dm_rooms (type, created_by)
         VALUES ('direct', $1)
         RETURNING id`,
        [userId],
      );
      roomId = createdRoom.rows[0].id;

      await client.query(
        `INSERT INTO dm_room_members (room_id, user_id, username)
         VALUES ($1, $2, $3), ($1, $4, $5)`,
        [roomId, me.id, me.username, arenaAdmin.id, arenaAdmin.username],
      );
    }

    const insertedMessage = await client.query(
      `INSERT INTO dm_messages (room_id, user_id, username, content, type)
       VALUES ($1, $2, $3, $4, 'text')
       RETURNING
         id,
         room_id AS "roomId",
         user_id AS "userId",
         username,
         content,
         audio_url AS "audioUrl",
         video_url AS "videoUrl",
         file_url AS "fileUrl",
         type,
         is_read AS "isRead",
         created_at AS "createdAt"`,
      [roomId, userId, me.username, content],
    );

    await client.query("COMMIT");

    void broadcastMessageToRoom(roomId, insertedMessage.rows[0]).catch(error =>
      req.log.error({ error, roomId }, "Arena withdrawal message realtime broadcast failed"));
     void notifyMessageRecipients(roomId, userId, insertedMessage.rows[0].id, me.username).catch(error =>
       req.log.error({ error, roomId }, "Arena withdrawal background message notification failed"));

    res.status(201).json(SendArenaWithdrawRequestResponse.parse({
      ok: true,
      roomId,
      content,
    }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      req.log.error({ rollbackError }, "Arena withdrawal transaction rollback failed");
    }
    req.log.error({ error, userId }, "Arena withdrawal request failed");
    res.status(500).json({ error: "تعذر إرسال الطلب" });
  } finally {
    client.release();
  }
});

// ── POST /messages/rooms/:id/join — group rooms only ──────────────────────────
router.post("/messages/rooms/:id/join", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.type !== "group") {
    res.status(403).json({ error: "Cannot join a private direct room" }); return;
  }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
    const already = await client.query(
      `SELECT 1 FROM dm_room_members WHERE room_id=$1 AND user_id=$2`,
      [roomId, userId],
    );
    if (!already.rows.length) {
      await client.query(
        `INSERT INTO dm_room_members (room_id, user_id, username) VALUES ($1,$2,$3)`,
        [roomId, userId, me.username],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// ── GET /messages/rooms/:id — fetch messages (members only) ───────────────────
router.get("/messages/rooms/:id", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getMembership(roomId, userId);
  if (!membership) {
    res.status(403).json({ error: "Access denied — not a member of this room" }); return;
  }
  if (await directRoomUnavailable(roomId, userId)) {
    res.status(403).json({ error: "Messaging is unavailable in this conversation" }); return;
  }

  // Expired messages are removed for every participant before history is read.
  await pool.query(
    `DELETE FROM dm_message_reactions
     WHERE message_id IN (
       SELECT id FROM dm_messages
       WHERE room_id=$1 AND expires_at IS NOT NULL AND expires_at <= now()
     )`,
    [roomId],
  );
  await pool.query(
    `DELETE FROM dm_messages
     WHERE room_id=$1 AND expires_at IS NOT NULL AND expires_at <= now()`,
    [roomId],
  );

  const msgs = await db.select().from(dmMessages)
    .where(eq(dmMessages.roomId, roomId))
    .orderBy(desc(dmMessages.createdAt)).limit(60);

  const rawMembers = await hideReadCursors(
    await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId)), userId);
  const [room]  = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
  const members = await enrichDirectMembers(rawMembers, userId, room?.type === "direct");

  // Advance this member's read cursor to the latest fetched message timestamp.
  // The WHERE guard ensures the cursor is strictly monotonic — concurrent reads
  // cannot move it backward and cause already-read messages to reappear as unread.
  const latestTs = msgs.length > 0 ? msgs[0]!.createdAt : null;
  if (latestTs) {
    const advanced = await db.update(dmRoomMembers)
      .set({ lastReadAt: latestTs })
      .where(and(
        eq(dmRoomMembers.roomId, roomId),
        eq(dmRoomMembers.userId, userId),
        sql`(${dmRoomMembers.lastReadAt} IS NULL OR ${dmRoomMembers.lastReadAt} < ${latestTs})`,
      ))
      .returning({ lastReadAt: dmRoomMembers.lastReadAt });
    if (advanced.length > 0) {
      const receiptSettings = await pool.query<{ user_id: number; read_receipts: boolean }>(
        `SELECT rm.user_id, COALESCE(s.read_receipts, true) AS read_receipts
         FROM dm_room_members rm
         LEFT JOIN dm_user_settings s ON s.user_id = rm.user_id
         WHERE rm.room_id = $1`,
        [roomId],
      );
      const readerShares = receiptSettings.rows.find(row => row.user_id === userId)?.read_receipts ?? true;
      const allowedRecipients = readerShares
        ? receiptSettings.rows.filter(row => row.read_receipts).map(row => row.user_id)
        : [];
      if (allowedRecipients.length > 0) {
        void broadcastRoomEvent(roomId, {
          type: "chat-read",
          readerUserId: userId,
          readAt: latestTs,
        }, allowedRecipients).catch(error =>
          req.log.error({ error, roomId, userId }, "Chat read receipt realtime broadcast failed"));
      }
    }
  }

  const ordered = msgs.reverse();
  const ids = ordered.map(m => m.id);
  let reactionRows: { message_id: number; reaction: string; user_id: number }[] = [];
  if (ids.length) {
    reactionRows = (await pool.query<{message_id:number;reaction:string;user_id:number}>(
      "SELECT message_id,reaction,user_id FROM dm_message_reactions WHERE message_id = ANY($1)", [ids])).rows;
  }
  const replies = new Map<number, { id:number; username:string; content:string|null; type:string }>();
  const replyIds = ordered.map(m => m.replyToId).filter((id): id is number => id !== null);
  if (replyIds.length) {
    const result = await pool.query<{id:number;username:string;content:string|null;type:string}>(
      "SELECT id,username,content,type FROM dm_messages WHERE room_id=$1 AND id=ANY($2)", [roomId, replyIds]);
    result.rows.forEach(row => replies.set(row.id, row));
  }
  const messages = ordered.map(msg => {
    const reactions = { support: 0, listen: 0, celebrate: 0 };
    let myReaction: string | null = null;
    reactionRows.filter(r => r.message_id === msg.id).forEach(r => {
      reactions[r.reaction as keyof typeof reactions]++;
      if (r.user_id === userId) myReaction = r.reaction;
    });
    return { ...msg, replyToId: msg.replyToId ?? null, replyTo: msg.replyToId ? replies.get(msg.replyToId) ?? null : null, reactions, myReaction };
  });
  const peerState = room?.type === "direct" ? members.find(member => member.userId !== userId) : undefined;
  res.json({
    room: room ? {
      ...room,
      blocked: peerState?.blocked ?? false,
      blockedByMe: peerState?.blockedByMe ?? false,
    } : null,
    messages,
    members,
  });
});

// ── POST /messages/rooms/:id/send (members only) ──────────────────────────────
router.post("/messages/rooms/:id/send", expectedSenderGuard, async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = Number(req.params.id);
  if (!Number.isSafeInteger(roomId) || roomId < 1 || roomId > 2147483647) { res.status(400).json({ error: "Invalid room ID" }); return; }

  // Membership gate — prevents IDOR and XP farming from external rooms
  const membership = await getMembership(roomId, userId);
  if (!membership) {
    res.status(403).json({ error: "Access denied — not a member of this room" }); return;
  }

  const { content, audioUrl, videoUrl, fileUrl, type = "text", replyToId, expireAfterHours } = req.body as {
    content?: string; audioUrl?: string; videoUrl?: string; fileUrl?: string; type?: string; replyToId?: number;
    expireAfterHours?: number | null;
  };
  if (expireAfterHours != null && !MESSAGE_EXPIRY_HOURS.has(expireAfterHours)) {
    res.status(400).json({ error: "Invalid message expiry" }); return;
  }
  const expiresAt = expireAfterHours == null
    ? null
    : new Date(Date.now() + expireAfterHours * 60 * 60 * 1000);
  const encryptedEnvelope = typeof content === "string" && content.startsWith(E2E_PREFIX)
    ? parseE2eEnvelope(content)
    : null;
  const clientMessageId = req.body.clientMessageId;
  if (clientMessageId !== undefined && (typeof clientMessageId !== "string" ||
      !CLIENT_MESSAGE_ID.test(clientMessageId) || !encryptedEnvelope)) {
    res.status(400).json({ error: "clientMessageId requires a UUID and an encrypted envelope" }); return;
  }
  const requestHash = messageRequestHash([roomId, content?.trim() ?? null,
    audioUrl ?? null, videoUrl ?? null, fileUrl ?? null, type, replyToId ?? null, expireAfterHours ?? null]);
  if (typeof content === "string" && content.startsWith("e2e:") && !encryptedEnvelope) {
    res.status(400).json({ error: "Invalid encrypted message" }); return;
  }

  if (!content?.trim() && !audioUrl && !videoUrl && !fileUrl) {
    res.status(400).json({ error: "Message content required" }); return;
  }

  // Validate all attachment URLs (incoming branch: must be https, ≤2000 chars)
  for (const url of [audioUrl, videoUrl, fileUrl]) {
    if (url !== undefined && !isValidAttachmentUrl(url)) {
      res.status(400).json({ error: "Invalid attachment URL — must be https and under 2000 chars" }); return;
    }
  }

  // ⭐ Detect a Stars Hall room early: 1:1 with a hosted world star.
  // Casual/short messages are allowed there — it's a conversation, not a feed.
  const roomMembers = await db.select({ userId: dmRoomMembers.userId })
    .from(dmRoomMembers).where(eq(dmRoomMembers.roomId, roomId));
  const [room] = await db.select().from(dmRooms).where(eq(dmRooms.id, roomId)).limit(1);
  if (room?.type === "direct" && await directRoomUnavailable(roomId, userId)) {
    res.status(403).json({ error: "Messaging is unavailable in this conversation" }); return;
  }
  if (replyToId !== undefined) {
    if (!Number.isInteger(replyToId)) { res.status(400).json({ error: "Invalid reply target" }); return; }
    const reply = await pool.query("SELECT 1 FROM dm_messages WHERE id=$1 AND room_id=$2", [replyToId, roomId]);
    if (!reply.rows.length) { res.status(400).json({ error: "Reply target is not in this room" }); return; }
  }
  const otherIds = roomMembers.map(m => m.userId).filter((id): id is number => id !== null && id !== userId);
  let starPeer: { id: number; username: string; def: StarDef } | null = null;
  if (otherIds.length === 1) {
    const [other] = await db.select({ id: usersTable.id, username: usersTable.username, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, otherIds[0])).limit(1);
    const def = other ? isStarAccount(other) : null;
    if (other && def) starPeer = { id: other.id, username: other.username, def };
  }

  if (content && !encryptedEnvelope) {
    const hasAttachment = Boolean(audioUrl ?? videoUrl ?? fileUrl);
    const check = await validateChatContent(content, hasAttachment || starPeer !== null);
    if (!check.ok) { res.status(400).json({ error: check.reason }); return; }
  }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  let msg;
  if (encryptedEnvelope) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serializes device registration/revocation and encrypted sends. The
      // final key-set comparison and INSERT share this transaction.
      await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
      // Recheck membership under the same lock used for group membership changes.
      const currentMember = await client.query("SELECT 1 FROM dm_room_members WHERE room_id=$1 AND user_id=$2 FOR SHARE", [roomId, userId]);
      if (!currentMember.rows.length) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Access denied — not a member of this room" }); return;
      }
      if (clientMessageId) {
        const replay = await messageReplay(client, userId, clientMessageId, requestHash);
        if (replay.conflict || replay.message) {
          if (replay.conflict) {
            await client.query("ROLLBACK");
            res.status(409).json({ error: "clientMessageId already used for another payload" }); return;
          }
          // Receipts retain only identity, never a second copy of deleted/expired ciphertext.
          const original = await client.query(`SELECT id,room_id AS "roomId",user_id AS "userId",username,
            content,audio_url AS "audioUrl",video_url AS "videoUrl",file_url AS "fileUrl",type,
            is_read AS "isRead",reply_to_id AS "replyToId",expires_at AS "expiresAt",created_at AS "createdAt"
            FROM dm_messages WHERE id=$1 AND user_id=$2 AND room_id=$3
            AND (expires_at IS NULL OR expires_at>now())`, [replay.message.id, userId, roomId]);
          await client.query("ROLLBACK");
          if (!original.rows.length) { res.status(410).json({ error: "Previously sent message is no longer available" }); return; }
          res.json({ message: { ...original.rows[0], replyTo: null,
            reactions: { support: 0, listen: 0, celebrate: 0 }, myReaction: null }, xpEarned: 0, replayed: true });
          return;
        }
      }
      const registered = await client.query<{
        user_id: number;
        device_id: string | null;
        fingerprint: string | null;
      }>(
        `SELECT m.user_id, k.device_id, k.fingerprint
         FROM dm_room_members m
         LEFT JOIN dm_user_e2ee_keys k
           ON k.user_id = m.user_id
          AND k.updated_at >= now() - $2::interval
         WHERE m.room_id = $1
         FOR SHARE OF m`,
        [roomId, E2E_DEVICE_TTL],
      );
      if (registered.rows.some(row => !row.device_id || !row.fingerprint)) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "A room member has not enabled secure messaging" });
        return;
      }
      const currentKeys = registered.rows
        .map(row => `${row.user_id}.${row.device_id}.${row.fingerprint}`)
        .sort();
      const envelopeKeys = encryptedEnvelope.recipients
        .map(recipient => `${recipient.userId}.${recipient.deviceId}.${recipient.fingerprint}`)
        .sort();
      if (
        currentKeys.length !== envelopeKeys.length ||
        currentKeys.some((key, index) => key !== envelopeKeys[index])
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Secure device keys changed; refresh and retry" });
        return;
      }
      const inserted = await client.query(
        `INSERT INTO dm_messages
           (room_id, user_id, username, content, audio_url, video_url, file_url, type, reply_to_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, room_id AS "roomId", user_id AS "userId", username,
                   content, audio_url AS "audioUrl", video_url AS "videoUrl",
                   file_url AS "fileUrl", type, is_read AS "isRead",
                    reply_to_id AS "replyToId", expires_at AS "expiresAt",
                    created_at AS "createdAt"`,
        [
          roomId, userId, me.username, content?.trim() ?? null,
          audioUrl ?? null, videoUrl ?? null, fileUrl ?? null, type, replyToId ?? null, expiresAt,
        ],
      );
      msg = inserted.rows[0];
      if (clientMessageId) await saveMessageReceipt(client, userId, clientMessageId, requestHash, { id: msg.id });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } else {
    [msg] = await db.insert(dmMessages).values({
      roomId, userId, username: me.username,
      content: content?.trim() ?? null,
      audioUrl: audioUrl ?? null, videoUrl: videoUrl ?? null,
      fileUrl: fileUrl ?? null, type, replyToId: replyToId ?? null, expiresAt,
    }).returning();
  }

  // XP reward: atomic conditional UPDATE — only awards when:
  //   1. The room has at least one other member (prevents solo-room farming)
  //   2. The per-user DB-backed cooldown has elapsed (60 s)
  // The WHERE clause makes both the eligibility check and the award happen in a
  // single statement, so concurrent requests cannot both pass and double-award.
  const hasOtherMember = roomMembers.some(m => m.userId !== userId);

  let xpEarned = 0;
  if (hasOtherMember) {
    const awarded = await db.update(usersTable)
      .set({
        xp: sql`${usersTable.xp} + 5`,
        lastDmXpAt: sql`now()`,
      })
      .where(and(
        eq(usersTable.id, userId),
        sql`(${usersTable.lastDmXpAt} IS NULL OR ${usersTable.lastDmXpAt} < now() - interval '60 seconds')`,
      ))
      .returning({ id: usersTable.id });
    if (awarded.length > 0) xpEarned = 5;
  }

  // ⭐ Stars Hall: the empire's internal intelligence replies in the star's
  // persona — only for citizens holding a real invite entitlement (no cost bypass).
  if (content?.trim() && !encryptedEnvelope && starPeer && await hasStarInvite(userId, starPeer.username)) {
    generateStarReply(roomId, starPeer.def, starPeer.id, me.username, content.trim()).catch(() => {});
  }

  // The persisted message is delivered through the authenticated signaling
  // channel to the room members resolved above on the server. Failure to push
  // must not turn a saved message into a failed send; REST recovery remains.
  void broadcastMessageToRoom(roomId, msg).catch(error =>
    req.log.error({ error, roomId }, "Chat realtime broadcast failed"));
   void notifyMessageRecipients(roomId, userId, msg.id, me.username).catch(error =>
     req.log.error({ error, roomId }, "Chat background message notification failed"));
  res.status(201).json({
    message: {
      ...msg,
      replyToId: msg.replyToId ?? null,
      replyTo: null,
      reactions: { support: 0, listen: 0, celebrate: 0 },
      myReaction: null,
    },
    xpEarned,
  });
});

// ── GET /messages/unread-count ────────────────────────────────────────────────
router.get("/messages/unread-count", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ count: 0 }); return; }

  const memberships = await db.select()
    .from(dmRoomMembers).where(eq(dmRoomMembers.userId, userId));
  if (memberships.length === 0) { res.json({ count: 0 }); return; }

  // Muted conversations don't contribute to the badge
  const mutedRes = await pool.query(
    `SELECT room_id FROM dm_room_members WHERE user_id = $1 AND muted`, [userId]);
  const mutedSet = new Set<number>(mutedRes.rows.map((r: { room_id: number }) => r.room_id));

  let count = 0;
  for (const m of memberships) {
    if (mutedSet.has(m.roomId)) continue;
    count += await unreadCount(m.roomId, userId, m.lastReadAt ?? null);
  }
  res.json({ count });
});

// ── Message reactions — one current reaction per citizen/message ──────────────
router.put("/messages/rooms/:roomId/messages/:msgId/reaction", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const roomId = Number(req.params.roomId), msgId = Number(req.params.msgId);
  const reaction = req.body?.reaction;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  if (!Number.isInteger(roomId) || !Number.isInteger(msgId) || !["support", "listen", "celebrate"].includes(reaction)) {
    res.status(400).json({ error: "Invalid reaction" }); return;
  }
  if (!await getMembership(roomId, userId)) { res.status(403).json({ error: "Access denied" }); return; }
  const room = await pool.query<{type:string}>("SELECT type FROM dm_rooms WHERE id=$1", [roomId]);
  if (room.rows[0]?.type === "direct" && await directRoomUnavailable(roomId, userId)) {
    res.status(403).json({ error: "Reactions are unavailable in this conversation" }); return;
  }
  const message = await pool.query("SELECT 1 FROM dm_messages WHERE id=$1 AND room_id=$2", [msgId, roomId]);
  if (!message.rows.length) { res.status(404).json({ error: "Message not found" }); return; }
  await pool.query(
    `INSERT INTO dm_message_reactions (message_id,user_id,reaction) VALUES ($1,$2,$3)
     ON CONFLICT (message_id,user_id) DO UPDATE SET reaction=EXCLUDED.reaction`,
    [msgId, userId, reaction],
  );
  res.json({ reaction });
});

router.delete("/messages/rooms/:roomId/messages/:msgId/reaction", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const roomId = Number(req.params.roomId), msgId = Number(req.params.msgId);
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  if (!Number.isInteger(roomId) || !Number.isInteger(msgId) || !await getMembership(roomId, userId)) {
    res.status(403).json({ error: "Access denied" }); return;
  }
  const room = await pool.query<{type:string}>("SELECT type FROM dm_rooms WHERE id=$1", [roomId]);
  if (room.rows[0]?.type === "direct" && await directRoomUnavailable(roomId, userId)) {
    res.status(403).json({ error: "Reactions are unavailable in this conversation" }); return;
  }
  const message = await pool.query("SELECT 1 FROM dm_messages WHERE id=$1 AND room_id=$2", [msgId, roomId]);
  if (!message.rows.length) { res.status(404).json({ error: "Message not found" }); return; }
  await pool.query("DELETE FROM dm_message_reactions WHERE message_id=$1 AND user_id=$2", [msgId, userId]);
  res.json({ reaction: null });
});

// ── DELETE /messages/rooms/:roomId/messages/:msgId — unsend own message ───────
router.delete("/messages/rooms/:roomId/messages/:msgId", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.roomId);
  const msgId  = parseInt(req.params.msgId);
  if (isNaN(roomId) || isNaN(msgId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getMembership(roomId, userId);
  if (!membership) { res.status(403).json({ error: "Access denied — not a member of this room" }); return; }

  // Only the author can delete their own message — enforced in the WHERE clause
  const deleted = await db.delete(dmMessages)
    .where(and(eq(dmMessages.id, msgId), eq(dmMessages.roomId, roomId), eq(dmMessages.userId, userId)))
    .returning({
      id: dmMessages.id,
      fileUrl: dmMessages.fileUrl,
      audioUrl: dmMessages.audioUrl,
      videoUrl: dmMessages.videoUrl,
    });
  if (deleted.length === 0) {
    res.status(403).json({ error: "يمكنك حذف رسائلك فقط — Vous ne pouvez supprimer que vos propres messages" }); return;
  }

  // Deleting an authored attachment also removes the private bytes once no
  // other message references the same object. Even if storage is temporarily
  // unavailable, the authorization query above makes the orphan unreadable.
  const localAttachmentUrls = [deleted[0].fileUrl, deleted[0].audioUrl, deleted[0].videoUrl]
    .filter((url): url is string => typeof url === "string")
    .filter(url => /^\/api\/messages\/files\/[A-Za-z0-9._-]+$/.test(url));

  for (const attachmentUrl of new Set(localAttachmentUrls)) {
    const stillReferenced = await pool.query(
      `SELECT 1
       FROM dm_messages
       WHERE file_url = $1 OR audio_url = $1 OR video_url = $1
       LIMIT 1`,
      [attachmentUrl],
    );
    if (stillReferenced.rows.length > 0) continue;

    const name = attachmentUrl.slice(attachmentUrl.lastIndexOf("/") + 1);
    try {
      await deleteChatObject(name);
      const legacyPath = path.join(legacyChatUploadsDir, name);
      if (legacyPath.startsWith(legacyChatUploadsDir) && fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
      }
    } catch (error) {
      console.error("Deleted message attachment cleanup failed:", error);
    }
  }
  void broadcastRoomEvent(roomId, {
    type: "chat-message-deleted",
    messageId: msgId,
    deletedByUserId: userId,
  }).catch(error =>
    req.log.error({ error, roomId, msgId }, "Chat message deletion realtime broadcast failed"));
  res.json({ deleted: true });
});

// ── DELETE /messages/rooms/:roomId — leave/delete a conversation ──────────────
router.delete("/messages/rooms/:roomId", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.roomId);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  // Lock the room while changing its membership. This makes simultaneous exits
  // safe: the last person leaving a direct conversation removes the now-orphaned
  // room and its messages, while the other participant keeps their own membership
  // and conversation until they choose to leave as well.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(47201, 1)");
    const { rows: roomRows } = await client.query<{ type: string }>(
      `SELECT type FROM dm_rooms WHERE id = $1 FOR UPDATE`,
      [roomId],
    );
    const room = roomRows[0];
    if (!room) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Room not found" }); return;
    }

    const { rowCount } = await client.query(
      `DELETE FROM dm_room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId],
    );
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "Access denied — not a member of this room" }); return;
    }

    let roomDeleted = false;
    if (room.type === "direct") {
      const { rows: remainingRows } = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM dm_room_members WHERE room_id = $1`,
        [roomId],
      );
      if ((remainingRows[0]?.count ?? 0) === 0) {
        await client.query(`DELETE FROM dm_messages WHERE room_id = $1`, [roomId]);
        await client.query(`DELETE FROM dm_rooms WHERE id = $1`, [roomId]);
        roomDeleted = true;
      }
    }

    await client.query("COMMIT");
    res.json({ deleted: true, roomDeleted });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* transaction already finished */ }
    throw error;
  } finally {
    client.release();
  }
});

// ── POST /messages/rooms/:id/mute — mute/unmute a conversation ────────────────
router.post("/messages/rooms/:id/mute", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }
  const membership = await getMembership(roomId, userId);
  if (!membership) { res.status(403).json({ error: "Access denied" }); return; }
  const muted = req.body?.muted === true;
  await pool.query(`UPDATE dm_room_members SET muted = $1 WHERE room_id = $2 AND user_id = $3`,
    [muted, roomId, userId]);
  res.json({ muted });
});

// ── GET /messages/settings — per-user messenger settings ─────────────────────
router.get("/messages/settings", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { rows } = await pool.query(
    `SELECT notifications, read_receipts FROM dm_user_settings WHERE user_id = $1`, [userId]);
  res.json({
    notifications: rows[0]?.notifications ?? true,
    readReceipts:  rows[0]?.read_receipts ?? true,
  });
});

// ── POST /messages/settings ───────────────────────────────────────────────────
router.post("/messages/settings", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { notifications, readReceipts } = req.body as { notifications?: boolean; readReceipts?: boolean };
  if (typeof notifications !== "boolean" && typeof readReceipts !== "boolean") {
    res.status(400).json({ error: "Nothing to update" }); return;
  }
  await pool.query(
    `INSERT INTO dm_user_settings (user_id, notifications, read_receipts)
     VALUES ($1, COALESCE($2, true), COALESCE($3, true))
     ON CONFLICT (user_id) DO UPDATE SET
       notifications = COALESCE($2, dm_user_settings.notifications),
       read_receipts = COALESCE($3, dm_user_settings.read_receipts),
       updated_at = now()`,
    [userId, notifications ?? null, readReceipts ?? null]);
  const { rows } = await pool.query(
    `SELECT notifications, read_receipts FROM dm_user_settings WHERE user_id = $1`, [userId]);
  res.json({ notifications: rows[0].notifications, readReceipts: rows[0].read_receipts });
});

// ── GET /messages/group-rooms — public group rooms list ───────────────────────
router.get("/messages/group-rooms", async (_req, res): Promise<void> => {
  const rooms = await db.select().from(dmRooms)
    .where(eq(dmRooms.type, "group")).orderBy(desc(dmRooms.createdAt)).limit(20);
  const withMembers = await Promise.all(rooms.map(async r => {
    const members = await db.select().from(dmRoomMembers).where(eq(dmRoomMembers.roomId, r.id));
    return { ...r, memberCount: members.length };
  }));
  res.json({ rooms: withMembers });
});

// Authenticated community discovery. Initiative counts deliberately include
// only open initiatives and are calculated in SQL rather than trusting a
// client-maintained counter.
router.get("/messages/communities", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.type, r.icon, r.created_by AS "createdBy", r.created_at AS "createdAt",
            COUNT(DISTINCT m.user_id)::int AS "memberCount",
            COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'open')::int AS "activeInitiativeCount"
     FROM dm_rooms r
     LEFT JOIN dm_room_members m ON m.room_id=r.id
     LEFT JOIN solidarity_initiatives i ON i.room_id=r.id
     WHERE r.type='group'
     GROUP BY r.id
     ORDER BY r.created_at DESC
     LIMIT 50`,
  );
  res.json({ communities: rows });
});

export default router;
