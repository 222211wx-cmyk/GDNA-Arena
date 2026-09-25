export declare function pushEnabled(userId: number): Promise<boolean>;
export declare function enablePush(userId: number): Promise<void>;
export declare function disablePush(userId: number): Promise<void>;
export declare function forgetPushOnLogout(userId: number): Promise<void>;
export declare function refreshPushIfAllowed(userId: number): Promise<void>;
export declare function listenForPushTaps(navigate: (path: string) => void): () => void;