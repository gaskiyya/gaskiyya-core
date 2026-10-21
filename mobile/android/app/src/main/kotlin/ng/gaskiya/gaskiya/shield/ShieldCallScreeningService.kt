package ng.gaskiya.gaskiya.shield

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService

class ShieldCallScreeningService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        respondToCall(details, CallResponse.Builder().build())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && details.callDirection != Call.Details.DIRECTION_INCOMING) return
        val number = details.handle?.schemeSpecificPart ?: return
        ShieldEngine.send(this, "onIncomingCall", mapOf("number" to number))
    }
}
