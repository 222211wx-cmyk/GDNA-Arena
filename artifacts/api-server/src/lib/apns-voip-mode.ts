// No Apple Developer provisioning is available for this project. Real APNs
// delivery must be explicitly enabled; mock never means provider acceptance.
export function isApnsVoipMock(): boolean {
  return process.env.APNS_VOIP_MODE?.trim().toLowerCase() !== "live";
}