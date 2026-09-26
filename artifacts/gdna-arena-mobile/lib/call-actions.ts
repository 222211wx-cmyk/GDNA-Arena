export type CallPush = {
  type: 'call'; callId: string; callUUID: string; recipientId: string;
  callerName: string; handle: string; expiresAt: string; hasVideo: boolean;
};
export type CallAction = 'answer' | 'end';
export function parseCallPush(value: unknown, now = Date.now()): CallPush | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.type !== 'call' || typeof p.callId !== 'string' || !/^[\w-]{1,128}$/.test(p.callId) ||
      typeof p.callUUID !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(p.callUUID) ||
      typeof p.recipientId !== 'string' || !/^\d+$/.test(p.recipientId) ||
      typeof p.callerName !== 'string' || !p.callerName.trim() ||
      typeof p.handle !== 'string' || !p.handle.trim() ||
      typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.expiresAt)) ||
      Date.parse(p.expiresAt) <= now) return null;
  return { ...p, callUUID: p.callUUID.toLowerCase(), hasVideo: p.hasVideo === true || p.hasVideo === 'true' } as CallPush;
}

// Serial generations prevent an old token refresh from restoring a disabled
// installation. All operations capture their authenticated request options.
export class RegistrationGeneration {
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  invalidate() { this.generation += 1; }
  capture() { const generation = this.generation; return () => generation === this.generation; }
  run<T>(operation: (current: () => boolean) => Promise<T>): Promise<T | undefined> {
    const generation = this.generation;
    const result = this.tail.then(() => generation === this.generation
      ? operation(() => generation === this.generation) : undefined);
    this.tail = result.catch(() => undefined);
    return result;
  }
}