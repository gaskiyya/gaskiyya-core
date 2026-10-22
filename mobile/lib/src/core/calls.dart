import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'copy.dart';

// Bank calls that ring like a phone call: CallKit on iPhone (ios/Runner/AppDelegate.swift) and an
// incoming-call notification with the phone's ringtone on Android (android/.../calls/BankCalls.kt).
// The calling bank's name and the call code are on the phone's own call screen; the app draws no call screen.
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
        'labels': labels(),
      });
    } catch (_) {}
  }

  /// The words on the phone's call screen, in the app's language. "caller" keeps {bank} and {code} for the
  /// phone to fill in, so an iPhone woken by a VoIP push with the app closed uses the last ones it was given.
  static Map<String, String> labels() {
    if (!Copy.loaded) return const {};
    final c = Copy.I;
    return {
      'caller': c.t('app.calls.callerName'),
      'incoming': c.t('call.mismatch'),
      'inCall': c.t('app.calls.inCall'),
      'answer': c.t('app.calls.answer'),
      'decline': c.t('app.calls.decline'),
      'end': c.t('app.calls.end'),
    };
  }

  /// Hands the iPhone the call screen's words before any call rings, for calls that arrive while the app is closed.
  Future<void> sendLabels() async {
    if (!_ios) return;
    try {
      await _channel.invokeMethod<void>('labels', labels());
    } catch (_) {}
  }

  Future<void> endCall(String callId) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('endCall', {'callId': callId});
    } catch (_) {}
  }
}
