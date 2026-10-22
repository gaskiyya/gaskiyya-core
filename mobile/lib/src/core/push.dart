import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api.dart';
import 'calls.dart';

class FirebaseConfig {
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _senderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const _androidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const _androidApiKey = String.fromEnvironment('FIREBASE_ANDROID_API_KEY');
  static const _iosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
  static const _iosApiKey = String.fromEnvironment('FIREBASE_IOS_API_KEY');
  static const _iosBundleId = String.fromEnvironment('FIREBASE_IOS_BUNDLE_ID');

  static FirebaseOptions? get options {
    if (kIsWeb || _projectId.isEmpty || _senderId.isEmpty) return null;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        if (_androidAppId.isEmpty || _androidApiKey.isEmpty) return null;
        return const FirebaseOptions(apiKey: _androidApiKey, appId: _androidAppId, messagingSenderId: _senderId, projectId: _projectId);
      case TargetPlatform.iOS:
        if (_iosAppId.isEmpty || _iosApiKey.isEmpty) return null;
        return FirebaseOptions(
          apiKey: _iosApiKey,
          appId: _iosAppId,
          messagingSenderId: _senderId,
          projectId: _projectId,
          iosBundleId: _iosBundleId.isEmpty ? null : _iosBundleId,
        );
      default:
        return null;
    }
  }
}

abstract class PushTransport {
  Future<bool> start();
  Future<String?> token();
  Stream<String> get tokenRefresh;
  Stream<Map<String, dynamic>> get messages;
  Stream<Map<String, dynamic>> get opened;
  Future<Map<String, dynamic>?> launchedFrom();
  String get platform;
}

@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {
}

class FirebasePushTransport implements PushTransport {
  @override
  Future<bool> start() async {
    final options = FirebaseConfig.options;
    if (options == null) return false;
    try {
      await Firebase.initializeApp(options: options);
      FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);
      // The device registers even if alerts are declined: an iPhone still rings bank calls through CallKit.
      await FirebaseMessaging.instance.requestPermission(alert: true, sound: true, badge: false);
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<String?> token() async {
    final m = FirebaseMessaging.instance;
    // On iPhone the FCM token needs the APNs token, which can arrive a few seconds after launch.
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      for (var i = 0; i < 10 && await m.getAPNSToken() == null; i++) {
        await Future<void>.delayed(const Duration(seconds: 1));
      }
    }
    return m.getToken();
  }

  @override
  Stream<String> get tokenRefresh => FirebaseMessaging.instance.onTokenRefresh;

  @override
  Stream<Map<String, dynamic>> get messages => FirebaseMessaging.onMessage.map((m) => m.data);

  @override
  Stream<Map<String, dynamic>> get opened => FirebaseMessaging.onMessageOpenedApp.map((m) => m.data);

  @override
  Future<Map<String, dynamic>?> launchedFrom() async => (await FirebaseMessaging.instance.getInitialMessage())?.data;

  @override
  String get platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
}

class PushService {
  PushService(this.transport, {this.retryDelays = const [Duration(seconds: 5), Duration(seconds: 15), Duration(seconds: 45), Duration(minutes: 2), Duration(minutes: 5)]});

  final PushTransport transport;

  /// Delays between registration attempts; the last one repeats.
  final List<Duration> retryDelays;
  final _subs = <StreamSubscription<dynamic>>[];
  Timer? _retry;
  int _run = 0;
  bool enabled = false;
  String? registeredToken;

  Future<void> start({
    GaskiyaClient? client,
    List<GaskiyaClient> clients = const [],
    required void Function(Map<String, dynamic> data) onNotice,
    required void Function(Map<String, dynamic> data) onOpened,
  }) async {
    await stop();
    final run = _run;
    final all = [?client, ...clients];
    enabled = await transport.start();
    if (!enabled || run != _run) return;
    final calls = NativeCalls.instance;
    String? latest;
    var attempts = 0;
    Future<void> register(String? token) async {
      if (token != null && token.isNotEmpty) latest = token;
      if (run != _run) return;
      // On iOS the token waits for APNs, so it can be missing at first.
      if (latest == null) {
        try {
          final fresh = await transport.token();
          if (fresh != null && fresh.isNotEmpty) latest = fresh;
        } catch (_) {}
        if (run != _run) return;
      }
      final t = latest;
      final voip = t == null ? null : await calls.voipToken();
      var failed = t == null;
      for (final c in t == null ? const <GaskiyaClient>[] : all) {
        try {
          await c.registerDevice(t!, transport.platform, voipToken: voip);
          registeredToken = t;
        } catch (_) {
          failed = true;
        }
      }
      // An unregistered device gets no pushes, so keep retrying.
      _retry?.cancel();
      if (failed && run == _run) {
        final wait = retryDelays[attempts.clamp(0, retryDelays.length - 1)];
        attempts++;
        _retry = Timer(wait, () => register(null));
      } else if (!failed) {
        attempts = 0;
      }
    }

    await calls.prepareAudio();
    if (run != _run) return;
    _subs
      ..add(transport.tokenRefresh.listen(register))
      ..add(calls.tokenRefresh.listen((_) => register(null)));
    await register(null);
    if (run != _run) return;
    _subs
      ..add(transport.messages.listen(onNotice))
      ..add(transport.opened.listen(onOpened));
    final initial = await transport.launchedFrom();
    if (initial != null && run == _run) onOpened(initial);
  }

  Future<void> stop() async {
    _run++;
    _retry?.cancel();
    _retry = null;
    final subs = List.of(_subs);
    _subs.clear();
    await Future.wait(subs.map((s) => s.cancel().catchError((_) {}))).timeout(const Duration(seconds: 2), onTimeout: () => const []);
  }
}
