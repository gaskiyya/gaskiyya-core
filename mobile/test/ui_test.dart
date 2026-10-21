import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/screenshot.dart';
import 'package:gaskiya/src/ui/screens/onboarding.dart';
import 'package:gaskiya/src/ui/screens/result_sheet.dart';
import 'package:gaskiya/src/ui/theme.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _FakeReader implements TextReader {
  _FakeReader(this.text);
  final String text;
  @override
  bool get available => true;
  @override
  Future<List<TextBlock>> read(String path) async => [const TextBlock('09:41'), TextBlock(text, top: 50)];
}

Widget host(Widget child) => CupertinoApp(theme: G.theme(Brightness.light), home: child);

GaskiyaClient clientReturning(Map<String, dynamic> verdict) => GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async {
        if (req.url.path == '/v1/explain') {
          return http.Response(jsonEncode({'indicators': ['urgency_or_threat'], 'explanation': 'It rushes you to act.', 'action': 'Do not click the link.', 'source': 'model'}), 200);
        }
        return http.Response(jsonEncode(verdict), 200);
      }),
    );

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  test('CH-4: the app bundles the one shared copy file unchanged', () {
    expect(File('assets/copy.json').readAsStringSync(), File('../../packages/schemas/copy.json').readAsStringSync());
  });

  testWidgets('CH-4: a confirmed verdict screen uses the shared wording', (tester) async {
    final client = clientReturning({'verdict': 'confirmed', 'channel': 'sms', 'category': 'transaction_alert', 'sentAt': '2026-10-20T12:02:11Z', 'bank': 'DemoBank'});
    await tester.pumpWidget(host(ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.message('hello'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('verdict.confirmed.title')), findsOneWidget);
    expect(find.textContaining('DemoBank sent this message to this number by SMS'), findsOneWidget);
  });

  testWidgets('CH-4: a not-confirmed screen shows fixed wording, activity, then the explanation', (tester) async {
    final client = clientReturning({'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': 'In the last 24 hours DemoBank sent you no messages.', 'bank': 'DemoBank'});
    await tester.pumpWidget(host(ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.message('URGENT: verify now'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('verdict.not_confirmed.title')), findsOneWidget);
    expect(find.text(Copy.I.t('verdict.not_confirmed.body', {'bank': 'DemoBank'})), findsOneWidget);
    expect(find.text('In the last 24 hours DemoBank sent you no messages.'), findsOneWidget);
    expect(find.text('It rushes you to act.'), findsOneWidget);
    expect(find.text(Copy.I.t('explain.aiNote')), findsOneWidget);
  });

  testWidgets('a screenshot is read on the device and only its digest is sent', (tester) async {
    final paths = <String>[];
    final client = GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async {
        paths.add(req.url.path);
        return http.Response(jsonEncode({'verdict': 'confirmed', 'channel': 'sms', 'category': 'transaction_alert', 'sentAt': '2026-10-20T12:02:11Z', 'bank': 'DemoBank'}), 200);
      }),
    );
    const text = 'DemoBank: N5,000 was paid into your account ending ####.';
    final shot = Screenshot(path: '/tmp/shot.png', bytes: Uint8List(16), mediaType: 'image/png');
    await tester.pumpWidget(host(ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.screenshot(shot), reader: _FakeReader(text))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('verdict.confirmed.title')), findsOneWidget);
    expect(find.text(text, skipOffstage: false), findsOneWidget);
    expect(paths, ['/v1/verify/message']);
  });

  testWidgets('CH-4: an unavailable registry shows cannot check', (tester) async {
    final client = GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) async => http.Response('', 503)));
    await tester.pumpWidget(host(ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.message('hi'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsOneWidget);
  });

  testWidgets('onboarding pages through to Get started', (tester) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    var done = false;
    await tester.pumpWidget(host(OnboardingScreen(onDone: () => done = true)));
    await tester.pump(const Duration(milliseconds: 300));
    for (var i = 0; i < 3; i++) {
      await tester.tap(find.text('Continue'));
      for (var f = 0; f < 70; f++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
    }
    expect(find.text('Get started'), findsOneWidget);
    await tester.tap(find.text('Get started'));
    expect(done, isTrue);
  });
}
