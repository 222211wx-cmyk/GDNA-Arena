import { apiDelete, apiGet, type AuthUser } from './api';

export type PublicJwk = JsonWebKey & { kty: 'RSA'; n: string; e: string };
export interface DeviceKey {
  userId: number;
  deviceId: string;
  publicKey: PublicJwk;
  fingerprint: string;
}
export interface SecureDevice {
  deviceId: string;
  fingerprint: string;
  updatedAt?: string;
}
export interface RoomKeys {
  keys: DeviceKey[];
  missingUserIds: number[];
}
export interface EncryptedAttachment {
  key: string;
  iv: string;
  mime: string;
  name: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'file';
}
export const MAX_ENCRYPTED_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type SecurePayload =
  | { kind: 'text'; text: string }
  | { kind: 'attachment'; attachment: EncryptedAttachment };
export interface CallSecretEnvelope {
  wrappedSecret: string;
  fingerprint: string;
}

const nativeOnly = (): never => {
  throw new Error('Secure AMIS messaging is available in the native iOS and Android app.');
};

export async function ensureDeviceIdentity(_user: AuthUser): Promise<DeviceKey> {
  return nativeOnly();
}
export async function enrollDeviceIdentity(_user: AuthUser): Promise<DeviceKey> {
  return nativeOnly();
}
export async function getCurrentDeviceId(_userId: number): Promise<string | null> {
  return null;
}
export async function getDevices(): Promise<{ devices: SecureDevice[] }> {
  const result = await apiGet<{ devices: { device_id: string; fingerprint: string; updated_at?: string }[] }>('/messages/e2e/devices');
  return {
    devices: result.devices.map(item => ({
      deviceId: item.device_id,
      fingerprint: item.fingerprint,
      updatedAt: item.updated_at,
    })),
  };
}
export async function revokeDevice(deviceId: string, _userId: number): Promise<void> {
  await apiDelete(`/messages/e2e/devices/${encodeURIComponent(deviceId)}`);
}
export const getRoomKeys = (roomId: number) =>
  apiGet<RoomKeys>(`/messages/rooms/${roomId}/e2e-keys`);
export async function encryptPayload(
  _payload: SecurePayload,
  _recipients: DeviceKey[],
): Promise<string> {
  return nativeOnly();
}
export async function decryptPayload(_content: string, _userId: number): Promise<SecurePayload> {
  return nativeOnly();
}
export async function encryptCallSecret(
  _secret: string,
  _recipient: DeviceKey,
): Promise<CallSecretEnvelope> {
  return nativeOnly();
}
export async function decryptCallSecret(
  _userId: number,
  _envelope: CallSecretEnvelope,
): Promise<string> {
  return nativeOnly();
}
export async function encryptAndUploadImage(
  _uri: string,
  _name: string,
  _mime: string,
  _size?: number,
  _roomId?: number,
  _onProgress?: (fraction: number) => void,
): Promise<{ fileUrl: string; metadata: EncryptedAttachment }> {
  return nativeOnly();
}
export async function encryptAndUploadVideo(
  _uri: string, _name: string, _roomId: number, _onProgress?: (fraction: number) => void,
): Promise<{ fileUrl: string; metadata: EncryptedAttachment }> {
  return nativeOnly();
}
export async function decryptVideoToLocalUri(
  _fileUrl: string, _metadata: EncryptedAttachment,
): Promise<string> {
  return nativeOnly();
}
export async function decryptAttachmentToDataUri(
  _fileUrl: string,
  _metadata: EncryptedAttachment,
): Promise<string> {
  return nativeOnly();
}
export async function withKeyRefreshRetry<T>(
  _operation: (keys: DeviceKey[]) => Promise<T>,
  _roomId: number,
): Promise<T> {
  return nativeOnly();
}