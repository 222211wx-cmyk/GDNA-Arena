import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Video } from 'react-native-compressor';
import { apiDelete, apiGet, apiPut, apiUpload, ApiError, getApiBase, getHeaders, type AuthUser } from './api';
import { assertNetworkOnline } from '@/contexts/OnlineContext';
import { assertEncryptedAttachmentSize, compressAndSendVideo, IMAGE_PLAINTEXT_LIMIT, VIDEO_CIPHERTEXT_LIMIT, AES_GCM_TAG_BYTES } from './attachment-policy';
import { nativeSubtle } from './native-crypto';

const PREFIX = 'e2e:v1:';
const DEVICE_KEY = 'gdna.e2e.device.v1';
const PRIVATE_KEY = 'gdna.e2e.private.v1';
const PUBLIC_KEY = 'gdna.e2e.public.v1';
const REVOKED_KEY = 'gdna.e2e.revoked.v1';
const scoped = (userId: number, key: string) => `${key}.${userId}`;

export type PublicJwk = JsonWebKey & { kty: 'RSA'; n: string; e: string };
export interface DeviceKey { userId: number; deviceId: string; publicKey: PublicJwk; fingerprint: string }
export interface SecureDevice { deviceId: string; fingerprint: string; updatedAt?: string }
export interface RoomKeys { keys: DeviceKey[]; missingUserIds: number[] }
export interface EncryptedAttachment {
  key: string;
  iv: string;
  mime: string;
  name: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'file';
}
export const MAX_ENCRYPTED_VIDEO_BYTES = VIDEO_CIPHERTEXT_LIMIT;
export const MAX_IMAGE_BYTES = IMAGE_PLAINTEXT_LIMIT;
export type SecurePayload =
  | { kind: 'text'; text: string }
  | { kind: 'attachment'; attachment: EncryptedAttachment };
export interface CallSecretEnvelope {
  wrappedSecret: string;
  fingerprint: string;
}

const subtle = () => {
  const value = nativeSubtle as unknown as SubtleCrypto | undefined;
  if (!value) throw new Error('Secure messaging requires the native cryptography module.');
  return value;
};
const asBuffer = (value: Uint8Array) =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: ArrayBuffer) => new TextDecoder().decode(value);
const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(value => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};
const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(value => { binary += String.fromCharCode(value); });
  return btoa(binary);
};
const base64UrlToBytes = (value: string) => {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url value.');
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new Error('Invalid base64url value.');
  }
};
const validUserId = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('A valid user id is required.');
};
const canonicalPublicKey = (value: unknown): PublicJwk => {
  if (!value || typeof value !== 'object') throw new Error('Invalid RSA public key.');
  const key = value as Record<string, unknown>;
  if (key.kty !== 'RSA' || typeof key.n !== 'string' || !key.n || typeof key.e !== 'string' || !key.e) {
    throw new Error('Invalid RSA public key.');
  }
  return { kty: 'RSA', n: key.n, e: key.e };
};
async function fingerprint(key: unknown) {
  const canonical = canonicalPublicKey(key);
  const digest = await subtle().digest('SHA-256', asBuffer(encode(JSON.stringify(canonical))));
  return bytesToBase64Url(new Uint8Array(digest));
}
const validAttachment = (value: unknown): value is EncryptedAttachment => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.key === 'string' && typeof item.iv === 'string' &&
    typeof item.mime === 'string' && typeof item.name === 'string' &&
    typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 &&
    (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' || item.kind === 'file');
};
const validPayload = (value: unknown): value is SecurePayload => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.kind === 'text' && typeof item.text === 'string') ||
    (item.kind === 'attachment' && validAttachment(item.attachment));
};

async function createIdentity(userId: number) {
  const pair = await subtle().generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  ) as CryptoKeyPair;
  const privateJwk = await subtle().exportKey('jwk', pair.privateKey);
  const publicJwk = canonicalPublicKey(await subtle().exportKey('jwk', pair.publicKey));
  const deviceId = bytesToBase64Url(Crypto.getRandomBytes(24));
  await Promise.all([
    SecureStore.setItemAsync(scoped(userId, DEVICE_KEY), deviceId),
    SecureStore.setItemAsync(scoped(userId, PRIVATE_KEY), JSON.stringify(privateJwk), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    SecureStore.setItemAsync(scoped(userId, PUBLIC_KEY), JSON.stringify(publicJwk), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  ]);
  return { deviceId, publicKey: publicJwk };
}

async function registerIdentity(user: AuthUser, allowEnrollment: boolean): Promise<DeviceKey> {
  validUserId(user.id);
  if (!allowEnrollment && await SecureStore.getItemAsync(scoped(user.id, REVOKED_KEY))) {
    throw new Error('This secure device was revoked. Enroll it explicitly to use secure messaging again.');
  }
  let deviceId = await SecureStore.getItemAsync(scoped(user.id, DEVICE_KEY));
  let publicText = await SecureStore.getItemAsync(scoped(user.id, PUBLIC_KEY));
  const privateText = await SecureStore.getItemAsync(scoped(user.id, PRIVATE_KEY));
  if (!deviceId || !publicText || !privateText) {
    const created = await createIdentity(user.id);
    deviceId = created.deviceId;
    publicText = JSON.stringify(created.publicKey);
  } else {
    const publicJwk = canonicalPublicKey(JSON.parse(publicText));
    await subtle().importKey('jwk', JSON.parse(privateText), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    publicText = JSON.stringify(publicJwk);
  }
  const publicKey = canonicalPublicKey(JSON.parse(publicText));
  const ownFingerprint = await fingerprint(publicKey);
  const registered = await apiPut<{ deviceId: string; publicKey: PublicJwk; fingerprint: string }, { deviceId: string; publicKey: PublicJwk }>(
    '/messages/e2e/key', { deviceId, publicKey },
  );
  if (registered.deviceId !== deviceId ||
      await fingerprint(registered.publicKey) !== ownFingerprint ||
      registered.fingerprint !== ownFingerprint) {
    throw new Error('The secure device registration response is invalid.');
  }
  return { userId: user.id, deviceId, publicKey, fingerprint: ownFingerprint };
}

export const ensureDeviceIdentity = (user: AuthUser) => registerIdentity(user, false);

export async function enrollDeviceIdentity(user: AuthUser): Promise<DeviceKey> {
  validUserId(user.id);
  await Promise.all([
    SecureStore.deleteItemAsync(scoped(user.id, REVOKED_KEY)),
    SecureStore.deleteItemAsync(scoped(user.id, DEVICE_KEY)),
    SecureStore.deleteItemAsync(scoped(user.id, PRIVATE_KEY)),
    SecureStore.deleteItemAsync(scoped(user.id, PUBLIC_KEY)),
  ]);
  return registerIdentity(user, true);
}

export async function getCurrentDeviceId(userId: number): Promise<string | null> {
  validUserId(userId);
  return SecureStore.getItemAsync(scoped(userId, DEVICE_KEY));
}

export async function getDevices(): Promise<{ devices: SecureDevice[] }> {
  const result = await apiGet<{ devices: { device_id: string; fingerprint: string; updated_at?: string }[] }>('/messages/e2e/devices');
  return { devices: result.devices.map(item => ({ deviceId: item.device_id, fingerprint: item.fingerprint, updatedAt: item.updated_at })) };
}

export async function revokeDevice(deviceId: string, userId: number): Promise<void> {
  validUserId(userId);
  await apiDelete(`/messages/e2e/devices/${deviceId}`);
  if (await getCurrentDeviceId(userId) === deviceId) {
    await Promise.all([
      SecureStore.deleteItemAsync(scoped(userId, DEVICE_KEY)),
      SecureStore.deleteItemAsync(scoped(userId, PRIVATE_KEY)),
      SecureStore.deleteItemAsync(scoped(userId, PUBLIC_KEY)),
      SecureStore.setItemAsync(scoped(userId, REVOKED_KEY), deviceId, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    ]);
  }
}

export const getRoomKeys = (roomId: number) => apiGet<RoomKeys>(`/messages/rooms/${roomId}/e2e-keys`);

export async function encryptPayload(payload: SecurePayload, recipients: DeviceKey[]): Promise<string> {
  if (!validPayload(payload)) throw new Error('Invalid secure message payload.');
  if (!recipients.length) throw new Error('At least one recipient is required.');
  const devices = new Set<string>();
  for (const recipient of recipients) {
    validUserId(recipient.userId);
    if (typeof recipient.deviceId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/u.test(recipient.deviceId)) {
      throw new Error('A valid recipient device id is required.');
    }
    const recipientDevice = `${recipient.userId}.${recipient.deviceId}`;
    if (devices.has(recipientDevice)) throw new Error('Duplicate recipient device id.');
    if (!recipient.fingerprint || recipient.fingerprint !== await fingerprint(recipient.publicKey)) {
      throw new Error('Recipient fingerprint does not match its public key.');
    }
    devices.add(recipientDevice);
  }
  const aes = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = Crypto.getRandomBytes(12);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, aes, asBuffer(encode(JSON.stringify(payload))));
  const rawKey = await subtle().exportKey('raw', aes);
  const entries = await Promise.all(recipients.map(async recipient => {
    let publicKey: CryptoKey;
    try {
      publicKey = await subtle().importKey('jwk', canonicalPublicKey(recipient.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    } catch {
      throw new Error('Invalid recipient RSA public key.');
    }
    const wrapped = await subtle().encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
    return [`${recipient.userId}.${recipient.deviceId}`, { wrappedKey: bytesToBase64Url(new Uint8Array(wrapped)), fingerprint: recipient.fingerprint }] as const;
  }));
  const envelope = { v: 1, alg: 'RSA-OAEP-256/A256GCM', iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), keys: Object.fromEntries(entries) };
  return PREFIX + bytesToBase64Url(encode(JSON.stringify(envelope)));
}

export async function decryptPayload(content: string, userId: number): Promise<SecurePayload> {
  validUserId(userId);
  if (typeof content !== 'string' || !content.startsWith(PREFIX)) throw new Error('Message is not encrypted.');
  const deviceId = await getCurrentDeviceId(userId);
  const [privateText, publicText] = await Promise.all([
    SecureStore.getItemAsync(scoped(userId, PRIVATE_KEY)),
    SecureStore.getItemAsync(scoped(userId, PUBLIC_KEY)),
  ]);
  if (!deviceId || !privateText || !publicText) throw new Error('No device identity exists for this user.');
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(decode(asBuffer(base64UrlToBytes(content.slice(PREFIX.length))))) as Record<string, unknown>;
  } catch {
    throw new Error('Malformed encrypted message.');
  }
  if (envelope.v !== 1 || envelope.alg !== 'RSA-OAEP-256/A256GCM' || typeof envelope.iv !== 'string' ||
      typeof envelope.ciphertext !== 'string' || !envelope.keys || typeof envelope.keys !== 'object' || Array.isArray(envelope.keys)) {
    throw new Error('Malformed encrypted message.');
  }
  const ownFingerprint = await fingerprint(JSON.parse(publicText));
  const entry = (envelope.keys as Record<string, unknown>)[`${userId}.${deviceId}`];
  if (!entry || typeof entry !== 'object') throw new Error('No encrypted message key exists for this device.');
  const fields = entry as Record<string, unknown>;
  if (typeof fields.wrappedKey !== 'string' || typeof fields.fingerprint !== 'string') throw new Error('Malformed encrypted message.');
  if (fields.fingerprint !== ownFingerprint) throw new Error('Encrypted message was addressed to a different device identity.');
  try {
    const privateKey = await subtle().importKey('jwk', JSON.parse(privateText), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const raw = await subtle().decrypt({ name: 'RSA-OAEP' }, privateKey, asBuffer(base64UrlToBytes(fields.wrappedKey)));
    const aes = await subtle().importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const clear = await subtle().decrypt(
      { name: 'AES-GCM', iv: asBuffer(base64UrlToBytes(envelope.iv)) },
      aes,
      asBuffer(base64UrlToBytes(envelope.ciphertext)),
    );
    const payload: unknown = JSON.parse(decode(clear));
    if (!validPayload(payload)) throw new Error('Decrypted message has an invalid payload.');
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === 'Decrypted message has an invalid payload.') throw error;
    throw new Error('Unable to decrypt encrypted message.');
  }
}

export async function encryptCallSecret(
  secret: string,
  recipient: DeviceKey,
): Promise<CallSecretEnvelope> {
  if (!secret) throw new Error('A call secret is required.');
  validUserId(recipient.userId);
  if (!recipient.fingerprint || recipient.fingerprint !== await fingerprint(recipient.publicKey)) {
    throw new Error('Recipient fingerprint does not match its public key.');
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await subtle().importKey(
      'jwk',
      canonicalPublicKey(recipient.publicKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
  } catch {
    throw new Error('Invalid recipient RSA public key.');
  }
  const wrapped = await subtle().encrypt({ name: 'RSA-OAEP' }, publicKey, asBuffer(encode(secret)));
  return {
    wrappedSecret: bytesToBase64Url(new Uint8Array(wrapped)),
    fingerprint: recipient.fingerprint,
  };
}

export async function decryptCallSecret(
  userId: number,
  envelope: CallSecretEnvelope,
): Promise<string> {
  validUserId(userId);
  if (!envelope || typeof envelope.wrappedSecret !== 'string' || typeof envelope.fingerprint !== 'string') {
    throw new Error('Malformed call secret envelope.');
  }
  const deviceId = await getCurrentDeviceId(userId);
  const [privateText, publicText] = await Promise.all([
    SecureStore.getItemAsync(scoped(userId, PRIVATE_KEY)),
    SecureStore.getItemAsync(scoped(userId, PUBLIC_KEY)),
  ]);
  if (!deviceId || !privateText || !publicText) throw new Error('No device identity exists for this user.');
  if (await fingerprint(JSON.parse(publicText)) !== envelope.fingerprint) {
    throw new Error('Call secret was addressed to a different device identity.');
  }
  try {
    const privateKey = await subtle().importKey(
      'jwk',
      JSON.parse(privateText),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    return decode(await subtle().decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      asBuffer(base64UrlToBytes(envelope.wrappedSecret)),
    ));
  } catch {
    throw new Error('Unable to decrypt call secret.');
  }
}

export async function encryptAndUploadImage(
  uri: string,
  name: string,
  mime: string,
  size?: number,
  roomId?: number,
  onProgress?: (fraction: number) => void,
): Promise<{ fileUrl: string; metadata: EncryptedAttachment }> {
  if (!mime.startsWith('image/')) throw new Error('Only image attachments are supported.');
  return encryptAndUploadAttachment(uri, name, mime, 'image', roomId, onProgress, size);
}

export async function encryptAndUploadVideo(
  uri: string,
  name: string,
  roomId: number,
  onProgress?: (fraction: number) => void,
): Promise<{ fileUrl: string; metadata: EncryptedAttachment }> {
  if (!Number.isSafeInteger(roomId) || roomId <= 0) throw new Error('A conversation is required for encrypted uploads.');
  return compressAndSendVideo(uri, name, onProgress, {
    compress: (source, progress) => Video.compress(
      source, { compressionMethod: 'manual', maxSize: 720, bitrate: 1_000_000, stripAudio: false }, progress,
    ),
    encryptAndUpload: (source, mp4Name, progress) =>
      encryptAndUploadAttachment(source, mp4Name, 'video/mp4', 'video', roomId, progress),
    deleteFile: source => FileSystem.deleteAsync(source, { idempotent: true }),
  });
}

async function encryptAndUploadAttachment(
  uri: string, name: string, mime: string, kind: 'image' | 'video',
  roomId?: number, onProgress?: (fraction: number) => void, size?: number,
): Promise<{ fileUrl: string; metadata: EncryptedAttachment }> {
  if (!Number.isSafeInteger(roomId) || !roomId || roomId <= 0) throw new Error('A conversation is required for encrypted uploads.');
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !info.size) throw new Error('Selected attachment is unavailable.');
  const limit = kind === 'image' ? MAX_IMAGE_BYTES + AES_GCM_TAG_BYTES : MAX_ENCRYPTED_VIDEO_BYTES;
  assertEncryptedAttachmentSize(kind, info.size);
  const source = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const plain = Uint8Array.from(atob(source), character => character.charCodeAt(0));
  assertEncryptedAttachmentSize(kind, plain.byteLength);
  const aes = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = Crypto.getRandomBytes(12);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, aes, asBuffer(plain));
  if (ciphertext.byteLength > limit) throw new Error('Encrypted attachment exceeds the upload limit.');
  onProgress?.(0.1);
  const encryptedUri = `${FileSystem.cacheDirectory}gdna-${Crypto.randomUUID()}.enc`;
  await FileSystem.writeAsStringAsync(encryptedUri, bytesToBase64(new Uint8Array(ciphertext)), { encoding: FileSystem.EncodingType.Base64 });
  try {
    const form = new FormData();
    form.append('file', { uri: encryptedUri, name: `${name.replace(/[^A-Za-z0-9._-]/g, '_')}.enc`, type: 'application/octet-stream' } as never);
    const uploaded = await apiUpload<{ url: string }>(
      `/messages/upload?roomId=${roomId}&kind=${kind}`, form,
      fraction => onProgress?.(0.1 + 0.9 * fraction),
    );
    return {
      fileUrl: uploaded.url,
      metadata: {
        key: bytesToBase64Url(new Uint8Array(await subtle().exportKey('raw', aes))),
        iv: bytesToBase64Url(iv),
        mime,
        name,
        size: kind === 'image' ? (size ?? plain.byteLength) : plain.byteLength,
        kind,
      },
    };
  } finally {
    await FileSystem.deleteAsync(encryptedUri, { idempotent: true });
  }
}

export async function decryptVideoToLocalUri(fileUrl: string, metadata: EncryptedAttachment): Promise<string> {
  if (metadata.kind !== 'video' || metadata.mime !== 'video/mp4' || !validAttachment(metadata)) {
    throw new Error('Invalid encrypted video metadata.');
  }
  assertNetworkOnline();
  const url = fileUrl.startsWith('/api/') ? `${getApiBase().replace(/\/api$/u, '')}${fileUrl}` : fileUrl;
  const basename = `${FileSystem.cacheDirectory}gdna-video-${Crypto.randomUUID()}`;
  const encryptedUri = `${basename}.enc`;
  const output = `${basename}.mp4`;
  try {
    const response = await FileSystem.downloadAsync(url, encryptedUri, { headers: getHeaders() });
    if (response.status !== 200) throw new Error(`Encrypted video download failed: ${response.status}`);
    const info = await FileSystem.getInfoAsync(encryptedUri);
    if (!info.exists || !info.size || info.size > MAX_ENCRYPTED_VIDEO_BYTES) {
      throw new Error('Encrypted video exceeds the 25 MB limit.');
    }
    const source = await FileSystem.readAsStringAsync(encryptedUri, { encoding: FileSystem.EncodingType.Base64 });
    const cipher = Uint8Array.from(atob(source), character => character.charCodeAt(0));
    let clear: ArrayBuffer;
    try {
      const aes = await subtle().importKey('raw', asBuffer(base64UrlToBytes(metadata.key)), 'AES-GCM', false, ['decrypt']);
      clear = await subtle().decrypt({ name: 'AES-GCM', iv: asBuffer(base64UrlToBytes(metadata.iv)) }, aes, asBuffer(cipher));
    } catch {
      throw new Error('Unable to decrypt encrypted video: authentication failed.');
    }
    await FileSystem.writeAsStringAsync(output, bytesToBase64(new Uint8Array(clear)), { encoding: FileSystem.EncodingType.Base64 });
    return output;
  } catch (error) {
    await FileSystem.deleteAsync(output, { idempotent: true }).catch(() => {});
    throw error instanceof Error ? error : new Error('Unable to decrypt video.');
  } finally {
    await FileSystem.deleteAsync(encryptedUri, { idempotent: true });
  }
}

export async function decryptAttachmentToDataUri(fileUrl: string, metadata: EncryptedAttachment): Promise<string> {
  if (!fileUrl || !validAttachment(metadata) || metadata.kind !== 'image') throw new Error('Invalid encrypted attachment metadata.');
  assertNetworkOnline();
  const url = fileUrl.startsWith('/api/') ? `${getApiBase().replace(/\/api$/u, '')}${fileUrl}` : fileUrl;
  const response = await fetch(url, { headers: getHeaders(), credentials: 'include' });
  if (!response.ok) throw new Error(`Encrypted attachment download failed: ${response.status}`);
  try {
    const aes = await subtle().importKey('raw', asBuffer(base64UrlToBytes(metadata.key)), 'AES-GCM', false, ['decrypt']);
    const clear = await subtle().decrypt(
      { name: 'AES-GCM', iv: asBuffer(base64UrlToBytes(metadata.iv)) },
      aes,
      await response.arrayBuffer(),
    );
    return `data:${metadata.mime};base64,${bytesToBase64(new Uint8Array(clear))}`;
  } catch {
    throw new Error('Unable to decrypt attachment.');
  }
}

export async function withKeyRefreshRetry<T>(operation: (keys: DeviceKey[]) => Promise<T>, roomId: number): Promise<T> {
  const load = async () => {
    const response = await getRoomKeys(roomId);
    if (!Array.isArray(response.missingUserIds)) throw new Error('Secure recipient status is unavailable.');
    if (response.missingUserIds.length) throw new Error(`Secure messaging is unavailable for user${response.missingUserIds.length === 1 ? '' : 's'} ${response.missingUserIds.join(', ')}.`);
    if (!Array.isArray(response.keys) || !response.keys.length) throw new Error('No secure devices are registered for this conversation.');
    return response.keys;
  };
  try {
    return await operation(await load());
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    return operation(await load());
  }
}
