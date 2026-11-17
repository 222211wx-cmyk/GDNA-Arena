// Placeholder: original module is missing from the repository. Replace with the real implementation.
import { stub, type StubFn } from "./_stub";

export class CallRingtone {
  async enable(): Promise<boolean> { return false; }
  start(_ringing?: boolean | "incoming" | "ringback"): boolean { return false; }
  close(): void {}
  stop(): void {}
}
