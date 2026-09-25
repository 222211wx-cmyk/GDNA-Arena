export async function pushEnabled(_userId: number): Promise<boolean> { return false; }
export async function enablePush(_userId: number): Promise<void> {
  throw new Error('Phone notifications are available only in the installed iOS or Android app.');
}
export async function disablePush(_userId: number): Promise<void> {}
export async function forgetPushOnLogout(_userId: number): Promise<void> {}
export async function refreshPushIfAllowed(_userId: number): Promise<void> {}
export function listenForPushTaps(_navigate: (path: string) => void): () => void { return () => {}; }