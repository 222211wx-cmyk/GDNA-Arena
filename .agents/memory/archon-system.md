---
name: Archon System
description: Encrypted internal self-development system — the foundation of the GDNA Empire. Lives at /growth.
---

## Architecture

**Frontend phases** (growth.tsx):
1. `boot` — terminal boot animation (7 typewriter lines), menu to start or load existing profile
2. `initiation` — 7 questions one at a time (Q1–Q6 = A/B/C/D choices, Q7 = free text)
3. `encoding` — Matrix-style encryption animation while API call processes
4. `profile` — Full profile with 4 tabs: DIMENSIONAL PROFILE / FOUR PILLARS / ORACLE INTELLIGENCE / BREATH CALIBRATION

**The 7 Archon Dimensions:**
- VOLUNTAS — إرادة الفاتح (Q1 answer)
- RESILENTIA — صمود المحارب (Q2)
- INTELLECTUS — وضوح الرؤية (Q3)
- DISCIPLINA — انضباط الإمبراطور (Q4)
- SOCIETAS — قوة التأثير (Q5)
- ABUNDANTIA — عقلية الوفرة (Q6)
- AUCTORITAS — السلطة الداخلية (Q7 free text length → score)

**Score map:** A=90, B=70, C=50, D=30. AUCTORITAS = min(100, 40 + text.length * 2).

**The 7 Archetypes (classified by dimension scores):**
- THE SOVEREIGN — overall ≥ 75
- THE CONQUEROR — VOLUNTAS ≥ 80 AND RESILENTIA ≥ 70
- THE VISIONARY — INTELLECTUS ≥ 80 AND AUCTORITAS ≥ 70
- THE ARCHITECT — DISCIPLINA ≥ 80 AND INTELLECTUS ≥ 70
- THE CATALYST — SOCIETAS ≥ 80 AND ABUNDANTIA ≥ 70
- THE SENTINEL — RESILENTIA ≥ 80 AND DISCIPLINA ≥ 70
- THE SEEKER — all others

**Archon Code format:** `ARCH-XXXX-XXXX-TAG` (e.g. ARCH-7X4K-9MV2-SOV)
Generated deterministically from dimension values + archetype.

**DB tables:** `archon_sessions`, `archon_directives` (in lib/db/src/schema/archon.ts)

**API routes** (artifacts/api-server/src/routes/archon.ts):
- `POST /api/archon/assess` — full initiation, calls GPT-4o-mini, stores session, returns profile
- `GET /api/archon/profile` — latest active session for authenticated user
- `POST /api/archon/mission` — generate classified daily directive for a specific dimension

**The Four Pillars (FOUR PILLARS tab — pure frontend, no new API):**
Computed from the 7 dimensions and displayed as a Growth Engine dashboard:
- 🧠 MENS (العقل) = avg(INTELLECTUS, AUCTORITAS)
- ⚔️ VIS (القوة) = avg(VOLUNTAS, DISCIPLINA)
- 🔥 ANIMA (الروح) = avg(RESILENTIA, SOCIETAS)
- 👑 LEGATUM (الإرث) = ABUNDANTIA*0.5 + overallScore*0.3 + minDim*0.2
Engine score = avg of 4 pillars. Shows animated column chart, per-pillar daily challenges (Arabic), growth state label, weakest pillar spotlight.

**Why:**
The user wanted a "complex encrypted internal system" (نظام داخلي معقد مشفر) as the foundation of the empire. Terminal aesthetic, cipher animations, imperial language — not a wellness app, an intelligence system.

**How to apply:**
- Never soften the language — directives are "classified", dimensions are "imperial", failures are "shadow missions"
- The boot sequence always runs first (even if profile exists) — it's the ritual
- Re-assess clears old sessions (set isActive=false) before inserting new
- Import from `@workspace/db/schema` (not `@workspace/db/schema/archon`) — sub-path must be exported in package.json
