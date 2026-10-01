import type { PhoneRecoveryPlatform, PhoneRecoverySession } from './phone-recovery';

// Metro selects this file for browser exports; no native Firebase import belongs
// here. The mobile browser façade hands off to the main website's reCAPTCHA flow.
export function phoneRecoveryPlatform(): PhoneRecoveryPlatform {
  return 'website';
}

export async function createPhoneRecoverySession(_expectedProjectId: string): Promise<PhoneRecoverySession> {
  throw new Error('Continue on the website to verify your phone using browser SMS recovery.');
}