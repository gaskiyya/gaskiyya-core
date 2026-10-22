import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/push.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakeTransport implements PushTransport {
  FakeTransport({this.available = true, this.initial});
  final bool available;
  final Map<String, dynamic>? initial;
  final refresh = StreamController<String>.broadcast();
  final incoming = StreamController<Map<String, dynamic>>.broadcast();
  final taps = StreamController<Map<String, dynamic>>.broadcast();

  @override
  Future<bool> start() async => available;
  @override
  Future<String?> token() async => 'fcm-token-1';
  @override
  Stream<String> get tokenRefresh => refresh.stream;
  @override
  Stream<Map<String, dynamic>> get messages => incoming.stream;
  @override
  Stream<Map<String, dynamic>> get opened => taps.stream;
  @override
  Future<Map<String, dynamic>?> launchedFrom() async => initial;
  @override
  String get platform => 'android';
}

({GaskiyaClient client, List<Map<String, dynamic>> devices}) registry() {
  final devices = <Map<String, dynamic>>[];
  final client = GaskiyaClient(
    baseUrl: 'http://registry',
    token: () async => 'customer-token',
    httpClient: MockClient((req) async {
      if (req.url.path == '/v1/devices') devices.add(jsonDecode(req.body) as Map<String, dynamic>);
      return http.Response('', 204);
    }),
  );
  return (client: client, devices: devices);
}

Map<String, dynamic> opened(String code) => {
      'type': 'call.opened',
      'callId': 'call_1',
      'bank': 'DemoBank',
      'purpose': 'card_activation',
      'code': code,
      'expiresAt': DateTime.now().add(const Duration(minutes: 3)).toUtc().toIso8601String(),
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('CALL-1 on the device: the push token is registered with the registry, and again when it rotates', () async {
    final r = registry();
    final t = FakeTransport();
    final push = PushService(t);
    await push.start(client: r.client, onNotice: (_) {}, onOpened: (_) {});
    expect(push.enabled, isTrue);
    expect(r.devices, [
      {'pushToken': 'fcm-token-1', 'platform': 'android'},
    ]);
    t.refresh.add('fcm-token-2');
    await pumpEventQueue();
    expect(r.devices.last['pushToken'], 'fcm-token-2');
    expect(push.registeredToken, 'fcm-token-2');
  });

  test('foreground notices and taps reach the app', () async {
    final r = registry();
    final t = FakeTransport(initial: opened('1111'));
    final notices = <Map<String, dynamic>>[];
    final taps = <Map<String, dynamic>>[];
    await PushService(t).start(client: r.client, onNotice: notices.add, onOpened: taps.add);
    expect(taps.single['code'], '1111');
    t.incoming.add(opened('4821'));
    t.taps.add(opened('4821'));
    await pumpEventQueue();
    expect(notices.single['code'], '4821');
    expect(taps.length, 2);
  });

  test('without Firebase configured, push stays off and nothing is registered', () async {
    final r = registry();
    final push = PushService(FakeTransport(available: false));
    await push.start(client: r.client, onNotice: (_) {}, onOpened: (_) {});
    expect(push.enabled, isFalse);
    expect(r.devices, isEmpty);
    expect(FirebaseConfig.options, isNull);
    expect(kIsWeb, isFalse);
  });
}
