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
      final settings = await FirebaseMessaging.instance.requestPermission(alert: true, sound: true, badge: false);
      return settings.authorizationStatus == AuthorizationStatus.authorized || settings.authorizationStatus == AuthorizationStatus.provisional;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<String?> token() => FirebaseMessaging.instance.getToken();

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
  PushService(this.transport);

  final PushTransport transport;
  final _subs = <StreamSubscription<dynamic>>[];
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
    Future<void> register(String? token) async {
      if (token == null || token.isEmpty) return;
      final voip = await calls.voipToken();
      for (final c in all) {
        try {
          await c.registerDevice(token, transport.platform, voipToken: voip);
          registeredToken = token;
        } catch (_) {
        }
      }
    }

    await calls.prepareAudio();
    await register(await transport.token());
    if (run != _run) return;
    _subs
      ..add(transport.tokenRefresh.listen(register))
      ..add(calls.tokenRefresh.listen((_) => register(registeredToken)))
      ..add(transport.messages.listen(onNotice))
      ..add(transport.opened.listen(onOpened));
    final initial = await transport.launchedFrom();
    if (initial != null && run == _run) onOpened(initial);
  }

  Future<void> stop() async {
    _run++;
    final subs = List.of(_subs);
    _subs.clear();
    await Future.wait(subs.map((s) => s.cancel().catchError((_) {}))).timeout(const Duration(seconds: 2), onTimeout: () => const []);
  }
}
