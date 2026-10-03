import type { RequestHandler } from "express";
import { clipWithThumbnail } from "./clips-thumbnail-response.js";

export const DEFAULT_CLIPS_FEED_LIMIT = 5;
export const MAX_CLIPS_FEED_LIMIT = 10;
// Covers a cold managed-Postgres checkout while remaining bounded. The SQL has
// its own shorter statement timeout, so this is not permission for a slow query.
export const CLIPS_FEED_DEADLINE_MS = 1_200;

export type ClipsFeedQuery =
  | { ok: true; before: number | null; limit: number; q: string }
  | { ok: false; parameter: "before" | "limit" | "q" };

function parsePositiveSafeInteger(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseClipsFeedQuery(query: {
  before?: unknown;
  limit?: unknown;
  q?: unknown;
}): ClipsFeedQuery {
  let before: number | null = null;
  if (query.before !== undefined) {
    before = parsePositiveSafeInteger(query.before);
    if (before === null) return { ok: false, parameter: "before" };
  }

  let limit = DEFAULT_CLIPS_FEED_LIMIT;
  if (query.limit !== undefined) {
    const parsedLimit = parsePositiveSafeInteger(query.limit);
    if (parsedLimit === null || parsedLimit > MAX_CLIPS_FEED_LIMIT) {
      return { ok: false, parameter: "limit" };
    }
    limit = parsedLimit;
  }

  let q = "";
  if (query.q !== undefined) {
    if (typeof query.q !== "string" || query.q.length > 100) {
      return { ok: false, parameter: "q" };
    }
    q = query.q.trim();
  }

  return { ok: true, before, limit, q };
}

export function clipsFeedPage<T extends { id: number }>(
  rows: T[],
  limit: number,
): { clips: T[]; hasMore: boolean; nextBefore: number | null } {
  const hasMore = rows.length > limit;
  const clips = hasMore ? rows.slice(0, limit) : rows;
  return {
    clips,
    hasMore,
    nextBefore: hasMore ? clips[clips.length - 1].id : null,
  };
}

interface FeedRow {
  id: number;
  thumbnail_object_name?: string | null;
  [key: string]: unknown;
}

/** Preserve the feed envelope on failure, but distinguish downtime from an empty feed. */
export function createClipsFeedHandler(deps: {
  loadRows(
    before: number | null,
    limit: number,
    signal?: AbortSignal,
    q?: string,
    viewerId?: number | null,
  ): Promise<FeedRow[]>;
  logFailure(error: unknown): void;
  deadlineMs?: number;
}): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const query = parseClipsFeedQuery(req.query);
      if (query.ok === false) {
        res.status(400).json({ error: `Invalid ${query.parameter}` });
        return;
      }
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Clips feed deadline exceeded"));
        }, deps.deadlineMs ?? CLIPS_FEED_DEADLINE_MS);
        timer.unref();
      });
      let rows: FeedRow[];
      try {
        const viewerId = (req.session as { userId?: number } | undefined)?.userId ?? null;
        rows = await Promise.race([
          deps.loadRows(query.before, query.limit, controller.signal, query.q, viewerId),
          deadline,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      const page = clipsFeedPage(rows.map(row => ({
        ...clipWithThumbnail(row), video_url: `/api/clips/stream/${row.id}${row.content_type === "video/mp4" ? "/video.mp4" : ""}`,
      })), query.limit);
      res.json(page);
    } catch (error) {
      deps.logFailure(error);
      res.set("Retry-After", "2").status(503).json({
        clips: [],
        hasMore: false,
        degraded: true,
        error: "Clips feed is temporarily unavailable",
      });
    }
  };
}