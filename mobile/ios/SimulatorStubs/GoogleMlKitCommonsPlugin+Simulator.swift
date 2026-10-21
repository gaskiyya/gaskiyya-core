#if targetEnvironment(simulator)
import Flutter

@objc
public class GoogleMlKitCommonsPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {}
}
#endif
