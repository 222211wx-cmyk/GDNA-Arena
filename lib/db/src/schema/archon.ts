import { pgTable, serial, integer, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

// ── Archon Initiation Sessions ────────────────────────────────────────────────
export const archonSessionsTable = pgTable("archon_sessions", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull(),

  // ── The 7 Archon Dimensions (0–100) ────────────────────────────────────────
  volontas:    integer("volontas").notNull().default(0),    // إرادة الفاتح  — Conqueror's Will
  resilentia:  integer("resilentia").notNull().default(0),  // صمود المحارب — Warrior's Resilience
  intellectus: integer("intellectus").notNull().default(0), // وضوح الرؤية  — Clarity of Vision
  disciplina:  integer("disciplina").notNull().default(0),  // انضباط الإمبراطور — Imperial Discipline
  societas:    integer("societas").notNull().default(0),    // قوة التأثير   — Power of Influence
  abundantia:  integer("abundantia").notNull().default(0),  // عقلية الوفرة  — Abundance Mindset
  auctoritas:  integer("auctoritas").notNull().default(0),  // السلطة الداخلية — Inner Authority

  // ── The Encrypted Code ────────────────────────────────────────────────────
  archonCode:  text("archon_code").notNull(),               // e.g. ARCH-7X4K-9MV2-SOV

  // ── AI-Generated Profile ──────────────────────────────────────────────────
  archetype:   text("archetype"),                           // THE SOVEREIGN | THE CONQUEROR | etc
  aiProfile:   jsonb("ai_profile"),                         // full GPT analysis

  // ── Raw initiation answers ────────────────────────────────────────────────
  answers:     jsonb("answers"),                            // raw Q1–Q7 answers

  // ── Meta ──────────────────────────────────────────────────────────────────
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow(),
});

// ── Archon Daily Directives ───────────────────────────────────────────────────
export const archonDirectivesTable = pgTable("archon_directives", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull(),
  sessionId:   integer("session_id"),
  dimension:   text("dimension"),                           // which dimension this targets
  directive:   text("directive").notNull(),                 // the mission text
  completed:   boolean("completed").notNull().default(false),
  createdAt:   timestamp("created_at").defaultNow(),
});
