const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
    console, Date, Map, Set, Promise, Error,
    setTimeout: () => 1, clearTimeout: () => {},
  });
  return module.exports;
}
const logic = load('lib/call-actions.ts');
test('native gesture handling initializes before call handlers and router', () => {
  const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.match(entry, /^\s*(?:\/\/[^\n]*\n\s*)*import 'react-native-gesture-handler';/);
});
const payload = () => ({
  type: 'call', callId: 'call_real', callUUID: '7c91eb50-eeb1-5a70-ae24-0afbdad16945',
  recipientId: '42', callerName: 'Citizen', handle: '7',
  expiresAt: new Date(Date.now() + 30000).toISOString(), hasVideo: 'true',
});
test('payload requires authoritative identifiers, real handle and unexpired invitation', () => {
  assert.equal(logic.parseCallPush(payload()).hasVideo, true);
  for (const field of ['callId', 'callUUID', 'handle', 'recipientId', 'callerName']) {
    assert.equal(logic.parseCallPush({ ...payload(), [field]: '' }), null);
  }
  assert.equal(logic.parseCallPush({ ...payload(), expiresAt: new Date(0).toISOString() }), null);
  assert.equal(logic.parseCallPush({ ...payload(), type: 'message' }), null);
});
test('generation drops queued old-account work, then serializes cleanup after in-flight work', async () => {
  const queue = new logic.RegistrationGeneration();
  let release;
  const order = [];
  const first = queue.run(async current => {
    order.push('start');
    await new Promise(r => { release = r; });
    assert.equal(current(), false);
    order.push('finish');
  });
  await Promise.resolve();
  const obsolete = queue.run(async () => { order.push('obsolete'); });
  const snapshot = queue.capture();
  queue.invalidate();
  const cleanup = queue.run(async () => { order.push('delete'); });
  release();
  await Promise.all([first, obsolete, cleanup]);
  assert.equal(snapshot(), false);
  assert.deepEqual(order, ['start', 'finish', 'delete']);
});
function service(platform = 'android', { fullScreen = true, bridge = true, iosVoipEnabled = true, telecomFailure = false } = {}) {
  const events = {}, logs = [], store = new Map([['gdna.native.calls.enabled.42', 'yes']]);
  let account = 42, active = true;
  let resolvePermission;
  let permission = async () => ({ authorizationStatus: 1 });
  let readPreference = async k => store.get(k) ?? null;
  const notifee = {
    createChannel: async c => logs.push(['channel', c]),
    displayNotification: async n => logs.push(['display', n]),
    cancelNotification: async id => logs.push(['dismiss', id]),
    onBackgroundEvent: cb => { events.backgroundAction = cb; },
    onForegroundEvent: cb => { events.action = cb; },
    getInitialNotification: async () => null,
    requestPermission: () => permission(),
    getNotificationSettings: async () => ({ authorizationStatus: 1 }),
  };
  const messaging = {
    setBackgroundMessageHandler: cb => { events.push = cb; },
    onMessage: cb => { events.message = cb; },
    onTokenRefresh: cb => { events.token = cb; },
    getToken: async () => 'a-real-token-from-firebase',
  };
  const native = {
    addEventListener: (event, cb) => { events[event] = cb; },
    getInitialEvents: async () => [],
    clearInitialEvents() {},
    endCall: id => logs.push(['endNative', id]),
    setCurrentCallActive() {},
    registerVoipToken() {},
  };
  const svc = load('lib/call-service.native.ts', {
    'react-native': { DeviceEventEmitter: { addListener: (name, cb) => { events[name] = cb; } }, Platform: { OS: platform }, AppState: { currentState: 'active', addEventListener() {} }, NativeModules: {
      RNCallKeep: {}, RNVoipPushNotificationManager: {},
      GDNACallTelecom: {
        register: async () => logs.push(['phoneAccount']),
        create: async (...args) => { if (telecomFailure) throw new Error('Telecom rejected the call'); logs.push(['telecom', ...args]); },
        end: async id => logs.push(['telecomEnd', id]),
        startAudio: async id => logs.push(['audio', id]),
        drain: async () => [],
      },
      ...(bridge ? { GDNAFullScreenIntent: {
        canUse: async () => { logs.push(['checkFullScreen']); return fullScreen; },
        openSettings: async () => { logs.push(['openSettings']); },
      } } : {}),
    } },
    'expo-constants': { default: { executionEnvironment: 'bare', expoConfig: { extra: { iosVoipEnabled }, android: { package: 'com.gdna.test' } } } },
    'expo-secure-store': {
      getItemAsync: k => readPreference(k),
      setItemAsync: async (k, v) => { store.set(k, v); },
      deleteItemAsync: async k => { store.delete(k); },
    },
    'expo-crypto': { randomUUID: () => 'installation-id' },
    '@workspace/api-client-react': {
      setBaseUrl() {},
      checkNativeCallPushCall: async () => ({ active }),
      registerNativeCallPushInstallation: async data => logs.push(['register', data.provider]),
      removeNativeCallPushInstallation: async () => logs.push(['remove']),
    },
    './api': {
      apiGet: async () => ({ id: account }),
      apiPost: async url => logs.push(['decline', url]),
      getApiBase: () => 'https://example.test/api', getHeaders: () => ({}),
      loadSessionCookie: async () => {},
    },
    './call-actions': logic,
    '@react-native-firebase/messaging': { default: () => messaging },
    '@notifee/react-native': { default: notifee },
    'react-native-callkeep': { default: native },
    'react-native-voip-push-notification': { default: { ...native, addEventListener: (e, cb) => { events[`voip:${e}`] = cb; } } },
  });
  return { svc, events, logs, store, account: id => { account = id; }, active: value => { active = value; },
    deferPermission: () => { permission = () => new Promise(resolve => { resolvePermission = resolve; }); },
    grantPermission: () => resolvePermission({ authorizationStatus: 1 }),
    deferPreference: () => { let release; readPreference = () => new Promise(resolve => { release = resolve; }); return () => release('yes'); },
  };
}
test('Android denied full-screen access fails enrollment before token registration; Settings opens only on explicit action', async () => {
  const s = service('android', { fullScreen: false });
  await assert.rejects(s.svc.enableNativeCalls(42), { name: 'FullScreenIntentAccessError' });
  assert.equal(s.logs.some(x => x[0] === 'register' || x[0] === 'openSettings'), false);
  assert.equal(await s.svc.canUseFullScreenIntent(), false);
  await s.svc.openFullScreenIntentSettings();
  assert.equal(s.logs.filter(x => x[0] === 'openSettings').length, 1);
  await assert.rejects(s.events.push({ data: payload() }), { name: 'FullScreenIntentAccessError' });
  assert.equal(s.logs.some(x => x[0] === 'display'), false);
});
test('missing native access bridge fails closed instead of reporting full-screen support', async () => {
  const s = service('android', { bridge: false });
  await assert.rejects(s.svc.enableNativeCalls(42), /updated native build/);
  assert.equal(s.logs.some(x => x[0] === 'register'), false);
});
test('account reset during permission prompt cancels enrollment before registration', async () => {
  const s = service();
  s.deferPermission();
  const enrollment = s.svc.enableNativeCalls(42);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  s.svc.resetCallAccount();
  s.grantPermission();
  await assert.rejects(enrollment, /cancelled/);
  assert.equal(s.logs.some(x => x[0] === 'register'), false);
});
test('reset clears an in-flight invitation while account-scoped preference read is pending', async () => {
  const s = service();
  const release = s.deferPreference();
  const delivery = s.events.push({ data: payload() });
  s.svc.resetCallAccount();
  release();
  await delivery;
  assert.equal(s.logs.some(x => x[0] === 'display'), false);
});
test('background delivery has real full-screen and explicit accept; no automatic answer', async () => {
  const s = service();
  await s.events.push({ data: payload() });
  const notification = s.logs.find(x => x[0] === 'display')[1];
  assert.equal(notification.android.channelId, 'native-calls-ringtone-v1');
  assert.equal(notification.android.sound, 'gdna_call');
  assert.equal(notification.android.loopSound, true);
  assert.equal(notification.android.fullScreenAction.launchActivity, 'com.gdna.test.GDNACallActivity');
  assert.equal(s.logs.filter(x => x[0] === 'telecom').length, 1);
  assert.equal(s.logs.some(x => x[0] === 'audio'), false);
  assert.equal(notification.android.actions[1].pressAction.launchActivity, 'default');
  let answered = 0;
  s.svc.bindCallController(42, { call: { callId: 'call_real', phase: 'incoming' }, answer: async () => { answered++; } }, () => {});
  assert.equal(answered, 0);
  await s.events.backgroundAction({ detail: { notification, pressAction: { id: 'answer' } } });
  assert.equal(answered, 1);
  await s.events.backgroundAction({ detail: { notification, pressAction: { id: 'answer' } } });
  assert.equal(answered, 1);
});
test('wrong recipient and inactive call cannot answer or decline', async () => {
  for (const mismatch of ['recipient', 'inactive']) {
    const s = service();
    if (mismatch === 'recipient') s.account(9); else s.active(false);
    await s.events.push({ data: payload() });
    assert.equal(s.logs.some(x => x[0] === 'display' || x[0] === 'telecom'), false);
    const notification = { id: payload().callUUID, data: payload() };
    await s.events.backgroundAction({ detail: { notification, pressAction: { id: 'decline' } } });
    assert.equal(s.logs.some(x => x[0] === 'decline'), false);
    assert.equal(s.logs.some(x => x[0] === 'dismiss'), true);
  }
});
test('decline uses authenticated existing endpoint, terminal delivery dismisses', async () => {
  const s = service();
  await s.events.push({ data: payload() });
  const notification = s.logs.find(x => x[0] === 'display')[1];
  await s.events.backgroundAction({ detail: { notification, pressAction: { id: 'decline' } } });
  assert.ok(s.logs.some(x => x[0] === 'decline' && x[1] === '/call/decline?id=call_real'));
  await s.events.push({ data: { type: 'call-ended', callUUID: payload().callUUID, callId: 'call_real' } });
  assert.ok(s.logs.some(x => x[0] === 'dismiss'));
});
test('startup does not register tokens or request permissions', async () => {
  const s = service();
  await Promise.resolve();
  assert.equal(s.logs.some(x => x[0] === 'register'), false);
  await s.svc.enableNativeCalls(42);
  assert.equal(s.logs.some(x => x[0] === 'register'), true);
  await s.svc.disableNativeCalls(42);
  assert.equal(s.store.has('gdna.native.calls.enabled.42'), false);
});
test('disabled iOS VoIP fails opt-in explicitly and never registers, re-enrolls or handles events', async () => {
  const s = service('ios', { iosVoipEnabled: false });
  assert.equal(s.events['voip:register'], undefined);
  assert.equal(s.events['voip:notification'], undefined);
  await assert.rejects(s.svc.enableNativeCalls(42), /iOS VoIP calls are disabled/);
  await assert.rejects(s.svc.refreshNativeCalls(42), /iOS VoIP calls are disabled/);
  assert.equal(s.logs.some(x => x[0] === 'register'), false);
  assert.equal(s.store.get('gdna.native.calls.enabled.42'), 'yes'); // prior opt-in is not claimed as re-enrolled
  await s.svc.disableNativeCalls(42);
  assert.equal(s.store.has('gdna.native.calls.enabled.42'), false);
});
test('iOS early answer is mapped only after original native payload replay', async () => {
  const s = service('ios');
  let answered = 0;
  s.events.answerCall({ callUUID: payload().callUUID.toUpperCase() });
  s.events['voip:notification'](payload());
  s.svc.bindCallController(42, { call: { callId: 'call_real', phase: 'incoming' }, answer: async () => { answered++; } }, () => {});
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(answered, 1);
  assert.equal(s.logs.some(x => x[0] === 'display'), false);
});
test('headless handlers are imported before router entry', () => {
  const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.ok(entry.indexOf("import './lib/call-service'") < entry.indexOf("import 'expo-router/entry'"));
});
test('CallKit display failures never create an actionable invitation', async () => {
  const s = service('ios');
  let answered = 0;
  s.events.didDisplayIncomingCall({ callUUID: payload().callUUID, errorCode: 'CallUUIDAlreadyExists', payload: payload() });
  s.events.answerCall({ callUUID: payload().callUUID });
  s.svc.bindCallController(42, { call: { callId: 'call_real', phase: 'incoming' }, answer: async () => { answered++; } }, () => {});
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(answered, 0);
});
test('native end after answer reaches existing WebSocket controller, not ringing-only decline', async () => {
  const s = service('ios');
  s.events['voip:notification'](payload());
  let ended = 0;
  s.svc.bindCallController(42, {
    call: { callId: 'call_real', phase: 'active' }, answer: async () => {},
    reject: () => { throw new Error('active call must not reject'); }, end: () => { ended++; },
  }, () => {});
  s.active(false); // endpoint only exposes invitations still ringing
  s.events.endCall({ callUUID: payload().callUUID });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(ended, 1);
  assert.equal(s.logs.some(x => x[0] === 'decline'), false);
});
test('Telecom allocation failure never reports notification-only ringing success', async () => {
  const s = service('android', { telecomFailure: true });
  await assert.rejects(s.events.push({ data: payload() }), /Telecom rejected/);
  assert.match(s.svc.callSetupError(), /Telecom rejected/);
  assert.equal(s.logs.some(x => x[0] === 'display' || x[0] === 'audio'), false);
});
test('duplicate Android delivery does not allocate another call or re-ring', async () => {
  const s = service();
  await s.events.push({ data: payload() });
  await s.events.push({ data: payload() });
  assert.equal(s.logs.filter(x => x[0] === 'telecom').length, 1);
  assert.equal(s.logs.filter(x => x[0] === 'display').length, 1);
});
test('Android audio lifecycle stays separate from iOS CallKit activation semantics', async () => {
  const s = service();
  await s.svc.prepareAndroidCall('opaque-call-id', 'Citizen', false);
  assert.equal(s.svc.hasNativeCallAudio(), false);
  assert.equal(s.logs.some(x => x[0] === 'audio'), false);
  await s.svc.startAndroidCallAudio('opaque-call-id');
  await s.svc.endAndroidCall('opaque-call-id');
  assert.ok(s.logs.some(x => x[0] === 'audio' && x[1] === 'opaque-call-id'));
  assert.ok(s.logs.some(x => x[0] === 'telecomEnd' && x[1] === 'opaque-call-id'));
});