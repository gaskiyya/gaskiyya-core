import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// Bank calls that ring like a phone call: CallKit on iPhone (ios/Runner/AppDelegate.swift) and an
// incoming-call notification with the phone's ringtone on Android (android/.../calls/BankCalls.kt).
class NativeCalls {
  NativeCalls._() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'voipToken' && call.arguments is String) _tokens.add(call.arguments as String);
      if (call.method == 'callEvent' && call.arguments is Map) _events.add(Map<String, dynamic>.from(call.arguments as Map));
    });
  }

  static final instance = NativeCalls._();
  static const _channel = MethodChannel('ng.gaskiya/calls');
  final _tokens = StreamController<String>.broadcast();
  final _events = StreamController<Map<String, dynamic>>.broadcast();

  bool get supported => _ios || (!kIsWeb && defaultTargetPlatform == TargetPlatform.android);
  bool get _ios => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  Stream<String> get tokenRefresh => _tokens.stream;

  /// What the person did on the phone's own call screen: rang, answered, ended or missed, with the call's
  /// callId, orgId, bank and code. Events from before the app was listening come first.
  Stream<Map<String, dynamic>> get events {
    StreamSubscription<Map<String, dynamic>>? live;
    late final StreamController<Map<String, dynamic>> out;
    out = StreamController(
      onListen: () async {
        final early = <Map<String, dynamic>>[];
        var drained = false;
        live = _events.stream.listen((e) => drained ? out.add(e) : early.add(e));
        if (supported) {
          try {
            for (final e in await _channel.invokeListMethod<Object?>('drainEvents') ?? const []) {
              if (e is Map) out.add(Map<String, dynamic>.from(e));
            }
          } catch (_) {}
        }
        drained = true;
        early.forEach(out.add);
      },
      onCancel: () => live?.cancel(),
    );
    return out.stream;
  }

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
