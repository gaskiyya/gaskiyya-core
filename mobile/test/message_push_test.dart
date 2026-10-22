import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gaskiya/src/core/receipt_reader.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/push.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/screens/receipt_screen.dart';

import 'support.dart';

const _text = 'DemoBank: Acct ***5678 debited NGN5,000.00 POS SHOPRITE LEKKI. Bal NGN12,450.10';

class TapTransport implements PushTransport {
  final taps = StreamController<Map<String, dynamic>>.broadcast();
  final incoming = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Future<bool> start() async => true;
  @override
  Future<String?> token() async => 'fcm-token-1';
  @override
  Stream<String> get tokenRefresh => const Stream.empty();
  @override
  Stream<Map<String, dynamic>> get messages => incoming.stream;
  @override
  Stream<Map<String, dynamic>> get opened => taps.stream;
  @override
  Future<Map<String, dynamic>?> launchedFrom() async => null;
  @override
  String get platform => 'android';
}

Map<String, dynamic> message(String id) => {'type': 'message.received', 'itemId': id, 'orgId': 'demobank', 'bank': 'DemoBank', 'channel': 'sms'};

Map<String, dynamic> transfer(String id) => {
      'type': 'transfer.received',
      'transferId': id,
      'orgId': 'demobank',
      'bank': 'DemoBank',
      'amountKobo': '1250000',
      'reference': '000013261022120000123456789012',
      'valueDate': '2026-10-22',
    };

FakeRegistry withInbox() {
  final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
  registry.inboxItems['demobank'] = [
    {'id': 'm1', 'from': 'DemoBank', 'text': _text, 'at': '2026-10-22T10:30:00Z', 'kind': 'genuine', 'channel': 'sms'},
  ];
  return registry;
}

Future<void> frames(WidgetTester tester, [int n = 20]) async {
  for (var i = 0; i < n; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
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

  group('a message or payment alert from the bank', () {
    test('arriving while the app is open refreshes the inbox and raises a banner, not the Calls tab', () async {
      final registry = withInbox();
      final state = await linkedState(registry, ['demobank']);
      final inbox = state.inboxChanged.value;
      final calls = state.openCallsTab.value;
      state.handleNotice(message('m1'));
      expect(state.inboxChanged.value, inbox + 1);
      expect(state.arrivedMessage.value?.id, 'm1');
      expect(state.arrivedMessage.value?.from, 'DemoBank');
      expect(state.arrivedMessage.value?.receipt, isNull);
      expect(state.openMessage.value, isNull);
      expect(state.openCallsTab.value, calls);
      state.handleNotice({'type': 'message.received'});
      expect(state.arrivedMessage.value?.id, 'm1');
      state.dispose();
      await registry.close();
    });

    test('tapping a message notification opens that message, not the Calls tab', () async {
      final registry = withInbox();
      final push = TapTransport();
      final state = await linkedState(registry, ['demobank'], push: push);
      await pumpEventQueue();
      final calls = state.openCallsTab.value;
      push.taps.add(message('m1'));
      await pumpEventQueue();
      expect(state.openMessage.value, 'm1');
      expect(state.openCallsTab.value, calls);
      expect(state.arrivedMessage.value, isNull);
      state.dispose();
      await registry.close();
    });

    test('tapping a payment alert opens the receipt check with its amount, reference and date', () async {
      final registry = withInbox();
      final push = TapTransport();
      final state = await linkedState(registry, ['demobank'], push: push);
      await pumpEventQueue();
      final calls = state.openCallsTab.value;
      push.taps.add(transfer('t1'));
      await pumpEventQueue();
      expect(state.openReceipt.value, (orgId: 'demobank', amountKobo: 1250000, reference: '000013261022120000123456789012', valueDate: '2026-10-22'));
      expect(state.openMessage.value, isNull);
      expect(state.openCallsTab.value, calls);
      push.taps.add({'type': 'transfer.sent', 'transferId': 't1', 'bank': 'DemoBank'});
      await pumpEventQueue();
      expect(state.openCallsTab.value, calls);
      state.dispose();
      await registry.close();
    });

    testWidgets('a tapped message notification shows the message in full on the Check tab', (tester) async {
      phoneSize(tester);
      mockSharing(tester);
      final registry = withInbox();
      final state = await tester.runAsync(() => linkedState(registry, ['demobank']));
      await tester.pumpWidget(hostWith(HomeScreen(state: state!), disableAnimations: true));
      await frames(tester, 5);
      state.handleNotice(message('m1'), null, true);
      await frames(tester);
      final preview = find.byKey(const ValueKey('message-preview'));
      expect(preview, findsOneWidget);
      expect(find.descendant(of: preview, matching: find.text(_text)), findsOneWidget);
      expect(state.openMessage.value, isNull);
      await tidy(tester, state, registry);
    });

    testWidgets('the in-app banner names the sender, and tapping it opens the message', (tester) async {
      phoneSize(tester);
      mockSharing(tester);
      final registry = withInbox();
      final state = await tester.runAsync(() => linkedState(registry, ['demobank']));
      await tester.pumpWidget(hostWith(HomeScreen(state: state!), disableAnimations: true));
      await frames(tester, 5);
      state.handleNotice(message('m1'));
      await frames(tester, 3);
      final banner = find.byKey(const ValueKey('message-banner'));
      expect(find.descendant(of: banner, matching: find.text('DemoBank')), findsOneWidget);
      expect(find.descendant(of: banner, matching: find.text(Copy.I.t('app.check.newMessage'))), findsOneWidget);
      await tester.tap(banner);
      await frames(tester);
      expect(find.byKey(const ValueKey('message-preview')), findsOneWidget);
      await tester.pump(const Duration(seconds: 7));
      await tidy(tester, state, registry);
    });

    testWidgets('a tapped payment alert opens the receipt check filled in', (tester) async {
      phoneSize(tester);
      mockSharing(tester);
      final registry = withInbox();
      final state = await tester.runAsync(() => linkedState(registry, ['demobank']));
      // The large-title to back-button hero logs a debug-only TextStyle lerp note during the push; it is not about this flow.
      final onError = FlutterError.onError;
      FlutterError.onError = (d) {
        if (!d.toString().contains('interpolate TextStyles')) onError?.call(d);
      };
      addTearDown(() => FlutterError.onError = onError);
      await tester.pumpWidget(hostWith(HomeScreen(state: state!), disableAnimations: true));
      await frames(tester, 5);
      state.handleNotice(transfer('t1'), null, true);
      await frames(tester);
      final screen = find.byKey(const ValueKey('receipt-from-alert'));
      expect(screen, findsOneWidget);
      final r = tester.widget<ReceiptScreen>(screen);
      expect((r.amountKobo, r.reference, r.valueDate), (1250000, '000013261022120000123456789012', '2026-10-22'));
      expect(state.openReceipt.value, isNull);
      await tidy(tester, state, registry);
      FlutterError.onError = onError;
    });

    testWidgets('the receipt check opens with the alert\'s amount, reference and date filled in', (tester) async {
      phoneSize(tester);
      final client = GaskiyaClient(
        baseUrl: 'http://registry',
        token: () async => 'tok',
        httpClient: MockClient((req) async => req.url.path == '/v1/me'
            ? http.Response(jsonEncode({'bank': {'id': 'demobank', 'name': 'DemoBank', 'domains': ['demobank.ng'], 'bankCode': '000013'}, 'phoneLast4': '5678', 'accounts': ['0012345678']}), 200)
            : http.Response('{}', 404)),
      );
      await tester.pumpWidget(hostWith(ReceiptScreen(client: client, amountKobo: 1250000, reference: '000013261022120000123456789012', valueDate: '2026-10-22'), disableAnimations: true));
      await frames(tester, 5);
      expect(tester.widget<CupertinoTextField>(find.byKey(const ValueKey('receipt-amount'))).controller!.text, formatKobo(1250000));
      expect(tester.widget<CupertinoTextField>(find.byKey(const ValueKey('receipt-reference'))).controller!.text, '000013261022120000123456789012');
      expect(find.text('22 October 2026'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    });
  });
}
