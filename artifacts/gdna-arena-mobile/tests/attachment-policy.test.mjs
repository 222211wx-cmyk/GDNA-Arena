import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertEncryptedAttachmentSize, IMAGE_PLAINTEXT_LIMIT,
  VIDEO_CIPHERTEXT_LIMIT, AES_GCM_TAG_BYTES, uploadFraction, compressAndSendVideo,
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

test('Android content picker video is compressed locally, encrypted, uploaded and temporary output removed', async () => {
  const calls = [];
  const progress = [];
  const result = await compressAndSendVideo('content://media/external/video/12', 'holiday.mov',
    fraction => progress.push(fraction), {
      compress: async (source, notify) => {
        calls.push(['compress', source]);
        notify(0.5);
        notify(1);
        return '/data/user/0/app/cache/compressed.mp4';
      },
      encryptAndUpload: async (source, name, notify) => {
        calls.push(['encryptAndUpload', source, name]);
        notify(0.5);
        notify(1);
        return { fileUrl: '/api/messages/attachment/1' };
      },
      deleteFile: async source => { calls.push(['deleteFile', source]); },
    });
  assert.deepEqual(result, { fileUrl: '/api/messages/attachment/1' });
  assert.deepEqual(calls, [
    ['compress', 'content://media/external/video/12'],
    ['encryptAndUpload', 'file:///data/user/0/app/cache/compressed.mp4', 'holiday.mp4'],
    ['deleteFile', 'file:///data/user/0/app/cache/compressed.mp4'],
  ]);
  assert.deepEqual(progress.map(value => Math.round(value * 100)), [0, 15, 30, 65, 100]);
});

test('failed encrypted upload removes only compressed file and propagates the error', async () => {
  const removed = [];
  await assert.rejects(compressAndSendVideo('file:///photos/original.mov', 'original.mov', undefined, {
    compress: async () => 'file:///cache/compressed.mp4',
    encryptAndUpload: async () => { throw new Error('Upload rejected'); },
    deleteFile: async source => { removed.push(source); },
  }), /Upload rejected/);
  assert.deepEqual(removed, ['file:///cache/compressed.mp4']);
});

test('oversize compressed video cannot upload and its temporary file is removed', async () => {
  const removed = [];
  let uploaded = false;
  await assert.rejects(compressAndSendVideo('content://media/external/video/12', 'large.mov', undefined, {
    compress: async () => '/cache/large.mp4',
    encryptAndUpload: async () => {
      assertEncryptedAttachmentSize('video', VIDEO_CIPHERTEXT_LIMIT - AES_GCM_TAG_BYTES + 1);
      uploaded = true;
    },
    deleteFile: async source => { removed.push(source); },
  }), /25 MB/);
  assert.equal(uploaded, false);
  assert.deepEqual(removed, ['file:///cache/large.mp4']);
});

test('compression failure, unchanged original, and nonlocal output never start an upload or delete picked media', async () => {
  let uploaded = 0;
  let deleted = 0;
  for (const compress of [
    async () => { throw new Error('Codec unavailable'); },
    async () => '/photos/original.mov',
    async () => 'https://example.com/video.mp4',
    async () => 'content://media/external/video/12',
  ]) {
    await assert.rejects(compressAndSendVideo('file:///photos/original.mov', 'original.mov', undefined, {
      compress,
      encryptAndUpload: async () => { uploaded++; },
      deleteFile: async () => { deleted++; },
    }), /Codec unavailable|did not produce/);
  }
  assert.equal(uploaded, 0);
  assert.equal(deleted, 0);
});

test('cleanup failure does not obscure an otherwise successful encrypted upload', async () => {
  const result = await compressAndSendVideo('file:///original.mov', 'original.mov', undefined, {
    compress: async () => 'file:///cache/output.mp4',
    encryptAndUpload: async () => 'uploaded',
    deleteFile: async () => { throw new Error('Cache file already removed'); },
  });
  assert.equal(result, 'uploaded');
});