#if targetEnvironment(simulator)
import Flutter

@objc
public class GoogleMlKitTextRecognitionPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {}
}
#endif
