export const DEFERRED_WEBRTC_TRANSPORT = { provider: "webrtc", version: 1 } as const;

export function isDeferredWebRtcTransport(value: unknown, deferredMedia: unknown): boolean {
  if (!value || typeof value !== "object" || deferredMedia !== true) return false;
  const transport = value as { provider?: unknown; version?: unknown };
  return transport.provider === DEFERRED_WEBRTC_TRANSPORT.provider &&
    transport.version === DEFERRED_WEBRTC_TRANSPORT.version;
}

/**
 * Provides a cancellation boundary around asynchronous TURN config loading.
 * The continuation is never invoked after cancellation, so it cannot request
 * media, construct a peer connection, or produce SDP for a cancelled call.
 */
export async function afterDeferredConfig<T>(
  isCurrent: () => boolean,
  loadConfig: () => Promise<T>,
  continueSetup: (config: T, isCurrent: () => boolean) => Promise<void>,
): Promise<boolean> {
  const config = await loadConfig();
  if (!isCurrent()) return false;
  await continueSetup(config, isCurrent);
  return isCurrent();
}

export async function loadDeferredConfig<T>(
  isCurrent: () => boolean,
  loadConfig: () => Promise<T>,
): Promise<T | null> {
  const config = await loadConfig();
  return isCurrent() ? config : null;
}