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