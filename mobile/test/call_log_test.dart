import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/screens/in_call_screen.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

Map<String, dynamic> opened(String id, String code, {String purpose = 'fraud_check'}) => {
      'type': 'call.opened',
      'callId': id,
      'bank': 'DemoBank',
      'purpose': purpose,
      'code': code,
      'expiresAt': DateTime.now().add(const Duration(minutes: 3)).toUtc().toIso8601String(),
    };

Future<void> nativeEvent(WidgetTester tester, String event, String callId) =>
    tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      'ng.gaskiya/calls',
      const StandardMethodCodec().encodeMethodCall(MethodCall('callEvent', {'event': event, 'callId': callId, 'orgId': 'demobank', 'bank': 'DemoBank', 'code': '4821'})),
      (_) {},
    );

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tidy(WidgetTester tester, AppState state, FakeRegistry registry) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 7));
  await registry.close();
  state.dispose();
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  testWidgets('a bank call the app hears about is logged with its bank, code and purpose, kept across restarts and listed on the Calls tab',
      (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    state.handleNotice(opened('call_1', '4821'), state.links.single);

    final r = state.callLog.single;
    expect((r.id, r.bank, r.code, r.purpose, r.outcome), ('call_1', 'DemoBank', '4821', 'fraud_check', CallOutcome.ringing));
    state.handleNotice(opened('call_1', '4821'), state.links.single);
    expect(state.callLog, hasLength(1));

    final prefs = (await tester.runAsync(SharedPreferences.getInstance))!;
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    final saved = jsonDecode(prefs.getString('callLog')!) as List;
    expect(saved.single, containsPair('code', '4821'));

    final again = AppState(httpClient: registry.client, push: NoPush(), apiHttp: () => registry.client);
    await tester.runAsync(again.load);
    expect(again.callLog.single.code, '4821');
    again.dispose();

    await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
    await settle(tester);
    expect(find.text(Copy.I.t('app.calls.recent')), findsOneWidget);
    expect(find.textContaining(Copy.I.t('app.calls.outcome.ringing'), findRichText: true), findsOneWidget);
    expect(find.textContaining(Copy.I.t('app.calls.codeIs', {'code': '4821'})), findsOneWidget);
    await tidy(tester, state, registry);
  });

  testWidgets('answering on the phone keeps the person on an in-call screen until they end it, then logs it as answered', (tester) async {
    phoneSize(tester);
    mockSharing(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.pumpWidget(hostWith(HomeScreen(state: state), disableAnimations: true));
    await settle(tester);
    state.handleNotice(opened('call_1', '4821'), state.links.single);
    await settle(tester);
    expect(find.byType(InCallScreen), findsNothing);

    await nativeEvent(tester, 'answered', 'call_1');
    await settle(tester);
    expect(state.activeCall?.id, 'call_1');
    expect(find.byType(InCallScreen), findsOneWidget);
    expect(find.text(Copy.I.t('app.calls.inCall', {'bank': 'DemoBank'})), findsOneWidget);
    expect(find.descendant(of: find.byType(InCallScreen), matching: find.byWidgetPredicate((w) => w is CodeDigits && w.code == '4821')), findsOneWidget);
    expect(find.descendant(of: find.byType(InCallScreen), matching: find.text(Copy.I.purpose('fraud_check').cap)), findsOneWidget);
    expect(find.byKey(const ValueKey('callTimer')), findsOneWidget);

    await tester.tap(find.bySemanticsLabel(Copy.I.t('app.calls.end')));
    await settle(tester);
    expect(find.byType(InCallScreen), findsNothing);
    final r = state.callLog.single;
    expect(r.outcome, CallOutcome.answered);
    expect(r.endedAt, isNotNull);
    await tidy(tester, state, registry);
  });

  testWidgets('one in-call screen fills the phone, and answering another call ends the first', (tester) async {
    phoneSize(tester);
    mockSharing(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    await tester.pumpWidget(hostWith(HomeScreen(state: state), disableAnimations: true));
    await settle(tester);
    state.handleNotice(opened('call_1', '4821'), state.links.single);
    state.handleNotice(opened('call_2', '7730'), state.links.single);
    await nativeEvent(tester, 'answered', 'call_1');
    await settle(tester);
    await nativeEvent(tester, 'answered', 'call_2');
    await settle(tester);

    expect(state.activeCall?.id, 'call_2');
    expect(state.callLog.firstWhere((r) => r.id == 'call_1').outcome, CallOutcome.answered);
    expect(find.byType(InCallScreen), findsOneWidget);
    expect(tester.getSize(find.byType(InCallScreen)), tester.getSize(find.byType(HomeScreen)));
    await tidy(tester, state, registry);
  });

  testWidgets('an answered call ends when the bank closes it', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    state.handleNotice(opened('call_1', '4821'), state.links.single);
    state.answerCall('call_1');
    expect(state.activeCall?.id, 'call_1');
    state.handleNotice({'type': 'call.closed', 'callId': 'call_1'}, state.links.single);
    expect(state.activeCall, isNull);
    expect(state.callLog.single.outcome, CallOutcome.answered);
    state.dispose();
    await registry.close();
  });

  testWidgets('a call that rings and is left alone is logged as missed when it closes, or when a check finds it gone', (tester) async {
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = (await tester.runAsync(() => linkedState(registry, ['demobank'])))!;
    final l = state.links.single;
    state.handleNotice(opened('call_1', '4821'), l);
    state.handleNotice({'type': 'call.closed', 'callId': 'call_1'}, l);
    expect(state.callLog.single.outcome, CallOutcome.missed);

    state.handleNotice(opened('call_2', '7730'), l);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    await tester.runAsync(state.refreshCall);
    expect(state.callLog.map((r) => (r.id, r.outcome)), [('call_2', CallOutcome.missed), ('call_1', CallOutcome.missed)]);

    state.handleNotice(opened('call_3', '1188'), l);
    await nativeEvent(tester, 'ended', 'call_3');
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    expect(state.callLog.first.outcome, CallOutcome.declined);
    state.dispose();
    await registry.close();
  });
}
