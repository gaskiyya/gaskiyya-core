package ng.gaskiya.gaskiya.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Decline on the incoming-call notification and End call on the ongoing one; both end the agent's call too.
// Answer opens MainActivity instead.
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra(BankCalls.EXTRA_CALL_ID)
        // Kept alive until the registry has heard, so the agent's call ends even with the app closed.
        val pending = goAsync()
        when (intent.action) {
            BankCalls.ACTION_DECLINE -> BankCalls.decline(context, callId) { pending.finish() }
            BankCalls.ACTION_END -> BankCalls.hangUp(context, callId) { pending.finish() }
            else -> pending.finish()
        }
    }
}
