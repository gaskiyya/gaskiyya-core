package ng.gaskiya.gaskiya.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Decline on the incoming-call notification and End call on the ongoing one. Answer opens MainActivity instead.
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra(BankCalls.EXTRA_CALL_ID)
        when (intent.action) {
            BankCalls.ACTION_DECLINE -> BankCalls.decline(context, callId)
            BankCalls.ACTION_END -> BankCalls.hangUp(context, callId)
        }
    }
}
