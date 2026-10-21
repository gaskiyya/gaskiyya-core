import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';

import 'support.dart';

Color? dotColor(WidgetTester tester) => (tester.widget<Container>(find.byKey(const ValueKey('status-dot'))).decoration as BoxDecoration?)?.color;

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  testWidgets('F24: Settings section headers are small grey capitals, and privacy rows wrap', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(SettingsScreen(state: state), disableAnimations: true));
    await tester.pump();
    for (final key in ['app.settings.privacy', 'app.settings.about', 'banks.heading']) {
      final header = tester.widget<Text>(find.text(Copy.I.t(key).toUpperCase()));
      expect(header.style?.fontSize, 13, reason: key);
      expect(header.style?.fontWeight, FontWeight.w400, reason: key);
    }
    final privacy = tester.widget<Text>(find.text(Copy.I.t('app.settings.textStays')));
    expect(privacy.maxLines, greaterThan(1));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(hostWith(const SizedBox()));
    state.dispose();
    await registry.close();
  });

  testWidgets('F24: inbox rows show the channel, and the status dot is green only while the registry answers', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    registry.inboxItems['demobank'] = [
      {'id': 'm1', 'from': 'DemoBank', 'text': 'Your card ending 1234 was used.', 'at': '2026-10-20T10:30:00Z', 'kind': 'genuine', 'channel': 'whatsapp'},
    ];
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
    await tester.runAsync(state.refreshCall);
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.textContaining(Copy.I.channel('whatsapp')), findsOneWidget);
    final grey = CupertinoColors.systemGrey.color.toARGB32();
    expect(dotColor(tester)!.toARGB32(), isNot(grey));

    registry.failingCallChecks.add('demobank');
    await tester.runAsync(state.refreshCall);
    await tester.pump();
    expect(dotColor(tester)!.toARGB32(), grey);
    await tester.pumpWidget(hostWith(const SizedBox()));
    await tester.pump(const Duration(seconds: 1));
    state.dispose();
    await registry.close();
  });

  testWidgets('F24: the call banner never covers the Calls tab', (tester) async {
    phoneSize(tester);
    mockSharing(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(HomeScreen(state: state), disableAnimations: true));
    await tester.pump();
    Finder banner(String code) => find.byWidgetPredicate((w) => w is Text && w.data == code);
    Map<String, dynamic> notice(String id, String code) =>
        {'type': 'call.opened', 'callId': id, 'id': id, 'purpose': 'card_activation', 'code': code, 'status': 'open', 'expiresAt': '2099-01-01T00:00:00Z', 'bank': 'DemoBank'};

    state.handleNotice(notice('c1', '5517'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(banner('5517'), findsOneWidget);

    await tester.tap(find.text(Copy.I.t('app.tabs.calls')));
    await tester.pump(const Duration(milliseconds: 100));
    expect(banner('5517'), findsNothing);
    state.handleNotice(notice('c2', '6620'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(banner('6620'), findsNothing);

    await tester.pumpWidget(hostWith(const SizedBox()));
    await tester.pump(const Duration(seconds: 7));
    state.dispose();
    await registry.close();
  });
}
