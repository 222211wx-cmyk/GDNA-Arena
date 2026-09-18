import type { RequestHandler } from "express";
import { clipWithThumbnail } from "./clips-thumbnail-response.js";

export const DEFAULT_CLIPS_FEED_LIMIT = 10;
export const MAX_CLIPS_FEED_LIMIT = 20;

export type ClipsFeedQuery =
  | { ok: true; before: number | null; limit: number }
  | { ok: false; parameter: "before" | "limit" };

function parsePositiveSafeInteger(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseClipsFeedQuery(query: {
  before?: unknown;
  limit?: unknown;
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

  return { ok: true, before, limit };
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
  loadRows(before: number | null, limit: number): Promise<FeedRow[]>;
  logFailure(error: unknown): void;
}): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const query = parseClipsFeedQuery(req.query);
      if (query.ok === false) throw new Error(`Invalid ${query.parameter}`);
      const rows = await deps.loadRows(query.before, query.limit);
      res.json(clipsFeedPage(rows.map(row => ({
        ...clipWithThumbnail(row), video_url: `/api/clips/stream/${row.id}`,
      })), query.limit));
    } catch (error) {
      deps.logFailure(error);
      res.json({ clips: [], hasMore: false, degraded: true });
    }
  };
}