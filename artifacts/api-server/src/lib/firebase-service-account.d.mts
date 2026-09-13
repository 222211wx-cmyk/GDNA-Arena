export function selectServiceAccount(env: Record<string, string | undefined>): string;
export function parseServiceAccount(raw: unknown): {
  account: Record<string, unknown> | null;
  error: string | null;
};