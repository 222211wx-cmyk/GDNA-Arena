package __PACKAGE__

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.*
import android.net.Uri
import android.os.*
import android.telecom.*
import android.view.WindowManager
import android.widget.*
import com.facebook.react.bridge.*

// One process-owned call slot. No exported action accepts caller-supplied invitations.
internal object GDNAcalls {
  var id: String? = null
  var uuid: String? = null
  var label = ""
  var connection: Connection? = null
  var creation: Promise? = null
  var audio: Promise? = null
  var accepted = false
  val actions = mutableListOf<Pair<String, String>>()
  val handler = Handler(Looper.getMainLooper())
  var expiry: Runnable? = null
  var screen: Activity? = null
  var react: ReactApplicationContext? = null
  fun handle(context: Context) = PhoneAccountHandle(ComponentName(context, GDNACallConnectionService::class.java), "gdna-self-managed")
  fun register(context: Context) {
    check(Build.VERSION.SDK_INT >= 26) { "Android 8 or newer is required for self-managed calls." }
    context.getSystemService(TelecomManager::class.java).registerPhoneAccount(
      PhoneAccount.builder(handle(context), "GDNA calls")
        .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
        .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_SIP)).build())
    check(context.getSystemService(TelecomManager::class.java).getPhoneAccount(handle(context))?.isEnabled == true) {
      "Android did not enable the GDNA self-managed phone account."
    }
  }
  fun action(kind: String) {
    id?.let { actions.add(it to kind) }
    react?.takeIf { it.hasActiveReactInstance() }?.getJSModule(
      com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java
    )?.emit("GDNACallAction", Arguments.createMap().apply { putString("callId", id); putString("kind", kind) })
  }
  fun close(context: Context) {
    expiry?.let { handler.removeCallbacks(it) }; expiry = null
    creation?.reject("CALL_ENDED", "Telecom call ended before creation."); creation = null
    audio?.reject("CALL_ENDED", "Call ended before foreground audio started."); audio = null
    connection?.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    connection?.destroy(); connection = null
    id = null; uuid = null; accepted = false
    screen?.finish(); screen = null
    context.stopService(Intent(context, GDNACallAudioService::class.java))
  }
}

class GDNACallConnectionService : ConnectionService() {
  private fun create(request: ConnectionRequest, incoming: Boolean): Connection {
    val requested = request.extras?.getString("gdnaId")
      ?: request.extras?.getBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)?.getString("gdnaId")
    if (requested == null || requested != GDNAcalls.id || GDNAcalls.connection != null)
      return Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
    val call = object : Connection() {
      override fun onShowIncomingCallUi() {
        GDNAcalls.creation?.resolve(null); GDNAcalls.creation = null
      }
      override fun onAnswer() { GDNAcalls.action("answer"); openApp() }
      override fun onAnswer(videoState: Int) = onAnswer()
      override fun onReject() { GDNAcalls.action("end"); GDNAcalls.close(this@GDNACallConnectionService) }
      override fun onDisconnect() = onReject()
      override fun onAbort() = onReject()
      override fun onHold() { GDNAcalls.action("interrupted"); GDNAcalls.close(this@GDNACallConnectionService) }
      override fun onCallAudioStateChanged(state: CallAudioState) {
        GDNAcalls.react?.takeIf { it.hasActiveReactInstance() }?.getJSModule(
          com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java
        )?.emit("GDNACallAudioState", Arguments.createMap().apply {
          putString("callId", GDNAcalls.id); putBoolean("muted", state.isMuted)
          putBoolean("speaker", state.route == CallAudioState.ROUTE_SPEAKER)
        })
      }
      private fun openApp() {
        packageManager.getLaunchIntentForPackage(packageName)?.let {
          it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          startActivity(it)
        }
      }
    }
    call.connectionProperties = Connection.PROPERTY_SELF_MANAGED
    call.setAudioModeIsVoip(true)
    call.setCallerDisplayName(GDNAcalls.label, TelecomManager.PRESENTATION_ALLOWED)
    call.setAddress(Uri.fromParts("sip", requested, null), TelecomManager.PRESENTATION_ALLOWED)
    GDNAcalls.connection = call
    if (incoming) call.setRinging() else call.setDialing()
    if (!incoming) { GDNAcalls.creation?.resolve(null); GDNAcalls.creation = null }
    return call
  }
  override fun onCreateIncomingConnection(account: PhoneAccountHandle?, request: ConnectionRequest) = create(request, true)
  override fun onCreateOutgoingConnection(account: PhoneAccountHandle?, request: ConnectionRequest) = create(request, false)
  override fun onCreateIncomingConnectionFailed(account: PhoneAccountHandle?, request: ConnectionRequest) {
    GDNAcalls.action("unavailable"); GDNAcalls.close(this)
  }
  override fun onCreateOutgoingConnectionFailed(account: PhoneAccountHandle?, request: ConnectionRequest) {
    GDNAcalls.action("unavailable"); GDNAcalls.close(this)
  }
}

class GDNACallActivity : Activity() {
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if (GDNAcalls.id == null || GDNAcalls.accepted) { finish(); return }
    GDNAcalls.screen = this
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
    else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 100, 40, 40) }
    layout.addView(TextView(this).apply { text = "Incoming GDNA call\n${GDNAcalls.label}"; textSize = 26f })
    layout.addView(Button(this).apply {
      text = "Answer"
      setOnClickListener {
        GDNAcalls.action("answer")
        packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
        finish()
      }
    })
    layout.addView(Button(this).apply {
      text = "Decline"
      setOnClickListener { GDNAcalls.action("end"); GDNAcalls.close(this@GDNACallActivity) }
    })
    setContentView(layout)
  }
  override fun onDestroy() { if (GDNAcalls.screen === this) GDNAcalls.screen = null; super.onDestroy() }
}

class GDNACallAudioService : Service() {
  private var focus: AudioFocusRequest? = null
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (GDNAcalls.id == null || !GDNAcalls.accepted) { stopSelf(); return START_NOT_STICKY }
    try {
      check(checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "Microphone permission is required." }
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(NotificationChannel("gdna-active-call-v1", "Active GDNA call", NotificationManager.IMPORTANCE_LOW))
      val open = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName)!!,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val notification = Notification.Builder(this, "gdna-active-call-v1")
        .setSmallIcon(android.R.drawable.sym_action_call).setContentTitle("GDNA call in progress")
        .setContentText("Tap to return to your call").setContentIntent(open)
        .setCategory(Notification.CATEGORY_CALL).setOngoing(true).build()
      if (Build.VERSION.SDK_INT >= 29)
        startForeground(7041, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or
          (if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0))
      else startForeground(7041, notification)
      val audioManager = getSystemService(AudioManager::class.java)
      if (focus == null) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener({ change ->
            // Fail closed on cellular/other interruption: never transmit while audio focus is lost.
            if (change < 0) { GDNAcalls.action("interrupted"); GDNAcalls.close(this) }
          }, GDNAcalls.handler).build()
        check(audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Call audio focus is unavailable." }
        focus = request
      }
      GDNAcalls.connection?.setActive()
      GDNAcalls.audio?.resolve(null); GDNAcalls.audio = null
    } catch (error: Exception) {
      GDNAcalls.audio?.reject("CALL_AUDIO_FAILED", error); GDNAcalls.audio = null
      GDNAcalls.action("unavailable"); GDNAcalls.close(this); stopSelf()
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    focus?.let { getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }; focus = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}

class CallTelecomModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init { GDNAcalls.react = context }
  override fun getName() = "GDNACallTelecom"
  private fun run(promise: Promise, block: () -> Unit) = reactApplicationContext.runOnUiQueueThread {
    try { block() } catch (error: Exception) { promise.reject("TELECOM_FAILED", error) }
  }
  @ReactMethod fun register(promise: Promise) = run(promise) { GDNAcalls.register(reactApplicationContext); promise.resolve(null) }
  @ReactMethod fun create(id: String, uuid: String, label: String, incoming: Boolean, lifetime: Double, promise: Promise) = run(promise) {
    if (GDNAcalls.id == id && GDNAcalls.connection != null) { promise.resolve(null); return@run }
    check(GDNAcalls.id == null) { "Another native call is already in progress." }
    GDNAcalls.register(reactApplicationContext)
    GDNAcalls.id = id; GDNAcalls.uuid = uuid; GDNAcalls.label = label; GDNAcalls.creation = promise
    val expiry = Runnable { if (GDNAcalls.id == id) { GDNAcalls.action("end"); GDNAcalls.close(reactApplicationContext) } }
    GDNAcalls.expiry = expiry
    GDNAcalls.handler.postDelayed(expiry, lifetime.toLong().coerceIn(1, 60000))
    val extras = Bundle().apply { putString("gdnaId", id) }
    try {
      val manager = reactApplicationContext.getSystemService(TelecomManager::class.java)
      if (incoming) manager.addNewIncomingCall(GDNAcalls.handle(reactApplicationContext), extras)
      else manager.placeCall(Uri.fromParts("sip", id, null), Bundle().apply {
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, GDNAcalls.handle(reactApplicationContext))
        putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, extras)
      })
    } catch (error: Exception) { GDNAcalls.close(reactApplicationContext); throw error }
  }
  @ReactMethod fun startAudio(id: String, promise: Promise) = run(promise) {
    check(GDNAcalls.id == id && GDNAcalls.connection != null) { "Native call is no longer available." }
    check(reactApplicationContext.currentActivity != null && reactApplicationContext.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED) {
      "Open the call screen before enabling the microphone."
    }
    check(reactApplicationContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "Microphone permission is required." }
    GDNAcalls.accepted = true
    GDNAcalls.expiry?.let { GDNAcalls.handler.removeCallbacks(it) }; GDNAcalls.expiry = null
    GDNAcalls.audio = promise
    GDNAcalls.handler.postDelayed({
      if (GDNAcalls.audio === promise) {
        GDNAcalls.audio?.reject("CALL_AUDIO_TIMEOUT", "Android did not start the microphone foreground service.")
        GDNAcalls.audio = null
        GDNAcalls.action("unavailable"); GDNAcalls.close(reactApplicationContext)
      }
    }, 8000)
    try { reactApplicationContext.startForegroundService(Intent(reactApplicationContext, GDNACallAudioService::class.java)) }
    catch (error: Exception) { GDNAcalls.close(reactApplicationContext); throw error }
  }
  @ReactMethod fun end(id: String, promise: Promise) = run(promise) {
    if (id.isEmpty() || GDNAcalls.id == id) GDNAcalls.close(reactApplicationContext)
    if (id.isEmpty()) GDNAcalls.actions.clear()
    promise.resolve(null)
  }
  @ReactMethod fun drain(promise: Promise) = run(promise) {
    val result = Arguments.createArray()
    GDNAcalls.actions.forEach { (id, kind) -> result.pushMap(Arguments.createMap().apply { putString("callId", id); putString("kind", kind) }) }
    GDNAcalls.actions.clear(); promise.resolve(result)
  }
}