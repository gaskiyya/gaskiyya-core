package ng.gaskiya.gaskiya.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import io.flutter.FlutterInjector
import ng.gaskiya.gaskiya.MainActivity
import org.json.JSONObject

// Bank calls on Android, mirroring CallKit on iPhone: the phone's own ringtone and an incoming-call
// notification (full screen on a locked phone) until the call is answered, declined or runs out.
// Answering opens the app and plays the same agent voice as the iPhone and the console's simulated phone.
// What happens to each call (rang, answered, ended, missed) goes to Flutter for the call log and the in-call screen.
object BankCalls {
    const val ACTION_ANSWER = "ng.gaskiya.calls.ANSWER"
    const val ACTION_DECLINE = "ng.gaskiya.calls.DECLINE"
    const val EXTRA_CALL_ID = "callId"
    private const val CHANNEL = "incoming_calls"
    private const val NOTIFICATION_ID = 7301
    private const val RING_MS = 30_000L

    private data class Incoming(val callId: String, val orgId: String, val bank: String, val code: String)

    private val main = Handler(Looper.getMainLooper())
    private var current: Incoming? = null
    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var voice: AgentVoice? = null
    private var missed: Runnable? = null
    private val held = mutableListOf<Map<String, Any>>()
    private var sink: ((Map<String, Any>) -> Unit)? = null

    fun drain(to: (Map<String, Any>) -> Unit): List<Map<String, Any>> {
        sink = to
        return held.toList().also { held.clear() }
    }

    private fun emit(event: String, call: Incoming) {
        val e = mapOf("event" to event, "callId" to call.callId, "orgId" to call.orgId, "bank" to call.bank, "code" to call.code, "at" to System.currentTimeMillis())
        sink?.invoke(e) ?: run {
            held.add(e)
            if (held.size > 50) held.removeAt(0)
        }
    }

    fun ring(context: Context, args: Map<*, *>) {
        val ctx = context.applicationContext
        val callId = args["callId"] as? String ?: return
        if (current?.callId == callId) return
        val call = Incoming(
            callId = callId,
            orgId = args["orgId"] as? String ?: "",
            bank = args["bank"] as? String ?: "Your bank",
            code = (args["code"] as? String ?: "").filter(Char::isDigit),
        )
        val left = (args["expiresInMs"] as? Number)?.toLong() ?: RING_MS
        if (left <= 0) return
        stopAll(ctx)
        current = call
        startRinging(ctx)
        notify(ctx, call)
        emit("rang", call)
        missed = Runnable {
            if (current?.callId == callId) {
                stopAll(ctx)
                emit("missed", call)
            }
        }.also { main.postDelayed(it, minOf(RING_MS, left)) }
    }

    fun answer(context: Context, callId: String?) {
        val call = current?.takeIf { it.callId == callId } ?: return
        val ctx = context.applicationContext
        stopRinging(ctx)
        voice = AgentVoice(ctx, call.orgId, call.code).also { it.start() }
        emit("answered", call)
    }

    fun decline(context: Context, callId: String?) {
        val call = current ?: return
        if (callId != null && call.callId != callId) return
        stopAll(context.applicationContext)
        emit("ended", call)
    }

    fun end(context: Context, callId: String?) {
        if (callId == null || current?.callId == callId) stopAll(context.applicationContext)
    }

    private fun stopAll(ctx: Context) {
        stopRinging(ctx)
        voice?.stop()
        voice = null
        current = null
    }

    private fun stopRinging(ctx: Context) {
        missed?.let(main::removeCallbacks)
        missed = null
        ringtone?.stop()
        ringtone = null
        vibrator?.cancel()
        vibrator = null
        ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    // Ringer volume and silent/vibrate mode apply as for any phone call.
    private fun startRinging(ctx: Context) {
        val uri = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ringtone = RingtoneManager.getRingtone(ctx, uri)?.apply {
            audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
            play()
        }
        val audio = ctx.getSystemService(AudioManager::class.java)
        if (audio?.ringerMode == AudioManager.RINGER_MODE_SILENT) return
        vibrator = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        })?.apply {
            val pattern = longArrayOf(0, 1000, 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrate(pattern, 0)
            }
        }
    }

    private fun notify(ctx: Context, call: Incoming) {
        val manager = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Silent channel: the ringtone above loops for the whole call, a channel sound would play once.
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Incoming bank calls", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Rings when your bank calls you through Gaskiyya."
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), flags)
        val answer = PendingIntent.getActivity(
            ctx, 1,
            Intent(ctx, MainActivity::class.java).setAction(ACTION_ANSWER).putExtra(EXTRA_CALL_ID, call.callId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            flags,
        )
        val decline = PendingIntent.getBroadcast(
            ctx, 2,
            Intent(ctx, CallActionReceiver::class.java).setAction(ACTION_DECLINE).putExtra(EXTRA_CALL_ID, call.callId),
            flags,
        )
        val caller = if (call.code.isEmpty()) call.bank else "${call.bank} · Code ${call.code}"
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)
        builder
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(caller)
            .setContentText("Incoming call")
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val person = Person.Builder().setName(caller).setImportant(true).build()
            builder.setStyle(Notification.CallStyle.forIncomingCall(person, decline, answer))
        } else {
            @Suppress("DEPRECATION")
            builder
                .setPriority(Notification.PRIORITY_MAX)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline)
                .addAction(android.R.drawable.sym_action_call, "Answer", answer)
        }
        runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
    }
}

// Plays the agent's opening line and then the call code, digit by digit, from the Flutter assets
// shared with iOS (assets/audio/agent, rendered by scripts/voice/render.py).
private class AgentVoice(private val ctx: Context, orgId: String, code: String) {
    private val main = Handler(Looper.getMainLooper())
    private val ids: List<String>
    private var afterOpening = 380L
    private var betweenDigits = 240L
    private var player: MediaPlayer? = null
    private var stopped = false

    init {
        val manifest = runCatching { JSONObject(ctx.assets.open(key("voice.json")).bufferedReader().use { it.readText() }) }.getOrNull()
        val clips = manifest?.optJSONObject("clips")
        manifest?.optJSONObject("pauses")?.let {
            afterOpening = it.optLong("afterOpening", afterOpening)
            betweenDigits = it.optLong("betweenDigits", betweenDigits)
        }
        val opening = if (clips?.has("opening-$orgId") == true) "opening-$orgId" else "opening-generic"
        ids = listOf(opening) + code.mapIndexed { i, d -> "digit-$d-${if (i == code.length - 1) "last" else "mid"}" }
    }

    fun start() = main.postDelayed({ play(0) }, 600)

    fun stop() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        player?.release()
        player = null
    }

    private fun play(i: Int) {
        if (stopped || i >= ids.size) return
        player?.release()
        player = runCatching {
            ctx.assets.openFd(key("${ids[i]}.wav")).use { fd ->
                MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                    prepare()
                }
            }
        }.getOrNull() ?: return play(i + 1)
        player?.setOnCompletionListener { main.postDelayed({ play(i + 1) }, if (i == 0) afterOpening else betweenDigits) }
        player?.start()
    }

    private fun key(name: String) = FlutterInjector.instance().flutterLoader().getLookupKeyForAsset("assets/audio/agent/$name")
}
