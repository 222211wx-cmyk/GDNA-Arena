const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function harness(identity = async user => ({ deviceId: `device-${user.id}` })) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let pending = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value;
      }];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!effects[index] || !same(effects[index].deps, deps)) pending.push({ index, callback, deps });
    },
  };
  const sockets = [];
  const posts = [];
  const secureStore = new Map();
  class Socket {
    static OPEN = 1;
    readyState = Socket.OPEN;
    sent = [];
    closed = false;
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.closed = true; }
    message(value) { this.onmessage({ data: JSON.stringify(value) }); }
  }
  class ApiError extends Error {}
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx: () => null },
    '@tanstack/react-query': { useQueryClient: () => queryClient },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, PermissionsAndroid: {} },
    'expo-crypto': { getRandomBytes: length => new Uint8Array(length).fill(7) },
    'expo-secure-store': {
      getItemAsync: async key => secureStore.get(key) ?? null,
      setItemAsync: async (key, value) => { secureStore.set(key, value); },
    },
    './native-push.native': { dismissCallAlert: async () => {} },
    './native-crypto': { nativeSubtle: {} },
    'react-native-agora': {},
    './call-service': {
      prepareAndroidCall: async () => {}, endAndroidCall: async () => {},
      startAndroidCallAudio: async () => {}, prepareCallAnswer: async () => {},
      waitForCallAudio: async () => {}, hasNativeCallAudio: () => false,
    },
    './night-camera': { detachNightCamera() {} },
    './api': {
      ApiError,
      apiGet: async () => ({ keys: [{ deviceId: 'peer-device' }] }),
      apiPost: async (url, body) => { posts.push({ url, body }); },
      createAuthenticatedWebSocket: () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
    },
    '@/contexts/OnlineContext': { useOnline: () => ({ isOnline: true }), assertNetworkOnline() {} },
    './e2e': { ensureDeviceIdentity: identity, encryptCallSecret: async () => ({ wrappedSecret: 'encrypted', fingerprint: 'fingerprint' }) },
  };
  const queryClient = { invalidateQueries: async () => {} };
  const source = fs.readFileSync(path.join(__dirname, '../lib/agora-calls.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
    console, Date, Map, Set, Promise, Error, Uint8Array, TextEncoder, btoa, WebSocket: Socket,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  });
  let result;
  function render(user) {
    cursor = 0;
    pending = [];
    result = module.exports.useAgoraCalls(user, onIncoming);
    for (const { index, callback, deps } of pending) {
      effects[index]?.cleanup?.();
      effects[index] = { deps, cleanup: callback() };
    }
    return result;
  }
  const onIncoming = () => {};
  function cleanup() {
    for (const effect of effects) effect?.cleanup?.();
  }
  return { render, cleanup, sockets, posts };
}

test('cleaned-up effect cannot open a socket when old identity resolves after a new account connects', async () => {
  const old = deferred();
  const h = harness(user => user.id === 1 ? old.promise : Promise.resolve({ deviceId: 'device-2' }));
  h.render({ id: 1, username: 'old' });
  assert.equal(h.sockets.length, 0);
  h.render({ id: 2, username: 'new' });
  await settle();
  assert.equal(h.sockets.length, 1);
  h.sockets[0].onopen();
  assert.deepEqual(h.sockets[0].sent[0], { type: 'register', userId: 2, username: 'new', deviceId: 'device-2' });
  old.resolve({ deviceId: 'device-1' });
  await settle();
  assert.equal(h.sockets.length, 1, 'obsolete connect must never construct another socket');
  assert.equal(h.sockets[0].closed, false);
  h.cleanup();
});

test('server type:error displays its message and ends an outgoing call waiting for call-ready', async () => {
  const h = harness();
  const user = { id: 42, username: 'caller' };
  h.render(user);
  await settle();
  const socket = h.sockets[0];
  socket.onopen();
  const starting = h.render(user).start('recipient', false);
  let earlyFailure;
  void starting.catch(cause => { earlyFailure = cause; });
  await settle();
  const offer = socket.sent.find(message => message.type === 'call-offer');
  assert.ok(offer, `outgoing call should be pending on signaling; sent=${JSON.stringify(socket.sent)} failure=${earlyFailure?.stack}`);
  socket.message({ type: 'error', message: 'Call denied by server.' });
  await assert.rejects(starting, /Call ended before secure media was ready/);
  await settle();
  const state = h.render(user);
  assert.equal(state.error, 'Call denied by server.');
  assert.equal(state.call, null);
  assert.ok(socket.sent.some(message => message.type === 'call-end' && message.callId === offer.callId));
  assert.ok(h.posts.some(post => post.url === '/call/end' && post.body.callId === offer.callId), JSON.stringify(h.posts));
  h.cleanup();
});

test('WebSocket onerror makes a connection failure visible', async () => {
  const h = harness();
  const user = { id: 42, username: 'caller' };
  h.render(user);
  await settle();
  h.sockets[0].onerror(new Error('transport failed'));
  assert.equal(h.render(user).error, 'Cannot connect to the call server. Check your connection or sign in again.');
  h.cleanup();
});