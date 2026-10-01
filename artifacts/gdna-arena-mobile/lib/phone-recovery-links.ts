export function recoveryWebsiteUrl(route: '/recover-account' | '/recovery-phone'): string {
  const configured = process.env.EXPO_PUBLIC_WEB_ORIGIN
    ?? process.env.EXPO_PUBLIC_DOMAIN
    ?? process.env.EXPO_PUBLIC_API_ORIGIN;
  if (!configured) {
    throw new Error('Website address is missing. Configure EXPO_PUBLIC_WEB_ORIGIN or EXPO_PUBLIC_DOMAIN before using browser recovery.');
  }
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(configured) ? configured : `https://${configured}`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && __DEV__ && url.protocol === 'http:'))
    || (local && !__DEV__) || url.username || url.password || url.search || url.hash) {
    throw new Error('Website address must be a valid public HTTPS origin without credentials, query, or fragment.');
  }
  // The main website owns these root routes, not the mobile preview path.
  return new URL(route, url.origin).toString();
}

export function phoneRecoveryErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/invalid-phone-number|missing-phone-number/.test(code)) return 'Enter a valid phone number with its country calling code, for example +212…';
  if (/invalid-verification-code|missing-verification-code/.test(code)) return 'The SMS code is incorrect. Request a new code and try again.';
  if (/session-expired|invalid-verification-id|code-expired/.test(code)) return 'This SMS verification expired. Request a new code.';
  if (/operation-not-allowed/.test(code)) return 'Firebase phone sign-in is unavailable. The project owner must enable the Phone provider and permitted SMS regions.';
  if (/quota-exceeded|too-many-requests|billing-not-enabled/.test(code)) return 'SMS requests are temporarily unavailable or limited. Wait before retrying; Firebase billing, quota, and SMS-region settings may need attention.';
  if (/app-not-authorized|invalid-app-credential|missing-app-credential|captcha|invalid-api-key/.test(code)) {
    return 'Android phone verification could not validate this app. The owner must check Firebase app registration, signing SHA fingerprints, and reCAPTCHA/Play Integrity setup.';
  }
  if (/network-request-failed/.test(code)) return 'Phone verification could not connect. Check your connection and request a new code.';
  if (code.startsWith('auth/')) return `Phone verification failed (${code}). Request a new code or contact support.`;
  if (error instanceof Error && /RNFBAuth|RNFBApp|native module/i.test(error.message)) {
    return 'SMS recovery requires a rebuilt Android app containing Firebase Auth. This installed build does not have the required native module.';
  }
  return error instanceof Error ? error.message : 'Phone recovery failed. Please try again.';
}

export function recoveryPasswordValid(password: string): boolean {
  let bytes = 0;
  for (const character of password) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return password.length >= 6 && bytes <= 72;
}