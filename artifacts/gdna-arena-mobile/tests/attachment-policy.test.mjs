import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertEncryptedAttachmentSize, IMAGE_PLAINTEXT_LIMIT,
  VIDEO_CIPHERTEXT_LIMIT, AES_GCM_TAG_BYTES, uploadFraction,
} from '../.attachment-test-dist/attachment-policy.js';

test('progress is bounded and tracks actual bytes uploaded', () => {
  assert.equal(uploadFraction(1, 4), 0.25);
  assert.equal(uploadFraction(8, 4), 1);
  assert.equal(uploadFraction(-2, 4), 0);
  assert.equal(uploadFraction(1, 0), 0);
});

test('preflight counts AES-GCM authentication tag in encrypted video, not image plaintext', () => {
  assert.doesNotThrow(() => assertEncryptedAttachmentSize('video', VIDEO_CIPHERTEXT_LIMIT - AES_GCM_TAG_BYTES));
  assert.throws(() => assertEncryptedAttachmentSize('video', VIDEO_CIPHERTEXT_LIMIT - AES_GCM_TAG_BYTES + 1), /25 MB/);
  assert.doesNotThrow(() => assertEncryptedAttachmentSize('image', IMAGE_PLAINTEXT_LIMIT));
  assert.throws(() => assertEncryptedAttachmentSize('image', IMAGE_PLAINTEXT_LIMIT + 1), /5 MB/);
  assert.throws(() => assertEncryptedAttachmentSize('video', 0), /unavailable/);
});