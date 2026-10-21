import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// Bank calls that ring through CallKit on iPhone (ios/Runner/AppDelegate.swift).
class NativeCalls {
  NativeCalls._() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'voipToken' && call.arguments is String) _tokens.add(call.arguments as String);
    });
  }

  static final instance = NativeCalls._();
  static const _channel = MethodChannel('ng.gaskiya/calls');
  final _tokens = StreamController<String>.broadcast();

  bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  Stream<String> get tokenRefresh => _tokens.stream;

  Future<String?> voipToken() async {
    if (!supported) return null;
    try {
      final t = await _channel.invokeMethod<String>('voipToken');
      return t == null || t.isEmpty ? null : t;
    } catch (_) {
      return null;
    }
  }

  Future<void> prepareAudio() async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('prepareAudio');
    } catch (_) {}
  }

  Future<void> endCall(String callId) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('endCall', {'callId': callId});
    } catch (_) {}
  }
}
