import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// Bank calls that ring like a phone call: CallKit on iPhone (ios/Runner/AppDelegate.swift) and an
// incoming-call notification with the phone's ringtone on Android (android/.../calls/BankCalls.kt).
class NativeCalls {
  NativeCalls._() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'voipToken' && call.arguments is String) _tokens.add(call.arguments as String);
    });
  }

  static final instance = NativeCalls._();
  static const _channel = MethodChannel('ng.gaskiya/calls');
  final _tokens = StreamController<String>.broadcast();

  bool get supported => _ios || (!kIsWeb && defaultTargetPlatform == TargetPlatform.android);
  bool get _ios => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  Stream<String> get tokenRefresh => _tokens.stream;

  Future<String?> voipToken() async {
    if (!_ios) return null;
    try {
      final t = await _channel.invokeMethod<String>('voipToken');
      return t == null || t.isEmpty ? null : t;
    } catch (_) {
      return null;
    }
  }

  Future<void> prepareAudio() async {
    if (!_ios) return;
    try {
      await _channel.invokeMethod<void>('prepareAudio');
    } catch (_) {}
  }

  Future<void> ring({required String callId, required String orgId, required String bank, required String code, required DateTime expiresAt}) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('ring', {
        'callId': callId,
        'orgId': orgId,
        'bank': bank,
        'code': code,
        'expiresAt': expiresAt.toUtc().toIso8601String(),
        'expiresInMs': expiresAt.difference(DateTime.now()).inMilliseconds,
      });
    } catch (_) {}
  }

  Future<void> endCall(String callId) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('endCall', {'callId': callId});
    } catch (_) {}
  }
}
