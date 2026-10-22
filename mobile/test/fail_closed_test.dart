import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/screenshot.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/screens/result_sheet.dart';
import 'package:gaskiya/src/ui/theme.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

GaskiyaClient callsClient(http.Response Function() answer) => GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async => answer()),
    );

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status);

final _open = {
  'verdict': 'calling',
  'calling': true,
  'bank': 'DemoBank',
  'call': {'id': 'call_1', 'purpose': 'card_activation', 'code': '1442', 'status': 'open', 'openedAt': '2026-10-20T12:00:00Z', 'expiresAt': '2099-01-01T00:00:00Z'},
};

class _NoReader implements TextReader {
  const _NoReader();
  @override
  bool get available => false;
  @override
  Future<List<TextBlock>> read(String path) async => const [];
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('F9: calls fail closed on the device', () {
    test('a registry error, a cannot_check answer or a malformed answer is cannot check, never not calling', () async {
      final answers = <http.Response>[
        json({'code': 'error', 'message': 'Internal error'}, 500),
        json({'verdict': 'cannot_check', 'bank': 'DemoBank'}),
        json({'bank': 'DemoBank'}),
        json({'calling': true, 'bank': 'DemoBank'}),
        http.Response('not json', 200),
      ];
      for (final a in answers) {
        final s = await callsClient(() => a).openCall();
        expect(s.cannotCheck, isTrue, reason: a.body);
        expect(s.calling, isFalse);
      }
      final thrown = await GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) => throw const SocketException('down'))).openCall();
      expect(thrown.cannotCheck, isTrue);
    });

    test('explicit answers are kept', () async {
      final none = await callsClient(() => json({'verdict': 'not_calling', 'calling': false, 'bank': 'DemoBank'})).openCall();
      expect((none.cannotCheck, none.calling), (false, false));
      final open = await callsClient(() => json(_open)).openCall();
      expect((open.cannotCheck, open.calling, open.call?.code), (false, true, '1442'));
    });

    testWidgets('the Calls tab shows one cannot check naming every bank whose check failed, never not calling for it', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')])..failingCallChecks.addAll(['demobank', 'acme']);
      final state = (await tester.runAsync(() => linkedState(registry, ['demobank', 'acme'])))!;
      Future<void> settle() async {
        await tester.runAsync(state.refreshCall);
        await tester.pump(const Duration(seconds: 1));
        await tester.pump(const Duration(seconds: 1));
      }

      await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
      await settle();
      expect(state.callUnchecked.map((l) => l.id), ['demobank', 'acme']);
      expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsOneWidget);
      expect(find.text(Copy.I.orList(['DemoBank', 'Acme Bank'])), findsOneWidget);
      expect(find.text(Copy.I.t('call.not_calling.title')), findsNothing);
      expect(find.textContaining(Copy.I.t('call.not_calling.body', {'bank': 'DemoBank'})), findsNothing);

      registry.failingCallChecks.remove('demobank');
      await settle();
      expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsOneWidget);
      expect(find.text('Acme Bank'), findsOneWidget);
      expect(find.text(Copy.I.t('call.not_calling.body', {'bank': 'DemoBank'})), findsNothing);
      expect(find.text(Copy.I.t('call.not_calling.title')), findsNothing);

      registry.failingCallChecks.remove('acme');
      registry.calling['acme'] = '1442';
      await settle();
      expect(find.text(Copy.I.t('call.calling.title', {'bank': 'Acme Bank'})), findsOneWidget);
      registry.failingCallChecks.add('acme');
      await settle();
      expect(find.text(Copy.I.t('call.calling.title', {'bank': 'Acme Bank'})), findsNothing);
      expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsOneWidget);

      registry.failingCallChecks.clear();
      registry.calling.clear();
      await settle();
      expect(find.text(Copy.I.t('call.not_calling.title')), findsOneWidget);
      expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsNothing);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });
  });

  testWidgets('F23: an unreadable screenshot shows one consistent cannot-check message', (tester) async {
    final client = callsClient(() => json({'code': 'unreadable', 'message': 'No message text could be read from the image'}, 422));
    final shot = Screenshot(path: null, bytes: Uint8List(16), mediaType: 'image/png');
    await tester.runAsync(() async {
      await tester.pumpWidget(CupertinoApp(
        theme: G.theme(Brightness.light),
        home: ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.screenshot(shot), reader: const _NoReader()),
      ));
      await Future<void>.delayed(const Duration(seconds: 1));
    });
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsOneWidget);
    expect(find.text(Copy.I.t('bot.screenshotUnread')), findsOneWidget);
    expect(find.text(Copy.I.t('verdict.cannot_check.body')), findsNothing);
    expect(find.text(Copy.I.t('verdict.confirmed.title')), findsNothing);
  });

  group('F20: a malformed confirmed answer is cannot check', () {
    const good = {'verdict': 'confirmed', 'channel': 'sms', 'category': 'transaction_alert', 'sentAt': '2026-10-20T12:02:11Z', 'bank': 'DemoBank'};
    final malformed = <Map<String, dynamic>>[
      {...good}..remove('sentAt'),
      {...good}..remove('channel'),
      {...good}..remove('category'),
      {...good, 'sentAt': 'yesterday'},
      {...good, 'sentAt': 12345},
      {...good, 'channel': 'carrier-pigeon'},
      {...good, 'channel': null},
      {'verdict': 'confirmed'},
    ];

    test('the client never returns confirmed without sentAt, channel and category', () async {
      expect((await callsClient(() => json(good)).verifyText('hello')).verdict, Verdict.confirmed);
      for (final m in malformed) {
        final r = await callsClient(() => json(m)).verifyText('hello');
        expect(r.verdict, Verdict.cannotCheck, reason: '$m');
      }
    });

    testWidgets('the sheet shows cannot check and never fires the confirmed haptic', (tester) async {
      final haptics = <Object?>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') haptics.add(call.arguments);
        return null;
      });
      for (final m in malformed) {
        haptics.clear();
        await tester.pumpWidget(CupertinoApp(
          theme: G.theme(Brightness.light),
          home: ResultSheet(key: UniqueKey(), client: callsClient(() => json(m)), bank: 'DemoBank', request: CheckRequest.message('hello')),
        ));
        await tester.pump(const Duration(seconds: 2));
        expect(tester.takeException(), isNull, reason: '$m');
        expect(find.text(Copy.I.t('verdict.cannot_check.title')), findsOneWidget, reason: '$m');
        expect(find.text(Copy.I.t('verdict.confirmed.title')), findsNothing);
        expect(haptics, isNot(contains('HapticFeedbackType.mediumImpact')), reason: '$m');
      }
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null);
    });
  });
}
