package ng.gaskiya.gaskiya.shield

import android.net.Uri
import android.os.Build
import android.telecom.CallRedirectionService
import android.telecom.PhoneAccountHandle
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.Q)
class ShieldRedirectionService : CallRedirectionService() {
    override fun onPlaceCall(handle: Uri, initialPhoneAccount: PhoneAccountHandle, allowInteractiveResponse: Boolean) {
        placeCallUnmodified()
        val number = handle.schemeSpecificPart ?: return
        ShieldEngine.send(this, "onOutgoingCall", mapOf("number" to number))
    }
}
