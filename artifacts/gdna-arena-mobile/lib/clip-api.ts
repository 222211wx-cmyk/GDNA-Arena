import { ApiError, getApiBase, getHeaders } from '@/lib/api';
import { CLIP_CODE_PATTERN } from '@/lib/clip-logic';

export type Clip = {
  id: number;
  code: string;
  name: string;
  originalName: string | null;
  duration: number;
  size: number;
  created_at: string;
  contentType: string;
  processingStatus: string;
  url: string | null;
  urlExpiresAt: string | null;
};

export class ClipApiError extends ApiError {
  constructor(status: number, message: string, public readonly retryAfter: string | null) {
    super(status, message);
    this.name = 'ClipApiError';
  }
}

function isClip(value: unknown, expectedCode: string): value is Clip {
  if (!value || typeof value !== 'object') return false;
  const clip = value as Partial<Clip>;
  return clip.code === expectedCode &&
    typeof clip.id === 'number' &&
    typeof clip.name === 'string' &&
    (typeof clip.originalName === 'string' || clip.originalName === null) &&
    typeof clip.duration === 'number' &&
    typeof clip.size === 'number' &&
    typeof clip.created_at === 'string' &&
    typeof clip.contentType === 'string' &&
    typeof clip.processingStatus === 'string' &&
    (typeof clip.url === 'string' || clip.url === null) &&
    (typeof clip.urlExpiresAt === 'string' || clip.urlExpiresAt === null);
}

export async function fetchClipByCode(code: string, signal?: AbortSignal): Promise<Clip> {
  if (!CLIP_CODE_PATTERN.test(code)) throw new ApiError(404, 'Clip not found');
  const response = await fetch(`${getApiBase()}/clip/by-code/${encodeURIComponent(code)}`, {
    method: 'GET',
    headers: getHeaders(),
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof body?.error === 'string'
      ? body.error
      : `Unable to open clip (${response.status})`;
    throw new ClipApiError(response.status, message, response.headers.get('retry-after'));
  }
  const body = await response.json() as { clip?: unknown };
  if (!isClip(body.clip, code)) throw new Error('The clip response is invalid.');
  if (body.clip.url) {
    const url = new URL(body.clip.url);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('The clip playback URL is invalid.');
    }
  }
  return body.clip;
}