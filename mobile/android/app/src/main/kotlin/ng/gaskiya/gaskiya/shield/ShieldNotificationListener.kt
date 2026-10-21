package ng.gaskiya.gaskiya.shield

import android.app.Notification
import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class ShieldNotificationListener : NotificationListenerService() {
    private val whatsapp = setOf("com.whatsapp", "com.whatsapp.w4b")
    private val smsApps = setOf("com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging")

    private val recent = LinkedHashMap<String, Long>()

    private fun appOf(pkg: String): String? {
        if (pkg == packageName) return null
        if (pkg in whatsapp) return "whatsapp"
        if (pkg in smsApps) return "sms"
        val defaultSms = try {
            Telephony.Sms.getDefaultSmsPackage(this)
        } catch (_: Throwable) {
            null
        }
        return if (pkg == defaultSms) "sms" else null
    }

    private fun inCall(): Boolean {
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION
    }

    private fun lastMessage(extras: Bundle): Pair<String?, String?>? {
        @Suppress("DEPRECATION")
        val messages: Array<Parcelable>? = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        val last = messages?.lastOrNull() as? Bundle ?: return null
        val text = last.getCharSequence("text")?.toString()
        val sender = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            @Suppress("DEPRECATION")
            (last.getParcelable("sender_person") as? android.app.Person)?.name?.toString() ?: last.getCharSequence("sender")?.toString()
        } else {
            last.getCharSequence("sender")?.toString()
        }
        return sender to text
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val app = appOf(sbn.packageName) ?: return
            val n = sbn.notification ?: return
            if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
            val extras = n.extras ?: return
            val styled = lastMessage(extras)
            val sender = styled?.first?.takeIf { it.isNotBlank() }
                ?: extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
                ?: ""
            val text = styled?.second?.takeIf { it.isNotBlank() }
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?: return
            if (text.isBlank()) return
            val dedupe = "${sbn.key}|${text.hashCode()}"
            if (recent.containsKey(dedupe)) return
            recent[dedupe] = sbn.postTime
            while (recent.size > 100) recent.remove(recent.keys.first())
            ShieldEngine.send(
                this,
                "onMessage",
                mapOf("app" to app, "sender" to sender, "text" to text, "inCall" to inCall(), "postedAt" to sbn.postTime),
            )
        } catch (_: Throwable) {
        }
    }
}
