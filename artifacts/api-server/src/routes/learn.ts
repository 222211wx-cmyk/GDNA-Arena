import { Router, type IRouter } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db, learnCourses, learnProgress, usersTable, transactionsTable } from "../lib/db";

const router: IRouter = Router();

// ── GET /learn/courses ─────────────────────────────────────────────────────────
router.get("/learn/courses", async (req, res): Promise<void> => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;

  const rows = domain && domain !== "all"
    ? await db.select().from(learnCourses).where(eq(learnCourses.domain, domain)).orderBy(desc(learnCourses.isLive), learnCourses.id)
    : await db.select().from(learnCourses).orderBy(desc(learnCourses.isLive), learnCourses.id);

  // Attach completion status per user
  const userId = req.session?.userId ?? null;
  let completedIds = new Set<number>();
  if (userId) {
    const rows2 = await db.select({ courseId: learnProgress.courseId })
      .from(learnProgress).where(eq(learnProgress.userId, userId));
    completedIds = new Set(rows2.map(r => r.courseId));
  }

  const courses = rows.map(c => ({ ...c, completed: completedIds.has(c.id) }));
  res.json({ courses });
});

// ── POST /learn/:id/complete (+20 XP) ─────────────────────────────────────────
router.post("/learn/:id/complete", async (req, res): Promise<void> => {
  const courseId = parseInt(req.params.id);
  if (isNaN(courseId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userId = req.session?.userId ?? null;
  if (!userId) { res.json({ xpEarned: 0, message: "Login to earn XP" }); return; }

  // Check already completed
  const [existing] = await db.select().from(learnProgress)
    .where(and(eq(learnProgress.userId, userId), eq(learnProgress.courseId, courseId))).limit(1);
  if (existing) { res.json({ xpEarned: 0, message: "Already completed" }); return; }

  const [course] = await db.select().from(learnCourses).where(eq(learnCourses.id, courseId)).limit(1);
  if (!course) { res.status(404).json({ error: "Course not found" }); return; }

  const xp = course.xpReward;
  await db.insert(learnProgress).values({ userId, courseId });
  await db.update(usersTable).set({ xp: sql`${usersTable.xp} + ${xp}` }).where(eq(usersTable.id, userId));
  await db.insert(transactionsTable).values({ userId, amount: xp, type: "learn", description: `Completed: ${course.title} — +${xp} XP` });
  await db.update(learnCourses).set({ totalStudents: sql`${learnCourses.totalStudents} + 1` }).where(eq(learnCourses.id, courseId));

  res.json({ xpEarned: xp, message: `+${xp} XP — Course Complete!` });
});

// ── GET /learn/stats ───────────────────────────────────────────────────────────
router.get("/learn/stats", async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? null;
  const [total]    = await db.select({ cnt: sql<number>`count(*)::int` }).from(learnCourses);
  const [students] = await db.select({ cnt: sql<number>`count(distinct user_id)::int` }).from(learnProgress);
  let completed = 0;
  if (userId) {
    const [r] = await db.select({ cnt: sql<number>`count(*)::int` }).from(learnProgress).where(eq(learnProgress.userId, userId));
    completed = r?.cnt ?? 0;
  }
  res.json({ totalCourses: total?.cnt ?? 0, totalStudents: students?.cnt ?? 0, userCompleted: completed });
});

export default router;
