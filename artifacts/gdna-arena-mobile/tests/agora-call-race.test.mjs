import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { build } = createRequire(path.join(root, '../api-server/package.json'))('esbuild');
const dir = await mkdtemp(path.join(os.tmpdir(), 'agora-race-'));
const mock = path.join(dir, 'mock.mjs');
await writeFile(mock, `
export const useCallback = fn => fn;
export const useRef = value => ({ current: value });
export const useEffect = fn => { globalThis.__agoraRace.effects.push(fn()); };
export const useState = value => [value, next => {
  globalThis.__agoraRace.state.push(next);
}];
export const useQueryClient = () => ({ invalidateQueries() {} });
export const AppState = { addEventListener: () => ({ remove() {} }) };
export const PermissionsAndroid = {};
export const Platform = { OS: 'ios' };
export const getRandomBytes = length => Uint8Array.from({ length }, (_, i) =>
  (i + ++globalThis.__agoraRace.random) % 256);
export const subtle = { digest: () => globalThis.__agoraRace.digest() };
export const ChannelProfileType = { ChannelProfileCommunication: 1 };
export const ConnectionStateType = { ConnectionStateReconnecting: 1, ConnectionStateConnected: 2, ConnectionStateFailed: 3 };
export const EncryptionMode = { Aes256Gcm2: 1 };
export const RtcSurfaceView = () => null;
export const createAgoraRtcEngine = () => globalThis.__agoraRace.createEngine();
export class ApiError extends Error { constructor(status) { super('API error'); this.status = status; } }
export const apiGet = path => globalThis.__agoraRace.apiGet(path);
export const apiPost = async () => ({});
export const createAuthenticatedWebSocket = () => {
  const ws = { readyState: 1, sent: [], send(value) { this.sent.push(JSON.parse(value)); },
    close() { this.readyState = 3; } };
  globalThis.__agoraRace.ws = ws;
  return ws;
};
export const assertNetworkOnline = () => {};
export const useOnline = () => ({ isOnline: true });
export const decryptCallSecret = async () => 'secret';
export const encryptCallSecret = async () => ({ wrappedSecret: 'wrapped', fingerprint: 'fingerprint' });
export const ensureDeviceIdentity = async () => ({ deviceId: 'device' });
export const dismissCallAlert = async () => {};
export const attachNightCamera = (_engine, callId) => { globalThis.__agoraRace.attaches.push(callId); };
export const detachNightCamera = () => {};
export const getItemAsync = async () => null;
export const setItemAsync = async () => {};
`);
const outfile = path.join(dir, 'agora-calls.mjs');
await build({
  entryPoints: [path.join(root, 'lib/agora-calls.tsx')],
  outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'race-dependencies', setup(plugin) {
    plugin.onResolve({ filter: /^(react|@tanstack\/react-query|react-native|expo-crypto|expo-secure-store|react-native-quick-crypto|react-native-agora|\.\/api|@\/contexts\/OnlineContext|\.\/e2e|\.\/native-push.native|\.\/night-camera)$/ },
      () => ({ path: mock, external: true }));
  } }],
});
const { useAgoraCalls } = await import(pathToFileURL(outfile).href);
globalThis.WebSocket = class { static OPEN = 1; };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function setup() {
  const race = {
    effects: [], state: [], random: 0, attaches: [], engines: [],
    token: deferred(), digestGate: deferred(),
    apiGet(path) {
      if (path.startsWith('/agora/token')) return this.token.promise;
      return Promise.resolve({ keys: [{ deviceId: 'device' }] });
    },
    digest() { return this.digestGate.promise; },
    createEngine() {
      const engine = {
        released: 0, joined: 0,
        initialize() {}, registerEventHandler(handler) { this.handler = handler; },
        enableEncryption() { return 0; }, enableAudio() {}, enableVideo() {},
        startPreview() {}, stopPreview() {}, leaveChannel() {},
        joinChannel() { this.joined++; return 0; },
        release() { this.released++; },
      };
      this.engines.push(engine);
      return engine;
    },
  };
  globalThis.__agoraRace = race;
  const hook = useAgoraCalls({ id: 77, username: 'caller' }, () => {});
  await tick();
  assert.ok(race.ws, 'authenticated signaling socket was created');
  const dial = async () => {
    const started = hook.start('callee', true);
    await tick();
    const offer = race.ws.sent.filter(item => item.type === 'call-offer').at(-1);
    assert.ok(offer, 'call offer was submitted');
    race.ws.onmessage({ data: JSON.stringify({ type: 'call-ready', callId: offer.callId }) });
    await started;
    return offer.callId;
  };
  return { race, hook, dial };
}

test('ending during token request cannot create an engine for a subsequent call', async () => {
  const { race, hook, dial } = await setup();
  const oldId = await dial();
  hook.end();
  await dial();
  race.token.resolve({ appId: 'app', token: 'token', uid: 1 });
  await tick();
  assert.equal(race.engines.length, 1, 'only the new call may create an engine');
  assert.equal(race.engines[0].released, 0);
  assert.equal(race.ws.sent.some(item => item.type === 'call-end' && item.callId === oldId), true);
  hook.end();
});

test('ending during digest releases old engine and stale events cannot end the new call', async () => {
  const { race, hook, dial } = await setup();
  const oldId = await dial();
  race.token.resolve({ appId: 'app', token: 'token', uid: 1 });
  await tick();
  const oldEngine = race.engines[0];
  assert.ok(oldEngine?.handler, 'digest pending after old engine initialization');
  hook.end();
  await dial();
  race.digestGate.resolve(new Uint8Array(32).buffer);
  await tick();
  assert.equal(oldEngine.joined, 0);
  assert.equal(oldEngine.released, 1);
  assert.equal(race.attaches.includes(oldId), false, 'stale video call cannot attach camera');
  oldEngine.handler.onError(1, 'stale engine error');
  await tick();
  assert.equal(race.ws.sent.filter(item => item.type === 'call-end').length, 1,
    'old callback must not terminate the new call');
  hook.end();
});