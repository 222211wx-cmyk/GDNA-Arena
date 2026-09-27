const assert = require('node:assert/strict');
const { test } = require('node:test');
const withVoipPush = require('../plugins/withVoipPush');

// Execute the registered mod actions without generating native projects.
async function runMod(platform, mod, results, iosVoipEnabled = true) {
  const config = withVoipPush({ name: 'Plugin test', slug: 'plugin-test', extra: { iosVoipEnabled }, android: { package: 'com.gdna.test' } });
  const result = await config.mods[platform][mod]({
    ...config,
    modResults: results,
    modRequest: { platform, modName: mod, introspect: true },
  });
  return result.modResults;
}

test('iOS merges modes idempotently and preserves unrelated configuration', async () => {
  const initial = {
    UIBackgroundModes: ['fetch', 'audio'],
    NSMicrophoneUsageDescription: 'Existing microphone reason',
  };
  const once = await runMod('ios', 'infoPlist', structuredClone(initial));
  const twice = await runMod('ios', 'infoPlist', structuredClone(once));
  assert.deepEqual(twice, once);
  assert.deepEqual(once.UIBackgroundModes, ['fetch', 'audio', 'voip', 'remote-notification']);
  assert.equal(once.NSMicrophoneUsageDescription, initial.NSMicrophoneUsageDescription);
  assert.equal(once.CFBundleAllowMixedLocalizations, true);
});

test('Android leaves Firebase notification defaults to the library idempotently', async () => {
  const name = 'com.google.firebase.messaging.default_notification_channel_id';
  const initial = { manifest: { application: [{ $: {}, 'meta-data': [
    { $: { 'android:name': name, 'android:value': 'custom-calls', 'tools:replace': 'android:resource' } },
    { $: { 'android:name': 'unrelated', 'android:value': 'keep' } },
    { $: { 'android:name': 'com.google.firebase.messaging.default_notification_color', 'android:resource': '@color/notification_icon_color' } },
  ] }] } };
  const once = await runMod('android', 'manifest', structuredClone(initial));
  const twice = await runMod('android', 'manifest', structuredClone(once));
  assert.deepEqual(twice, once);
  const entries = once.manifest.application[0]['meta-data'];
  assert.deepEqual(entries, [initial.manifest.application[0]['meta-data'][1]]);
  const empty = await runMod('android', 'manifest', { manifest: { application: [{ $: {} }] } });
  assert.deepEqual(empty.manifest.application[0]['meta-data'], []);
  assert.equal(empty.manifest.application[0].$['tools:replace'],
    'android:allowBackup,android:supportsRtl,android:label,android:theme,android:name,android:icon');
});

test('Android preserves permission attributes and adds no duplicates', async () => {
  const existing = {
    $: { 'android:name': 'android.permission.RECORD_AUDIO', 'android:maxSdkVersion': '35' },
  };
  const initial = { manifest: { 'uses-permission': [existing], application: [{ $: {} }] } };
  const once = await runMod('android', 'manifest', structuredClone(initial));
  const twice = await runMod('android', 'manifest', structuredClone(once));
  assert.deepEqual(twice, once);
  assert.deepEqual(once.manifest['uses-permission'][0], existing);
  assert.ok(once.manifest.application[0].$['tools:replace'].includes('android:name'));
  assert.equal(once.manifest.application[0].service.length, 4);
  const services = once.manifest.application[0].service;
  assert.equal(services.find(s => s.$['android:name'] === 'app.notifee.core.ForegroundService')
    .$['android:foregroundServiceType'], 'phoneCall');
  assert.equal(services.find(s => s.$['android:name'] === 'com.gdna.test.GDNACallConnectionService')
    .$['android:permission'], 'android.permission.BIND_TELECOM_CONNECTION_SERVICE');
  assert.equal(once.manifest['uses-permission'].length, 8);
  assert.equal(once.manifest['uses-permission'].filter(
    permission => permission.$['android:name'] === 'android.permission.USE_FULL_SCREEN_INTENT',
  ).length, 1);
});

test('handles absent mode and permission lists without adding entitlements', async () => {
  const config = withVoipPush({ name: 'Plugin test', slug: 'plugin-test', extra: { iosVoipEnabled: true } });
  assert.equal(config.mods.ios.entitlements, undefined);
  assert.equal((await runMod('ios', 'infoPlist', {})).UIBackgroundModes.length, 3);
  assert.equal((await runMod('android', 'manifest', { manifest: { application: [{ $: {} }] } }))
    .manifest['uses-permission'].length, 8);
});

test('default app disables iOS mods without disabling Android call setup', async () => {
  const app = require('../app.json').expo;
  assert.equal(app.extra.iosVoipEnabled, false);
  const config = withVoipPush({ ...app, mods: undefined });
  assert.equal(config.mods.ios, undefined);
  assert.equal(typeof config.mods.android.manifest, 'function');
  assert.equal(typeof config.mods.android.dangerous, 'function');
  assert.equal(withVoipPush({ name: 'No opt-in', slug: 'no-opt-in' }).mods.ios, undefined);
  const enabled = withVoipPush({ name: 'Enabled', slug: 'enabled', extra: { iosVoipEnabled: true } });
  assert.ok(enabled.mods.ios.appDelegate);
  assert.ok(enabled.mods.ios.xcodeproj);
  assert.ok(enabled.mods.ios.infoPlist);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { modifyAppDelegate, modifyBridgingHeader, updateProjectBridge } = require('../plugins/voip-native');

test('Android generates dedicated Telecom implementation idempotently without entitlements', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdna-telecom-'));
  try {
    const folder = path.join(temp, 'app/src/main/java/com/gdna/test');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'MainApplication.kt'), '// add(MyReactNativePackage())');
    const config = withVoipPush({ name: 'Plugin test', slug: 'plugin-test', android: { package: 'com.gdna.test' } });
    const invoke = () => config.mods.android.dangerous({
      ...config, modResults: {}, modRequest: { platformProjectRoot: temp, platform: 'android', modName: 'dangerous' },
    });
    await invoke();
    const read = () => ['MainApplication.kt', 'FullScreenIntentModule.kt', 'CallTelecomModule.kt']
      .map(name => fs.readFileSync(path.join(folder, name), 'utf8'));
    const first = read();
    await invoke();
    assert.deepEqual(read(), first);
    assert.match(first[2], /CAPABILITY_SELF_MANAGED/);
    assert.match(first[2], /FOREGROUND_SERVICE_TYPE_MICROPHONE/);
    assert.match(first[2], /LifecycleState.RESUMED/);
    assert.match(first[2], /reactApplicationContext\.currentActivity != null/);
    assert.doesNotMatch(first[2], /check\(currentActivity/);
    assert.match(first[2], /checkSelfPermission\(Manifest.permission.RECORD_AUDIO\)/);
    assert.match(first[2], /onShowIncomingCallUi/);
    assert.doesNotMatch(first[2], /specialUse|__PACKAGE__/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('installed Expo SDK 54 Swift template is patched idempotently before bridge startup', async () => {
  // Read the actual installed template, not a hand-written approximation.
  const template = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
  const source = execFileSync('tar', ['-xOf', template, 'package/ios/HelloWorld/AppDelegate.swift'], { encoding: 'utf8' });
  const result = await runMod('ios', 'appDelegate', { language: 'swift', contents: source });
  const swift = result.contents;
  assert.equal(modifyAppDelegate(swift), swift);
  assert.ok(swift.indexOf('GDNASetupCallKeep()') < swift.indexOf('let delegate = ReactNativeDelegate()'));
  assert.ok(swift.indexOf('GDNAReportCall(uuid') < swift.indexOf('GDNAVoipEvent(payload'));
  assert.match(swift, /extension AppDelegate: PKPushRegistryDelegate/);
  assert.match(swift, /UUID\(uuidString: uuid\)/);
  assert.match(swift, /data\["callId"\]/);
  assert.match(swift, /expiry\.map \{ \$0 > Date\(\) \}/);
  assert.match(swift, /if !valid \{\s+GDNAEndCall\(uuid\)/);
  assert.doesNotMatch(swift, /voipRegistration|registerVoipToken|desiredPushTypes|UUID\(\)/);
  assert.equal((swift.match(/completion\(\)/g) || []).length, 2); // exclusive guard and report paths
  assert.ok(swift.includes('class ReactNativeDelegate: ExpoReactNativeFactoryDelegate'));
  assert.ok(swift.includes('return super.application(app, open: url, options: options)'));
  await assert.rejects(runMod('ios', 'appDelegate', { language: 'objc', contents: '' }), /requires Swift/);
});

test('Xcode mod preserves installed Expo bridging header and unrelated build settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdna-voip-plugin-'));
  try {
    const template = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
    execFileSync('tar', ['-xzf', template, '-C', root]);
    const ios = path.join(root, 'package/ios');
    // Resolve xcode through Expo's config-plugin dependency rather than add a dependency.
    const expoPlugins = require.resolve('expo/config-plugins');
    const configPlugins = require.resolve('@expo/config-plugins', { paths: [path.dirname(expoPlugins)] });
    const xcode = require(require.resolve('xcode', { paths: [path.dirname(configPlugins)] }));
    const project = xcode.project(path.join(ios, 'HelloWorld.xcodeproj/project.pbxproj'));
    project.parseSync();
    const before = JSON.stringify(project.pbxXCBuildConfigurationSection());
    updateProjectBridge(project, ios);
    const headerPath = path.join(ios, 'HelloWorld/HelloWorld-Bridging-Header.h');
    const header = fs.readFileSync(headerPath, 'utf8');
    updateProjectBridge(project, ios);
    assert.equal(fs.readFileSync(headerPath, 'utf8'), header);
    assert.equal(modifyBridgingHeader(header), header);
    assert.equal(JSON.stringify(project.pbxXCBuildConfigurationSection()), before);
    assert.match(header, /Use this file to import your target's public headers/);
    assert.match(header, /@"appName": @"GDNA Arena", @"supportsVideo": @YES/);
    assert.match(header, /withCompletionHandler:completion/);
    assert.doesNotMatch(header, /addCompletionHandler|voipRegistration|push-type\.voip/);
    for (const [module, headerName] of [
      ['react-native-callkeep', 'RNCallKeep'],
      ['react-native-voip-push-notification', 'RNVoipPushNotificationManager'],
    ]) {
      const base = path.dirname(require.resolve(`${module}/package.json`));
      const nativeDir = module === 'react-native-callkeep' ? 'RNCallKeep' : 'RNVoipPushNotification';
      const installedHeader = fs.readFileSync(path.join(base, 'ios', nativeDir, `${headerName}.h`), 'utf8');
      assert.match(installedHeader, module === 'react-native-callkeep'
        ? /withCompletionHandler:\(void/ : /didReceiveIncomingPushWithPayload:/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails explicitly for unsupported templates and absent application', async () => {
  assert.throws(() => modifyAppDelegate('class OtherDelegate {}'), /Expo Swift/);
  await assert.rejects(runMod('android', 'manifest', { manifest: {} }), /application manifest/);
});