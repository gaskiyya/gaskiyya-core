import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/licence_sheet.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

const source = {
  'id': 'fccpc-digital-lenders',
  'regulator': 'FCCPC',
  'title': 'FCCPC approved digital lenders',
  'url': 'https://fccpc.gov.ng/registration-of-digital-money-lenders/approvals-of-dmls/',
  'publishedAt': null,
  'retrievedAt': '2026-10-20',
  'sample': false,
};
const firm = {'name': 'EXAMPLE CREDIT LIMITED', 'regulator': 'FCCPC', 'category': 'digital_lender', 'status': 'Full approval', 'source': source};
const regulators = [
  {'name': 'FCCPC', 'url': 'https://fccpc.gov.ng'},
  {'name': 'CBN', 'url': 'https://www.cbn.gov.ng'},
  {'name': 'SEC', 'url': 'https://sec.gov.ng'},
];
final licensed = {'verdict': 'licensed', 'firm': firm, 'regulators': regulators};
final nearMiss = {'verdict': 'not_listed', 'similarTo': firm, 'regulators': regulators, 'sources': [source]};
final unknown = {'verdict': 'not_listed', 'similarTo': null, 'regulators': regulators, 'sources': [source]};

GaskiyaClient licenceClient(Object? answer, {int status = 200, List<Map<String, dynamic>>? sent}) => GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async {
        expect(req.url.path, '/v1/verify/licence');
        sent?.add(jsonDecode(req.body) as Map<String, dynamic>);
        return http.Response(jsonEncode(answer ?? {'code': 'error', 'message': 'x'}), status);
      }),
    );

Finder asset(String name) => find.byWidgetPredicate((w) => w is Image && w.image is AssetImage && (w.image as AssetImage).assetName == 'assets/3d/$name.png');

Future<void> ask(WidgetTester tester, GaskiyaClient client, String query, {double textScale = 1}) async {
  await tester.pumpWidget(hostWith(LicenceSheet(client: client), textScale: textScale));
  await tester.enterText(find.byKey(const ValueKey('licence-query')), query);
  await tester.pump();
  await tester.tap(find.byKey(const ValueKey('licence-check')));
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Copy get c => Copy.I;

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  testWidgets('LIC-12: sends only the typed name, and shows "listed" with the regulator and list date, never the confirmed look', (tester) async {
    phoneSize(tester);
    final sent = <Map<String, dynamic>>[];
    await ask(tester, licenceClient(licensed, sent: sent), '  Example Credit  ');
    expect(sent, [
      {'query': 'Example Credit'}
    ]);
    expect(find.text(c.t('licence.licensed.title')), findsOneWidget);
    expect(find.text(c.t('licence.licensed.body', {'name': 'EXAMPLE CREDIT LIMITED', 'regulator': 'FCCPC', 'category': c.t('licence.categories.digital_lender')})), findsOneWidget);
    expect(find.text('2026-10-20'), findsOneWidget);
    expect(find.text('Full approval'), findsOneWidget);
    expect(find.text(c.t('licence.licensed.short').toUpperCase()), findsOneWidget);
    expect(find.text(c.t('verdict.confirmed.title')), findsNothing);
    expect(asset('verdict_confirmed'), findsNothing);
    expect(asset('shield'), findsOneWidget);
    expect(c.t('licence.licensed.body'), contains('does not confirm'));
  });

  testWidgets('LIC-12: a near miss is "not listed" with the look-alike warning; an unknown name has no warning', (tester) async {
    phoneSize(tester);
    await ask(tester, licenceClient(nearMiss), 'Exampel Credit');
    expect(find.text(c.t('licence.not_listed.title')), findsOneWidget);
    expect(find.text(c.t('licence.similar', {'name': 'EXAMPLE CREDIT LIMITED'})), findsOneWidget);
    expect(find.text(c.t('licence.licensed.title')), findsNothing);
    expect(find.text(c.t('licence.not_listed.body', {'regulators': 'FCCPC, CBN or SEC'})), findsOneWidget);
    expect(asset('verdict_not_confirmed'), findsOneWidget);

    await ask(tester, licenceClient(unknown), 'Moonbeam Capital');
    expect(find.text(c.t('licence.not_listed.title')), findsOneWidget);
    expect(find.byKey(const ValueKey('licence-similar')), findsNothing);
  });

  testWidgets('LIC-12: errors, malformed answers and rate limits fail closed to "cannot check"', (tester) async {
    phoneSize(tester);
    for (final client in [
      licenceClient(null, status: 500),
      licenceClient({'verdict': 'licensed'}),
      licenceClient({'verdict': 'fraud'}),
    ]) {
      await ask(tester, client, 'Example Credit');
      expect(find.text(c.t('licence.cannot_check.title')), findsOneWidget);
      expect(find.text(c.t('licence.licensed.title')), findsNothing);
      expect(find.text(c.t('licence.not_listed.title')), findsNothing);
    }
    await ask(tester, licenceClient({'code': 'rate_limited', 'message': 'x'}, status: 429), 'Example Credit');
    expect(find.text(c.t('licence.cannot_check.title')), findsOneWidget);
    expect(find.text(c.t('app.result.rateLimited')), findsOneWidget);
    expect(LicenceResult.fromJson(const {}).verdict, LicenceVerdict.cannotCheck);
  });

  testWidgets('LIC-12: the Check screen offers the check as one labelled button that opens the sheet', (tester) async {
    phoneSize(tester);
    final handle = tester.ensureSemantics();
    final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
    final state = await linkedState(registry, ['demobank']);
    await tester.pumpWidget(hostWith(CheckScreen(state: state)));
    await tester.pump(const Duration(seconds: 1));
    await tester.scrollUntilVisible(find.byKey(const ValueKey('licence-entry')), 300, scrollable: find.byType(Scrollable).first);
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.bySemanticsLabel(c.t('licence.title')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('licence-entry')));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text(c.t('licence.intro')), findsOneWidget);
    handle.dispose();
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 5));
    await registry.close();
    state.dispose();
  });

  for (final (name, answer) in [('listed', licensed), ('near miss', nearMiss), ('cannot check', null)]) {
    testWidgets('LIC-12: at twice the text size nothing overflows: $name', (tester) async {
      phoneSize(tester);
      await ask(tester, licenceClient(answer, status: answer == null ? 503 : 200), 'Example Credit', textScale: 2);
      expect(tester.takeException(), isNull);
    });
  }
}
