package __PACKAGE__

import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class FullScreenIntentModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "GDNAFullScreenIntent"

  @ReactMethod
  fun canUse(promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(NotificationManager::class.java)
      promise.resolve(Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())
    } catch (error: Exception) {
      promise.reject("FULL_SCREEN_INTENT_CHECK_FAILED", error)
    }
  }

  @ReactMethod
  fun openSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < 34) {
        promise.reject("FULL_SCREEN_INTENT_NOT_APPLICABLE", "Full-screen intent settings require Android 14.")
        return
      }
      val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
        Uri.parse("package:${reactApplicationContext.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("FULL_SCREEN_INTENT_SETTINGS_FAILED", error)
    }
  }
}

class FullScreenIntentPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(FullScreenIntentModule(context), CallTelecomModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}