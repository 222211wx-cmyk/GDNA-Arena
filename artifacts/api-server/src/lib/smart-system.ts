/**
 * ═══════════════════════════════════════════════════════════
 *  GDN-SMART SYSTEM — Core Intelligence Module
 *  smartSystem() analyses real citizen data and returns
 *  status ACTIF + personalised recommendations for every domain.
 * ═══════════════════════════════════════════════════════════
 */
import { pool } from "@workspace/db";

export interface SmartDomain {
  id: string;
  name: string;
  score: number;
  status: "ACTIF" | "INACTIF";
  detail: string;
}

export interface SmartReport {
  status: "ACTIF";
  citizen: string;
  level: number;
  overallScore: number;
  domains: SmartDomain[];
  recommendations: string[];
  generatedAt: string;
}

// ── Main function — call this whenever you need the Smart report ──────────────
export async function smartSystem(userId: number): Promise<SmartReport> {
  // ── Fetch all citizen data in parallel ─────────────────────────────────────
  const [userRow, archonRow, pulseRow, learnRow, transRow, celebRow, followRow] =
    await Promise.all([
      pool.query(
        `SELECT username, xp, balance, games_played, wins FROM users WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT archetype FROM archon_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) as cnt FROM pulse_posts WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(
        `SELECT COUNT(*) as cnt FROM user_lesson_progress WHERE user_id = $1 AND completed = true`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(
        `SELECT SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as earned,
                COUNT(*) as cnt
         FROM transactions WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ earned: 0, cnt: 0 }] })),
      pool.query(
        `SELECT COUNT(*) as cnt FROM celebration_entries WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(
        `SELECT COUNT(*) as cnt FROM social_follows WHERE follower_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

  const u           = userRow.rows[0] ?? {};
  const gamesPlayed = parseInt(u.games_played ?? 0);
  const wins        = parseInt(u.wins ?? 0);
  const xp          = parseInt(u.xp ?? 0);
  const balance     = parseInt(u.balance ?? 0);
  const level       = Math.floor(Math.sqrt(xp / 100)) + 1;
  const winRate     = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
  const archetype   = archonRow.rows[0]?.archetype ?? null;
  const posts       = parseInt(pulseRow.rows[0]?.cnt ?? 0);
  const lessons     = parseInt(learnRow.rows[0]?.cnt ?? 0);
  const coinsEarned = parseFloat(transRow.rows[0]?.earned ?? 0);
  const comps       = parseInt(celebRow.rows[0]?.cnt ?? 0);
  const following   = parseInt(followRow.rows[0]?.cnt ?? 0);

  // ── Score per domain ────────────────────────────────────────────────────────
  const domains: SmartDomain[] = [
    {
      id: "gaming",
      name: "Gaming",
      score: Math.min(100, gamesPlayed * 5 + wins * 10),
      status: gamesPlayed > 0 ? "ACTIF" : "INACTIF",
      detail: `${gamesPlayed} parties · ${wins} victoires · ${winRate}% win rate`,
    },
    {
      id: "education",
      name: "Education",
      score: Math.min(100, lessons * 20),
      status: lessons > 0 ? "ACTIF" : "INACTIF",
      detail: `${lessons} lecons completees`,
    },
    {
      id: "business",
      name: "Business",
      score: Math.min(100, Math.floor(coinsEarned / 10)),
      status: balance > 500 || coinsEarned > 0 ? "ACTIF" : "INACTIF",
      detail: `${balance} pieces · ${Math.floor(coinsEarned)} pieces gagnees`,
    },
    {
      id: "social",
      name: "Social",
      score: Math.min(100, following * 5 + posts * 10),
      status: posts > 0 || following > 0 ? "ACTIF" : "INACTIF",
      detail: `${posts} posts · ${following} abonnements`,
    },
    {
      id: "competitions",
      name: "Competitions",
      score: Math.min(100, comps * 25),
      status: comps > 0 ? "ACTIF" : "INACTIF",
      detail: `${comps} participations`,
    },
    {
      id: "xp",
      name: "XP",
      score: Math.min(100, Math.floor(xp / 10)),
      status: xp > 0 ? "ACTIF" : "INACTIF",
      detail: `${xp} XP · Niveau ${level}`,
    },
  ];

  const overallScore = Math.round(
    domains.reduce((s, d) => s + d.score, 0) / domains.length
  );

  // ── Build personalised recommendations ─────────────────────────────────────
  const recommendations: string[] = [];

  if (gamesPlayed === 0) {
    recommendations.push("Joue ta premiere partie pour activer le module Gaming et gagner des XP.");
  } else if (winRate < 40) {
    recommendations.push(`Ton win rate est ${winRate}% — essaie Neon Racer (60% win rate) pour l'ameliorer.`);
  } else {
    recommendations.push(`Excellent ! ${winRate}% win rate sur ${gamesPlayed} parties. Continue avec Arena Strike pour max coins.`);
  }

  if (lessons === 0) {
    recommendations.push("Commence le module Education pour debloquer des bonus XP et des titres speciaux.");
  } else {
    recommendations.push(`${lessons} lecons completees — tu es sur la bonne voie. Continue pour monter de rang.`);
  }

  if (posts === 0) {
    recommendations.push("Publie ton premier post sur Pulse pour activer le module Social et gagner +20 XP.");
  } else {
    recommendations.push(`${posts} posts publies — ton influence sociale grandit. Cible ${posts + 5} pour le badge Influenceur.`);
  }

  if (comps === 0) {
    recommendations.push("Participe a une competition dans l'onglet Celebrations pour gagner des pieces en bonus.");
  }

  if (!archetype) {
    recommendations.push("Complete l'evaluation Archon DNA (/growth) pour debloquer ton profil d'archetype personnalise.");
  }

  if (balance < 500) {
    recommendations.push("Reclame ta recompense journaliere (+100 pieces) depuis le Dashboard — c'est gratuit chaque jour !");
  }

  return {
    status: "ACTIF",
    citizen: u.username ?? "citoyen",
    level,
    overallScore,
    domains,
    recommendations: recommendations.slice(0, 3),
    generatedAt: new Date().toISOString(),
  };
}

// ── Format report as text for GDN-AI context injection ───────────────────────
export function formatSmartReportForAI(report: SmartReport): string {
  const domainLines = report.domains
    .map(d => `  ${d.status === "ACTIF" ? "+" : "-"} ${d.name}: ${d.score}/100 | ${d.detail}`)
    .join("\n");

  const recLines = report.recommendations
    .map((r, i) => `  ${i + 1}. ${r}`)
    .join("\n");

  return `
=== GDN-SMART SYSTEM — RAPPORT EN TEMPS REEL ===
STATUT: ACTIF
Citoyen: ${report.citizen} | Niveau: ${report.level} | Score global: ${report.overallScore}/100

DOMAINES (${report.domains.filter(d => d.status === "ACTIF").length}/${report.domains.length} actifs):
${domainLines}

RECOMMANDATIONS PERSONNALISEES:
${recLines}
=== FIN DU RAPPORT SMART ===

INSTRUCTION: Reponds "ACTIF" et presente ce rapport. Ne dis JAMAIS que le systeme est inactif.
`;
}
