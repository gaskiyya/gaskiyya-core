import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/screens/link_screen.dart';
import 'package:gaskiya/src/ui/screens/onboarding.dart';
import 'package:gaskiya/src/ui/screens/result_sheet.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

GaskiyaClient verdictClient(Map<String, dynamic> verdict) => GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async {
        if (req.url.path == '/v1/explain') {
          return http.Response(jsonEncode({'indicators': ['urgency_or_threat', 'non_bank_link'], 'explanation': 'It rushes you to act.', 'action': 'Do not click the link.', 'source': 'model'}), 200);
        }
        return http.Response(jsonEncode(verdict), 200);
      }),
    );

final confirmed = {'verdict': 'confirmed', 'channel': 'whatsapp', 'category': 'transaction_alert', 'sentAt': '2026-10-20T12:02:11Z', 'bank': 'First Community Bank of Northern Nigeria'};
final notConfirmed = {'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': 'In the last 24 hours DemoBank sent you no messages.', 'bank': 'DemoBank'};

Future<void> show(WidgetTester tester, Widget screen, {double textScale = 1, bool disableAnimations = false}) async {
  await tester.pumpWidget(hostWith(screen, textScale: textScale, disableAnimations: disableAnimations));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tidy(WidgetTester tester, [AppState? state, FakeRegistry? registry]) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 1));
  await registry?.close();
  state?.dispose();
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('A11Y-1: the call code reads as one label, digit by digit', () {
    testWidgets('one merged label; the single digits are not read separately', (tester) async {
      final handle = tester.ensureSemantics();
      await show(tester, const Center(child: CodeDigits(code: '4719')));
      expect(find.bySemanticsLabel('Call code 4 7 1 9'), findsOneWidget);
      expect(tester.getSemantics(find.byType(CodeDigits)), matchesSemantics(label: 'Call code 4 7 1 9'));
      for (final d in ['4', '7', '1', '9']) {
        expect(find.bySemanticsLabel(d), findsNothing);
      }
      handle.dispose();
    });

    testWidgets('the calls screen reads the live code the same way', (tester) async {
      phoneSize(tester);
      final handle = tester.ensureSemantics();
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '2580';
      final state = await linkedState(registry, ['demobank']);
      await show(tester, CallsScreen(state: state));
      expect(find.bySemanticsLabel(Copy.I.t('a11y.callCode', {'digits': '2 5 8 0'})), findsOneWidget);
      handle.dispose();
      await tidy(tester, state, registry);
    });
  });

  group('A11Y-2: the decorative 3D art is hidden from screen readers', () {
    testWidgets('Art3D adds nothing to the semantics tree', (tester) async {
      final handle = tester.ensureSemantics();
      await show(tester, const Center(child: Art3D('call', size: 100)));
      final image = tester.widget<Image>(find.byType(Image));
      expect(image.excludeFromSemantics, isTrue);
      expect(image.semanticLabel, isNull);
      expect(find.descendant(of: find.byType(Art3D), matching: find.byType(ExcludeSemantics)), findsWidgets);
      handle.dispose();
    });
  });

  group('A11Y-3: reduced motion is respected', () {
    testWidgets('with animations disabled the 3D art, the call pulse and shimmer stand still', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '4719';
      final state = await linkedState(registry, ['demobank']);
      await show(tester, CallsScreen(state: state), disableAnimations: true);
      expect(tester.hasRunningAnimations, isFalse);
      final opacities = tester.widgetList<Opacity>(find.descendant(of: find.byType(CodeDigits), matching: find.byType(Opacity)));
      expect(opacities.map((o) => o.opacity), everyElement(1.0));

      await show(tester, const Column(children: [Art3D('call', size: 80), Shimmer()]), disableAnimations: true);
      expect(tester.hasRunningAnimations, isFalse);
      await tidy(tester, state, registry);
    });

    testWidgets('with animations on, the shimmer animates', (tester) async {
      await show(tester, const Column(children: [Art3D('call', size: 80), Shimmer()]));
      expect(tester.hasRunningAnimations, isTrue);
      await tidy(tester);
    });

    testWidgets('the 3D art never moves, even with animations on', (tester) async {
      await show(tester, const Center(child: Art3D('call', size: 80)));
      expect(tester.hasRunningAnimations, isFalse);
      expect(find.descendant(of: find.byType(Art3D), matching: find.byType(Transform)), findsNothing);
      expect(tester.getSize(find.byType(Image)), const Size(80, 80));
      final before = tester.getRect(find.byType(Image));
      await tester.pump(const Duration(seconds: 2));
      expect(tester.getRect(find.byType(Image)), before);
      await tidy(tester);
    });

    testWidgets('the sign-in screen settles and then holds still with animations on', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, const []);
      await show(tester, LinkScreen(state: state));
      await tester.pumpAndSettle();
      expect(tester.hasRunningAnimations, isFalse);
      await tidy(tester, state, registry);
    });

    testWidgets('a verdict appears at once, without the spring', (tester) async {
      phoneSize(tester);
      await tester.pumpWidget(hostWith(ResultSheet(client: verdictClient(notConfirmed), bank: 'DemoBank', request: CheckRequest.message('URGENT')), disableAnimations: true));
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(find.text(Copy.I.t('verdict.not_confirmed.title')), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
      await tidy(tester);
    });

    testWidgets('onboarding pages without sliding when motion is reduced', (tester) async {
      phoneSize(tester);
      await tester.pumpWidget(hostWith(OnboardingScreen(onDone: () {}), disableAnimations: true));
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
      await tester.tap(find.text('Continue'));
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
      await tidy(tester);
    });
  });

  group('A11Y-4: at twice the text size nothing overflows', () {
    const scale = 2.0;

    testWidgets('home (check tab)', (tester) async {
      phoneSize(tester);
      mockSharing(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await show(tester, HomeScreen(state: state), textScale: scale);
      expect(tester.takeException(), isNull);
      await tidy(tester, state, registry);
    });

    testWidgets('call check, calling and not calling', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await show(tester, CallsScreen(state: state), textScale: scale);
      expect(tester.takeException(), isNull);
      registry.calling['demobank'] = '4719';
      await state.refreshCall();
      await show(tester, CallsScreen(state: state), textScale: scale);
      expect(find.byType(CodeDigits), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tidy(tester, state, registry);
    });

    testWidgets('settings and activity', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await show(tester, SettingsScreen(state: state), textScale: scale);
      expect(tester.takeException(), isNull);
      await show(tester, ActivityScreen(state: state), textScale: scale);
      expect(tester.takeException(), isNull);
      await tidy(tester, state, registry);
    });

    testWidgets('link screen', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')]);
      final state = await linkedState(registry, const []);
      await show(tester, LinkScreen(state: state), textScale: scale);
      expect(tester.takeException(), isNull);
      await tidy(tester, state, registry);
    });

    for (final (name, verdict) in [('confirmed', confirmed), ('not confirmed', notConfirmed)]) {
      testWidgets('verdict result: $name', (tester) async {
        phoneSize(tester);
        await show(tester, ResultSheet(client: verdictClient(verdict), bank: 'DemoBank', request: CheckRequest.message('URGENT: verify now')), textScale: scale);
        expect(find.text(Copy.I.t('verdict.${verdict['verdict']}.title')), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tidy(tester);
      });
    }
  });
}
