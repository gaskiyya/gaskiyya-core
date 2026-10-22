import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';

import 'support.dart';

const _message = 'DemoBank: Your card ending 1234 was used for NGN 5,000.00 at SHOPRITE LEKKI. If this was not you, call 0700 000 0001. Never share your PIN.';

Copy get c => Copy.I;

Future<void> settle(WidgetTester tester, [int frames = 10]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  testWidgets('the Check screen keeps only the input, the button and the actions, without explanations', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
    await settle(tester);
    expect(find.text(c.t('app.check.checkMessage')), findsOneWidget);
    for (final key in ['app.check.fingerprintNote', 'receipt.subtitle', 'licence.entryHint', 'safety.neverAsks']) {
      expect(find.text(c.t(key)), findsNothing, reason: key);
    }
    await tester.pumpWidget(hostWith(const SizedBox()));
    await tester.pump(const Duration(seconds: 1));
    state.dispose();
    await registry.close();
  });

  testWidgets('a recent message opens in full, and Check Message checks it', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    registry.inboxItems['demobank'] = [
      {'id': 'm1', 'from': 'DemoBank', 'text': _message, 'at': '2026-10-20T10:30:00Z', 'kind': 'genuine', 'channel': 'sms'},
    ];
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
    await settle(tester, 5);

    await tester.tap(find.byKey(const ValueKey('inbox-m1')));
    await settle(tester);
    final preview = find.byKey(const ValueKey('message-preview'));
    expect(preview, findsOneWidget);
    expect(tester.widget<Text>(find.descendant(of: preview, matching: find.text(_message))).maxLines, isNull);
    expect(find.descendant(of: preview, matching: find.text('DemoBank')), findsOneWidget);
    expect(find.descendant(of: preview, matching: find.textContaining(c.channel('sms'))), findsOneWidget);
    expect(registry.calls.where((x) => x.path == '/v1/verify/message'), isEmpty);

    await tester.tap(find.byKey(const ValueKey('preview-check')));
    await settle(tester, 20);
    expect(preview, findsNothing);
    expect(registry.calls.where((x) => x.path == '/v1/verify/message'), hasLength(1));
    expect(find.text(c.t('app.result.messageCheck')), findsOneWidget);
    expect(find.text(c.t('verdict.not_confirmed.title')), findsOneWidget);

    await tester.pumpWidget(hostWith(const SizedBox()));
    await tester.pump(const Duration(seconds: 1));
    state.dispose();
    await registry.close();
  });

  testWidgets('closing the preview checks nothing', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    registry.inboxItems['demobank'] = [
      {'id': 'm1', 'from': 'DemoBank', 'text': _message, 'at': '2026-10-20T10:30:00Z'},
    ];
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
    await settle(tester, 5);
    await tester.tap(find.byKey(const ValueKey('inbox-m1')));
    await settle(tester);
    await tester.tap(find.descendant(of: find.byKey(const ValueKey('message-preview')), matching: find.text(c.t('app.common.done'))));
    await settle(tester);
    expect(find.byKey(const ValueKey('message-preview')), findsNothing);
    expect(registry.calls.where((x) => x.path == '/v1/verify/message'), isEmpty);
    await tester.pumpWidget(hostWith(const SizedBox()));
    await tester.pump(const Duration(seconds: 1));
    state.dispose();
    await registry.close();
  });

  group('Automatic protection', () {
    const channel = MethodChannel('ng.gaskiya/shield.setup');
    late List<String> asked;
    late Map<String, Object?> status;

    setUp(() {
      asked = [];
      status = {};
    });

    Future<Future<void> Function()> showSettings(WidgetTester tester) async {
      phoneSize(tester);
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'status') return status;
        asked.add(call.method);
        return true;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await tester.pumpWidget(hostWith(SettingsScreen(state: state), disableAnimations: true));
      await settle(tester, 3);
      await tester.scrollUntilVisible(find.text(c.t('shield.settingsTitle').toUpperCase()), 300, scrollable: find.byType(Scrollable).first);
      await settle(tester, 3);
      return () async {
        await tester.pumpWidget(hostWith(const SizedBox()));
        state.dispose();
        await registry.close();
      };
    }

    testWidgets('on Android a tap anywhere on a row asks for that permission', (tester) async {
      final close = await showSettings(tester);
      await tester.tap(find.text(c.t('shield.perm.calls.title')));
      await settle(tester, 2);
      expect(asked, ['requestScreeningRole']);
      await tester.tap(find.descendant(of: find.byKey(const ValueKey('shield-messages')), matching: find.text(c.t('shield.turnOn'))));
      await settle(tester, 2);
      expect(asked, ['requestScreeningRole', 'openNotificationAccess']);
      await close();
    });

    testWidgets('on iPhone the section says what iOS allows, and Turn On asks for bank alerts', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      try {
        final close = await showSettings(tester);
        expect(find.text(c.t('shield.ios.note')), findsOneWidget);
        expect(find.text(c.t('shield.perm.calls.title')), findsNothing);
        await tester.tap(find.text(c.t('shield.ios.alerts.title')));
        await settle(tester, 2);
        expect(asked, ['requestAlerts']);
        status = {'alerts': true};
        await tester.tap(find.descendant(of: find.byKey(const ValueKey('shield-alerts')), matching: find.text(c.t('shield.turnOn'))));
        await settle(tester, 2);
        expect(asked, ['requestAlerts', 'requestAlerts']);
        expect(find.descendant(of: find.byKey(const ValueKey('shield-alerts')), matching: find.text(c.t('shield.on'))), findsOneWidget);
        await close();
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });
  });
}
