const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const withAndroidFirebase = require('./withAndroidFirebase');

test('Expo iOS introspection succeeds without GoogleService-Info.plist', async () => {
  const { compileModsAsync } = require('expo/config-plugins');
  const projectRoot = path.resolve(__dirname, '..');
  const config = withAndroidFirebase({
    name: 'GDNA', slug: 'gdna', _internal: { projectRoot },
    android: { googleServicesFile: './google-services.json' },
  });
  const result = await compileModsAsync(config, {
    projectRoot, platforms: ['ios'], introspect: true,
  });
  assert.equal(result.ios?.googleServicesFile, undefined);
  assert.equal(result.mods.ios.appDelegate, undefined);
  assert.equal(result.mods.ios.xcodeproj, undefined);
});

test('official Android Firebase mods do not register iOS initialization or plist mods', () => {
  const config = withAndroidFirebase({
    name: 'GDNA', slug: 'gdna', _internal: { projectRoot: path.resolve(__dirname, '..') },
  });
  assert.equal(config.mods.ios, undefined);
  assert.deepEqual(Object.keys(config.mods.android).sort(),
    ['appBuildGradle', 'dangerous', 'manifest', 'projectBuildGradle']);
  assert.equal(config.ios, undefined);
});

test('Android Gradle mods work idempotently on actual Expo template and copy authentic config', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdna-firebase-'));
  try {
    const template = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
    execFileSync('tar', ['-xzf', template, '-C', root]);
    const platformProjectRoot = path.join(root, 'package/android');
    const projectRoot = path.resolve(__dirname, '..');
    const config = withAndroidFirebase({
      name: 'GDNA', slug: 'gdna',
      _internal: { projectRoot },
      android: { googleServicesFile: './google-services.json' },
    });
    async function mod(name, modResults) {
      const result = await config.mods.android[name]({
        ...config, modResults,
        modRequest: { projectRoot, platformProjectRoot, platform: 'android', modName: name, introspect: false },
      });
      return result.modResults;
    }
    for (const [name, file, expected] of [
      ['projectBuildGradle', 'build.gradle', 'com.google.gms:google-services'],
      ['appBuildGradle', 'app/build.gradle', "apply plugin: 'com.google.gms.google-services'"],
    ]) {
      const original = fs.readFileSync(path.join(platformProjectRoot, file), 'utf8');
      const once = await mod(name, { language: 'groovy', contents: original });
      assert.ok(once.contents.includes(expected));
      assert.deepEqual(await mod(name, once), once);
    }
    await mod('dangerous', {});
    assert.deepEqual(fs.readFileSync(path.join(platformProjectRoot, 'app/google-services.json')),
      fs.readFileSync(path.join(projectRoot, 'google-services.json')));
    assert.equal(config.mods.ios, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});