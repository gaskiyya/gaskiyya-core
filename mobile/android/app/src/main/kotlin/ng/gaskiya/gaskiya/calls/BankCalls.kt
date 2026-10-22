package ng.gaskiya.gaskiya.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
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
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

// Bank calls on Android, mirroring CallKit on iPhone: the phone's own ringtone and an incoming-call
// notification (full screen on a locked phone) until the call is answered, declined or runs out.
// The caller on that call screen is the calling bank's name and the call code ("DemoBank · Code 4821"),
// so the person compares the code there; the app draws no call screen of its own. Answering opens the
// app, plays the same agent voice as the iPhone and the console's simulated phone, and leaves an ongoing
// call notification with the bank, the code and End call until the call ends. The agent says the code
// again and again until the call ends.
// What happens to each call (rang, answered, ended, missed, closed by the bank) goes to Flutter for the call log.
//
// Both ends hang up together: answering, declining or ending here tells the registry with the call's own
// token, and while the call rings or is on, the registry is asked every few seconds whether the agent hung up.
// The demo's fraud call ("unverified") rings with the spoofed caller, no code, a "not verified" line and no voice.
object BankCalls {
    const val ACTION_ANSWER = "ng.gaskiya.calls.ANSWER"
    const val ACTION_DECLINE = "ng.gaskiya.calls.DECLINE"
    const val ACTION_END = "ng.gaskiya.calls.END"
    const val EXTRA_CALL_ID = "callId"
    private const val CHANNEL = "incoming_calls"
    private const val ONGOING_CHANNEL = "ongoing_calls"
    private const val NOTIFICATION_ID = 7301
    private const val ONGOING_ID = 7302
    private const val RING_MS = 30_000L
    private const val POLL_MS = 3_000L

    private data class Incoming(
        val callId: String,
        val orgId: String,
        val bank: String,
        val code: String,
        val labels: Labels,
        val token: String = "",
        val apiUrl: String = "",
        val unverified: Boolean = false,
    ) {
        val callerName get() = if (unverified) labels.unverifiedName(bank) else labels.callerName(bank, code)
    }

    // The call screen's words, in the app's language when Flutter sends them.
    private data class Labels(
        val caller: String,
        val incoming: String,
        val inCall: String,
        val answer: String,
        val decline: String,
        val end: String,
        val unverifiedCaller: String,
        val unverified: String,
    ) {
        fun callerName(bank: String, code: String) =
            if (code.isEmpty()) bank else caller.replace("{bank}", bank).replace("{code}", code)

        fun unverifiedName(caller: String) = unverifiedCaller.replace("{caller}", caller)

        companion object {
            fun from(raw: Any?): Labels {
                val m = raw as? Map<*, *> ?: emptyMap<Any, Any>()
                fun text(key: String, fallback: String) = (m[key] as? String)?.takeIf { it.isNotBlank() } ?: fallback
                val caller = text("caller", "{bank} · Code {code}").takeIf { "{bank}" in it && "{code}" in it } ?: "{bank} · Code {code}"
                return Labels(
                    caller = caller,
                    incoming = text("incoming", "The caller must read this code to you. If they can't, hang up."),
                    inCall = text("inCall", "On a call with {bank}"),
                    answer = text("answer", "Answer"),
                    decline = text("decline", "Decline"),
                    end = text("end", "End call"),
                    unverifiedCaller = text("unverifiedCaller", "{caller} · Not verified by Gaskiyya").takeIf { "{caller}" in it } ?: "{caller} · Not verified by Gaskiyya",
                    unverified = text("unverified", "Gaskiyya has not verified this call. Don't share any code, PIN or password."),
                )
            }
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var current: Incoming? = null
    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var voice: AgentVoice? = null
    private var missed: Runnable? = null
    private var poll: Runnable? = null
    private val io = Executors.newSingleThreadExecutor()
    private val held = mutableListOf<Map<String, Any>>()
    private var sink: ((Map<String, Any>) -> Unit)? = null

    fun drain(to: (Map<String, Any>) -> Unit): List<Map<String, Any>> {
        sink = to
        return held.toList().also { held.clear() }
    }

    private fun emit(event: String, call: Incoming) {
        val e = buildMap<String, Any> {
            putAll(mapOf("event" to event, "callId" to call.callId, "orgId" to call.orgId, "bank" to call.bank, "code" to call.code, "at" to System.currentTimeMillis()))
            if (call.unverified) put("kind", "unverified")
        }
        sink?.invoke(e) ?: run {
            held.add(e)
            if (held.size > 50) held.removeAt(0)
        }
    }

    fun ring(context: Context, args: Map<*, *>) {
        val ctx = context.applicationContext
        val callId = args["callId"] as? String ?: return
        if (current?.callId == callId) return
        val unverified = args["kind"] == "unverified"
        val call = Incoming(
            callId = callId,
            orgId = args["orgId"] as? String ?: "",
            bank = args["bank"] as? String ?: "Your bank",
            // An unverified call never shows a code, whatever the arguments say.
            code = if (unverified) "" else (args["code"] as? String ?: "").filter(Char::isDigit),
            labels = Labels.from(args["labels"]),
            token = args["token"] as? String ?: "",
            apiUrl = args["apiUrl"] as? String ?: "",
            unverified = unverified,
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
        watch(ctx)
    }

    fun answer(context: Context, callId: String?) {
        val call = current?.takeIf { it.callId == callId } ?: return
        val ctx = context.applicationContext
        stopRinging(ctx)
        if (!call.unverified) voice = AgentVoice(ctx, call.orgId, call.code).also { it.start() }
        notifyOngoing(ctx, call)
        emit("answered", call)
        post(call, "answer")
    }

    // End call on the ongoing call notification. done runs once the registry has heard, so a receiver can finish.
    fun hangUp(context: Context, callId: String?, done: () -> Unit = {}) = decline(context, callId, done)

    // Decline on the incoming call, or End call once on: the agent's call ends too.
    fun decline(context: Context, callId: String?, done: () -> Unit = {}) {
        val call = current?.takeIf { callId == null || it.callId == callId } ?: return done()
        stopAll(context.applicationContext)
        emit("ended", call)
        if (!post(call, "end") { done() }) done()
    }

    // The agent (or the console) ended the call: the call screen goes and the voice stops at once.
    private fun closed(ctx: Context, callId: String) {
        val call = current?.takeIf { it.callId == callId } ?: return
        stopAll(ctx)
        emit("closed", call)
    }

    // While the call rings or is on, asks the registry whether the other side has hung up.
    private fun watch(ctx: Context) {
        poll?.let(main::removeCallbacks)
        val tick = object : Runnable {
            override fun run() {
                val call = current ?: return
                post(call, "status") { status -> if (status == "ended" || status == "expired") closed(ctx, call.callId) }
                main.postDelayed(this, POLL_MS)
            }
        }
        poll = tick
        main.postDelayed(tick, POLL_MS)
    }

    // POSTs to the registry with the call's own token, off the main thread; then gets the call's status (or null).
    private fun post(call: Incoming, action: String, then: ((String?) -> Unit)? = null): Boolean {
        if (call.token.isEmpty() || call.apiUrl.isEmpty()) return false
        io.execute {
            val status = runCatching {
                val id = URLEncoder.encode(call.callId, "UTF-8")
                val conn = URL("${call.apiUrl.trimEnd('/')}/v1/calls/$id/$action").openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 8_000
                    conn.readTimeout = 8_000
                    conn.doOutput = true
                    conn.setRequestProperty("content-type", "application/json")
                    conn.outputStream.use { it.write(JSONObject().put("token", call.token).toString().toByteArray()) }
                    if (conn.responseCode != 200) null else JSONObject(conn.inputStream.bufferedReader().use { it.readText() }).optString("status")
                } finally {
                    conn.disconnect()
                }
            }.getOrNull()
            then?.let { main.post { it(status) } }
        }
        return true
    }

    fun end(context: Context, callId: String?) {
        if (callId == null || current?.callId == callId) stopAll(context.applicationContext)
    }

    private fun stopAll(ctx: Context) {
        poll?.let(main::removeCallbacks)
        poll = null
        stopRinging(ctx)
        ctx.getSystemService(NotificationManager::class.java)?.cancel(ONGOING_ID)
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
        // The phone's incoming call screen names the calling bank and shows its code as the caller.
        val caller = call.callerName
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)
        builder
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(caller)
            .setContentText(if (call.unverified) call.labels.unverified else call.labels.incoming)
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
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, call.labels.decline, decline)
                .addAction(android.R.drawable.sym_action_call, call.labels.answer, answer)
        }
        runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
    }

    // While the call is on: the bank, its code, a running timer and End call, in the status bar and on the lock screen.
    // A plain ongoing notification, as CallStyle needs a foreground service or a full-screen intent.
    private fun notifyOngoing(ctx: Context, call: Incoming) {
        val manager = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(ONGOING_CHANNEL, "Bank call in progress", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows the bank and its call code while you're on a call through Gaskiyya."
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(ctx, 3, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), flags)
        val end = PendingIntent.getBroadcast(
            ctx, 4,
            Intent(ctx, CallActionReceiver::class.java).setAction(ACTION_END).putExtra(EXTRA_CALL_ID, call.callId),
            flags,
        )
        val caller = call.callerName
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, ONGOING_CHANNEL) else Notification.Builder(ctx)
        builder
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(caller)
            .setContentText(if (call.unverified) call.labels.unverified else call.labels.inCall.replace("{bank}", call.bank))
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setUsesChronometer(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, call.labels.end, end)
        runCatching { manager.notify(ONGOING_ID, builder.build()) }
    }
}

// Plays the agent's opening line once and then the call code, digit by digit, again and again with a short
// pause until the call ends (stop()), from the Flutter assets shared with iOS (assets/audio/agent, rendered by
// scripts/voice/render.py). It holds transient audio focus while it speaks and stops if another app takes it.
private class AgentVoice(private val ctx: Context, orgId: String, code: String) {
    private val main = Handler(Looper.getMainLooper())
    private val ids: List<String>
    private var afterOpening = 380L
    private var betweenDigits = 240L
    private var betweenRepeats = 1_800L
    private var player: MediaPlayer? = null
    private var stopped = false
    private var focus: AudioFocusRequest? = null
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()

    init {
        val manifest = runCatching { JSONObject(ctx.assets.open(key("voice.json")).bufferedReader().use { it.readText() }) }.getOrNull()
        val clips = manifest?.optJSONObject("clips")
        manifest?.optJSONObject("pauses")?.let {
            afterOpening = it.optLong("afterOpening", afterOpening)
            betweenDigits = it.optLong("betweenDigits", betweenDigits)
            betweenRepeats = it.optLong("betweenRepeats", betweenRepeats)
        }
        val opening = if (clips?.has("opening-$orgId") == true) "opening-$orgId" else "opening-generic"
        ids = listOf(opening) + code.mapIndexed { i, d -> "digit-$d-${if (i == code.length - 1) "last" else "mid"}" }
    }

    fun start() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener { change -> if (change == AudioManager.AUDIOFOCUS_LOSS) main.post { stop() } }
                .build()
            focus = request
            ctx.getSystemService(AudioManager::class.java)?.requestAudioFocus(request)
        }
        main.postDelayed({ play(0) }, 600)
    }

    fun stop() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) focus?.let { ctx.getSystemService(AudioManager::class.java)?.abandonAudioFocusRequest(it) }
        focus = null
    }

    // After the last digit the code starts again (clip 1), until stop().
    private fun play(i: Int) {
        if (stopped || ids.size < 2) return
        if (i >= ids.size) return play(1)
        player?.release()
        val next = runCatching {
            ctx.assets.openFd(key("${ids[i]}.wav")).use { fd ->
                MediaPlayer().apply {
                    setAudioAttributes(attributes)
                    setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                    prepare()
                }
            }
        }.getOrNull()
        player = next
        if (next == null) {
            main.postDelayed({ play(i + 1) }, betweenDigits)
            return
        }
        val pause = when (i) {
            0 -> afterOpening
            ids.size - 1 -> betweenRepeats
            else -> betweenDigits
        }
        player?.setOnCompletionListener { main.postDelayed({ play(i + 1) }, pause) }
        player?.start()
    }

    private fun key(name: String) = FlutterInjector.instance().flutterLoader().getLookupKeyForAsset("assets/audio/agent/$name")
}
