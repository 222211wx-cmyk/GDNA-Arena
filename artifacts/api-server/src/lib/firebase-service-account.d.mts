export function selectServiceAccount(env: Record<string, string | undefined>): string;
export function resolveServiceAccount(env: Record<string, string | undefined>): {
  account: Record<string, unknown> | null;
  error: string | null;
  diagnostic?: string | null;
  source: string | null;
  missingFallbackFields?: string[];
};
export function safeJsonError(error: unknown): string;
export function parseServiceAccount(raw: unknown): {
  account: Record<string, unknown> | null;
  error: string | null;
  diagnostic?: string | null;
};
