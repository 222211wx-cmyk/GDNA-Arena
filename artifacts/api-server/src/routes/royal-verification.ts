import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const userId = (req: any): number | null => req.session?.userId ?? null;
const safeView = (row: any) => ({
  id: row.id,
  status: row.status,
  producerName: row.producer_name,
  country: row.country,
  warningAcceptedAt: row.warning_accepted_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get("/royal/verification", async (req, res): Promise<void> => {
  const id = userId(req); if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { rows } = await pool.query("SELECT * FROM royal_verifications WHERE user_id=$1", [id]);
  res.json({ verification: rows[0] ? safeView(rows[0]) : null });
});

router.post("/royal/verification", limiter, async (req, res): Promise<void> => {
  const id = userId(req); if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const producerName = String(req.body?.producerName ?? "").trim();
  const country = String(req.body?.country ?? "").trim();
  const accepted = req.body?.acceptedAccuracy === true
    && req.body?.acceptedImpersonation === true
    && req.body?.acceptedPayoutResponsibility === true;
  if (producerName.length < 3 || country.length < 2 || !accepted) {
    res.status(400).json({ error: "Accurate producer information and acceptance of all legal warnings are required" }); return;
  }
  const { rows } = await pool.query(
    `INSERT INTO royal_verifications
       (id,user_id,producer_name,country,declaration_accepted,warning_accepted_at,status,earnings_frozen)
     VALUES ($1,$2,$3,$4,TRUE,NOW(),'declared',FALSE)
     ON CONFLICT (user_id) DO UPDATE SET producer_name=EXCLUDED.producer_name,country=EXCLUDED.country,
       declaration_accepted=TRUE,warning_accepted_at=NOW(),status='declared',earnings_frozen=FALSE,updated_at=NOW()
     RETURNING *`,
    [crypto.randomUUID(), id, producerName, country],
  );
  res.status(201).json({
    verification: safeView(rows[0]),
    message: "Legal declaration accepted. Future earnings will be handled according to the information you provide; incorrect information may forfeit unpaid entitlements.",
  });
});

router.get("/royal/badge/:username", async (req, res): Promise<void> => {
  const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const { rows } = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM royal_verifications rv JOIN users u ON u.id=rv.user_id
      WHERE u.username=$1 AND rv.status='declared' AND rv.declaration_accepted=TRUE) AS verified`, [username],
  );
  res.json({ royalVerified: rows[0]?.verified === true });
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