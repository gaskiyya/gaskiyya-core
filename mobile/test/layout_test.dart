import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/widgets/tab_bar.dart';

import 'support.dart';

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync(),
      overlays: {for (final l in Copy.languages.where((l) => l != 'en')) l: File('assets/copy.$l.json').readAsStringSync()}));

  testWidgets('F24: Settings section headers are small grey capitals, and privacy rows wrap', (tester) async {
    phoneSize(tester);
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(SettingsScreen(state: state), disableAnimations: true));
    await tester.pump();
    for (final key in ['app.settings.privacy', 'app.settings.about']) {
      final header = tester.widget<Text>(find.text(Copy.I.t(key).toUpperCase()));
      expect(header.style?.fontSize, 13, reason: key);
      expect(header.style?.fontWeight, FontWeight.w400, reason: key);
    }
    final privacy = tester.widget<Text>(find.text(Copy.I.t('app.settings.textStays')));
    expect(privacy.maxLines, greaterThan(1));
    expect(find.text(Copy.I.t('banks.heading').toUpperCase()), findsNothing);
    expect(find.text('DemoBank'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(hostWith(const SizedBox()));
    state.dispose();
    await registry.close();
  });

  testWidgets('F24: inbox rows show the channel, and the Check screen carries no bank tag', (tester) async {
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
    expect(find.byKey(const ValueKey('status-dot')), findsNothing);
    expect(find.descendant(of: find.byType(CupertinoSliverNavigationBar), matching: find.text('DemoBank')), findsNothing);
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

  for (final lang in ['en', 'pcm', 'ha', 'yo', 'ig']) {
    testWidgets('Settings rows line up and the tab bar fits a 320pt phone in $lang', (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 568 * 3);
      tester.view.devicePixelRatio = 3;
      tester.view.padding = const FakeViewPadding(bottom: 34 * 3);
      addTearDown(tester.view.reset);
      mockSharing(tester);
      Copy.I.language = lang;
      addTearDown(() => Copy.I.language = 'en');
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await tester.pumpWidget(hostWith(HomeScreen(state: state), disableAnimations: true));
      await tester.pump();
      await tester.tap(find.text(Copy.I.t('app.tabs.settings')));
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(tester.takeException(), isNull);

      final bar = tester.getRect(find.byType(GTabBar));
      expect(bar.bottom, 568);
      expect(bar.height, GTabBar.barHeight + 34);
      final labels = [for (final t in ['check', 'calls', 'activity', 'settings']) find.descendant(of: find.byType(GTabBar), matching: find.text(Copy.I.t('app.tabs.$t')))];
      final centres = [for (final l in labels) tester.getCenter(l)];
      for (var i = 0; i < labels.length; i++) {
        expect(tester.widget<Text>(labels[i]).maxLines, 1);
        expect(centres[i].dy, closeTo(centres[0].dy, 0.01));
        expect(centres[i].dx, closeTo(6 + (320 - 12) / 4 * (i + 0.5), 1));
      }

      final starts = {
        for (final key in ['app.language.title', 'app.settings.textStays', 'app.settings.numbersMasked', 'app.settings.showIntro', 'app.settings.unlink'])
          key: tester.getTopLeft(find.text(Copy.I.t(key), skipOffstage: false)).dx,
      };
      expect(starts.values.toSet(), hasLength(1), reason: '$starts');
      await tester.pumpWidget(hostWith(const SizedBox()));
      await tester.pump(const Duration(seconds: 7));
      state.dispose();
      await registry.close();
    });
  }
}
