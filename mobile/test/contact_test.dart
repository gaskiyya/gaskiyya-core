import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/text_tools.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/result_sheet.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

({GaskiyaClient client, List<http.Request> requests}) answering(Object body, [int status = 200]) {
  final requests = <http.Request>[];
  final client = GaskiyaClient(
    baseUrl: 'http://registry',
    token: () async => 'tok',
    httpClient: MockClient((req) async {
      requests.add(req);
      return http.Response(body is String ? body : jsonEncode(body), status);
    }),
  );
  return (client: client, requests: requests);
}

final official = {
  'verdict': 'official',
  'contact': {'type': 'phone', 'value': '+2349060000000'},
  'matches': [
    {'id': 'demobank', 'name': 'DemoBank', 'kind': 'bank', 'as': ['phone', 'whatsapp']},
  ],
};

final notOfficial = {
  'verdict': 'not_official',
  'contact': {'type': 'social', 'value': 'demobank_care', 'platform': 'x'},
  'organisation': null,
  'reasons': ['impersonation', 'not_registered'],
  'impersonates': [
    {'id': 'demobank', 'name': 'DemoBank', 'kind': 'bank'},
  ],
};

Future<void> showSheet(WidgetTester tester, GaskiyaClient client, CheckRequest req, {double textScale = 1, String bank = 'DemoBank', String kind = 'bank'}) async {
  await tester.pumpWidget(hostWith(ResultSheet(client: client, bank: bank, kind: kind, request: req), textScale: textScale));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tidy(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 1));
}

Copy get c => Copy.I;

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('detection: a contact on its own goes to the contact check', () {
    test('numbers, emails, handles and profile links are contacts, read as the registry reads them', () {
      expect(parseContact('+234 906 000 0000'), (type: 'phone', value: '+2349060000000', platform: null));
      expect(parseContact('0809 555 0101'), (type: 'phone', value: '+2348095550101', platform: null));
      expect(parseContact('tel:+2348012345678'), (type: 'phone', value: '+2348012345678', platform: null));
      expect(parseContact('Help@DemoBank.ng'), (type: 'email', value: 'help@demobank.ng', platform: null));
      expect(parseContact('mailto:care@demobank.ng?subject=hi'), (type: 'email', value: 'care@demobank.ng', platform: null));
      expect(parseContact('@DemoBank_NG'), (type: 'handle', value: 'demobank_ng', platform: null));
      expect(parseContact('https://wa.me/2349060000000'), (type: 'whatsapp', value: '+2349060000000', platform: null));
      expect(parseContact('https://api.whatsapp.com/send?phone=2349060000000'), (type: 'whatsapp', value: '+2349060000000', platform: null));
      expect(parseContact('https://x.com/DemoBank'), (type: 'social', value: 'demobank', platform: 'x'));
      expect(parseContact('twitter.com/demobank'), (type: 'social', value: 'demobank', platform: 'x'));
      expect(parseContact('https://www.facebook.com/demobank'), (type: 'social', value: 'demobank', platform: 'facebook'));
      expect(parseContact('https://fb.com/profile.php?id=1000123456'), (type: 'social', value: '1000123456', platform: 'facebook'));
      expect(parseContact('https://instagram.com/demobank/'), (type: 'social', value: 'demobank', platform: 'instagram'));
      expect(parseContact('https://www.tiktok.com/@demobank'), (type: 'social', value: 'demobank', platform: 'tiktok'));
      expect(parseContact('t.me/demobank_help'), (type: 'social', value: 'demobank_help', platform: 'telegram'));
    });

    test('messages, other links and site pages are not contacts', () {
      for (final text in [
        'https://www.demobank.ng/app',
        'demobank.ng',
        'DemoBank: your card ending 1234 was used. Call 0809 555 0101 if not you.',
        'Your account is blocked',
        '482913',
        'https://x.com/home',
        'https://www.facebook.com/sharer',
        'https://wa.me/',
        'ftp://x.com/demobank',
        '',
      ]) {
        expect(looksLikeContact(text), isFalse, reason: text);
      }
    });

    test('routing: contacts to the contact check, links to the link check, the rest to the message check', () {
      expect(requestFor('+234 906 000 0000').kind, CheckKind.contact);
      expect(requestFor('help@demobank.ng').kind, CheckKind.contact);
      expect(requestFor('@demobank').kind, CheckKind.contact);
      expect(requestFor('https://x.com/demobank').kind, CheckKind.contact);
      expect(requestFor('https://www.demobank.ng/app').kind, CheckKind.link);
      expect(requestFor('Your account is blocked. Call us now').kind, CheckKind.message);
      expect(requestFor('Your account is blocked', asContact: true).kind, CheckKind.contact);
    });

    testWidgets('the check screen offers the contact check and labels the button for a pasted contact', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.byKey(const ValueKey('check-contact')), findsOneWidget);

      await tester.enterText(find.byType(CupertinoTextField), 'https://www.demobank.ng/app');
      await tester.pump();
      expect(find.text(c.t('app.check.checkLink')), findsOneWidget);

      await tester.enterText(find.byType(CupertinoTextField), '0809 555 0101');
      await tester.pump();
      expect(find.text(c.t('official.app.checkContact')), findsNWidgets(2));
      expect(find.text(c.t('app.check.checkMessage')), findsNothing);
      expect(find.text(c.t('app.check.checkLink')), findsNothing);

      await tester.tap(find.text(c.t('official.app.checkContact')).last);
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(registry.calls.map((x) => x.path), contains('/v1/verify/contact'));
      expect(registry.calls.map((x) => x.path), isNot(contains('/v1/verify/message')));
      expect(find.text(c.t('official.contact.cannotCheckBody')), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 7));
      state.dispose();
      await registry.close();
    });
  });

  group('verifyContact: parsing, and failing closed', () {
    test('sends the pasted text for every organisation (no tenantId) and reads an official answer', () async {
      final f = answering(official);
      final r = await f.client.verifyContact('  0906 000 0000 ');
      expect(f.requests.single.url.path, '/v1/verify/contact');
      expect(jsonDecode(f.requests.single.body), {'contact': '0906 000 0000'});
      expect(r.verdict, ContactVerdict.official);
      expect(r.type, 'phone');
      expect(r.value, '+2349060000000');
      expect(r.matches.single.name, 'DemoBank');
      expect(r.matches.single.as, ['phone', 'whatsapp']);
    });

    test('reads a not-official answer with the organisations it imitates', () async {
      final r = await answering(notOfficial).client.verifyContact('https://x.com/demobank_care');
      expect(r.verdict, ContactVerdict.notOfficial);
      expect(r.platform, 'x');
      expect(r.organisation, isNull);
      expect(r.reasons, contains('impersonation'));
      expect(r.impersonates.single.id, 'demobank');
    });

    test('a 422 is "not a contact"; a 429 is rethrown', () async {
      expect((await answering({'code': 'not_a_contact'}, 422).client.verifyContact('hello')).verdict, ContactVerdict.notAContact);
      await expectLater(answering({'code': 'rate_limited'}, 429).client.verifyContact('0809 555 0101'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 429)));
    });

    test('errors and malformed answers are "cannot check", never "official"', () async {
      for (final (body, status) in <(Object, int)>[
        ({'code': 'error'}, 500),
        ({'code': 'unknown_tenant'}, 404),
        ({'verdict': 'cannot_check'}, 200),
        ('not json', 200),
        ({'verdict': 'official', 'contact': {'type': 'phone', 'value': '+2349060000000'}, 'matches': []}, 200),
        ({'verdict': 'official', 'contact': {'type': 'phone', 'value': '+2349060000000'}}, 200),
        ({'verdict': 'official', 'matches': (official['matches'] as List)}, 200),
        ({'verdict': 'official', 'contact': {'type': 'pager', 'value': '1'}, 'matches': (official['matches'] as List)}, 200),
        ({'verdict': 'official', 'contact': {'type': 'phone', 'value': '+2349060000000'}, 'matches': [{'id': 'demobank', 'name': 'DemoBank', 'as': []}]}, 200),
        ({'verdict': 'genuine'}, 200),
      ]) {
        expect((await answering(body, status).client.verifyContact('0906 000 0000')).verdict, ContactVerdict.cannotCheck, reason: '$body');
      }
      final down = GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) async => throw const SocketException('down')));
      expect((await down.verifyContact('0906 000 0000')).verdict, ContactVerdict.cannotCheck);
    });

    test('banks carry their kind; an older registry without one means a bank', () {
      final j = {'id': 'taxoffice', 'name': 'Tax Office (demo)', 'kind': 'agency', 'domains': ['taxoffice.example'], 'customerTokenUrl': '/sim/customer-token?tenant=taxoffice'};
      final b = Bank.fromJson(j, 'http://registry');
      expect(b.kind, 'agency');
      expect(Bank.fromJson(b.toJson(), 'http://registry').kind, 'agency');
      expect(Bank.fromJson({...j}..remove('kind'), 'http://registry').kind, 'bank');
      expect(Bank.fromJson({...j, 'kind': 'cartel'}, 'http://registry').kind, 'bank');
    });
  });

  group('the contact result sheet', () {
    testWidgets('official: the organisation, the kind of contact, and the spoofing note, without the confirmed style', (tester) async {
      phoneSize(tester);
      await showSheet(tester, answering(official).client, CheckRequest.contact('0906 000 0000'));
      expect(find.text(c.t('official.app.contactCheck')), findsOneWidget);
      expect(find.text(c.t('official.contact.official.title')), findsOneWidget);
      expect(find.text(c.t('official.contact.official.short').toUpperCase()), findsOneWidget);
      expect(find.text(c.t('official.contact.official.body', {'org': 'DemoBank', 'contact': c.t('official.contact.kinds.phone')})), findsOneWidget);
      expect(find.text('+2349060000000'), findsOneWidget);
      expect(find.text('DemoBank'), findsOneWidget);
      expect(find.text(c.t('official.contact.spoofNote')), findsOneWidget);
      expect(find.text(c.t('verdict.confirmed.title')), findsNothing);
      expect(find.text(c.t('verdict.confirmed.short').toUpperCase()), findsNothing);
      await tidy(tester);
    });

    testWidgets('official @handle: named by the platform it is registered on', (tester) async {
      phoneSize(tester);
      final answer = {
        'verdict': 'official',
        'contact': {'type': 'handle', 'value': 'demobank'},
        'matches': [
          {'id': 'demobank', 'name': 'DemoBank', 'kind': 'bank', 'as': ['social'], 'platforms': ['instagram']},
        ],
      };
      await showSheet(tester, answering(answer).client, CheckRequest.contact('@demobank'));
      final kind = c.t('official.contact.kinds.social', {'platform': c.t('official.contact.platforms.instagram')});
      expect(find.text(c.t('official.contact.official.body', {'org': 'DemoBank', 'contact': kind})), findsOneWidget);
      expect(find.text('@demobank'), findsOneWidget);
      await tidy(tester);
    });

    testWidgets('not official: the warning body for any organisation, and an impersonation warning per organisation imitated', (tester) async {
      phoneSize(tester);
      await showSheet(tester, answering(notOfficial).client, CheckRequest.contact('https://x.com/demobank_care'));
      expect(find.text(c.t('official.contact.not_official.title')), findsOneWidget);
      final kind = c.t('official.contact.kinds.social', {'platform': c.t('official.contact.platforms.x')});
      expect(find.text(c.t('official.contact.not_official.bodyAny', {'contact': kind})), findsOneWidget);
      expect(find.byKey(const ValueKey('impersonates-demobank')), findsOneWidget);
      expect(find.text(c.t('official.contact.impersonation', {'org': 'DemoBank'})), findsOneWidget);
      expect(find.text(c.t('official.contact.spoofNote')), findsNothing);
      await tidy(tester);
    });

    testWidgets('not official for a named organisation uses its body', (tester) async {
      phoneSize(tester);
      final answer = {
        ...notOfficial,
        'contact': {'type': 'phone', 'value': '+2348011112222'},
        'organisation': {'id': 'demobank', 'name': 'DemoBank', 'kind': 'bank'},
        'reasons': ['not_registered'],
        'impersonates': [],
      };
      await showSheet(tester, answering(answer).client, CheckRequest.contact('08011112222'));
      expect(find.text(c.t('official.contact.not_official.body', {'org': 'DemoBank', 'contact': c.t('official.contact.kinds.phone')})), findsOneWidget);
      await tidy(tester);
    });

    testWidgets('cannot check, and not a contact', (tester) async {
      phoneSize(tester);
      await showSheet(tester, answering({'code': 'error'}, 503).client, CheckRequest.contact('0809 555 0101'));
      expect(find.text(c.t('verdict.cannot_check.title')), findsOneWidget);
      expect(find.text(c.t('official.contact.cannotCheckBody')), findsOneWidget);
      expect(find.text(c.t('official.contact.official.title')), findsNothing);
      await tidy(tester);

      await showSheet(tester, answering({'code': 'not_a_contact'}, 422).client, CheckRequest.contact('hello there'));
      expect(find.text(c.t('official.contact.notAContact')), findsOneWidget);
      expect(find.text(c.t('official.contact.official.title')), findsNothing);
      expect(find.text(c.t('official.contact.not_official.title')), findsNothing);
      await tidy(tester);

      await showSheet(tester, answering({'code': 'rate_limited'}, 429).client, CheckRequest.contact('0809 555 0101'));
      expect(find.text(c.t('app.result.rateLimited')), findsOneWidget);
      expect(find.text(c.t('official.contact.cannotCheckBody')), findsOneWidget);
      await tidy(tester);
    });

    testWidgets('screen readers: the verdict title is a header, and each warning reads as one line', (tester) async {
      phoneSize(tester);
      final handle = tester.ensureSemantics();
      await showSheet(tester, answering(notOfficial).client, CheckRequest.contact('https://x.com/demobank_care'));
      expect(tester.getSemantics(find.bySemanticsLabel(c.t('official.contact.not_official.title'))), matchesSemantics(label: c.t('official.contact.not_official.title'), isHeader: true));
      expect(find.bySemanticsLabel(c.t('official.contact.impersonation', {'org': 'DemoBank'})), findsOneWidget);
      await tidy(tester);

      await showSheet(tester, answering(official).client, CheckRequest.contact('0906 000 0000'));
      expect(find.bySemanticsLabel(c.t('official.contact.spoofNote')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('^${RegExp.escape(c.t('official.app.contact'))}\\s+\\+2349060000000\$')), findsOneWidget);
      handle.dispose();
      await tidy(tester);
    });

    for (final (name, answer) in [('official', official), ('not official', notOfficial), ('cannot check', {'verdict': 'cannot_check'})]) {
      testWidgets('A11Y-4: at twice the text size nothing overflows ($name)', (tester) async {
        phoneSize(tester);
        await showSheet(tester, answering(answer).client, CheckRequest.contact('0906 000 0000'), textScale: 2);
        expect(tester.takeException(), isNull);
        await tidy(tester);
      });
    }

    testWidgets('A11Y-4: the check screen with the contact entry at twice the text size', (tester) async {
      phoneSize(tester);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await tester.pumpWidget(hostWith(CheckScreen(state: state), textScale: 2, disableAnimations: true));
      await tester.pump();
      await tester.enterText(find.byType(CupertinoTextField), '@demobank');
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 7));
      state.dispose();
      await registry.close();
    });
  });

  group('app links', () {
    testWidgets('an official app store page: its own title, not the confirmed style', (tester) async {
      phoneSize(tester);
      final answer = {'verdict': 'official_app', 'host': 'play.google.com', 'matchedDomain': null, 'reasons': [], 'bank': 'DemoBank', 'app': {'store': 'play', 'id': 'ng.demobank.mobile', 'official': true}};
      await showSheet(tester, answering(answer).client, CheckRequest.link('https://play.google.com/store/apps/details?id=ng.demobank.mobile'));
      expect(find.text(c.t('official.app.appCheck')), findsOneWidget);
      expect(find.text(c.t('official.apps.officialTitle', {'org': 'DemoBank'})), findsOneWidget);
      expect(find.text(c.t('official.apps.officialBody', {'org': 'DemoBank'})), findsOneWidget);
      expect(find.text(c.t('official.apps.short').toUpperCase()), findsOneWidget);
      expect(find.text(c.t('verdict.confirmed.title')), findsNothing);
      await tidy(tester);
    });

    testWidgets('an official_app answer without its app fails closed', (tester) async {
      phoneSize(tester);
      final answer = {'verdict': 'official_app', 'host': 'play.google.com', 'reasons': [], 'bank': 'DemoBank'};
      await showSheet(tester, answering(answer).client, CheckRequest.link('https://play.google.com/store/apps/details?id=x'));
      expect(find.text(c.t('verdict.cannot_check.title')), findsOneWidget);
      expect(find.text(c.t('official.apps.officialTitle', {'org': 'DemoBank'})), findsNothing);
      await tidy(tester);
    });

    testWidgets('an APK download and a fake app are warned about', (tester) async {
      phoneSize(tester);
      final apk = {'verdict': 'not_confirmed', 'host': 'demobank-app.com', 'matchedDomain': null, 'reasons': ['apk', 'fake_app', 'not_registered'], 'bank': 'DemoBank', 'app': {'store': 'apk', 'id': null, 'official': false}};
      await showSheet(tester, answering(apk).client, CheckRequest.link('https://demobank-app.com/demobank.apk'));
      expect(find.text(c.t('link.not_confirmed.title')), findsOneWidget);
      expect(find.text(c.t('official.apps.apk')), findsOneWidget);
      expect(find.text(c.t('official.apps.fakeApp', {'org': 'DemoBank'})), findsNothing);
      await tidy(tester);

      final fake = {'verdict': 'not_confirmed', 'host': 'play.google.com', 'matchedDomain': null, 'reasons': ['fake_app'], 'bank': 'DemoBank', 'app': {'store': 'play', 'id': 'com.demobank.loans', 'official': false}};
      await showSheet(tester, answering(fake).client, CheckRequest.link('https://play.google.com/store/apps/details?id=com.demobank.loans'));
      expect(find.text(c.t('official.apps.fakeApp', {'org': 'DemoBank'})), findsOneWidget);
      expect(find.text(c.t('official.apps.apk')), findsNothing);
      await tidy(tester);
    });
  });

  group('organisations that are not banks', () {
    test('tOrg: a bank reads exactly as before; an agency or company is named', () {
      for (final path in Copy.orgVariants.keys) {
        expect(c.tOrg(path, 'bank', {'bank': 'DemoBank'}), c.t(path, {'bank': 'DemoBank'}), reason: path);
        expect(c.tOrg(path, null, {'bank': 'DemoBank'}), c.t(path, {'bank': 'DemoBank'}), reason: path);
        for (final kind in ['agency', 'company']) {
          final text = c.tOrg(path, kind, {'bank': 'Tax Office (demo)'});
          expect(text, contains('Tax Office (demo)'), reason: path);
          expect(text, isNot(contains('your bank')), reason: path);
        }
      }
      expect(c.tOrg('verdict.not_confirmed.title', 'agency', {'bank': 'Tax Office (demo)'}), c.t('verdict.not_confirmed.title'));
    });

    testWidgets('an agency\'s confirmed message says "Sent by" the agency, not "your bank"', (tester) async {
      phoneSize(tester);
      final answer = {'verdict': 'confirmed', 'channel': 'sms', 'category': 'service_update', 'sentAt': '2026-10-20T12:02:11Z', 'bank': 'Tax Office (demo)'};
      await showSheet(tester, answering(answer).client, CheckRequest.message('Your tax filing is due.'), bank: 'Tax Office (demo)', kind: 'agency');
      expect(find.text(c.t('official.org.confirmedTitle', {'bank': 'Tax Office (demo)'})), findsOneWidget);
      expect(find.text('Sent by Tax Office (demo)'), findsOneWidget);
      expect(find.text(c.t('verdict.confirmed.title')), findsNothing);
      await tidy(tester);

      await showSheet(tester, answering({...answer, 'bank': 'DemoBank'}).client, CheckRequest.message('Your card was used.'));
      expect(find.text(c.t('verdict.confirmed.title')), findsOneWidget);
      await tidy(tester);
    });

    testWidgets('an agency\'s cannot-check and the calls screen name the agency', (tester) async {
      phoneSize(tester);
      await showSheet(tester, answering({'code': 'error'}, 500).client, CheckRequest.message('Your tax filing is due.'), bank: 'Tax Office (demo)', kind: 'agency');
      expect(find.text(c.t('official.org.cannotCheckBody', {'bank': 'Tax Office (demo)'})), findsOneWidget);
      await tidy(tester);

      final taxOffice = Bank(id: 'taxoffice', name: 'Tax Office (demo)', kind: 'agency', domains: ['taxoffice.example'], customerTokenUrl: 'http://registry/sim/taxoffice/customer-token', demoInboxUrl: 'http://registry/sim/taxoffice/inbox');
      final registry = FakeRegistry([taxOffice]);
      final state = await linkedState(registry, ['taxoffice']);
      await state.refreshCall();
      await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.text(c.t('official.org.notCallingTitle', {'bank': 'Tax Office (demo)'})), findsOneWidget);
      expect(find.text(c.t('call.not_calling.title')), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 7));
      state.dispose();
      await registry.close();
    });
  });
}
