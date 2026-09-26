export const IMAGE_PLAINTEXT_LIMIT = 5 * 1024 * 1024;
export const VIDEO_CIPHERTEXT_LIMIT = 25 * 1024 * 1024;
export const AES_GCM_TAG_BYTES = 16;

export function assertEncryptedAttachmentSize(kind: 'image' | 'video', plainBytes: number): void {
  if (!Number.isSafeInteger(plainBytes) || plainBytes <= 0) {
    throw new Error('Selected attachment is unavailable.');
  }
  if (kind === 'image' && plainBytes > IMAGE_PLAINTEXT_LIMIT) {
    throw new Error('Image exceeds the 5 MB encrypted image limit.');
  }
  if (kind === 'video' && plainBytes + AES_GCM_TAG_BYTES > VIDEO_CIPHERTEXT_LIMIT) {
    throw new Error('Compressed video exceeds the 25 MB encrypted upload limit. Choose a shorter video.');
  }
}

export function uploadFraction(loaded: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return 0;
  return Math.max(0, Math.min(1, loaded / total));
}

// Keep the native compressor's plaintext output on-device until the encrypted
// upload finishes. Dependencies are passed in so the native path can be tested
// without a device; callers must supply the real compressor/encryptor/filesystem.
export async function compressAndSendVideo<T>(
  uri: string,
  name: string,
  onProgress: ((fraction: number) => void) | undefined,
  services: {
    compress: (source: string, progress: (fraction: number) => void) => Promise<string>;
    encryptAndUpload: (source: string, name: string, progress: (fraction: number) => void) => Promise<T>;
    deleteFile: (source: string) => Promise<void>;
  },
): Promise<T> {
  onProgress?.(0);
  const compressed = await services.compress(uri, fraction => onProgress?.(uploadFraction(fraction, 1) * 0.3));
  // The compressor returns an absolute path on Android and a file URI on iOS.
  // Never hand a remote/content URI to the plaintext reader or delete the picked original.
  const compressedUri = compressed.startsWith('/')
    ? `file://${compressed}`
    : /^file:\/+/u.test(compressed)
      ? `file:///${compressed.replace(/^file:\/+/u, '')}`
      : null;
  if (!compressedUri) throw new Error('Video compression did not produce a local MP4 file.');
  const originalUri = uri.startsWith('/')
    ? `file://${uri}`
    : /^file:\/+/u.test(uri)
      ? `file:///${uri.replace(/^file:\/+/u, '')}`
      : uri;
  if (compressedUri === originalUri) throw new Error('Video compression did not produce a new MP4 file.');
  try {
    const mp4Name = name.replace(/\.[^.]+$/u, '') + '.mp4';
    return await services.encryptAndUpload(compressedUri, mp4Name,
      fraction => onProgress?.(0.3 + uploadFraction(fraction, 1) * 0.7));
  } finally {
    await services.deleteFile(compressedUri).catch(() => {});
  }
}