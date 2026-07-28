import { Router, type IRouter } from "express";
import { db, gsFiguresTable, gsVotesTable, gsNewsTable, gsTraditionsTable } from "@workspace/db";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { moderateText, hasBlockedKeyword } from "../lib/moderate";

const router: IRouter = Router();

export const GS_DOMAINS = [
  { id: "sport",       label: "Sport",            icon: "⚽", labelAr: "رياضة",      labelFr: "Sport" },
  { id: "music",       label: "Music & Art",       icon: "🎵", labelAr: "موسيقى وفن", labelFr: "Musique & Art" },
  { id: "cinema",      label: "Cinema",            icon: "🎬", labelAr: "سينما",      labelFr: "Cinéma" },
  { id: "politics",    label: "Politics",          icon: "🏛️", labelAr: "سياسة",      labelFr: "Politique" },
  { id: "science",     label: "Science & Tech",    icon: "🔬", labelAr: "علوم وتقنية", labelFr: "Science & Tech" },
  { id: "culture",     label: "Culture & Heritage",icon: "🏺", labelAr: "ثقافة وتراث", labelFr: "Culture & Patrimoine" },
  { id: "business",    label: "Business",          icon: "💼", labelAr: "أعمال",      labelFr: "Affaires" },
  { id: "social",      label: "Social",            icon: "🌍", labelAr: "اجتماعي",    labelFr: "Social" },
  { id: "history",     label: "History",           icon: "📜", labelAr: "تاريخ",      labelFr: "Histoire" },
  { id: "archaeology", label: "Archaeology",       icon: "🗿", labelAr: "آثار",       labelFr: "Archéologie" },
];

function domainLabel(id: string): string {
  return GS_DOMAINS.find((d) => d.id === id)?.label ?? id;
}

// ─── GET /gs/domains ─────────────────────────────────────────────────────────
router.get("/gs/domains", async (_req, res): Promise<void> => {
  const stats = await db
    .select({
      domain: gsFiguresTable.domain,
      figureCount: sql<number>`count(*)::int`,
      totalVotes: sql<number>`coalesce(sum(${gsFiguresTable.votes}),0)::int`,
    })
    .from(gsFiguresTable)
    .groupBy(gsFiguresTable.domain);

  const map = Object.fromEntries(stats.map((s) => [s.domain, s]));
  const domains = GS_DOMAINS.map((d) => ({
    ...d,
    figureCount: map[d.id]?.figureCount ?? 0,
    totalVotes:  map[d.id]?.totalVotes  ?? 0,
  }));
  res.json({ domains });
});

// ─── GET /gs/figures ─────────────────────────────────────────────────────────
router.get("/gs/figures", async (req, res): Promise<void> => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
  const limitN = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const rows = domain
    ? await db.select().from(gsFiguresTable).where(eq(gsFiguresTable.domain, domain)).orderBy(desc(gsFiguresTable.votes)).limit(limitN)
    : await db.select().from(gsFiguresTable).orderBy(desc(gsFiguresTable.votes)).limit(limitN);

  const figures = rows.map((f, i) => ({
    ...f,
    rank:        i + 1,
    domainLabel: domainLabel(f.domain),
    imageUrl:    f.imageUrl ?? null,
  }));
  res.json({ figures, total: figures.length });
});

// ─── GET /gs/figures/:figureId ────────────────────────────────────────────────
router.get("/gs/figures/:figureId", async (req, res): Promise<void> => {
  const figureId = parseInt(req.params.figureId);
  if (isNaN(figureId)) { res.status(400).json({ error: "Invalid figure ID" }); return; }

  const [figure] = await db.select().from(gsFiguresTable).where(eq(gsFiguresTable.id, figureId)).limit(1);
  if (!figure) { res.status(404).json({ error: "Figure not found" }); return; }

  const domainFigures = await db
    .select({ id: gsFiguresTable.id })
    .from(gsFiguresTable)
    .where(eq(gsFiguresTable.domain, figure.domain))
    .orderBy(desc(gsFiguresTable.votes));

  const rank = domainFigures.findIndex((f) => f.id === figureId) + 1;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gsVotesTable)
    .where(and(eq(gsVotesTable.figureId, figureId), gte(gsVotesTable.createdAt, yesterday)));

  res.json({
    ...figure,
    rank,
    domainLabel: domainLabel(figure.domain),
    imageUrl:    figure.imageUrl ?? null,
    recentVotes: recent?.count ?? 0,
    voteTrend:   0,
  });
});

// ─── POST /gs/figures/:figureId/vote ─────────────────────────────────────────
router.post("/gs/figures/:figureId/vote", async (req, res): Promise<void> => {
  const figureId = parseInt(req.params.figureId);
  if (isNaN(figureId)) { res.status(400).json({ error: "Invalid figure ID" }); return; }

  // AI content-moderation on any optional comment
  const comment: string = req.body?.comment ?? "";
  if (comment) {
    const mod = await moderateText(comment);
    if (!mod.ok) {
      res.status(400).json({ error: `Vote rejected by AI filter. ${mod.reason}` });
      return;
    }
  }

  const voterIp =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  const [figure] = await db.select().from(gsFiguresTable).where(eq(gsFiguresTable.id, figureId)).limit(1);
  if (!figure) { res.status(404).json({ error: "Figure not found" }); return; }

  const [updated] = await db
    .update(gsFiguresTable)
    .set({ votes: figure.votes + 1 })
    .where(eq(gsFiguresTable.id, figureId))
    .returning();

  await db.insert(gsVotesTable).values({ figureId, voterIp });

  const domainFigures = await db
    .select({ id: gsFiguresTable.id })
    .from(gsFiguresTable)
    .where(eq(gsFiguresTable.domain, figure.domain))
    .orderBy(desc(gsFiguresTable.votes));

  const newRank = domainFigures.findIndex((f) => f.id === figureId) + 1;

  res.json({ figureId, newVotes: updated.votes, newRank, message: "Vote recorded!" });
});

// ─── GET /gs/ranking ─────────────────────────────────────────────────────────
router.get("/gs/ranking", async (_req, res): Promise<void> => {
  const ranking = await Promise.all(
    GS_DOMAINS.map(async (domain) => {
      const figures = await db
        .select()
        .from(gsFiguresTable)
        .where(eq(gsFiguresTable.domain, domain.id))
        .orderBy(desc(gsFiguresTable.votes))
        .limit(10);

      return {
        domain:      domain.id,
        domainLabel: domain.label,
        icon:        domain.icon,
        figures:     figures.map((f, i) => ({
          ...f,
          rank:        i + 1,
          domainLabel: domain.label,
          imageUrl:    f.imageUrl ?? null,
        })),
      };
    })
  );
  res.json({ ranking, updatedAt: new Date().toISOString() });
});

// ─── GET /gs/news ─────────────────────────────────────────────────────────────
router.get("/gs/news", async (req, res): Promise<void> => {
  const domain  = typeof req.query.domain === "string" ? req.query.domain : undefined;
  const limitN  = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const rows = domain
    ? await db.select().from(gsNewsTable).where(eq(gsNewsTable.domain, domain)).orderBy(desc(gsNewsTable.publishedAt)).limit(limitN)
    : await db.select().from(gsNewsTable).orderBy(desc(gsNewsTable.publishedAt)).limit(limitN);

  res.json({
    articles: rows.map((a) => ({
      ...a,
      domainLabel: domainLabel(a.domain),
      imageUrl:    a.imageUrl ?? null,
      publishedAt: a.publishedAt.toISOString(),
    })),
    total: rows.length,
  });
});

// ─── GET /gs/traditions ───────────────────────────────────────────────────────
router.get("/gs/traditions", async (req, res): Promise<void> => {
  const category = typeof req.query.category === "string" ? req.query.category : undefined;

  const rows = category
    ? await db.select().from(gsTraditionsTable).where(eq(gsTraditionsTable.category, category))
    : await db.select().from(gsTraditionsTable);

  res.json({
    traditions: rows.map((t) => ({ ...t, imageUrl: t.imageUrl ?? null })),
    total: rows.length,
  });
});

// ─── GET /gs/ticker ───────────────────────────────────────────────────────────
router.get("/gs/ticker", async (_req, res): Promise<void> => {
  let rows = await db
    .select()
    .from(gsNewsTable)
    .where(eq(gsNewsTable.isBreaking, true))
    .orderBy(desc(gsNewsTable.publishedAt))
    .limit(10);

  if (rows.length === 0) {
    rows = await db.select().from(gsNewsTable).orderBy(desc(gsNewsTable.publishedAt)).limit(10);
  }

  res.json({
    items: rows.map((n) => ({ id: n.id, text: n.title, domain: n.domain, isBreaking: n.isBreaking })),
  });
});

export default router;
