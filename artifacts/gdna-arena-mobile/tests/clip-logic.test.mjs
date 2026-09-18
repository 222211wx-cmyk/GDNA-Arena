import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClipCode,
  playbackSnapshot,
  retryAfterMilliseconds,
  shouldApplyReplacement,
  withPlaybackIntent,
  withPlaybackPosition,
} from '../.clip-test-dist/clip-logic.js';

test('accepts canonical codes and HTTPS clip share links', () => {
  assert.equal(parseClipCode(' helx-123456 '), 'HELX-123456');
  assert.equal(parseClipCode('https://helixly.app/clip/HELX-654321'), 'HELX-654321');
  assert.equal(parseClipCode('https://example.test/base/clip/helx-000001?share=1'), 'HELX-000001');
});

test('rejects malformed codes, insecure links, and misleading paths', () => {
  assert.equal(parseClipCode('HELX-12345'), null);
  assert.equal(parseClipCode('http://helixly.app/clip/HELX-123456'), null);
  assert.equal(parseClipCode('https://user@example.test/clip/HELX-123456'), null);
  assert.equal(parseClipCode('https://example.test/notclip/HELX-123456'), null);
});

test('recovery snapshots preserve play intent and clamp position', () => {
  assert.deepEqual(playbackSnapshot(91.5, true, 120), { position: 91.5, shouldPlay: true });
  assert.deepEqual(playbackSnapshot(130, false, 120), { position: 120, shouldPlay: false });
  assert.deepEqual(playbackSnapshot(Number.NaN, true), { position: 0, shouldPlay: true });
  const pausedDuringRecovery = withPlaybackIntent(playbackSnapshot(91.5, true, 120), false);
  assert.deepEqual(withPlaybackPosition(pausedDuringRecovery, 30, 120), {
    position: 30,
    shouldPlay: false,
  });
});

test('only applies a replacement belonging to the current operation and source', () => {
  const currentUrl = 'https://storage.googleapis.com/clip?signature=new';
  assert.equal(shouldApplyReplacement(8, 8, currentUrl, currentUrl), true);
  assert.equal(shouldApplyReplacement(8, 7, currentUrl, currentUrl), false);
  assert.equal(
    shouldApplyReplacement(8, 8, 'https://storage.googleapis.com/clip?signature=old', currentUrl),
    false,
  );
});

test('honors numeric Retry-After while applying safe bounds', () => {
  assert.equal(retryAfterMilliseconds('2'), 2_000);
  assert.equal(retryAfterMilliseconds('999'), 30_000);
  assert.equal(retryAfterMilliseconds('invalid'), 2_000);
});