export const callSetupError = () => 'Locked-screen calls require an installed native build.';
export async function nativeCallsEnabled(_id: number): Promise<boolean> { return false; }
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
export async function prepareAndroidCall(_callId: string, _peer: string, _incoming: boolean) {}
export async function startAndroidCallAudio(_callId: string) {}
export async function endAndroidCall(_callId: string) {}