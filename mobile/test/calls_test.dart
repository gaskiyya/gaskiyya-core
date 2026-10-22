import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

Map<String, dynamic> call(String id, String code, String purpose) =>
    {'id': id, 'purpose': purpose, 'code': code, 'status': 'open', 'openedAt': '2026-10-20T12:00:00Z', 'expiresAt': '2099-01-01T00:00:00Z'};

GaskiyaClient answering(Map<String, dynamic> body) =>
    GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) async => http.Response(jsonEncode(body), 200)));

Finder code(String c) => find.byWidgetPredicate((w) => w is CodeDigits && w.code == c);

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  final two = {
    'verdict': 'calling',
    'calling': true,
    'bank': 'DemoBank',
    'call': call('call_2', '9031', 'card_activation'),
    'calls': [call('call_2', '9031', 'card_activation'), call('call_1', '1442', 'fraud_check')],
  };

  test('F10: every open call is read, newest first; an older registry sending only `call` still works', () async {
    final s = await answering(two).openCall();
    expect(s.calls.map((c) => c.code), ['9031', '1442']);
    expect(s.call?.code, '9031');
    final old = await answering({'calling': true, 'bank': 'DemoBank', 'call': call('call_1', '1442', 'fraud_check')}).openCall();
    expect(old.calls.map((c) => c.code), ['1442']);
    final blank = await answering({...two, 'calls': [call('call_2', '9031', 'card_activation'), call('call_1', '', 'fraud_check')]}).openCall();
    expect(blank.cannotCheck, isTrue);
  });

  testWidgets('F10: the Calls tab shows the code of every agent calling from a bank, and a closed call drops out', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')])
      ..calling['demobank'] = '9031'
      ..moreCalls['demobank'] = ['1442']
      ..calling['acme'] = '4719';
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank', 'acme'])))!;
    await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
    await tester.runAsync(state.refreshCall);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(code('9031'), findsOneWidget);
    expect(code('1442'), findsOneWidget);
    expect(code('4719'), findsOneWidget);
    final demo = state.links.firstWhere((l) => l.id == 'demobank');
    expect(demo.liveCalls.map((c) => c.code), ['9031', '1442']);
    expect(find.text(Copy.I.t('call.mismatchMany')), findsOneWidget);
    expect(find.text(Copy.I.t('call.mismatch')), findsNothing);
    expect(find.text(Copy.I.t('app.calls.checkAgain')), findsOneWidget);

    state.handleNotice({'type': 'call.closed', 'callId': 'call_demobank'});
    await tester.pump(const Duration(seconds: 1));
    expect(code('9031'), findsNothing);
    expect(code('1442'), findsOneWidget);
    expect(code('4719'), findsOneWidget);

    state.handleNotice({'type': 'call.opened', ...call('call_3', '5517', 'loan_follow_up'), 'callId': 'call_3', 'bank': 'DemoBank'});
    await tester.pump(const Duration(seconds: 1));
    expect(demo.liveCalls.map((c) => c.code), ['5517', '1442']);
    await tester.pumpWidget(hostWith(const SizedBox()));
    state.dispose();
    await registry.close();
  });

  testWidgets('the phone\'s call screen names the bank that is calling, with its code, for any linked bank', (tester) async {
    final native = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('ng.gaskiya/calls'), (c) async {
      native.add(c);
      return null;
    });
    final registry = FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')])..calling['acme'] = '4719';
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank', 'acme'])))!;
    await tester.runAsync(state.refreshCall);

    final ring = native.singleWhere((c) => c.method == 'ring').arguments as Map;
    expect(ring, containsPair('bank', 'Acme Bank'));
    expect(ring, containsPair('code', '4719'));
    final labels = Map<String, String>.from(ring['labels'] as Map);
    final caller = labels['caller']!.replaceAll('{bank}', ring['bank'] as String).replaceAll('{code}', ring['code'] as String);
    expect(caller, Copy.I.t('app.calls.callerName', {'bank': 'Acme Bank', 'code': '4719'}));
    expect(caller, allOf(contains('Acme Bank'), contains('4719')));
    expect(caller, isNot(contains('DemoBank')));
    expect(labels.values.where((v) => v.contains('DemoBank')), isEmpty);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('ng.gaskiya/calls'), null);
    state.dispose();
    await registry.close();
  });

  testWidgets('a bank call rings the phone once, before it is answered, and stops when the bank closes it', (tester) async {
    final native = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('ng.gaskiya/calls'), (c) async {
      native.add(c);
      return null;
    });
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '9031';
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.runAsync(state.refreshCall);
    await tester.runAsync(state.refreshCall);
    state.handleNotice({'type': 'call.opened', ...call('call_3', '5517', 'loan_follow_up'), 'callId': 'call_3', 'bank': 'DemoBank'});
    state.handleNotice({'type': 'call.opened', ...call('call_3', '5517', 'loan_follow_up'), 'callId': 'call_3', 'bank': 'DemoBank'});
    state.handleNotice({'type': 'call.opened', ...call('call_4', '2210', 'fraud_check'), 'status': 'answered', 'callId': 'call_4', 'bank': 'DemoBank'});

    final rings = native.where((c) => c.method == 'ring').map((c) => c.arguments as Map).toList();
    expect(rings.map((r) => r['code']), ['9031', '5517']);
    expect(rings.first, containsPair('bank', 'DemoBank'));
    expect(rings.first, containsPair('orgId', 'demobank'));
    expect(rings.first['expiresInMs'], greaterThan(0));

    state.handleNotice({'type': 'call.closed', 'callId': 'call_3'});
    expect(native.where((c) => c.method == 'endCall').map((c) => (c.arguments as Map)['callId']), ['call_3']);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('ng.gaskiya/calls'), null);
    state.dispose();
    await registry.close();
  });

  testWidgets('calls arriving together ring the phone once, for the newest', (tester) async {
    final native = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('ng.gaskiya/calls'), (c) async {
      native.add(c);
      return null;
    });
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')])
      ..calling['demobank'] = '9031'
      ..moreCalls['demobank'] = ['1442', '7730'];
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.runAsync(state.refreshCall);
    await tester.runAsync(state.refreshCall);
    expect(state.links.single.liveCalls.map((c) => c.code), ['9031', '1442', '7730']);
    expect(native.where((c) => c.method == 'ring').map((c) => (c.arguments as Map)['code']), ['9031']);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('ng.gaskiya/calls'), null);
    state.dispose();
    await registry.close();
  });

  testWidgets('F3: the call countdown ticks down while the Calls tab is on screen', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '9031';
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.runAsync(state.refreshCall);
    await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
    await tester.pump();
    final countdown = find.textContaining(Copy.I.t('app.calls.validFor', {'time': ''}).trim());
    String shown() => tester.widget<Text>(countdown).data!;
    final before = shown();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 1100)));
    await tester.pump(const Duration(seconds: 1));
    expect(shown(), isNot(before));
    await tester.pumpWidget(hostWith(const SizedBox()));
    state.dispose();
    await registry.close();
  });
}
