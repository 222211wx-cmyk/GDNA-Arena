import crypto from "node:crypto";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { objectStorageClient } from "../lib/chatStorage";
import { encryptPayoutDetails, maskAccount } from "../lib/payout-crypto";
import { requireAdmin } from "../middleware/require-admin";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 4, standardHeaders: true, legacyHeaders: false });

function userId(req: any): number | null {
  return req.session?.userId ?? null;
}
function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]/gu, "");
}
function idFile(name: string) {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not configured");
  const parts = `${dir.replace(/\/$/, "")}/royal-verification/${name}`.replace(/^\/?/, "/").split("/");
  return objectStorageClient.bucket(parts[1]).file(parts.slice(2).join("/"));
}
function safeView(row: any) {
  return {
    id: row.id, status: row.status, nameMatches: row.name_matches,
    earningsFrozen: row.earnings_frozen, maskedAccount: row.masked_account,
    createdAt: row.created_at, updatedAt: row.updated_at, verifiedAt: row.verified_at,
    reviewNote: row.review_note ?? null,
  };
}

router.get("/royal/verification", async (req, res): Promise<void> => {
  const id = userId(req); if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { rows } = await pool.query("SELECT * FROM royal_verifications WHERE user_id=$1", [id]);
  res.json({ verification: rows[0] ? safeView(rows[0]) : null });
});

router.post("/royal/verification", limiter, (req, res): void => {
  const id = userId(req); if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  upload.single("idCard")(req, res, async (error): Promise<void> => {
    if (error) { res.status(400).json({ error: "Identity image must be JPG, PNG or WebP and no larger than 8MB" }); return; }
    const legalName = String(req.body?.legalName ?? "").trim();
    const bankHolderName = String(req.body?.bankHolderName ?? "").trim();
    const bankName = String(req.body?.bankName ?? "").trim();
    const accountNumber = String(req.body?.accountNumber ?? "").replace(/\s+/g, "");
    const routingCode = String(req.body?.routingCode ?? "").trim();
    if (!req.file || legalName.length < 3 || bankHolderName.length < 3 || bankName.length < 2 || accountNumber.length < 6) {
      res.status(400).json({ error: "Legal name, identity image and complete bank details are required" }); return;
    }
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 16) { res.status(503).json({ error: "Secure verification storage unavailable" }); return; }
    const ext = req.file.mimetype === "image/png" ? ".png" : req.file.mimetype === "image/webp" ? ".webp" : ".jpg";
    const objectName = `${id}_${crypto.randomUUID()}${ext}`;
    const target = idFile(objectName);
    await target.save(req.file.buffer, { resumable: false, metadata: { contentType: req.file.mimetype, cacheControl: "private,no-store" } });
    const nameMatches = normalizedName(legalName) === normalizedName(bankHolderName);
    const encrypted = encryptPayoutDetails({ accountHolder: bankHolderName, bankName, accountNumber, routingCode: routingCode || null }, secret);
    const existing = await pool.query<{ id_object_name: string }>("SELECT id_object_name FROM royal_verifications WHERE user_id=$1", [id]);
    try {
      const { rows } = await pool.query(
        `INSERT INTO royal_verifications (id,user_id,legal_name,bank_holder_name,bank_name,encrypted_bank_payload,masked_account,id_object_name,id_mime_type,name_matches,status,earnings_frozen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',TRUE)
         ON CONFLICT (user_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,bank_holder_name=EXCLUDED.bank_holder_name,
           bank_name=EXCLUDED.bank_name,encrypted_bank_payload=EXCLUDED.encrypted_bank_payload,masked_account=EXCLUDED.masked_account,
           id_object_name=EXCLUDED.id_object_name,id_mime_type=EXCLUDED.id_mime_type,name_matches=EXCLUDED.name_matches,
           status='pending',earnings_frozen=TRUE,reviewed_by=NULL,review_note=NULL,verified_at=NULL,updated_at=NOW()
         RETURNING *`,
        [crypto.randomUUID(), id, legalName, bankHolderName, bankName, encrypted, maskAccount(accountNumber), objectName, req.file.mimetype, nameMatches],
      );
      if (existing.rows[0]?.id_object_name && existing.rows[0].id_object_name !== objectName) {
        void idFile(existing.rows[0].id_object_name).delete({ ignoreNotFound: true });
      }
      res.status(201).json({ verification: safeView(rows[0]), message: nameMatches ? "Verification submitted" : "Names do not match; earnings remain frozen" });
    } catch (e) {
      await target.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw e;
    }
  });
});

router.get("/royal/badge/:username", async (req, res): Promise<void> => {
  const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const { rows } = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM royal_verifications rv JOIN users u ON u.id=rv.user_id
      WHERE u.username=$1 AND rv.status='verified' AND rv.name_matches=TRUE) AS verified`, [username],
  );
  res.json({ royalVerified: rows[0]?.verified === true });
});

router.get("/royal/admin/verifications", requireAdmin, async (_req, res): Promise<void> => {
  const { rows } = await pool.query(
    `SELECT rv.id,u.username,rv.legal_name,rv.bank_holder_name,rv.bank_name,rv.status,rv.name_matches,rv.earnings_frozen,rv.masked_account,rv.created_at,rv.updated_at
     FROM royal_verifications rv JOIN users u ON u.id=rv.user_id ORDER BY rv.created_at DESC LIMIT 200`,
  );
  res.json({ verifications: rows.map(r => ({ id: r.id, username: r.username, legalName: r.legal_name, bankHolderName: r.bank_holder_name, bankName: r.bank_name, status: r.status, nameMatches: r.name_matches, earningsFrozen: r.earnings_frozen, maskedAccount: r.masked_account, createdAt: r.created_at, updatedAt: r.updated_at })) });
});

router.get("/royal/admin/verifications/:id/id-card", requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { rows } = await pool.query("SELECT id_object_name,id_mime_type FROM royal_verifications WHERE id=$1", [id]);
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Content-Type", rows[0].id_mime_type);
  res.setHeader("Cache-Control", "private, no-store");
  idFile(rows[0].id_object_name).createReadStream().on("error", () => res.destroy()).pipe(res);
});

router.patch("/royal/admin/verifications/:id", requireAdmin, async (req, res): Promise<void> => {
  const adminId = userId(req)!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const status = req.body?.status;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
  if (!["verified", "rejected"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  const { rows } = await pool.query(
    `UPDATE royal_verifications SET status=$1,earnings_frozen=($1<>'verified'),reviewed_by=$2,review_note=$3,
       verified_at=CASE WHEN $1='verified' THEN NOW() ELSE NULL END,updated_at=NOW()
     WHERE id=$4 AND ($1<>'verified' OR name_matches=TRUE) RETURNING *`, [status, adminId, note, id],
  );
  if (!rows[0]) { res.status(409).json({ error: "Bank account holder must exactly match the legal identity before approval" }); return; }
  await pool.query("INSERT INTO admin_audit_events (id,admin_user_id,action,target_ref,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)", [crypto.randomUUID(), adminId, `royal_verification_${status}`, id, JSON.stringify({ note })]);
  res.json({ verification: safeView(rows[0]) });
});

function wav(track: number): Buffer {
  const sampleRate = 8000, seconds = 8, samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2), base = 110 + (track % 48) * 5;
  for (let i = 0; i < samples; i++) {
    const beat = Math.sin(2 * Math.PI * (2 + track % 5) * i / sampleRate) > 0.86 ? 0.45 : 0.16;
    const value = Math.max(-1, Math.min(1, beat * Math.sin(2 * Math.PI * base * i / sampleRate) + 0.1 * Math.sin(2 * Math.PI * base * 1.5 * i / sampleRate)));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
router.get("/royal/music-library", (_req, res): void => {
  res.json({ tracks: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, title: `Empire Loop ${String(i + 1).padStart(4, "0")}`, durationSec: 8, license: "GDNA original — royalty-free for citizens", audioUrl: `/api/royal/music-library/${i + 1}/audio` })) });
});
router.get("/royal/music-library/:id/audio", (req, res): void => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 1000) { res.status(404).end(); return; }
  const audio = wav(id); res.setHeader("Content-Type", "audio/wav"); res.setHeader("Content-Length", audio.length); res.setHeader("Cache-Control", "public,max-age=31536000,immutable"); res.end(audio);
});

export default router;