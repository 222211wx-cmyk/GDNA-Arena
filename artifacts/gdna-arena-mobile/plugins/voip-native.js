const fs = require('node:fs');
const path = require('node:path');

function replaceBlock(source, name, body) {
  const start = `// GDNA ${name} BEGIN`;
  const end = `// GDNA ${name} END`;
  const block = `${start}\n${body}\n${end}`;
  const a = source.indexOf(start);
  if (a < 0) return `${source.trimEnd()}\n\n${block}\n`;
  const b = source.indexOf(end, a);
  if (b < 0) throw new Error(`Incomplete GDNA ${name} block`);
  return source.slice(0, a) + block + source.slice(b + end.length);
}

// C wrappers deliberately avoid relying on inferred Objective-C -> Swift selector names.
const bridge = `#import <RNCallKeep/RNCallKeep.h>
#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>

static inline void GDNASetupCallKeep(void) {
  [RNCallKeep setup:@{@"appName": @"GDNA Arena", @"supportsVideo": @YES}];
}
static inline void GDNAVoipToken(PKPushCredentials *credentials, NSString *type) {
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:type];
}
static inline void GDNAVoipEvent(PKPushPayload *payload, NSString *type) {
  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:type];
}
static inline void GDNAEndCall(NSString *uuid) {
  [RNCallKeep endCallWithUUID:uuid reason:1];
}
static inline void GDNAReportCall(NSString *uuid, NSString *handle, NSString *name,
                                 BOOL video, NSDictionary *payload, void (^completion)(void)) {
  [RNCallKeep reportNewIncomingCall:uuid handle:handle handleType:@"generic"
    hasVideo:video localizedCallerName:name supportsHolding:NO supportsDTMF:NO
    supportsGrouping:NO supportsUngrouping:NO fromPushKit:YES payload:payload
    withCompletionHandler:completion];
}`;

const delegate = `extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry,
                           didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    GDNAVoipToken(credentials, type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry,
                           didReceiveIncomingPushWith payload: PKPushPayload,
                           for type: PKPushType, completion: @escaping () -> Void) {
    let data = payload.dictionaryPayload
    // Never manufacture a server identity or phone number. Without a valid UUID
    // CallKit cannot report this push; this is a server contract violation.
    guard let uuid = data["callUUID"] as? String, UUID(uuidString: uuid) != nil else {
      NSLog("[GDNA VoIP] Invalid/missing callUUID: cannot report to CallKit")
      completion()
      return
    }
    let name = data["callerName"] as? String ?? ""
    let handle = data["handle"] as? String ?? name
    let video = data["hasVideo"] as? Bool ?? false
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let expiryString = data["expiresAt"] as? String ?? ""
    var expiry = iso.date(from: expiryString)
    if expiry == nil {
      iso.formatOptions = [.withInternetDateTime]
      expiry = iso.date(from: expiryString)
    }
    let callId = data["callId"] as? String ?? ""
    let valid = type == .voIP && data["type"] as? String == "call"
      && !callId.isEmpty && !handle.isEmpty && data["hasVideo"] is Bool
      && (expiry.map { $0 > Date() } ?? false)
    // Report synchronously on the PushKit delegate path, before forwarding to JS.
    // Native owns completion exclusively; no JS completion handler is registered.
    GDNAReportCall(uuid, handle, name, video, data) {
      if !valid {
        GDNAEndCall(uuid)
        NSLog("[GDNA VoIP] Ended expired/invalid incoming call after CallKit report")
      } else {
        // Preserve the entire authoritative payload, including callId and callUUID.
        GDNAVoipEvent(payload, type.rawValue)
      }
      completion()
    }
  }
}`;

function modifyAppDelegate(contents) {
  if (!/public class AppDelegate: ExpoAppDelegate/.test(contents)) {
    throw new Error('GDNA VoIP requires the Expo Swift AppDelegate template');
  }
  if (!contents.includes('import PushKit')) contents = `import PushKit\n${contents}`;
  if (!contents.includes('// GDNA native CallKeep setup')) {
    const launch = /(didFinishLaunchingWithOptions launchOptions:[\s\S]*?\) -> Bool \{)/;
    if (!launch.test(contents)) throw new Error('GDNA VoIP could not locate Swift launch method');
    contents = contents.replace(launch, '$1\n    // GDNA native CallKeep setup (before React bridge; no PushKit registration)\n    GDNASetupCallKeep()');
  }
  return replaceBlock(contents, 'PushKit delegate', delegate);
}

function modifyBridgingHeader(contents) {
  return replaceBlock(contents, 'VoIP bridge', bridge);
}

function updateProjectBridge(project, iosRoot) {
  const headers = new Set();
  for (const entry of Object.values(project.pbxXCBuildConfigurationSection())) {
    const setting = entry?.buildSettings?.SWIFT_OBJC_BRIDGING_HEADER;
    if (setting) headers.add(setting.replace(/^"|"$/g, '')
      .replace(/\$\((SRCROOT|PROJECT_DIR)\)|\$\{(SRCROOT|PROJECT_DIR)\}/g, iosRoot));
  }
  if (!headers.size) throw new Error('GDNA VoIP requires an existing Swift bridging header');
  for (const header of headers) {
    const filename = path.resolve(iosRoot, header);
    if (!fs.existsSync(filename)) throw new Error(`GDNA VoIP bridging header missing: ${filename}`);
    fs.writeFileSync(filename, modifyBridgingHeader(fs.readFileSync(filename, 'utf8')));
  }
}

module.exports = { modifyAppDelegate, modifyBridgingHeader, updateProjectBridge };