import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/ui/screens/result_sheet.dart';
import 'package:gaskiya/src/ui/theme.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

GaskiyaClient linkClient(Map<String, dynamic> answer) => GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async => http.Response(jsonEncode(answer), 200)),
    );

Finder asset(String name) => find.byWidgetPredicate((w) => w is Image && w.image is AssetImage && (w.image as AssetImage).assetName == 'assets/3d/$name.png');

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  testWidgets('F14: a link on the bank domain says it belongs to the bank, with a bank-domain tag, without the confirmed artwork or tag', (tester) async {
    final client = linkClient({'verdict': 'belongs', 'host': 'www.demobank.ng', 'matchedDomain': 'demobank.ng', 'reasons': [], 'bank': 'DemoBank'});
    await tester.pumpWidget(CupertinoApp(theme: G.theme(Brightness.light), home: ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.link('https://www.demobank.ng/app'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('link.belongs.title')), findsOneWidget);
    expect(find.text(Copy.I.t('link.belongs.body', {'domain': 'demobank.ng', 'bank': 'DemoBank'})), findsOneWidget);
    expect(find.text(Copy.I.t('verdict.confirmed.short').toUpperCase()), findsNothing);
    expect(find.text(Copy.I.t('verdict.confirmed.title')), findsNothing);
    expect(find.text(Copy.I.t('link.belongs.short').toUpperCase()), findsOneWidget);
    expect(Copy.I.t('link.belongs.body'), contains('does not confirm'));
    expect(asset('verdict_confirmed'), findsNothing);
    expect(asset('link'), findsOneWidget);
  });

  testWidgets('F14: a link off the bank domain keeps the not-confirmed artwork and tag', (tester) async {
    final client = linkClient({'verdict': 'not_confirmed', 'host': 'demobank-restore.com', 'matchedDomain': null, 'reasons': ['lookalike', 'not_registered'], 'bank': 'DemoBank'});
    await tester.pumpWidget(CupertinoApp(theme: G.theme(Brightness.light), home: ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.link('demobank-restore.com'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('link.not_confirmed.title')), findsOneWidget);
    expect(find.text(Copy.I.t('verdict.not_confirmed.short').toUpperCase()), findsOneWidget);
    expect(asset('verdict_not_confirmed'), findsOneWidget);
  });
}
