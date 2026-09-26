export const callSetupError = () => 'Locked-screen calls require an installed native build.';
export class FullScreenIntentAccessError extends Error {}
export async function canUseFullScreenIntent() { return false; }
export async function openFullScreenIntentSettings() { throw new FullScreenIntentAccessError(callSetupError()); }
export function recordCallSetupError(_error: unknown) {}
export async function enableNativeCalls(_id: number) { throw new Error(callSetupError()); }
export async function disableNativeCalls(_id: number) {}
export async function refreshNativeCalls(_id: number) {}
export function resetCallAccount() {}
export function bindCallController(_id: number, _controller: unknown, _navigate: () => void): () => void { return () => {}; }
export async function waitForCallAudio() {}
export function hasNativeCallAudio() { return false; }
export async function prepareCallAnswer(_callId: string) {}