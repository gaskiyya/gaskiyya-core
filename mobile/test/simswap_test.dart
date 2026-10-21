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

Widget host(Widget child) => CupertinoApp(theme: G.theme(Brightness.light), home: child);

Map<String, dynamic> en() => jsonDecode(File('assets/copy.json').readAsStringSync()) as Map<String, dynamic>;
Map<String, dynamic> overlay(String lang) => jsonDecode(File('assets/copy.$lang.json').readAsStringSync()) as Map<String, dynamic>;

GaskiyaClient registry(Map<String, dynamic> answer) => GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async => req.url.path == '/v1/explain' ? http.Response('', 503) : http.Response(jsonEncode(answer), 200)),
    );

const confirmedOtp = {'verdict': 'confirmed', 'bank': 'DemoBank', 'channel': 'sms', 'category': 'otp', 'sentAt': '2026-10-20T12:41:00Z'};

void main() {
  setUp(() {
    Copy.fromJson(
      File('assets/copy.json').readAsStringSync(),
      overlays: {for (final l in Copy.languages.where((l) => l != 'en')) l: File('assets/copy.$l.json').readAsStringSync()},
    );
  });

  test('SIM-10: the client reads SIM-swap warnings apart from sender warnings', () {
    final r = VerifyResult.fromJson({...confirmedOtp, 'warnings': ['sim_swapped_recently', 'unknown_sender']});
    expect(r.verdict, Verdict.confirmed);
    expect(r.simSwapped, isTrue);
    expect(r.senderWarnings, ['unknown_sender']);
    expect(VerifyResult.fromJson({...confirmedOtp}).simSwapped, isFalse);
  });

  testWidgets('SIM-10: a confirmed message with a recent SIM swap stays confirmed and shows the banner', (tester) async {
    final simswap = en()['simswap'] as Map;
    await tester.pumpWidget(host(ResultSheet(client: registry({...confirmedOtp, 'warnings': ['sim_swapped_recently']}), bank: 'DemoBank', request: CheckRequest.message('DemoBank: your one-time code is 482913'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text((en()['verdict'] as Map)['confirmed']['title'] as String), findsOneWidget);
    expect(find.byKey(const ValueKey('warning-sim_swapped_recently')), findsOneWidget);
    expect(find.text(simswap['title'] as String), findsOneWidget);
    expect(find.text(simswap['body'] as String), findsOneWidget);
    final banner = tester.widget<Semantics>(find.byKey(const ValueKey('warning-sim_swapped_recently')));
    expect(banner.properties.label, startsWith(simswap['a11y'] as String));
    expect(banner.properties.label, contains(simswap['body'] as String));
    expect(banner.properties.liveRegion, isTrue);
  });

  testWidgets('SIM-10: a not-confirmed message stays not confirmed, with the banner in the chosen language', (tester) async {
    Copy.I.language = 'yo';
    await tester.pumpWidget(host(ResultSheet(
        client: registry({'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': '', 'bank': 'DemoBank', 'warnings': ['sim_swapped_recently']}),
        bank: 'DemoBank',
        request: CheckRequest.message('URGENT: verify now'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text((overlay('yo')['verdict'] as Map)['not_confirmed']['title'] as String), findsOneWidget);
    expect(find.text((overlay('yo')['simswap'] as Map)['title'] as String), findsOneWidget);
  });

  testWidgets('SIM-10: no warning, no banner; an unknown SIM status shows the unknown note only', (tester) async {
    await tester.pumpWidget(host(ResultSheet(client: registry(confirmedOtp), bank: 'DemoBank', request: CheckRequest.message('DemoBank: your one-time code is 482913'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.byKey(const ValueKey('warning-sim_swapped_recently')), findsNothing);
    expect(find.byKey(const ValueKey('warning-sim_status_unknown')), findsNothing);

    await tester.pumpWidget(host(ResultSheet(
        key: const ValueKey('second'),
        client: registry({...confirmedOtp, 'warnings': ['sim_status_unknown']}),
        bank: 'DemoBank',
        request: CheckRequest.message('DemoBank: your one-time code is 482913'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.byKey(const ValueKey('warning-sim_status_unknown')), findsOneWidget);
    expect(find.text((en()['simswap'] as Map)['unknownTitle'] as String), findsOneWidget);
    expect(find.text((en()['simswap'] as Map)['title'] as String), findsNothing);
  });
}
