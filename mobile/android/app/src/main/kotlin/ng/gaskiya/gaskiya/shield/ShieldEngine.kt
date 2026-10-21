package ng.gaskiya.gaskiya.shield

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel

object ShieldEngine {
    const val CHANNEL = "ng.gaskiya/shield"
    private const val MAX_QUEUE = 20

    private val main = Handler(Looper.getMainLooper())
    private var engine: FlutterEngine? = null
    private var channel: MethodChannel? = null
    private var ready = false
    private val queue = ArrayDeque<Pair<String, Map<String, Any?>>>()

    fun send(context: Context, method: String, args: Map<String, Any?>) {
        val app = context.applicationContext
        main.post {
            try {
                ensure(app)
                val ch = channel
                if (ready && ch != null) {
                    ch.invokeMethod(method, args)
                } else {
                    if (queue.size >= MAX_QUEUE) queue.removeFirst()
                    queue.addLast(method to args)
                }
            } catch (_: Throwable) {
            }
        }
    }

    private fun ensure(context: Context) {
        if (engine != null) return
        val loader = FlutterInjector.instance().flutterLoader()
        loader.startInitialization(context)
        loader.ensureInitializationComplete(context, null)
        val e = FlutterEngine(context)
        val ch = MethodChannel(e.dartExecutor.binaryMessenger, CHANNEL)
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "ready" -> {
                    ready = true
                    while (queue.isNotEmpty()) {
                        val (m, a) = queue.removeFirst()
                        ch.invokeMethod(m, a)
                    }
                    result.success(null)
                }
                "showOverlay" -> {
                    ShieldOverlay.show(
                        context,
                        title = call.argument<String>("title") ?: "",
                        body = call.argument<String>("body") ?: "",
                        tone = call.argument<String>("tone") ?: "warn",
                        close = call.argument<String>("close") ?: "",
                        channelName = call.argument<String>("channelName") ?: "",
                    )
                    result.success(null)
                }
                "notify" -> {
                    ShieldOverlay.notify(
                        context,
                        id = call.argument<Int>("id") ?: 7000,
                        title = call.argument<String>("title") ?: "",
                        body = call.argument<String>("body") ?: "",
                        tone = call.argument<String>("tone") ?: "warn",
                        channelName = call.argument<String>("channelName") ?: "",
                    )
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        engine = e
        channel = ch
        e.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "shieldMain"))
    }
}
