export declare function callSetupError(): string | null;
export declare function recordCallSetupError(error: unknown): void;
export declare class FullScreenIntentAccessError extends Error {}
export declare function canUseFullScreenIntent(): Promise<boolean>;
export declare function openFullScreenIntentSettings(): Promise<void>;
export declare function enableNativeCalls(id: number): Promise<void>;
export declare function disableNativeCalls(id: number): Promise<void>;
export declare function refreshNativeCalls(id: number): Promise<void>;
export declare function resetCallAccount(): void;
export declare function bindCallController(id: number, controller: {
  call: { callId: string; phase: string } | null;
  answer: () => Promise<void>; reject: () => void; end: () => void;
}, navigate: () => void): () => void;
export declare function waitForCallAudio(): Promise<void>;
export declare function hasNativeCallAudio(): boolean;
export declare function prepareCallAnswer(callId: string): Promise<void>;
export declare function prepareAndroidCall(callId: string, peer: string, incoming: boolean): Promise<void>;
export declare function startAndroidCallAudio(callId: string): Promise<void>;
export declare function endAndroidCall(callId: string): Promise<void>;