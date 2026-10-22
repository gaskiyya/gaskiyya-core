package ng.gaskiya.gaskiya

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import ng.gaskiya.gaskiya.calls.BankCalls
import ng.gaskiya.gaskiya.shield.ShieldNotificationListener
import ng.gaskiya.gaskiya.shield.ShieldOverlay

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        intent = asShare(intent)
        super.onCreate(savedInstanceState)
        answerFrom(intent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel("calls", "Bank calls", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Tells you when your bank is calling and shows the call code."
            }
            val advisories = NotificationChannel("advisories", "Fraud warnings from your bank", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Warnings your bank's fraud team approved about scams using its name."
            }
            val messages = NotificationChannel("messages", "Messages and payment alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Messages and payment receipts your bank sent you, ready to check."
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
            manager.createNotificationChannel(advisories)
            manager.createNotificationChannel(messages)
        }
    }

    override fun onNewIntent(intent: Intent) {
        val shared = asShare(intent) ?: intent
        setIntent(shared)
        super.onNewIntent(shared)
        answerFrom(shared)
    }

    private fun answerFrom(intent: Intent?) {
        if (intent?.action == BankCalls.ACTION_ANSWER) BankCalls.answer(this, intent.getStringExtra(BankCalls.EXTRA_CALL_ID))
    }

    // receive_sharing_intent only reads ACTION_SEND, so text picked with "Check with Gaskiyya"
    // in another app's selection menu is handed over as an ordinary text share.
    private fun asShare(intent: Intent?): Intent? {
        if (intent?.action != Intent.ACTION_PROCESS_TEXT) return intent
        val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.takeIf { it.isNotBlank() } ?: return intent
        return Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val calls = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ng.gaskiya/calls")
        calls.setMethodCallHandler { call, result ->
            when (call.method) {
                "drainEvents" -> result.success(BankCalls.drain { e -> runOnUiThread { calls.invokeMethod("callEvent", e) } })
                "ring" -> {
                    (call.arguments as? Map<*, *>)?.let { BankCalls.ring(this, it) }
                    result.success(null)
                }
                "endCall" -> {
                    BankCalls.end(this, (call.arguments as? Map<*, *>)?.get("callId") as? String)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ng.gaskiya/shield.setup").setMethodCallHandler { call, result ->
            when (call.method) {
                "status" -> result.success(
                    mapOf(
                        "screening" to holdsRole(ROLE_SCREENING),
                        "redirection" to holdsRole(ROLE_REDIRECTION),
                        "overlay" to ShieldOverlay.canDraw(this),
                        "notifications" to hasNotificationAccess(),
                        "supported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q),
                    ),
                )
                "requestScreeningRole" -> result.success(requestRole(ROLE_SCREENING) || openDefaultApps())
                "requestRedirectionRole" -> result.success(requestRole(ROLE_REDIRECTION) || openDefaultApps())
                "openOverlaySettings" -> {
                    askPostNotifications()
                    result.success(open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))))
                }
                "openNotificationAccess" -> {
                    askPostNotifications()
                    result.success(openNotificationAccess())
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun holdsRole(role: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val rm = getSystemService(RoleManager::class.java) ?: return false
        return rm.isRoleAvailable(role) && rm.isRoleHeld(role)
    }

    private fun requestRole(role: String): Boolean {
        askPostNotifications()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val rm = getSystemService(RoleManager::class.java) ?: return false
        if (!rm.isRoleAvailable(role) || rm.isRoleHeld(role)) return rm.isRoleHeld(role)
        return try {
            @Suppress("DEPRECATION")
            startActivityForResult(rm.createRequestRoleIntent(role), REQUEST_ROLE)
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun hasNotificationAccess(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(this, ShieldNotificationListener::class.java)
        return enabled.split(":").any { ComponentName.unflattenFromString(it) == me }
    }

    private fun openNotificationAccess(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ComponentName(this, ShieldNotificationListener::class.java).flattenToString())
            if (open(detail)) return true
        }
        return open(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
    }

    private fun askPostNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    // Where the role dialog is unavailable, the phone's own Default apps page still lets the person choose Gaskiyya.
    private fun openDefaultApps(): Boolean = open(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))

    private fun open(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (_: Throwable) {
        false
    }

    companion object {
        private const val REQUEST_ROLE = 4101
        private const val REQUEST_NOTIFICATIONS = 4102
        private const val ROLE_SCREENING = "android.app.role.CALL_SCREENING"
        private const val ROLE_REDIRECTION = "android.app.role.CALL_REDIRECTION"
    }
}
