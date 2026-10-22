import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/push.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakeTransport implements PushTransport {
  FakeTransport({this.available = true, this.initial, this.tokenFails = false});
  final bool available;
  final bool tokenFails;
  final Map<String, dynamic>? initial;
  final refresh = StreamController<String>.broadcast();
  final incoming = StreamController<Map<String, dynamic>>.broadcast();
  final taps = StreamController<Map<String, dynamic>>.broadcast();

  @override
  Future<bool> start() async => available;
  @override
  Future<String?> token() async => tokenFails ? throw StateError('apns-token-not-set') : 'fcm-token-1';
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

  test('a registration that fails is tried again until the registry has it', () async {
    final devices = <Map<String, dynamic>>[];
    var down = 2;
    final client = GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'customer-token',
      httpClient: MockClient((req) async {
        if (req.url.path != '/v1/devices') return http.Response('', 404);
        if (down-- > 0) return http.Response('{"code":"store_unavailable","message":"Store unreachable"}', 503);
        devices.add(jsonDecode(req.body) as Map<String, dynamic>);
        return http.Response('', 204);
      }),
    );
    final push = PushService(FakeTransport(), retryDelays: const [Duration(milliseconds: 5)]);
    await push.start(client: client, onNotice: (_) {}, onOpened: (_) {});
    expect(devices, isEmpty);
    expect(push.registeredToken, isNull);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(devices, [
      {'pushToken': 'fcm-token-1', 'platform': 'android'},
    ]);
    expect(push.registeredToken, 'fcm-token-1');
    await push.stop();
  });

  test('a push token that is late is asked for again until there is one, then registered', () async {
    final r = registry();
    final t = _LateToken(failures: 2);
    final push = PushService(t, retryDelays: const [Duration(milliseconds: 5)]);
    await push.start(client: r.client, onNotice: (_) {}, onOpened: (_) {});
    expect(r.devices, isEmpty);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(t.asked, greaterThanOrEqualTo(3));
    expect(r.devices, [
      {'pushToken': 'fcm-token-1', 'platform': 'android'},
    ]);
    await push.stop();
  });

  test('stopping push stops the retries', () async {
    var tries = 0;
    final client = GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'customer-token',
      httpClient: MockClient((req) async {
        tries++;
        return http.Response('', 503);
      }),
    );
    final push = PushService(FakeTransport(), retryDelays: const [Duration(milliseconds: 5)]);
    await push.start(client: client, onNotice: (_) {}, onOpened: (_) {});
    await push.stop();
    final after = tries;
    await Future<void>.delayed(const Duration(milliseconds: 40));
    expect(tries, after);
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

  test('a push token that is not ready at sign-in is registered when it arrives', () async {
    final r = registry();
    final t = FakeTransport(tokenFails: true);
    final push = PushService(t);
    await push.start(client: r.client, onNotice: (_) {}, onOpened: (_) {});
    expect(r.devices, isEmpty);
    t.refresh.add('fcm-token-2');
    await pumpEventQueue();
    expect(r.devices, [
      {'pushToken': 'fcm-token-2', 'platform': 'android'},
    ]);
  });

  test('an iPhone registers its VoIP token with the push token, and again when the VoIP token arrives later', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    const calls = MethodChannel('ng.gaskiya/calls');
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    String? voip;
    messenger.setMockMethodCallHandler(calls, (call) async => call.method == 'voipToken' ? voip : null);
    try {
      final r = registry();
      await PushService(FakeTransport()).start(client: r.client, onNotice: (_) {}, onOpened: (_) {});
      expect(r.devices.single.containsKey('voipToken'), isFalse);
      voip = 'ab' * 32;
      await messenger.handlePlatformMessage(calls.name, calls.codec.encodeMethodCall(MethodCall('voipToken', voip)), (_) {});
      await pumpEventQueue();
      expect(r.devices.last, {'pushToken': 'fcm-token-1', 'platform': 'android', 'voipToken': voip});
    } finally {
      messenger.setMockMethodCallHandler(calls, null);
      debugDefaultTargetPlatformOverride = null;
    }
  });

  test('push restarted while it is still starting (sign-in, then more banks found) registers with every bank', () async {
    final first = registry();
    final second = registry();
    final t = _SlowStart();
    final push = PushService(t);
    final notices = <Map<String, dynamic>>[];
    final a = push.start(client: first.client, onNotice: notices.add, onOpened: (_) {});
    final b = push.start(clients: [first.client, second.client], onNotice: notices.add, onOpened: (_) {});
    t.ready.complete(true);
    await Future.wait([a, b]);
    expect(push.enabled, isTrue);
    expect(first.devices, [
      {'pushToken': 'fcm-token-1', 'platform': 'android'},
    ]);
    expect(second.devices, [
      {'pushToken': 'fcm-token-1', 'platform': 'android'},
    ]);
    t.incoming.add(opened('4821'));
    await pumpEventQueue();
    expect(notices, hasLength(1));
    await push.stop();
  });

  test('the Firebase transport without app keys is off, and is tried again on the next start', () async {
    final t = FirebasePushTransport();
    expect(await t.start(), isFalse);
    expect(await t.start(), isFalse);
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

class _LateToken extends FakeTransport {
  _LateToken({required this.failures});
  int failures;
  int asked = 0;
  @override
  Future<String?> token() async {
    asked++;
    if (failures-- > 0) throw StateError('apns-token-not-set');
    return 'fcm-token-1';
  }
}

class _SlowStart extends FakeTransport {
  final ready = Completer<bool>();
  @override
  Future<bool> start() => ready.future;
}
