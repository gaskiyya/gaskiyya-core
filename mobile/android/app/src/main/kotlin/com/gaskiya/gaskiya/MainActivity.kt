package com.gaskiya.gaskiya

import android.content.Intent
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        intent = asShare(intent)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        val shared = asShare(intent) ?: intent
        setIntent(shared)
        super.onNewIntent(shared)
    }

    // receive_sharing_intent only reads ACTION_SEND, so text picked with "Check with Gaskiyya"
    // in another app's selection menu is handed over as an ordinary text share.
    private fun asShare(intent: Intent?): Intent? {
        if (intent?.action != Intent.ACTION_PROCESS_TEXT) return intent
        val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.takeIf { it.isNotBlank() } ?: return intent
        return Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    }
}
