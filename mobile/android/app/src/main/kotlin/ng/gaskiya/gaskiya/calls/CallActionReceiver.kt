package ng.gaskiya.gaskiya.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Decline on the incoming-call notification. Answer opens MainActivity instead, so the app is in front for the call.
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == BankCalls.ACTION_DECLINE) BankCalls.decline(context, intent.getStringExtra(BankCalls.EXTRA_CALL_ID))
    }
}
