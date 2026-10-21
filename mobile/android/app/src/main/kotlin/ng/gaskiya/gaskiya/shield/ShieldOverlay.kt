package ng.gaskiya.gaskiya.shield

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

object ShieldOverlay {
    const val CHANNEL_ID = "shield"
    private const val AUTO_DISMISS_MS = 30_000L
    private const val OVERLAY_FALLBACK_ID = 6999

    private val main = Handler(Looper.getMainLooper())
    private var current: View? = null

    private fun dp(context: Context, v: Float): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics).toInt()

    private fun toneColor(tone: String): Int = when (tone) {
        "safe" -> Color.rgb(0x1C, 0x8A, 0x3A)
        "danger" -> Color.rgb(0xC6, 0x28, 0x28)
        else -> Color.rgb(0xC2, 0x5E, 0x00)
    }

    fun canDraw(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Settings.canDrawOverlays(context)

    fun show(context: Context, title: String, body: String, tone: String, close: String, channelName: String) {
        main.post {
            if (!canDraw(context)) {
                notify(context, OVERLAY_FALLBACK_ID, title, body, tone, channelName)
                return@post
            }
            try {
                draw(context, title, body, tone, close)
            } catch (_: Throwable) {
                notify(context, OVERLAY_FALLBACK_ID, title, body, tone, channelName)
            }
        }
    }

    private fun dismiss(context: Context) {
        val v = current ?: return
        current = null
        try {
            (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v)
        } catch (_: Throwable) {
        }
    }

    private fun draw(context: Context, title: String, body: String, tone: String, close: String) {
        dismiss(context)
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val pad = dp(context, 18f)
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, dp(context, 10f))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(context, 20f).toFloat()
                setStroke(dp(context, 4f), toneColor(tone))
            }
            elevation = dp(context, 12f).toFloat()
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        card.addView(TextView(context).apply {
            text = title
            setTextColor(Color.BLACK)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.DEFAULT_BOLD
        })
        card.addView(TextView(context).apply {
            text = body
            setTextColor(Color.BLACK)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setPadding(0, dp(context, 8f), 0, dp(context, 4f))
        })
        card.addView(Button(context).apply {
            text = close
            isAllCaps = false
            setTextColor(Color.BLACK)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.DEFAULT_BOLD
            minHeight = dp(context, 48f)
            setOnClickListener { dismiss(context) }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.END
        })
        card.contentDescription = "$title. $body"

        @Suppress("DEPRECATION")
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP
            y = dp(context, 40f)
        }
        val frame = LinearLayout(context).apply {
            setPadding(dp(context, 12f), 0, dp(context, 12f), 0)
            addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        wm.addView(frame, params)
        current = frame
        main.postDelayed({ if (current === frame) dismiss(context) }, AUTO_DISMISS_MS)
    }

    private fun ensureChannel(context: Context, channelName: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val name = channelName.ifBlank { "Gaskiyya" }
        val existing = manager.getNotificationChannel(CHANNEL_ID)
        if (existing != null && existing.name == name) return
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_HIGH))
    }

    fun notify(context: Context, id: Int, title: String, body: String, tone: String, channelName: String) {
        try {
            ensureChannel(context, channelName)
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pending = launch?.let {
                PendingIntent.getActivity(context, id, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(context, CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(context).setPriority(Notification.PRIORITY_HIGH)
            }
            builder
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setColor(toneColor(tone))
                .setCategory(Notification.CATEGORY_STATUS)
                .setAutoCancel(true)
            if (pending != null) builder.setContentIntent(pending)
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(id, builder.build())
        } catch (_: Throwable) {
        }
    }
}
