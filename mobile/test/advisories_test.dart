import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/push.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/alerts.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

const amina = '+2348012345678';

Map<String, dynamic> advisoryJson(String id, String bank, {List<String> domains = const ['demobank-restore.com'], bool callback = false}) => {
      'id': id,
      'bank': bank,
      'title': 'Fraud warning from $bank',
      'text': '$bank is aware of fake messages linking to ${domains.join(', ')} that pretend to come from us. Do not click the link; check any message in the $bank app.',
      'approvedAt': '2026-10-20T11:45:00.000Z',
      'expiresAt': '2026-11-03T11:45:00.000Z',
      'indicators': ['non_bank_link', 'urgency_or_threat'],
      'linkDomains': domains,
      'asksCallback': callback,
    };

FakeRegistry twoBanks() => FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')]);

class TapTransport implements PushTransport {
  final taps = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Future<bool> start() async => true;
  @override
  Future<String?> token() async => 'fcm-token-1';
  @override
  Stream<String> get tokenRefresh => const Stream.empty();
  @override
  Stream<Map<String, dynamic>> get messages => const Stream.empty();
  @override
  Stream<Map<String, dynamic>> get opened => taps.stream;
  @override
  Future<Map<String, dynamic>?> launchedFrom() async => null;
  @override
  String get platform => 'android';
}

Future<void> show(WidgetTester tester, Widget screen, {double textScale = 1, bool disableAnimations = false}) async {
  await tester.pumpWidget(hostWith(screen, textScale: textScale, disableAnimations: disableAnimations));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tidy(WidgetTester tester, AppState state, FakeRegistry registry) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 1));
  await registry.close();
  state.dispose();
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('ADV-11: the advisory list fails closed', () {
    GaskiyaClient client(int status, Object body) => GaskiyaClient(
          baseUrl: 'http://registry',
          token: () async => 'tok',
          httpClient: MockClient((_) async => http.Response(jsonEncode(body), status)),
        );

    test('a good answer lists the warnings', () async {
      final r = await client(200, {'bank': 'DemoBank', 'advisories': [advisoryJson('cmp_1', 'DemoBank')]}).advisories();
      expect(r.cannotCheck, isFalse);
      expect(r.advisories.single.linkDomains, ['demobank-restore.com']);
      expect(r.advisories.single.expiresAt.isAfter(r.advisories.single.approvedAt), isTrue);
    });

    test('an error, a refusal or a malformed answer is "cannot check", never an empty list', () async {
      for (final (status, body) in [
        (503, {'code': 'cannot_check'}),
        (500, {'code': 'error'}),
        (200, {'bank': 'DemoBank'}),
        (200, {'advisories': [{'id': 'x'}]}),
      ]) {
        final r = await client(status, body).advisories();
        expect(r.cannotCheck, isTrue, reason: '$status $body');
        expect(r.advisories, isEmpty);
      }
    });
  });

  group('ADV-11: each linked bank\'s warnings, from its own registry answer', () {
    test('each bank is asked with its own token; a failing bank is "cannot check"', () async {
      final registry = twoBanks();
      registry.advisories['demobank'] = [advisoryJson('cmp_1', 'DemoBank')];
      registry.failingAdvisories.add('acme');
      final state = await linkedState(registry, ['demobank', 'acme']);
      await state.refreshAdvisories();
      final demo = state.links.firstWhere((l) => l.id == 'demobank');
      final acme = state.links.firstWhere((l) => l.id == 'acme');
      expect(demo.advisories!.advisories.map((a) => a.id), ['cmp_1']);
      expect(acme.advisories!.cannotCheck, isTrue);
      expect(registry.calls.where((c) => c.path == '/v1/advisories').map((c) => c.bank).toSet(), {'demobank', 'acme'});
      state.dispose();
      await registry.close();
    });

    test('a live "published" notice fetches the list and raises the banner; "withdrawn" removes it at once', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await pumpEventQueue();
      await state.refreshAdvisories();
      expect(state.links.first.advisories!.advisories, isEmpty);

      registry.advisories['demobank'] = [advisoryJson('cmp_1', 'DemoBank')];
      registry.emit('demobank', {'type': 'advisory.published', 'advisoryId': 'cmp_1', 'bank': 'DemoBank', 'title': 'Fraud warning from DemoBank', 'expiresAt': '2026-11-03T11:45:00.000Z'});
      await pumpEventQueue();
      await pumpEventQueue();
      final demo = state.links.firstWhere((l) => l.id == 'demobank');
      expect(demo.advisories!.advisories.map((a) => a.id), ['cmp_1']);
      expect(state.arrivedAlert.value, (bank: 'DemoBank', id: 'cmp_1'));
      expect(state.links.firstWhere((l) => l.id == 'acme').advisories!.advisories, isEmpty);

      registry.advisories['demobank'] = [];
      state.handleNotice({'type': 'advisory.withdrawn', 'advisoryId': 'cmp_1', 'bank': 'DemoBank'}, demo);
      expect(demo.advisories!.advisories, isEmpty);
      state.dispose();
      await registry.close();
    });

    test('tapping a warning notice opens the alerts, not the Calls tab', () async {
      final registry = twoBanks();
      registry.advisories['demobank'] = [advisoryJson('cmp_1', 'DemoBank')];
      final push = TapTransport();
      final state = await linkedState(registry, ['demobank'], push: push);
      await pumpEventQueue();
      final alerts = state.openAlerts.value;
      final calls = state.openCallsTab.value;
      push.taps.add({'type': 'advisory.published', 'advisoryId': 'cmp_1', 'bank': 'DemoBank'});
      await pumpEventQueue();
      expect(state.openAlerts.value, alerts + 1);
      expect(state.openCallsTab.value, calls);
      expect(state.arrivedAlert.value, isNull);
      state.dispose();
      await registry.close();
    });
  });

  group('ADV-11: the Alerts from your bank section', () {
    testWidgets('lists each bank\'s warnings with the fake website highlighted, and says when a bank cannot be checked', (tester) async {
      phoneSize(tester);
      final handle = tester.ensureSemantics();
      final registry = twoBanks();
      registry.advisories['demobank'] = [advisoryJson('cmp_1', 'DemoBank', callback: true)];
      registry.failingAdvisories.add('acme');
      final state = await tester.runAsync(() => linkedState(registry, ['demobank', 'acme']));
      await tester.runAsync(() => state!.refreshAdvisories());
      await show(tester, CupertinoPageScaffold(child: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(16), child: AdvisoriesSection(state: state!)))));

      final c = Copy.I;
      expect(find.text(c.t('advisory.section')), findsOneWidget);
      expect(find.text(c.t('advisory.title', {'bank': 'DemoBank'})), findsOneWidget);
      expect(find.byKey(const ValueKey('lookalike-demobank-restore.com')), findsOneWidget);
      expect(find.bySemanticsLabel('${c.t('advisory.lookalikeLabel')}: demobank-restore.com'), findsOneWidget);
      expect(find.text(c.t('advisory.callbackNote')), findsOneWidget);
      expect(find.text(c.t('advisory.until', {'date': AdvisoryCard.date(DateTime.parse('2026-11-03T11:45:00.000Z').toLocal())})), findsOneWidget);
      expect(find.text(c.t('advisory.unavailable', {'bank': 'Acme Bank'})), findsOneWidget);
      expect(find.text(c.t('advisory.none', {'bank': 'Acme Bank'})), findsNothing);
      expect(tester.getSemantics(find.text(c.t('advisory.section'))), matchesSemantics(label: c.t('advisory.section'), isHeader: true));
      handle.dispose();
      await tidy(tester, state, registry);
    });

    testWidgets('a bank with no warnings says so', (tester) async {
      final registry = twoBanks();
      final state = await tester.runAsync(() => linkedState(registry, ['demobank']));
      await tester.runAsync(() => state!.refreshAdvisories());
      await show(tester, CupertinoPageScaffold(child: AdvisoriesSection(state: state!)));
      expect(find.text(Copy.I.t('advisory.none', {'bank': 'DemoBank'})), findsOneWidget);
      await tidy(tester, state, registry);
    });

    testWidgets('several organisations with no warnings share one line that names none of them', (tester) async {
      final registry = twoBanks();
      final state = await tester.runAsync(() => linkedState(registry, ['demobank', 'acme']));
      await tester.runAsync(() => state!.refreshAdvisories());
      await show(tester, CupertinoPageScaffold(child: AdvisoriesSection(state: state!)));
      expect(find.text(Copy.I.t('advisory.noneAll')), findsOneWidget);
      expect(find.textContaining('DemoBank'), findsNothing);
      expect(find.textContaining('Acme Bank'), findsNothing);
      await tidy(tester, state, registry);
    });

    testWidgets('fits a phone at 2x text with no overflow, and holds still when motion is reduced', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      registry.advisories['demobank'] = [advisoryJson('cmp_1', 'DemoBank', domains: ['demobank-restore-account-verification.com', 'demo-bank.ng'], callback: true)];
      final state = await tester.runAsync(() => linkedState(registry, ['demobank']));
      await tester.runAsync(() => state!.refreshAdvisories());
      await show(
        tester,
        CupertinoPageScaffold(child: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(16), child: AdvisoriesSection(state: state!)))),
        textScale: 2,
        disableAnimations: true,
      );
      expect(tester.takeException(), isNull);
      expect(find.byKey(const ValueKey('lookalike-demobank-restore-account-verification.com')), findsOneWidget);
      expect(find.descendant(of: find.byType(Reveal), matching: find.byType(TweenAnimationBuilder<double>)), findsNothing);
      await tidy(tester, state, registry);
    });

    testWidgets('the Activity tab shows the alerts first, and a tapped notice opens it', (tester) async {
      phoneSize(tester);
      mockSharing(tester);
      final registry = twoBanks();
      registry.advisories['demobank'] = [advisoryJson('cmp_1', 'DemoBank')];
      final state = await tester.runAsync(() => linkedState(registry, ['demobank']));
      await show(tester, HomeScreen(state: state!));
      expect(find.byType(AdvisoriesSection), findsNothing);
      state.openAlerts.value++;
      for (var i = 0; i < 20; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.byType(AdvisoriesSection), findsOneWidget);
      expect(find.text(Copy.I.t('advisory.title', {'bank': 'DemoBank'})), findsOneWidget);
      await tidy(tester, state, registry);
    });
  });
}
