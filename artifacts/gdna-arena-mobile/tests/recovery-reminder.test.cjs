const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/recovery-reminder-preference.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleScope = { exports: {} };
vm.runInNewContext(code, { module: moduleScope, exports: moduleScope.exports, Map, Promise, Error });
const { createReminderPreference } = moduleScope.exports;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('missing preference defaults off; only explicit true opts in', async () => {
  for (const value of [null, 'false', 'true']) {
    let state;
    const preference = createReminderPreference({ getItem: async () => value }, `read-${value}`, next => { state = next; });
    await preference.load();
    assert.equal(state.enabled, value === 'true');
    assert.equal(state.loading, false);
    assert.equal(state.error, false);
    preference.dispose();
  }
});

test('failed or corrupt reads report errors, default off, and allow an explicit save retry', async () => {
  for (const corrupt of [false, true]) {
    let state;
    const saved = [];
    const preference = createReminderPreference({
      getItem: async () => { if (corrupt) return 'invalid'; throw new Error('Storage unavailable'); },
      setItem: async (...args) => { saved.push(args); },
    }, `read-error-${corrupt}`, next => { state = next; });
    await preference.load();
    assert.equal(state.enabled, false);
    assert.equal(state.error, true);
    await preference.setEnabled(true);
    assert.equal(state.enabled, true);
    assert.equal(state.error, false);
    assert.deepEqual(saved, [[`read-error-${corrupt}`, 'true']]);
  }
});

test('failed writes preserve the last saved value rather than pretending success', async () => {
  let state;
  let fail = true;
  const preference = createReminderPreference({
    getItem: async () => 'true',
    setItem: async () => { if (fail) throw new Error('Disk full'); },
  }, 'write-error', next => { state = next; });
  await preference.load();
  await preference.setEnabled(false);
  assert.equal(state.enabled, true);
  assert.equal(state.error, true);
  assert.equal(state.saving, false);
  fail = false;
  await preference.setEnabled(false);
  assert.equal(state.enabled, false);
  assert.equal(state.error, false);
});

test('toggle is not optimistic and overlapping writes cannot reorder the preference', async () => {
  let state;
  let calls = 0;
  const write = deferred();
  const preference = createReminderPreference({
    getItem: async () => null,
    setItem: async () => { calls++; await write.promise; },
  }, 'pending-write', next => { state = next; });
  await preference.load();
  const saving = preference.setEnabled(true);
  await preference.setEnabled(false);
  assert.equal(state.enabled, false);
  assert.equal(state.saving, true);
  write.resolve();
  await saving;
  assert.equal(calls, 1);
  assert.equal(state.enabled, true);
});

test('identity switch and unmount discard late read/write state updates', async () => {
  for (const operation of ['read', 'write']) {
    const wait = deferred();
    const states = [];
    const preference = createReminderPreference({
      getItem: async () => operation === 'read' ? wait.promise : null,
      setItem: async () => wait.promise,
    }, `dispose-${operation}`, next => states.push(next));
    const loading = preference.load();
    if (operation === 'write') await loading;
    const saving = operation === 'write' ? preference.setEnabled(true) : Promise.resolve();
    preference.dispose();
    const count = states.length;
    wait.resolve(operation === 'read' ? 'true' : undefined);
    await Promise.all([loading, saving]);
    await preference.setEnabled(false);
    assert.equal(states.length, count);
  }
});

test('account returning during an old write reads its settled value, without blocking another account', async () => {
  const write = deferred();
  const disk = new Map();
  const storage = {
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => { await write.promise; disk.set(key, value); },
  };
  const previous = createReminderPreference(storage, 'account-a', () => {});
  await previous.load();
  const saving = previous.setEnabled(true);
  await flush();
  previous.dispose();
  let stateA, stateB;
  const returning = createReminderPreference(storage, 'account-a', next => { stateA = next; });
  const other = createReminderPreference(storage, 'account-b', next => { stateB = next; });
  const loading = returning.load();
  await other.load();
  assert.equal(stateB.enabled, false);
  assert.equal(stateB.loading, false);
  assert.equal(stateA.loading, true);
  write.resolve();
  await Promise.all([saving, loading]);
  assert.equal(stateA.enabled, true);
});

test('native reminder gates fresh status and CTA only scrolls to the existing password form', () => {
  const screen = fs.readFileSync(path.join(root, 'app/security.tsx'), 'utf8');
  const gate = screen.slice(screen.indexOf('const showReminder ='), screen.indexOf('const dir ='));
  for (const guard of ['isOnline', 'reminder.enabled', 'status.isSuccess', 'status.isFetchedAfterMount', '!status.isFetching', '!issued', 'busy === null', 'isRecoveryCodeExpiringSoon(status.data)']) {
    assert.ok(gate.includes(guard), `Missing warning guard: ${guard}`);
  }
  assert.doesNotMatch(gate, /isStale/);
  assert.match(screen, /refetchOnMount: 'always'/);
  const cta = screen.slice(screen.indexOf('testID="recovery-reminder-replace"'), screen.indexOf('{reminderCopy.replace}'));
  assert.match(cta, /scrollTo/);
  assert.doesNotMatch(cta, /run\(|issueRecoveryCode|revokeRecoveryCode/);
  assert.match(screen, /else refreshStatus\(currentUser.current\)/);
  assert.match(screen, /disabled=\{!password \|\| busy !== null \|\| !isOnline\}/);
});

test('reminder, dates and layout use supported device language with Arabic RTL fallback', () => {
  const screen = fs.readFileSync(path.join(root, 'app/security.tsx'), 'utf8');
  assert.match(screen, /\['ar', 'en', 'fr', 'es', 'de'\]\.includes\(deviceLanguage\) \? deviceLanguage : 'ar'/);
  assert.match(screen, /recoveryReminderCopy\(language\)/);
  assert.match(screen, /toLocaleDateString\(language\)/);
  assert.match(screen, /direction: language === 'ar' \? 'rtl' : 'ltr'/);
});