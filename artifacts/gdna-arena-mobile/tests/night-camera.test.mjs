import test from 'node:test';
import assert from 'node:assert/strict';
import { NightCameraController } from '../.night-test-dist/night-camera-controller.js';

function setup(overrides = {}) {
  let handler;
  const calls = [];
  const engine = {
    registerEventHandler(value) { handler = value; return true; },
    unregisterEventHandler(value) { assert.equal(value, handler); calls.push('unregister'); return true; },
    isCameraTorchSupported() { return false; },
    setCameraTorchOn(value) { calls.push(['torch', value]); return 0; },
    setLowlightEnhanceOptions(value, options) { calls.push(['night', value, options]); return 0; },
    switchCamera() { calls.push('switch'); return 0; },
    ...overrides,
  };
  const controller = new NightCameraController(engine, () => {});
  return { controller, calls, capture: () => handler.onLocalVideoStateChanged(0, 1, 0), fail: () => handler.onLocalVideoStateChanged(0, 3, 8) };
}

test('waits for successful camera capture and rejects unsupported torch', () => {
  const x = setup();
  x.controller.setTorch(true);
  assert.match(x.controller.snapshot.error, /not capturing/);
  x.capture();
  x.controller.setTorch(true);
  assert.match(x.controller.snapshot.error, /not supported/);
  assert.deepEqual(x.calls, []);
  x.controller.dispose();
});

test('toggles night enhancement and torch only on confirmed Agora success', () => {
  const x = setup({ isCameraTorchSupported: () => true });
  x.capture();
  x.controller.setNight(true);
  x.controller.setTorch(true);
  assert.equal(x.controller.snapshot.nightEnabled, true);
  assert.equal(x.controller.snapshot.torchEnabled, true);
  x.controller.setNight(false);
  x.controller.setTorch(false);
  assert.equal(x.controller.snapshot.nightEnabled, false);
  assert.equal(x.controller.snapshot.torchEnabled, false);
  assert.deepEqual(x.calls, [
    ['night', true, { mode: 0, level: 1 }], ['torch', true],
    ['night', false, { mode: 0, level: 1 }], ['torch', false],
  ]);
  x.controller.dispose();
});

test('surfaces SDK errors without pretending the controls succeeded', () => {
  const x = setup({
    isCameraTorchSupported: () => true,
    setLowlightEnhanceOptions: () => -4,
    setCameraTorchOn: () => -7,
  });
  x.capture();
  x.controller.setNight(true);
  assert.match(x.controller.snapshot.error, /-4/);
  assert.equal(x.controller.snapshot.nightEnabled, false);
  x.controller.setTorch(true);
  assert.match(x.controller.snapshot.error, /-7/);
  assert.equal(x.controller.snapshot.torchEnabled, false);
  x.fail();
  assert.match(x.controller.snapshot.error, /Camera capture failed.*8/);
  x.controller.dispose();
});

test('switching cameras invalidates capability until next capture; dispose turns lights off', () => {
  let supports = true;
  const x = setup({ isCameraTorchSupported: () => supports });
  x.capture();
  x.controller.setTorch(true);
  x.controller.setNight(true);
  x.controller.switchCamera();
  assert.equal(x.controller.snapshot.ready, false);
  assert.equal(x.controller.snapshot.torchEnabled, false);
  supports = false;
  x.capture();
  assert.equal(x.controller.snapshot.torchSupported, false);
  x.controller.dispose();
  assert.deepEqual(x.calls, [
    ['torch', true], ['night', true, { mode: 0, level: 1 }],
    ['torch', false], 'switch', ['night', false, { mode: 0, level: 1 }], 'unregister',
  ]);
});