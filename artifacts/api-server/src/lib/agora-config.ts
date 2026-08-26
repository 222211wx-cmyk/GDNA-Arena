const AGORA_HEX_ID = /^[a-f0-9]{32}$/i;

export interface AgoraServerConfig {
  appId: string;
  certificate: string;
}

export interface AgoraConfigStatus {
  appIdConfigured: boolean;
  appIdValid: boolean;
  certificateConfigured: boolean;
  certificateValid: boolean;
  ready: boolean;
}

/**
 * Read Agora configuration at request time rather than module-import time.
 * Replit injects production secrets into process.env; avoiding a module-level
 * snapshot means token requests never use a value captured before injection.
 */
export function readAgoraServerConfig(): AgoraServerConfig | null {
  const appId = process.env.AGORA_APP_ID?.trim() ?? "";
  const certificate = process.env.AGORA_APP_CERTIFICATE?.trim() ?? "";

  if (!AGORA_HEX_ID.test(appId) || !AGORA_HEX_ID.test(certificate)) {
    return null;
  }

  return { appId, certificate };
}

export function getAgoraConfigStatus(): AgoraConfigStatus {
  const appId = process.env.AGORA_APP_ID?.trim() ?? "";
  const certificate = process.env.AGORA_APP_CERTIFICATE?.trim() ?? "";
  const appIdValid = AGORA_HEX_ID.test(appId);
  const certificateValid = AGORA_HEX_ID.test(certificate);

  return {
    appIdConfigured: appId.length > 0,
    appIdValid,
    certificateConfigured: certificate.length > 0,
    certificateValid,
    ready: appIdValid && certificateValid,
  };
}