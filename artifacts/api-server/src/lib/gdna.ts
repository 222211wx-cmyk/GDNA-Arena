import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  configureGdnaCore,
  GDNA_CORE,
  GDNA_AGENTS,
  type Section,
} from "../../../../lib/gdna-core";
import { hasBlockedKeyword } from "./moderate";
import { citizenProjection } from "./citizen-projection";
import { MAX_CLIP_BYTES } from "./clip-upload-protocol";

export { GDNA_CORE, GDNA_AGENTS };
const VERSION = "gdna-v2-public-marketplace-encyclopedia";
export const platform = {
  capabilityVersion: VERSION,
  globalDailyLimit: 200,
  accountDailyLimit: 20,
  maxQueryCharacters: 4000,
  maxCompletionTokens: 1200,
  model: "gpt-5-mini",
  clips: "metadata-only",
  guard:
    "existing deterministic keyword policy; existing upload validation unchanged",
  encryptedMessages: "never read",
  dev: "version audit only; no execution or deployment",
  memory: "opt-in, latest 20 entries, 1000 characters each",
  uploadPolicy: {
    maxClipBytes: MAX_CLIP_BYTES,
    guarantees:
      "Existing clip-upload-protocol rights validation, owner-authorized uploads and media processing are unchanged. GDNA cannot scan media or decrypt AMIS envelopes.",
  },
};
export const gdnaAvailable = () =>
  Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );
export async function gdnaUsage(user: number) {
  const result = await pool.query(
    "SELECT used FROM gdna_usage WHERE day=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AND scope=$1",
    [`user:${user}`],
  );
  return { used: result.rows[0]?.used ?? 0, limit: 20 };
}
/** All processes share this transaction lock; reserve BOTH counters before any provider call. */
export async function reserveGdnaUsage(
  user: number,
  database: Pick<typeof pool, "connect"> = pool,
) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734201991)");
    const { rows } = await client.query(
      "SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day",
    );
    const day = rows[0].day;
    const scopes = ["global", `user:${user}`];
    await client.query(
      "INSERT INTO gdna_usage(day,scope) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
      [day, scopes],
    );
    const counters = (
      await client.query(
        "SELECT scope,used FROM gdna_usage WHERE day=$1 AND scope=ANY($2::text[])",
        [day, scopes],
      )
    ).rows;
    const used = counters.find((r) => r.scope === scopes[1]).used as number;
    const allowed =
      used < 20 && counters.find((r) => r.scope === "global").used < 200;
    if (allowed)
      await client.query(
        "UPDATE gdna_usage SET used=used+1 WHERE day=$1 AND scope=ANY($2::text[])",
        [day, scopes],
      );
    await client.query("COMMIT");
    return { allowed, used: used + Number(allowed), limit: 20 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function gdnaMemory(user: number) {
  return (
    await pool.query(
      'SELECT id,content,created_at AS "createdAt" FROM gdna_memory WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [user],
    )
  ).rows;
}
export async function deleteGdnaMemory(user: number, id?: string) {
  await pool.query(
    "DELETE FROM gdna_memory WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2::uuid)",
    [user, id ?? null],
  );
}
export async function recordCapabilityVersion() {
  await pool.query(
    "INSERT INTO gdna_evolution(id,agent,summary) VALUES($1,'dev',$2) ON CONFLICT DO NOTHING",
    [
      VERSION,
      "Public Souk listings and current active Legends encyclopedia retrieval; projected privacy filters, bounded memory, metadata-only Clips. No code execution or deployment.",
    ],
  );
}
async function remember(user: number, content: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734202, $1)", [user]);
    await client.query(
      "INSERT INTO gdna_memory(id,user_id,content) VALUES($1,$2,$3)",
      [randomUUID(), user, content.slice(0, 1000)],
    );
    await client.query(
      "DELETE FROM gdna_memory WHERE user_id=$1 AND id NOT IN (SELECT id FROM gdna_memory WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20)",
      [user],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function retrieveGdnaContext(
  section: Section,
  user: number,
  query = "",
) {
  const citations = [{ label: "GDNA Arena", url: "/" }];
  const data: Record<string, unknown> = {
    platform,
    memory: (await gdnaMemory(user))
      .slice(0, 5)
      .map((r) => r.content.slice(0, 500)),
  };
  let marketplaceSuggestions: Array<{
    title: string;
    description: string;
    url: string;
  }> = [];
  if (section === "hisn") {
    const terms = query
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3)
      .slice(0, 8)
      .map((term) => `%${term.slice(0, 80)}%`);
    const legends = (
      await pool.query(
        `SELECT id,name,domain,nationality,peak_year,left(bio::text,1400) AS biography_excerpt
      FROM legends WHERE is_active=TRUE
      ORDER BY (name ILIKE ANY($1::text[]) OR domain ILIKE ANY($1::text[]) OR bio::text ILIKE ANY($1::text[])) DESC NULLS LAST,rank,id LIMIT 5`,
        [terms],
      )
    ).rows;
    data.encyclopedia = legends;
    data.encyclopediaSource =
      "Current active platform Legends records; excerpts, not independently verified external facts";
    for (const legend of legends)
      citations.push({ label: legend.name, url: `/legends/${legend.id}` });
    data.account = (
      await pool.query(
        "SELECT username,xp,games_played,wins FROM users WHERE id=$1",
        [user],
      )
    ).rows[0];
    data.clips = (
      await pool.query(
        `SELECT c.id,left(c.title,180) AS title,c.duration_sec FROM clips c
      WHERE c.is_frozen=FALSE AND c.object_name IS NOT NULL AND c.processing_status='ready'
      AND NOT EXISTS (SELECT 1 FROM citizen_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=c.user_id) OR (b.blocked_id=$1 AND b.blocker_id=c.user_id))
      ORDER BY c.id DESC LIMIT 8`,
        [user],
      )
    ).rows;
    citations.push({ label: "Clips (title and duration only)", url: "/clips" });
  }
  if (section === "souk") {
    const rows = (
      await pool.query(
        `SELECT l.id,l.user_id,l.type,left(l.title,160) AS title,left(l.description,500) AS description,l.price,l.city
      FROM citizen_listings l JOIN users u ON u.id=l.user_id LEFT JOIN citizen_profiles p ON p.user_id=u.id
      WHERE l.type='market' AND u.password_hash<>'DELETED' AND coalesce(p.visibility,'everyone')='everyone'
      AND NOT EXISTS (SELECT 1 FROM citizen_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=l.user_id) OR (b.blocked_id=$1 AND b.blocker_id=l.user_id))
      ORDER BY l.created_at DESC,l.id DESC LIMIT 12`,
        [user],
      )
    ).rows;
    const listings = [];
    for (const row of rows) {
      const seller = await citizenProjection(row.user_id, user);
      if (!seller || seller.visibility !== "everyone") continue;
      listings.push({
        id: row.id,
        title: row.title,
        description: row.description,
        price: row.price,
        currency: "MAD",
        city: seller.city ? row.city : null,
        seller: seller.username,
        url: "/souk",
      });
    }
    data.listings = listings;
    data.currency =
      "MAD (د.م), seller asking prices; no negotiated price or inventory guarantee";
    data.marketplace =
      "Public citizen market listings, distinct from the platform-coin merchandise shop. If empty, explicitly state no eligible listings were retrieved.";
    marketplaceSuggestions = listings
      .slice(0, 3)
      .map((item) => ({
        title: item.title,
        description: `${item.price} MAD — current seller asking price; review listing before contacting.`,
        url: "/souk",
      }));
    citations.push({
      label: "Current public Souk listings (MAD)",
      url: "/souk",
    });
  }
  if (section === "helixly") {
    const own = await citizenProjection(user, user);
    const candidates = (
      await pool.query(
        `SELECT p.user_id FROM citizen_profiles p JOIN users u ON u.id=p.user_id
      WHERE p.user_id<>$1 AND u.password_hash<>'DELETED' AND p.interests ?| $2::text[] ORDER BY p.user_id LIMIT 20`,
        [user, own?.interests ?? []],
      )
    ).rows;
    const matches = [];
    for (const candidate of candidates) {
      const projected = await citizenProjection(candidate.user_id, user);
      const shared =
        projected?.interests.filter((i) => own?.interests.includes(i)) ?? [];
      if (projected && shared.length) {
        matches.push({ username: projected.username, sharedInterests: shared });
        citations.push({
          label: projected.username,
          url: `/citizen/${encodeURIComponent(projected.username)}`,
        });
      }
      if (matches.length === 5) break;
    }
    data.matches = matches;
    data.matchMethod =
      "Visible shared interests only, not relationship predictions";
    citations.push({ label: "Citizens", url: "/citizens" });
  }
  if (section === "guard") data.policy = platform.guard;
  if (section === "dev") await recordCapabilityVersion();
  const suggestions =
    section === "souk"
      ? marketplaceSuggestions
      : citations
          .slice(-3)
          .map((c) => ({
            title: c.label,
            description: "Open the verified platform source.",
            url: c.url,
          }));
  return { data, citations, suggestions };
}
configureGdnaCore({
  available: gdnaAvailable,
  blocked: hasBlockedKeyword,
  usage: gdnaUsage,
  reserve: reserveGdnaUsage,
  retrieve: retrieveGdnaContext,
  remember,
  async complete(system, query) {
    // This client is exclusive to GDNA: legacy OPENAI_API_KEY jobs remain unchanged.
    const client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      timeout: 25_000,
      maxRetries: 0,
    });
    const result = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 1200,
      reasoning_effort: "minimal",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: query },
      ],
    });
    return result.choices[0]?.message.content ?? "";
  },
  async audit(user, section, mode, reason) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO gdna_audit(id,user_id,agent,mode,reason) VALUES($1,$2,$3,$4,$5)",
      [id, user, section, mode, reason],
    );
    return id;
  },
});
