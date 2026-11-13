import { Router, type IRouter } from "express";
import { db, gsMediaTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router: IRouter = Router();

// ─── GET /gs/media ──────────────────────────────────────────────────────────
router.get("/gs/media", async (req, res): Promise<void> => {
  const figureId = req.query.figureId ? parseInt(req.query.figureId as string) : undefined;
  const domain   = typeof req.query.domain === "string" ? req.query.domain : undefined;
  const type     = typeof req.query.type   === "string" ? req.query.type   : undefined;

  const conditions: ReturnType<typeof eq>[] = [];
  if (figureId && !isNaN(figureId)) conditions.push(eq(gsMediaTable.figureId, figureId));
  if (domain)   conditions.push(eq(gsMediaTable.domain, domain));
  if (type)     conditions.push(eq(gsMediaTable.type, type as "story" | "video" | "audio"));

  const rows = conditions.length
    ? await db.select().from(gsMediaTable).where(and(...conditions)).orderBy(asc(gsMediaTable.sortOrder))
    : await db.select().from(gsMediaTable).orderBy(asc(gsMediaTable.sortOrder)).limit(200);

  res.json({ media: rows, total: rows.length });
});

export default router;
