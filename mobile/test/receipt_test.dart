import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/receipt_reader.dart';
import 'package:gaskiya/src/core/screenshot.dart';
import 'package:gaskiya/src/ui/screens/receipt_screen.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

const account = '8012345678';
const otherAccount = '8098765432';
const bankCode = '999001';
const sessionId = '000013261020130211123456789012';

class FakeReader implements TextReader {
  FakeReader(this.blocks, {this.available = true, this.fails = false});
  final List<TextBlock> blocks;
  @override
  final bool available;
  final bool fails;
  final paths = <String>[];
  @override
  Future<List<TextBlock>> read(String path) async {
    paths.add(path);
    if (fails) throw StateError('ocr failed');
    return blocks;
  }
}

const receiptBlocks = [
  TextBlock('9:41', top: 0),
  TextBlock('Transaction Successful', top: 60),
  TextBlock('Amount\nNGN25,000.00', top: 120),
  TextBlock('Beneficiary Name\nAMINA BELLO STORES', top: 200),
  TextBlock('Beneficiary Account\n8012345678 | DemoBank', top: 260),
  TextBlock('Session ID\n000013 2610 2013 0211 1234 5678 9012', top: 320),
  TextBlock('Transaction Date\n20 Oct 2026, 13:02', top: 380),
  TextBlock('Fee N10.75', top: 440),
  TextBlock('Narration\nPayment for goods', top: 500),
];

ReceiptFields genuineFields({Object amountKobo = 2500000, String reference = sessionId, String valueDate = '2026-10-20', String beneficiary = account}) =>
    ReceiptFields(beneficiaryAccount: beneficiary, beneficiaryBank: bankCode, amountKobo: amountKobo, reference: reference, valueDate: valueDate);

({GaskiyaClient client, List<http.Request> requests}) fakeRegistry({
  Map<String, dynamic>? me,
  int receiptStatus = 200,
  Map<String, dynamic>? receivedAnswer,
}) {
  final requests = <http.Request>[];
  final registered = receiptDigest(genuineFields());
  final mock = MockClient((req) async {
    requests.add(req);
    switch (req.url.path) {
      case '/v1/me':
        return http.Response(
            jsonEncode(me ??
                {
                  'bank': {'id': 'demobank', 'name': 'DemoBank', 'domains': ['demobank.ng'], 'bankCode': bankCode},
                  'phoneLast4': '5678',
                  'accounts': [account, otherAccount],
                }),
            200);
      case '/v1/verify/receipt':
        if (receiptStatus != 200) return http.Response(jsonEncode({'code': 'error', 'message': 'no'}), receiptStatus);
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        final ok = body['receiptDigest'] == registered && body['beneficiaryAccount'] == account;
        return http.Response(
          jsonEncode(ok
              ? (receivedAnswer ?? {'verdict': 'received', 'bank': 'DemoBank', 'paidFrom': 'PayBank', 'registeredAt': '2026-10-20T12:02:11Z'})
              : {'verdict': 'not_confirmed', 'bank': 'DemoBank'}),
          200,
        );
    }
    return http.Response('{"code":"not_found","message":"no"}', 404);
  });
  return (client: GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: mock), requests: requests);
}

GaskiyaClient failingClient(Object Function() answer) =>
    GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) async => answer() as http.Response));

Future<void> pumpFrames(WidgetTester tester, [int n = 12]) async {
  for (var i = 0; i < n; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapKey(WidgetTester tester, String key) async {
  await tester.scrollUntilVisible(find.byKey(ValueKey(key)), 120, scrollable: find.byType(Scrollable).first);
  await tester.pump();
  await tester.tap(find.byKey(ValueKey(key)));
  await pumpFrames(tester);
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('RCPT-A: receipt fields are read from text found on the phone', () {
    test('labelled receipt: amount, 30-digit session ID in groups, day-month-year date', () {
      final r = readReceipt(receiptBlocks);
      expect(r.amountKobo, 2500000);
      expect(r.reference, sessionId);
      expect(r.valueDate, '2026-10-20');
    });

    test('label and value in separate blocks, naira sign, a transfer reference, month-day-year date', () {
      final r = readReceipt(const [
        TextBlock('Transfer Receipt', top: 10),
        TextBlock('Amount', top: 100),
        TextBlock('\u20A61,500.50', top: 101),
        TextBlock('Transaction Ref', top: 150),
        TextBlock('FT26293ABC12', top: 151),
        TextBlock('Date', top: 200),
        TextBlock('Oct 20, 2026 1:02 PM', top: 201),
        TextBlock('Balance N2,345,000.00', top: 260),
      ]);
      expect(r.amountKobo, 150050);
      expect(r.reference, 'FT26293ABC12');
      expect(r.valueDate, '2026-10-20');
    });

    test('an unlabelled amount, a session ID split over two lines, a numeric date read day first', () {
      final r = readReceipt(const [
        TextBlock('You sent N 7,250 to MUSA ADAMU', top: 10),
        TextBlock('Session ID:\n000013261020130211\n123456789012', top: 60),
        TextBlock('05/10/2026 08:15', top: 120),
      ]);
      expect(r.amountKobo, 725000);
      expect(r.reference, sessionId);
      expect(r.valueDate, '2026-10-05');
    });

    test('a plain labelled amount, an ISO date, a lower-case reference with hyphens', () {
      final r = readReceipt(const [
        TextBlock('Amount: 2,500.00', top: 10),
        TextBlock('Reference: gsk-7781-xq', top: 40),
        TextBlock('Value date 2026-10-20T13:02:11', top: 80),
        TextBlock('Status: Successful', top: 120),
      ]);
      expect(r.amountKobo, 250000);
      expect(r.reference, 'GSK7781XQ');
      expect(r.valueDate, '2026-10-20');
    });

    test('day-month-year with hyphens; the largest marked amount when none is labelled', () {
      final r = readReceipt(const [
        TextBlock('Debit N 1,000.00 fee N 25.00', top: 10),
        TextBlock('Credit of NGN 12,000 completed', top: 20),
        TextBlock('Session ID 000013261020130211123456789012', top: 30),
        TextBlock('20-Oct-2026', top: 40),
      ]);
      expect(r.amountKobo, 1200000);
      expect(r.valueDate, '2026-10-20');
    });

    test('a date that does not exist is not read', () {
      final r = readReceipt(const [TextBlock('Amount NGN100.00'), TextBlock('Date 31/02/2026', top: 10)]);
      expect(r.amountKobo, 10000);
      expect(r.valueDate, isNull);
    });

    test('a field that is not clear is left empty, never guessed', () {
      final r = readReceipt(const [
        TextBlock('Amount NGN25,00.00', top: 10),
        TextBlock('Session ID 000013 2610 2013 0211 1234 5678 901', top: 20),
        TextBlock('Reference Successful', top: 30),
      ]);
      expect(r.amountKobo, isNull);
      expect(r.reference, isNull);
      expect(r.isEmpty, isTrue);
    });

    for (final (name, blocks) in [
      ('a chat screenshot', const [TextBlock('12:41'), TextBlock('Mum', top: 20), TextBlock('Hi dear, are you coming home today?', top: 60), TextBlock('Yes, by 6pm', top: 90), TextBlock('Tuesday 20 Oct 2026', top: 5)]),
      ('a bank message', const [TextBlock('DemoBank: our app now has instant card controls. Update today at https://www.demobank.ng/app')]),
      ('nothing at all', const <TextBlock>[]),
    ]) {
      test('not a receipt: $name gives nothing', () {
        final r = readReceipt(blocks);
        expect(r.isEmpty, isTrue);
      });
    }

    test('the image is read on the phone; a failing or missing reader reads nothing', () async {
      final reader = FakeReader(receiptBlocks);
      expect((await readReceiptImage(reader, '/tmp/receipt.png')).reference, sessionId);
      expect(reader.paths, ['/tmp/receipt.png']);
      expect((await readReceiptImage(FakeReader(receiptBlocks, fails: true), '/tmp/r.png')).isEmpty, isTrue);
      expect((await readReceiptImage(FakeReader(receiptBlocks, available: false), '/tmp/r.png')).isEmpty, isTrue);
    });

    test('amounts are shown as printed', () {
      expect(formatKobo(2500000), '25,000.00');
      expect(formatKobo(150050), '1,500.50');
      expect(formatKobo(5), '0.05');
      expect(formatKobo(123456789012), '1,234,567,890.12');
      expect(formatNaira(2500000), 'NGN25,000.00');
      expect(maskAccount(account), '******5678');
    });
  });

  group('RCPT-B: only a digest and the account leave the phone', () {
    test('the digest is computed with the bank code from /v1/me', () async {
      final f = fakeRegistry();
      final me = (await f.client.me())!;
      expect(me.accounts, [account, otherAccount]);
      expect(me.bankCode, bankCode);
      final r = await f.client.checkReceipt(account: account, bankCode: me.bankCode, amountKobo: 2500000, reference: '000013 2610 2013 0211 1234 5678 9012', valueDate: '2026-10-20');
      expect(r.verdict, ReceiptVerdict.received);
      expect(r.paidFrom, 'PayBank');
      expect(r.registeredAt, DateTime.parse('2026-10-20T12:02:11Z').toLocal());
      final req = f.requests.last;
      expect(req.url.path, '/v1/verify/receipt');
      expect(req.headers['authorization'], 'Bearer tok');
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      expect(body.keys.toSet(), {'receiptDigest', 'beneficiaryAccount'});
      expect(body['receiptDigest'], receiptDigest(genuineFields()));
      expect(body['beneficiaryAccount'], account);
      for (final secretField in ['2500000', '25,000', sessionId, '2026-10-20', bankCode, 'amount', 'reference', 'valueDate']) {
        expect(req.body, isNot(contains(secretField)));
      }
    });

    test('one kobo or one digit changed is not confirmed; another account is not confirmed', () async {
      final f = fakeRegistry();
      expect((await f.client.checkReceipt(account: account, bankCode: bankCode, amountKobo: 2500001, reference: sessionId, valueDate: '2026-10-20')).verdict, ReceiptVerdict.notConfirmed);
      expect((await f.client.checkReceipt(account: account, bankCode: bankCode, amountKobo: 2500000, reference: '${sessionId.substring(0, 29)}3', valueDate: '2026-10-20')).verdict,
          ReceiptVerdict.notConfirmed);
      expect((await f.client.checkReceipt(account: otherAccount, bankCode: bankCode, amountKobo: 2500000, reference: sessionId, valueDate: '2026-10-20')).verdict, ReceiptVerdict.notConfirmed);
    });

    test('with no bank code, or a field that cannot be canonical, nothing is sent and the answer is cannot check', () async {
      final f = fakeRegistry();
      expect((await f.client.checkReceipt(account: account, bankCode: null, amountKobo: 2500000, reference: sessionId, valueDate: '2026-10-20')).verdict, ReceiptVerdict.cannotCheck);
      expect((await f.client.checkReceipt(account: account, bankCode: bankCode, amountKobo: 2500000, reference: 'AB/12', valueDate: '2026-10-20')).verdict, ReceiptVerdict.cannotCheck);
      expect((await f.client.checkReceipt(account: account, bankCode: bankCode, amountKobo: 2500000, reference: sessionId, valueDate: '2026-02-30')).verdict, ReceiptVerdict.cannotCheck);
      expect((await f.client.verifyReceipt(account: account, digest: 'not-a-digest')).verdict, ReceiptVerdict.cannotCheck);
      expect(f.requests, isEmpty);
    });

    test('/v1/me keeps only well-formed accounts and bank codes', () async {
      final f = fakeRegistry(me: {
        'bank': {'id': 'demobank', 'name': 'DemoBank', 'domains': [], 'bankCode': '044'},
        'accounts': [account, '12345', 7, account],
      });
      final me = (await f.client.me())!;
      expect(me.accounts, [account]);
      expect(me.bankCode, isNull);
      expect(me.bankName, 'DemoBank');
    });
  });

  group('RCPT-C: receipt checks fail closed', () {
    final digest = receiptDigest(genuineFields());

    for (final (name, status) in [('a server error', 500), ('an unavailable registry', 503), ('an account not linked', 403), ('an unknown answer', 404)]) {
      test('$name is cannot check', () async {
        final f = fakeRegistry(receiptStatus: status);
        expect((await f.client.verifyReceipt(account: account, digest: digest)).verdict, ReceiptVerdict.cannotCheck);
      });
    }

    test('a network error is cannot check, and /v1/me gives null', () async {
      final client = failingClient(() => throw Exception('offline'));
      expect((await client.verifyReceipt(account: account, digest: digest)).verdict, ReceiptVerdict.cannotCheck);
      expect(await client.me(), isNull);
    });

    test('a body that is not JSON is cannot check', () async {
      final client = failingClient(() => http.Response('<html>', 200));
      expect((await client.verifyReceipt(account: account, digest: digest)).verdict, ReceiptVerdict.cannotCheck);
      expect(await client.me(), isNull);
    });

    for (final (name, answer) in [
      ('without paidFrom', {'verdict': 'received', 'bank': 'DemoBank', 'registeredAt': '2026-10-20T12:02:11Z'}),
      ('with an empty paidFrom', {'verdict': 'received', 'bank': 'DemoBank', 'paidFrom': ' ', 'registeredAt': '2026-10-20T12:02:11Z'}),
      ('without registeredAt', {'verdict': 'received', 'bank': 'DemoBank', 'paidFrom': 'PayBank'}),
      ('with an unreadable registeredAt', {'verdict': 'received', 'bank': 'DemoBank', 'paidFrom': 'PayBank', 'registeredAt': 'yesterday'}),
      ('with a verdict it does not know', {'verdict': 'genuine', 'bank': 'DemoBank', 'paidFrom': 'PayBank', 'registeredAt': '2026-10-20T12:02:11Z'}),
    ]) {
      test('a received answer $name is cannot check', () async {
        final f = fakeRegistry(receivedAnswer: answer);
        expect((await f.client.verifyReceipt(account: account, digest: digest)).verdict, ReceiptVerdict.cannotCheck);
      });
    }

    test('429 is passed on, so the screen can say to wait', () async {
      final f = fakeRegistry(receiptStatus: 429);
      await expectLater(f.client.verifyReceipt(account: account, digest: digest), throwsA(isA<ApiException>().having((e) => e.status, 'status', 429)));
    });
  });

  group('RCPT-D: the check flow on screen', () {
    Widget screen(GaskiyaClient client, {TextReader? reader}) => ReceiptScreen(
          client: client,
          reader: reader ?? FakeReader(receiptBlocks),
          pickImage: () async => '/tmp/receipt.png',
          now: () => DateTime.utc(2026, 10, 21, 9),
        );

    Future<void> tidy(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    }

    testWidgets('screenshot fills the fields, then the check says received', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry();
      final reader = FakeReader(receiptBlocks);
      await tester.pumpWidget(hostWith(screen(f.client, reader: reader), disableAnimations: true));
      await pumpFrames(tester);
      expect(find.text(Copy.I.t('receipt.accountOption', {'last4': '5678'})), findsOneWidget);
      expect(find.text(Copy.I.t('receipt.accountOption', {'last4': '5432'})), findsOneWidget);
      expect(find.text('21 October 2026'), findsOneWidget);

      await tapKey(tester, 'receipt-screenshot');
      expect(reader.paths, ['/tmp/receipt.png']);
      expect(tester.widget<CupertinoTextField>(find.byKey(const ValueKey('receipt-amount'))).controller!.text, '25,000.00');
      expect(tester.widget<CupertinoTextField>(find.byKey(const ValueKey('receipt-reference'))).controller!.text, sessionId);
      expect(find.text('20 October 2026'), findsOneWidget);
      expect(find.text(Copy.I.t('receipt.screenshotNote')), findsOneWidget);

      await tapKey(tester, 'receipt-check');
      await pumpFrames(tester, 20);
      expect(find.text(Copy.I.t('receipt.verdict.received.title')), findsOneWidget);
      final at = DateTime.parse('2026-10-20T12:02:11Z').toLocal();
      final time = '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
      final date = '${at.day} ${Copy.I.t('app.result.months').split(',')[at.month - 1]} ${at.year}';
      expect(
        find.text(Copy.I.t('receipt.verdict.received.body', {'payer': 'PayBank', 'amount': 'NGN25,000.00', 'account': '******5678', 'date': date, 'time': time})),
        findsOneWidget,
      );
      final verify = f.requests.where((r) => r.url.path == '/v1/verify/receipt').single;
      expect((jsonDecode(verify.body) as Map).keys.toSet(), {'receiptDigest', 'beneficiaryAccount'});
      expect(tester.takeException(), isNull);
      await tidy(tester);
    });

    testWidgets('a tampered amount is not confirmed', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry();
      await tester.pumpWidget(hostWith(screen(f.client), disableAnimations: true));
      await pumpFrames(tester);
      await tapKey(tester, 'receipt-screenshot');
      await tester.enterText(find.byKey(const ValueKey('receipt-amount')), '250,000.00');
      await tapKey(tester, 'receipt-check');
      await pumpFrames(tester, 20);
      expect(find.text(Copy.I.t('receipt.verdict.not_confirmed.title')), findsOneWidget);
      expect(find.text(Copy.I.t('receipt.verdict.not_confirmed.body', {'account': '******5678'})), findsOneWidget);
      expect(find.text(Copy.I.t('receipt.verdict.received.title')), findsNothing);
      await tidy(tester);
    });

    testWidgets('typed fields are checked before anything is sent', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry();
      await tester.pumpWidget(hostWith(screen(f.client), disableAnimations: true));
      await pumpFrames(tester);
      await tester.enterText(find.byKey(const ValueKey('receipt-amount')), '25,00');
      await tester.enterText(find.byKey(const ValueKey('receipt-reference')), 'AB/1');
      await tapKey(tester, 'receipt-check');
      expect(find.text(Copy.I.t('receipt.invalidAmount')), findsOneWidget);
      expect(find.text(Copy.I.t('receipt.invalidReference')), findsOneWidget);
      expect(f.requests.where((r) => r.url.path == '/v1/verify/receipt'), isEmpty);
      await tidy(tester);
    });

    testWidgets('an unreadable image says so and fills nothing', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry();
      await tester.pumpWidget(hostWith(screen(f.client, reader: FakeReader(const [TextBlock('12:41'), TextBlock('Hello there')])), disableAnimations: true));
      await pumpFrames(tester);
      await tapKey(tester, 'receipt-screenshot');
      expect(find.text(Copy.I.t('receipt.unreadable')), findsOneWidget);
      expect(tester.widget<CupertinoTextField>(find.byKey(const ValueKey('receipt-amount'))).controller!.text, isEmpty);
      await tidy(tester);
    });

    testWidgets('without on-device reading there is no screenshot button', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry();
      await tester.pumpWidget(hostWith(screen(f.client, reader: FakeReader(receiptBlocks, available: false)), disableAnimations: true));
      await pumpFrames(tester);
      expect(find.byKey(const ValueKey('receipt-screenshot')), findsNothing);
      expect(find.byKey(const ValueKey('receipt-check')), findsOneWidget);
      await tidy(tester);
    });

    testWidgets('no linked accounts: the no-accounts text and no check button', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry(me: {
        'bank': {'id': 'demobank', 'name': 'DemoBank', 'domains': [], 'bankCode': bankCode},
        'accounts': <String>[],
      });
      await tester.pumpWidget(hostWith(screen(f.client), disableAnimations: true));
      await pumpFrames(tester);
      expect(find.text(Copy.I.t('receipt.noAccounts')), findsOneWidget);
      expect(find.byKey(const ValueKey('receipt-check')), findsNothing);
      await tidy(tester);
    });

    testWidgets('a registry that does not answer shows cannot check, with no form', (tester) async {
      phoneSize(tester);
      await tester.pumpWidget(hostWith(screen(failingClient(() => http.Response('', 503))), disableAnimations: true));
      await pumpFrames(tester);
      expect(find.text(Copy.I.t('receipt.verdict.cannot_check.title')), findsOneWidget);
      expect(find.byKey(const ValueKey('receipt-check')), findsNothing);
      await tidy(tester);
    });

    testWidgets('a bank without a bank code gives cannot check, and sends nothing', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry(me: {
        'bank': {'id': 'demobank', 'name': 'DemoBank', 'domains': [], 'bankCode': null},
        'accounts': [account],
      });
      await tester.pumpWidget(hostWith(screen(f.client), disableAnimations: true));
      await pumpFrames(tester);
      await tapKey(tester, 'receipt-screenshot');
      await tapKey(tester, 'receipt-check');
      await pumpFrames(tester, 20);
      expect(find.text(Copy.I.t('receipt.verdict.cannot_check.title')), findsOneWidget);
      expect(f.requests.where((r) => r.url.path == '/v1/verify/receipt'), isEmpty);
      await tidy(tester);
    });

    testWidgets('too many checks: cannot check, with the wait message', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry(receiptStatus: 429);
      await tester.pumpWidget(hostWith(screen(f.client), disableAnimations: true));
      await pumpFrames(tester);
      await tapKey(tester, 'receipt-screenshot');
      await tapKey(tester, 'receipt-check');
      await pumpFrames(tester, 20);
      expect(find.text(Copy.I.t('receipt.verdict.cannot_check.title')), findsOneWidget);
      expect(find.text(Copy.I.t('app.result.rateLimited')), findsOneWidget);
      await tidy(tester);
    });

    testWidgets('at twice the text size nothing overflows, form and verdict', (tester) async {
      phoneSize(tester);
      final f = fakeRegistry();
      await tester.pumpWidget(hostWith(screen(f.client), textScale: 2, disableAnimations: true));
      await pumpFrames(tester);
      expect(tester.takeException(), isNull);
      await tapKey(tester, 'receipt-screenshot');
      await tapKey(tester, 'receipt-check');
      await pumpFrames(tester, 20);
      expect(find.text(Copy.I.t('receipt.verdict.received.title')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tidy(tester);
    });
  });
}
