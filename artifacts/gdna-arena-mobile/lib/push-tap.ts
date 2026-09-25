export type PushTap = Record<string, unknown>;

export function createPushTapGuard() {
  const inProgress = new Set<string>();
  const consumed = new Set<string>();
  return async (identifier: string, resolve: () => Promise<string | null>): Promise<string | null> => {
    if (inProgress.has(identifier) || consumed.has(identifier)) return null;
    inProgress.add(identifier);
    try {
      const route = await resolve();
      consumed.add(identifier);
      // Notification requests are finite but keep the in-memory set bounded.
      if (consumed.size > 100) consumed.delete(consumed.values().next().value!);
      return route;
    } finally {
      inProgress.delete(identifier);
    }
  };
}

export async function resolvePushTap(
  data: PushTap,
  accountId: number,
  verifyRoom: (roomId: string) => Promise<void>,
  verifyCall: (callId: string) => Promise<boolean>,
  verifyGroupCall: (callId: string, roomId: number) => Promise<boolean>,
): Promise<string | null> {
  if (data.recipientId !== String(accountId)) return null;
  if (data.type === 'message' && typeof data.roomId === 'string' &&
    /^[1-9]\d{0,14}$/.test(data.roomId) && Number.isSafeInteger(Number(data.roomId))) {
    await verifyRoom(data.roomId);
    return `/conversation/${data.roomId}`;
  }
  if (data.type === 'call' && typeof data.callId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(data.callId) && await verifyCall(data.callId))
    return '/(tabs)/amis?section=Calls';
  if (data.type === 'group-call' && typeof data.callId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(data.callId) && typeof data.roomId === 'string' &&
    /^[1-9]\d{0,14}$/.test(data.roomId) && Number.isSafeInteger(Number(data.roomId))) {
    await verifyRoom(data.roomId);
    if (await verifyGroupCall(data.callId, Number(data.roomId))) return '/(tabs)/amis?section=Calls';
  }
  return null;
}