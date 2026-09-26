const { withInfoPlist, withAndroidManifest, withAppDelegate, withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const { modifyAppDelegate, updateProjectBridge } = require('./voip-native');

module.exports = function withVoipPush(config) {
  config = withDangerousMod(config, ['android', async cfg => {
    const packageName = cfg.android?.package;
    if (!packageName || !/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+$/.test(packageName)) {
      throw new Error('GDNA full-screen intent needs an Android package name');
    }
    const folder = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    const main = path.join(folder, 'MainApplication.kt');
    const source = fs.readFileSync(main, 'utf8');
    const marker = '// add(MyReactNativePackage())';
    if (!source.includes('add(FullScreenIntentPackage())')) {
      if (!source.includes(marker)) throw new Error('Cannot register GDNA full-screen intent package in MainApplication');
      fs.writeFileSync(main, source.replace(marker, `${marker}\n              add(FullScreenIntentPackage())`));
    }
    fs.writeFileSync(path.join(folder, 'FullScreenIntentModule.kt'),
      fs.readFileSync(path.join(__dirname, 'FullScreenIntentModule.kt'), 'utf8').replace('__PACKAGE__', packageName));
    return cfg;
  }]);
  // Explicit static opt-in. Android Telecom/FCM mods remain independent.
  if (config.extra?.iosVoipEnabled !== true) return withAndroidManifest(config, androidManifest);
  config = withAppDelegate(config, cfg => {
    if (cfg.modResults.language !== 'swift') throw new Error('GDNA VoIP requires Swift AppDelegate');
    cfg.modResults.contents = modifyAppDelegate(cfg.modResults.contents);
    return cfg;
  });
  config = withXcodeProject(config, cfg => {
    updateProjectBridge(cfg.modResults, cfg.modRequest.platformProjectRoot);
    return cfg;
  });
  config = withInfoPlist(config, cfg => {
    cfg.modResults.UIBackgroundModes = [...new Set([
      ...(cfg.modResults.UIBackgroundModes || []),
      'voip',
      'audio',
      'remote-notification',
    ])];
    cfg.modResults.CFBundleAllowMixedLocalizations = true;
    return cfg;
  });

  return withAndroidManifest(config, androidManifest);
};

function androidManifest(cfg) {
    const manifest = cfg.modResults.manifest;
    const permissions = manifest['uses-permission'] || [];
    for (const name of [
      'android.permission.MANAGE_OWN_CALLS',
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.USE_FULL_SCREEN_INTENT',
    ]) {
      if (!permissions.some(permission => permission.$?.['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    }
    manifest['uses-permission'] = permissions;
    const application = manifest.application?.[0];
    if (!application) throw new Error('GDNA VoIP requires an Android application manifest entry');
    manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
    const services = application.service || (application.service = []);
    const upsert = (name, attributes) => {
      let service = services.find(item => item.$?.['android:name'] === name);
      if (!service) services.push(service = { $: { 'android:name': name } });
      service.$ = { ...service.$, ...attributes };
      return service;
    };
    const connection = upsert('io.wazo.callkeep.VoiceConnectionService', {
      'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
      'android:exported': 'true',
      'android:foregroundServiceType': 'phoneCall|microphone',
    });
    connection['intent-filter'] ||= [];
    if (!connection['intent-filter'].some(filter => filter.action?.some(
      action => action.$?.['android:name'] === 'android.telecom.ConnectionService',
    ))) connection['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }],
    });
    upsert('io.wazo.callkeep.RNCallKeepBackgroundMessagingService', { 'android:exported': 'false' });
    const notifee = upsert('app.notifee.core.ForegroundService', {
      'android:exported': 'false',
      'android:foregroundServiceType': 'phoneCall',
    });
    notifee.$['tools:replace'] = [...new Set([
      ...(notifee.$['tools:replace'] || '').split(',').map(value => value.trim()).filter(Boolean),
      'android:foregroundServiceType',
    ])].join(',');
    return cfg;
}