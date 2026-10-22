import AVFoundation
import CallKit
import Flutter
import PushKit
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let bankCalls = BankCalls()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Before Flutter: a call push can wake the app with no engine running.
    bankCalls.start()
    #if DEBUG
      bankCalls.simulateFromLaunchArguments()
    #endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    bankCalls.attach(FlutterMethodChannel(name: "ng.gaskiya/calls", binaryMessenger: engineBridge.applicationRegistrar.messenger()))
    ShieldSetup.attach(FlutterMethodChannel(name: "ng.gaskiya/shield.setup", binaryMessenger: engineBridge.applicationRegistrar.messenger()))
  }
}

// Settings > Automatic protection on iPhone. iOS lets no app screen calls or read messages, so the
// one switch is notification permission: bank call alerts and scam warnings while the app is closed.
enum ShieldSetup {
  static func attach(_ channel: FlutterMethodChannel) {
    channel.setMethodCallHandler { call, result in
      let center = UNUserNotificationCenter.current()
      switch call.method {
      case "status":
        center.getNotificationSettings { s in
          let on = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
          DispatchQueue.main.async { result(["alerts": on, "supported": true]) }
        }
      case "requestAlerts":
        center.getNotificationSettings { s in
          DispatchQueue.main.async {
            // Once asked, iOS shows no second prompt: only the app's page in Settings can change it.
            guard s.authorizationStatus == .notDetermined else {
              if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
              return result(false)
            }
            center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
              DispatchQueue.main.async {
                if granted { UIApplication.shared.registerForRemoteNotifications() }
                result(granted)
              }
            }
          }
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}

// Bank calls on iPhone. The bank's announced call arrives as a VoIP push and rings through
// CallKit: the iPhone call screen and the ringtone chosen in Settings > Sounds. The caller name on
// that screen is the calling bank's name and the call code ("DemoBank · Code 4821"), so the person
// compares the code there; the app draws no call screen of its own. Answering plays the same agent
// voice as the console's simulated phone. What happens on the call screen (rang, answered, ended,
// missed) goes to Flutter as "callEvent" for the call log, held in UserDefaults until Flutter asks
// for them with "drainEvents".
final class BankCalls: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  private static let tokenKey = "gk.voipToken"
  private static let eventsKey = "gk.callEvents"
  private static let labelsKey = "gk.callLabels"
  private static let ringSeconds: TimeInterval = 30

  private struct Incoming {
    let callId: String
    let orgId: String
    let bank: String
    let code: String
    var answered = false
    var timeout: DispatchWorkItem?
  }

  private let provider: CXProvider
  private let registry = PKPushRegistry(queue: .main)
  private var channel: FlutterMethodChannel?
  private var ids: [String: UUID] = [:]
  private var calls: [UUID: Incoming] = [:]
  private var rung: Set<String> = []
  private var voice: AgentVoice?
  private var listening = false

  override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = false
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = true
    // ringtoneSound stays nil, so CallKit rings with the phone's own ringtone.
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  func start() {
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
  }

  func attach(_ channel: FlutterMethodChannel) {
    self.channel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "voipToken":
        result(UserDefaults.standard.string(forKey: BankCalls.tokenKey))
      case "drainEvents":
        self?.listening = true
        result(UserDefaults.standard.array(forKey: BankCalls.eventsKey) ?? [])
        UserDefaults.standard.removeObject(forKey: BankCalls.eventsKey)
      case "labels":
        // The call screen's words in the app's language, kept for calls that ring while the app is closed.
        BankCalls.saveLabels(call.arguments)
        result(nil)
      case "ring":
        // The app heard the call on its live connection; rings the same way without waiting for a VoIP push.
        if let p = call.arguments as? [String: Any], let id = p["callId"] as? String, self?.rung.contains(id) == false {
          BankCalls.saveLabels(p["labels"])
          self?.incoming(p) {}
        }
        result(nil)
      case "endCall":
        if let id = (call.arguments as? [String: Any])?["callId"] as? String { self?.end(callId: id, reason: .remoteEnded) }
        result(nil)
      case "prepareAudio":
        // Asked once at sign-in, so no prompt interrupts the first answered call.
        if #available(iOS 17.0, *) {
          AVAudioApplication.requestRecordPermission { _ in }
        } else {
          AVAudioSession.sharedInstance().requestRecordPermission { _ in }
        }
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  // MARK: PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    let token = credentials.token.map { String(format: "%02x", $0) }.joined()
    UserDefaults.standard.set(token, forKey: BankCalls.tokenKey)
    channel?.invokeMethod("voipToken", arguments: token)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    UserDefaults.standard.removeObject(forKey: BankCalls.tokenKey)
  }

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    incoming(payload.dictionaryPayload, completion: completion)
  }

  private func incoming(_ p: [AnyHashable: Any], completion: @escaping () -> Void) {
    let callId = p["callId"] as? String ?? UUID().uuidString
    let bank = p["bank"] as? String ?? "Your bank"
    let code = (p["code"] as? String ?? "").filter(\.isNumber)
    let orgId = p["orgId"] as? String ?? ""
    let expiresAt = (p["expiresAt"] as? String).flatMap(BankCalls.parseDate)
    let uuid = ids[callId] ?? UUID()
    ids[callId] = uuid
    rung.insert(callId)

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: bank)
    update.localizedCallerName = BankCalls.callerName(bank: bank, code: code)
    update.hasVideo = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false

    // iOS stops delivering VoIP pushes to an app that does not report each one as a call,
    // so the call is always reported, then ended at once if its code has already expired.
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      defer { completion() }
      guard let self, error == nil else { return }
      let ringFor = min(BankCalls.ringSeconds, expiresAt?.timeIntervalSinceNow ?? BankCalls.ringSeconds)
      let call = Incoming(callId: callId, orgId: orgId, bank: bank, code: code)
      self.emit("rang", call)
      if ringFor <= 0 {
        self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
        self.forget(uuid)
        self.emit("missed", call)
        return
      }
      let timeout = DispatchWorkItem { [weak self] in self?.missed(uuid) }
      self.calls[uuid] = Incoming(callId: callId, orgId: orgId, bank: bank, code: code, timeout: timeout)
      DispatchQueue.main.asyncAfter(deadline: .now() + ringFor, execute: timeout)
      BankCalls.trace("ringing \(update.localizedCallerName ?? "") for \(Int(ringFor))s")
    }
  }

  #if DEBUG
    // The Simulator cannot receive VoIP pushes. Launch with
    // -GKTestCall demobank 1234 [answerAfterSeconds] to ring with the payload the server sends.
    func simulateFromLaunchArguments() {
      let args = ProcessInfo.processInfo.arguments
      guard let i = args.firstIndex(of: "-GKTestCall"), args.count > i + 2 else { return }
      let orgId = args[i + 1]
      let code = args[i + 2]
      let answerAfter = args.count > i + 3 ? Double(args[i + 3]) : nil
      let callId = "test-\(Int(Date().timeIntervalSince1970))"
      let payload: [AnyHashable: Any] = [
        "callId": callId, "orgId": orgId, "bank": orgId == "demobank" ? "DemoBank" : orgId, "code": code,
        "expiresAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(180)),
      ]
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        self.incoming(payload) {}
        guard let answerAfter else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + answerAfter) {
          guard let uuid = self.ids[callId] else { return }
          CXCallController().request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { error in
            BankCalls.trace(error.map { "answer failed: \($0.localizedDescription)" } ?? "answer requested")
          }
        }
      }
    }
  #endif

  static func trace(_ message: String) {
    #if DEBUG
      NSLog("GKCALL %@", message)
    #endif
  }

  // MARK: CallKit

  func providerDidReset(_ provider: CXProvider) {
    voice?.stop()
    voice = nil
    calls.values.forEach { $0.timeout?.cancel() }
    calls.removeAll()
    ids.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard var call = calls[action.callUUID] else { return action.fail() }
    call.timeout?.cancel()
    call.answered = true
    calls[action.callUUID] = call
    // .voiceChat adds voice processing that turns playback down; nothing is recorded, so plain playback is louder.
    try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [])
    voice?.stop()
    voice = AgentVoice(orgId: call.orgId, code: call.code)
    action.fulfill()
    emit("answered", call)
    BankCalls.trace("answered")
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    BankCalls.trace("audio session active")
    voice?.start()
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    voice?.stop()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    if let call = calls[action.callUUID] {
      if call.answered {
        voice?.stop()
        voice = nil
      }
      emit("ended", call)
    }
    forget(action.callUUID)
    action.fulfill()
  }

  // As on the console's phone, mute silences the agent's voice.
  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    voice?.muted = action.isMuted
    action.fulfill()
  }

  // MARK: Helpers

  private func missed(_ uuid: UUID) {
    guard let call = calls[uuid], !call.answered else { return }
    provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
    forget(uuid)
    emit("missed", call)
    BankCalls.trace("missed")
  }

  private func end(callId: String, reason: CXCallEndedReason) {
    guard let uuid = ids[callId], let call = calls[uuid] else { return }
    if call.answered {
      voice?.stop()
      voice = nil
    }
    provider.reportCall(with: uuid, endedAt: nil, reason: reason)
    forget(uuid)
  }

  private func emit(_ event: String, _ call: Incoming) {
    let e: [String: Any] = [
      "event": event, "callId": call.callId, "orgId": call.orgId, "bank": call.bank, "code": call.code,
      "at": Int(Date().timeIntervalSince1970 * 1000),
    ]
    if listening, let channel {
      channel.invokeMethod("callEvent", arguments: e)
      return
    }
    let held = UserDefaults.standard.array(forKey: BankCalls.eventsKey) ?? []
    UserDefaults.standard.set(Array((held + [e]).suffix(50)), forKey: BankCalls.eventsKey)
  }

  private func forget(_ uuid: UUID) {
    if let call = calls.removeValue(forKey: uuid) {
      call.timeout?.cancel()
      ids.removeValue(forKey: call.callId)
    } else {
      ids = ids.filter { $0.value != uuid }
    }
  }

  // What the iPhone call screen shows as the caller: the calling bank and its code, e.g. "DemoBank · Code 4821",
  // in the app's language once Flutter has sent its labels.
  static func callerName(bank: String, code: String) -> String {
    guard !code.isEmpty else { return bank }
    let labels = UserDefaults.standard.dictionary(forKey: labelsKey) as? [String: String]
    let template = labels?["caller"].flatMap { $0.contains("{bank}") && $0.contains("{code}") ? $0 : nil } ?? "{bank} · Code {code}"
    return template.replacingOccurrences(of: "{bank}", with: bank).replacingOccurrences(of: "{code}", with: code)
  }

  private static func saveLabels(_ value: Any?) {
    guard let labels = value as? [String: String], !labels.isEmpty else { return }
    UserDefaults.standard.set(labels, forKey: labelsKey)
  }

  private static func parseDate(_ s: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
  }
}

// The agent's voice, timed like console/src/device/agentVoice.ts: the organisation's opening
// ("Hello, good day. I am calling from DemoBank. Your code is"), then each digit of the code,
// using the same clips (assets/audio/agent) and the pauses in voice.json.
final class AgentVoice {
  private let ids: [String]
  private var pauses: (afterOpening: TimeInterval, betweenDigits: TimeInterval) = (0.38, 0.24)
  private var players: [AVAudioPlayer] = []
  private var started = false

  var muted = false {
    didSet { players.forEach { $0.volume = muted ? 0 : 1 } }
  }

  init(orgId: String, code: String) {
    var clips: Set<String> = []
    if let url = AgentVoice.asset("voice.json"),
      let data = try? Data(contentsOf: url),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    {
      clips = Set((json["clips"] as? [String: Any])?.keys.map { $0 } ?? [])
      if let p = json["pauses"] as? [String: Double] {
        pauses = ((p["afterOpening"] ?? 380) / 1000, (p["betweenDigits"] ?? 240) / 1000)
      }
    }
    let opening = clips.contains("opening-\(orgId)") ? "opening-\(orgId)" : "opening-generic"
    let digits = Array(code)
    ids = [opening] + digits.enumerated().map { i, d in "digit-\(d)-\(i == digits.count - 1 ? "last" : "mid")" }
  }

  func start() {
    guard !started else { return }
    started = true
    let loaded = ids.compactMap { id in AgentVoice.asset("\(id).wav").flatMap { try? AVAudioPlayer(contentsOf: $0) }.map { (id, $0) } }
    players = loaded.map(\.1)
    guard let first = players.first else { return BankCalls.trace("voice clips missing") }
    let now = first.deviceCurrentTime
    var at = now + 0.6
    for (i, (id, player)) in loaded.enumerated() {
      player.volume = muted ? 0 : 1
      player.prepareToPlay()
      player.play(atTime: at)
      BankCalls.trace(String(format: "voice %@ at +%.2fs (%.2fs)", id, at - now, player.duration))
      at += player.duration + (i == 0 ? pauses.afterOpening : pauses.betweenDigits)
    }
  }

  func stop() {
    players.forEach { $0.stop() }
    players.removeAll()
  }

  private static func asset(_ name: String) -> URL? {
    let key = FlutterDartProject.lookupKey(forAsset: "assets/audio/agent/\(name)")
    let url = Bundle.main.bundleURL.appendingPathComponent(key)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }
}
