export type PhoneRecoveryPlatform = 'android' | 'website' | 'unsupported';

export interface PhoneRecoverySession {
  send(phone: string, onAutomaticallyVerified: () => void): Promise<void>;
  submit<T>(code: string, consumeProof: (idToken: string) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export declare function phoneRecoveryPlatform(): PhoneRecoveryPlatform;
export declare function createPhoneRecoverySession(expectedProjectId: string): Promise<PhoneRecoverySession>;
