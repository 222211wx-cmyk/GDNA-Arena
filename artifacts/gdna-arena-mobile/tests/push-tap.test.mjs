import assert from 'node:assert/strict';
import test from 'node:test';
import { createPushTapGuard, resolvePushTap } from '../.push-tap-test-dist/push-tap.js';

const verifyRoom = async id => { if (id !== '12') throw new Error('Forbidden'); };
const verifyCall = async id => id === 'live';
const verifyGroupCall = async (id, room) => id === 'live' && room === 12;

test('notification tap cannot cross accounts or open a forbidden room', async () => {
  assert.equal(await resolvePushTap({ type: 'message', recipientId: '8', roomId: '12' }, 9, verifyRoom, verifyCall, verifyGroupCall), null);
  await assert.rejects(resolvePushTap({ type: 'message', recipientId: '9', roomId: '11' }, 9, verifyRoom, verifyCall, verifyGroupCall), /Forbidden/);
  assert.equal(await resolvePushTap({ type: 'message', recipientId: '9', roomId: '../12' }, 9, verifyRoom, verifyCall, verifyGroupCall), null);
  assert.equal(await resolvePushTap({ type: 'message', recipientId: '9', roomId: '12' }, 9, verifyRoom, verifyCall, verifyGroupCall), '/conversation/12');
});

test('terminal and malformed call alerts never navigate or auto-answer', async () => {
  assert.equal(await resolvePushTap({ type: 'call', recipientId: '9', callId: 'ended' }, 9, verifyRoom, verifyCall, verifyGroupCall), null);
  assert.equal(await resolvePushTap({ type: 'call', recipientId: '9', callId: '../live' }, 9, verifyRoom, verifyCall, verifyGroupCall), null);
  assert.equal(await resolvePushTap({ type: 'group-call', recipientId: '9', callId: 'ended', roomId: '12' }, 9, verifyRoom, verifyCall, verifyGroupCall), null);
  assert.equal(await resolvePushTap({ type: 'call', recipientId: '9', callId: 'live' }, 9, verifyRoom, verifyCall, verifyGroupCall), '/(tabs)/amis?section=Calls');
});

test('cold-start and live tap callbacks consume one notification only once', async () => {
  const guarded = createPushTapGuard();
  let complete;
  let checks = 0;
  const first = guarded('same-id', async () => {
    checks++;
    await new Promise(resolve => { complete = resolve; });
    return '/conversation/12';
  });
  assert.equal(await guarded('same-id', async () => { checks++; return '/conversation/12'; }), null);
  complete();
  assert.equal(await first, '/conversation/12');
  assert.equal(await guarded('same-id', async () => { checks++; return '/conversation/12'; }), null);
  assert.equal(checks, 1);
  await assert.rejects(guarded('offline-id', async () => { throw new Error('Offline'); }), /Offline/);
  assert.equal(await guarded('offline-id', async () => '/conversation/12'), '/conversation/12');
});