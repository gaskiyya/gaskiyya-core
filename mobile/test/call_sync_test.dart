import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';

import 'support.dart';

// Both ends hang up together, and the demo's fraud call rings with no code and a "not calling" warning.

const _channel = MethodChannel('ng.gaskiya/calls');

Map<String, dynamic> opened(String id, String code, {String? token}) => {
      'type': 'call.opened',
      'callId': id,
      'bank': 'DemoBank',
      'purpose': 'fraud_check',
      'code': code,
      'expiresAt': DateTime.now().add(const Duration(minutes: 3)).toUtc().toIso8601String(),
      'token': ?token,
    };

Map<String, dynamic> unverified(String id) => {
      'type': 'call.unverified',
      'callId': id,
      'bank': 'DemoBank',
      'purpose': 'unverified',
      // A code in the payload must never reach the screen for an unverified call.
      'code': '9999',
      'caller': 'DemoBank',
      'number': '+234 1 270 0000',
      'token': 'demobank.abc123',
      'expiresAt': DateTime.now().add(const Duration(minutes: 1)).toUtc().toIso8601String(),
    };

Future<void> nativeEvent(WidgetTester tester, String event, String callId, {String kind = 'bank'}) =>
    tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      'ng.gaskiya/calls',
      const StandardMethodCodec().encodeMethodCall(MethodCall('callEvent', {
        'event': event,
        'callId': callId,
        'orgId': 'demobank',
        'bank': 'DemoBank',
        'code': kind == 'bank' ? '4821' : '',
        if (kind != 'bank') 'kind': kind,
      })),
      (_) {},
    );

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  late List<MethodCall> native;
  setUp(() {
    native = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_channel, (call) async {
      native.add(call);
      return null;
    });
  });
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null));

  List<String> posted(FakeRegistry r) => [for (final c in r.calls) if (c.path.startsWith('/v1/calls/call_')) c.path];

  testWidgets('the ring hands the phone the call token and the registry address, so it can hang up with the app closed', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    state.handleNotice(opened('call_1', '4821', token: 'demobank.tok'), state.links.single);
    await settle(tester);
    final ring = native.lastWhere((c) => c.method == 'ring').arguments as Map;
    expect(ring['callId'], 'call_1');
    expect(ring['code'], '4821');
    expect(ring['kind'], 'bank');
    expect(ring['token'], 'demobank.tok');
    expect(ring['apiUrl'], isA<String>());
    state.dispose();
    await registry.close();
  });

  testWidgets('answering and hanging up on the phone tell the registry, so the agent\'s call ends too', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    state.handleNotice(opened('call_1', '4821'), state.links.single);
    await nativeEvent(tester, 'answered', 'call_1');
    await settle(tester);
    await nativeEvent(tester, 'ended', 'call_1');
    await settle(tester);
    expect(posted(registry), ['/v1/calls/call_1/answer', '/v1/calls/call_1/end']);
    expect(state.callLog.single.outcome, CallOutcome.answered);

    state.handleNotice(opened('call_2', '7730'), state.links.single);
    await nativeEvent(tester, 'ended', 'call_2');
    await settle(tester);
    expect(posted(registry).last, '/v1/calls/call_2/end');
    expect(state.callLog.first.outcome, CallOutcome.declined);
    state.dispose();
    await registry.close();
  });

  testWidgets('the agent ends the call: the phone\'s call screen and the agent\'s voice stop, and the log shows it ended', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    state.handleNotice(opened('call_1', '4821'), state.links.single);
    await nativeEvent(tester, 'answered', 'call_1');
    await settle(tester);
    expect(state.activeCall?.id, 'call_1');

    state.handleNotice({'type': 'call.closed', 'callId': 'call_1', 'endedBy': 'agent'}, state.links.single);
    await settle(tester);
    expect(native.where((c) => c.method == 'endCall').map((c) => (c.arguments as Map)['callId']), contains('call_1'));
    expect(state.activeCall, isNull);
    final r = state.callLog.single;
    expect((r.outcome, r.endedAt != null), (CallOutcome.answered, true));

    // The phone's own call screen reports when it saw the agent hang up first.
    state.handleNotice(opened('call_2', '7730'), state.links.single);
    await nativeEvent(tester, 'closed', 'call_2');
    await settle(tester);
    expect(state.callLog.first.outcome, CallOutcome.missed);
    state.dispose();
    await registry.close();
  });

  testWidgets('a check that no longer finds an answered call ends it on the phone', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '4821';
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.runAsync(state.refreshCall);
    await nativeEvent(tester, 'answered', 'call_demobank');
    await settle(tester);
    expect(state.activeCall?.id, 'call_demobank');

    registry.calling.clear();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    await tester.runAsync(state.refreshCall);
    await settle(tester);
    expect(native.where((c) => c.method == 'endCall').map((c) => (c.arguments as Map)['callId']), contains('call_demobank'));
    expect(state.activeCall, isNull);
    state.dispose();
    await registry.close();
  });

  testWidgets('a fraud call rings with no code, flagged unverified, and the Calls tab says the bank is not calling until it ends', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
    await settle(tester);
    expect(find.text(Copy.I.t('official.org.notCallingTitle', {'bank': 'DemoBank'})), findsNothing);

    state.handleNotice(unverified('fraud_1'), state.links.single);
    await settle(tester);
    final ring = native.lastWhere((c) => c.method == 'ring').arguments as Map;
    expect(ring['kind'], 'unverified');
    expect(ring['code'], '');
    expect(ring['bank'], 'DemoBank');
    expect(ring['token'], 'demobank.abc123');
    expect((ring['labels'] as Map)['unverifiedCaller'], contains('{caller}'));

    expect(state.unverifiedCall?.id, 'fraud_1');
    expect(state.callLog.single.code, '');
    expect(find.text(Copy.I.t('official.org.notCallingTitle', {'bank': 'DemoBank'})), findsOneWidget);
    expect(find.byType(CodeDigits), findsNothing);
    expect(find.textContaining('9999'), findsNothing);
    expect(find.text(Copy.I.t('app.calls.notVerified')), findsOneWidget);

    // Declined on the phone: the registry hears it, and the warning goes.
    await nativeEvent(tester, 'ended', 'fraud_1', kind: 'unverified');
    await settle(tester);
    expect(posted(registry), isEmpty);
    expect(registry.calls.map((c) => c.path), contains('/v1/calls/fraud_1/end'));
    expect(state.unverifiedCall, isNull);
    expect(state.callLog.single.outcome, CallOutcome.declined);
    expect(find.text(Copy.I.t('official.org.notCallingTitle', {'bank': 'DemoBank'})), findsNothing);
    expect(find.text(Copy.I.t('app.calls.howItWorks')), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 7));
    state.dispose();
    await registry.close();
  });

  testWidgets('the console ends a fraud call: the phone hangs up and the warning goes', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    state.handleNotice(unverified('fraud_2'), state.links.single);
    await settle(tester);
    expect(state.unverifiedCall?.id, 'fraud_2');
    state.handleNotice({'type': 'call.closed', 'callId': 'fraud_2', 'endedBy': 'agent'}, state.links.single);
    await settle(tester);
    expect(native.where((c) => c.method == 'endCall').map((c) => (c.arguments as Map)['callId']), contains('fraud_2'));
    expect(state.unverifiedCall, isNull);
    expect(state.callLog.single.outcome, CallOutcome.missed);
    state.dispose();
    await registry.close();
  });
}
