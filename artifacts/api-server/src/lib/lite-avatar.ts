import { spawn } from "node:child_process";
import type { RequestHandler } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { pool } from "./db";
import { r2Client, r2Config } from "./r2-storage";
import { compactCitizen, LITE_CITIZEN_COLUMNS, LITE_VISIBILITY } from "./lite-projection";

export function storedAvatarKey(url: unknown, id: number): string | null {
  if (typeof url !== "string") return null;
  const match = /^\/api\/citizen-profiles\/media\/([1-9]\d*)\/avatar\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(url);
  return match && Number(match[1]) === id ? `citizen-media/${id}/avatar/${match[2]}` : null;
}

export async function encodeLiteAvatar(input: Buffer, slow: boolean): Promise<Buffer> {
  const cap = slow ? 5120 : 10240;
  // Real WebP, never upscale; decrease dimensions until encoded bytes fit.
  for (const width of (slow ? [64, 48, 32, 16] : [96, 64, 48, 32, 16])) {
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-v", "error", "-threads", "1", "-max_pixels", "25000000",
        "-protocol_whitelist", "pipe", "-i", "pipe:0", "-frames:v", "1",
        "-vf", `scale=w='min(${width},iw)':h='min(${width},ih)':force_original_aspect_ratio=decrease`,
        "-c:v", "libwebp", "-quality", "45", "-f", "webp", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      let length = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 1024 * 1024) child.kill("SIGKILL");
        else chunks.push(chunk);
      });
      child.stdin.on("error", () => {});
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("Avatar encoding unavailable"));
        else resolve(Buffer.concat(chunks));
      });
      child.stdin.end(input);
    });
    if (bytes.length <= cap && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") return bytes;
  }
  throw new Error("Avatar cannot fit transfer budget");
}

let active = 0;
export const liteAvatar: RequestHandler = async (req, res) => {
  if (active >= 2) { res.status(503).json({ error: "Avatar encoder busy; retry later" }); return; }
  active++;
  try {
    const { rows } = await pool.query(`SELECT ${LITE_CITIZEN_COLUMNS}
      FROM users u LEFT JOIN citizen_profiles p ON p.user_id=u.id WHERE ${LITE_VISIBILITY}
      AND lower(u.username)=lower($2) LIMIT 1`, [req.session?.userId ?? null, String(req.params.username).slice(0, 80)]);
    const row = rows[0];
    const key = row && compactCitizen(row, req.session?.userId)?.avatarUrl && storedAvatarKey(row.avatar_url, row.id);
    if (!key) { res.status(404).json({ error: "Stored avatar not found" }); return; }
    const config = r2Config();
    if (!config) { res.status(503).json({ error: "Avatar storage unavailable" }); return; }
    const object = await r2Client().send(new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(10000) });
    if (!object.Body || !object.ContentLength || object.ContentLength > 5 * 1024 * 1024) throw new Error("Invalid avatar size");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) throw new Error("Avatar source too large");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = await encodeLiteAvatar(Buffer.concat(chunks), req.query.slow === "1");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("image/webp").send(bytes);
  } catch {
    res.status(503).json({ error: "Avatar conversion or storage unavailable" });
  } finally { active--; }
};
