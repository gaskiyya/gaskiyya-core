import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/shield/shield_logic.dart';
import 'package:gaskiya/src/shield/shield_runtime.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const official = '+2347000000001';
const scamNumber = '+2348099998888';

OfficialContacts demoContacts() => OfficialContacts(
      bankId: 'demobank',
      name: 'DemoBank',
      phones: [official, '+2347000000002'],
      senderIds: ['DEMOBNK', 'DemoBank'],
      domains: ['demobank.ng'],
    );

ShieldBank demo({OfficialContacts? contacts}) => ShieldBank(id: 'demobank', name: 'DemoBank', contacts: contacts ?? demoContacts(), domains: const ['demobank.ng']);
ShieldBank acme() => ShieldBank(
    id: 'acme',
    name: 'Acme Bank',
    contacts: OfficialContacts(bankId: 'acme', name: 'Acme Bank', phones: const ['+2347000000099'], senderIds: const ['ACMEBANK']),
    domains: const ['acme.ng']);

CallSession session(String code) => CallSession(id: 'call_$code', purpose: 'fraud_check', code: code, status: 'open', expiresAt: DateTime.utc(2099));
CallStatus calling(String code) => CallStatus(calling: true, bank: 'DemoBank', call: session(code), calls: [session(code)]);
CallStatus notCalling() => CallStatus(calling: false, bank: 'DemoBank');
CallStatus failed() => CallStatus.unavailable('DemoBank');

VerifyResult confirmed() => VerifyResult.fromJson({'verdict': 'confirmed', 'bank': 'DemoBank', 'channel': 'sms', 'category': 'transaction_alert', 'sentAt': '2026-10-20T10:00:00Z'});
VerifyResult notConfirmed() => VerifyResult(verdict: Verdict.notConfirmed, bank: 'DemoBank');

const creditAlert = 'Acct:**4521 Cr NGN250,000.00 Desc: TRF FROM OKAFOR. Bal NGN251,300.00';
const bankOtp = 'DemoBank: Your OTP is 482913. Do not share it with anyone.';

Iterable<ShieldNotice?> everyUnconfirmedOutcome() sync* {
  for (final number in [official, scamNumber, '08099998888', '', 'garbage']) {
    for (final s in [notCalling(), failed(), CallStatus(calling: true, bank: 'X', cannotCheck: true)]) {
      yield decideIncomingCall(number: number, checks: [(bank: demo(), status: s)]);
    }
  }
  for (final text in [creditAlert, bankOtp, 'DemoBank: visit demobank-verify.xyz or call 08099998888', 'hello']) {
    final plan = planMessage(sender: 'DEMOBNK', text: text, banks: [demo()]);
    for (final v in [notConfirmed(), VerifyResult.unavailable(), VerifyResult.fromJson({'verdict': 'confirmed'})]) {
      yield* decideMessageNotices(
        plan: plan,
        verdict: v,
        bankName: 'DemoBank',
        unofficialLinks: const ['demobank-verify.xyz'],
        unofficialNumbers: const [scamNumber],
        indicators: IndicatorResult([IndicatorMatch(kind: 'phone', value: scamNumber, campaignId: 'c1', reports: 4)]),
      );
    }
    yield decideOneTimeCode(oneTimeCode: true, inCall: true, calls: [failed()]);
  }
  final flagged = FlaggedNumbers()..add(scamNumber, bankId: 'demobank', source: 'message', now: DateTime.utc(2026, 10, 20));
  yield decideOutgoingCall(number: scamNumber, flagged: flagged, now: DateTime.utc(2026, 10, 21), banks: [demo()], yourBank: 'your bank');
}

void main() {
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('ZC-1: incoming calls', () {
    test('ZC-1: a call from the bank\'s official number with no open session gives shield.call.notCalling', () {
      final n = decideIncomingCall(number: '07000000001', checks: [(bank: demo(), status: notCalling())])!;
      expect(n.title.key, 'shield.call.notCalling.title');
      expect(n.title.params['bank'], 'DemoBank');
      expect(n.kind, ShieldKind.overlay);
      expect(n.tone, ShieldTone.danger);
      expect(n.confirms, isFalse);
    });

    test('ZC-1: an open session shows shield.call.really with the code, whatever number rings', () {
      for (final number in [official, scamNumber, '+447700900123', '']) {
        final n = decideIncomingCall(number: number, checks: [(bank: demo(), status: calling('9031'))])!;
        expect(n.title.key, 'shield.call.really.title');
        expect(n.body.single.params['code'], '9031');
        expect(n.tone, ShieldTone.safe);
      }
    });

    test('ZC-1: an unknown number with no open session shows nothing', () {
      expect(decideIncomingCall(number: scamNumber, checks: [(bank: demo(), status: notCalling())]), isNull);
      expect(decideIncomingCall(number: scamNumber, checks: [(bank: demo(), status: failed())]), isNull);
    });

    test('ZC-1: a failed check on an official number says "cannot check", never shield.call.really', () {
      final n = decideIncomingCall(number: '+234 700 000 0001', checks: [(bank: demo(), status: failed())])!;
      expect(n.title.key, 'shield.call.cannotCheck.title');
      expect(n.confirms, isFalse);
    });

    test('ZC-1: with no official contacts known, an official-looking number shows nothing rather than a guess', () {
      final unknown = ShieldBank(id: 'demobank', name: 'DemoBank');
      expect(decideIncomingCall(number: official, checks: [(bank: unknown, status: notCalling())]), isNull);
    });

    test('ZC-1: another bank\'s open call is shown even when the number is one bank\'s official line', () {
      final acmeCalling = CallStatus(calling: true, bank: 'Acme Bank', call: session('4719'), calls: [session('4719')]);
      final n = decideIncomingCall(number: official, checks: [(bank: demo(), status: notCalling()), (bank: acme(), status: acmeCalling)])!;
      expect(n.title.key, 'shield.call.really.title');
      expect(n.title.params['bank'], 'Acme Bank');
    });
  });

  group('ZC-2: bank messages', () {
    test('ZC-2: a message is bank-looking by sender ID, by name, by official number or by naming the bank', () {
      expect(looksLikeBankMessage('DEMOBNK', 'Your balance is low', demo()), isTrue);
      expect(looksLikeBankMessage('Demo-Bank', 'hi', demo()), isTrue);
      expect(looksLikeBankMessage('07000000002', 'hi', demo()), isTrue);
      expect(looksLikeBankMessage('+2348011112222', 'DemoBank: your card is blocked', demo()), isTrue);
      expect(looksLikeBankMessage('+2348011112222', 'Visit https://www.demobank.ng/help', demo()), isTrue);
      expect(looksLikeBankMessage('Mum', 'Please buy bread', demo()), isFalse);
      expect(looksLikeBankMessage('Mum', 'Please buy bread', ShieldBank(id: 'demobank', name: 'DemoBank')), isFalse);
    });

    test('ZC-2: only a registry "confirmed" verdict gives verdict.confirmed', () {
      final plan = planMessage(sender: 'DEMOBNK', text: 'DemoBank: your statement is ready', banks: [demo()]);
      final ok = decideMessageNotices(plan: plan, verdict: confirmed(), bankName: 'DemoBank');
      expect(ok.single.title.key, 'verdict.confirmed.title');
      expect(ok.single.body.single.key, 'shield.message.open');
      final no = decideMessageNotices(plan: plan, verdict: notConfirmed(), bankName: 'DemoBank');
      expect(no.first.title.key, 'verdict.not_confirmed.title');
      expect(no.first.body.map((b) => b.key), ['shield.message.notConfirmedBody', 'shield.message.open']);
    });

    test('ZC-2: a check error never produces "confirmed"; a malformed confirmed answer is "cannot check"', () {
      final plan = planMessage(sender: 'DEMOBNK', text: 'DemoBank: your statement is ready', banks: [demo()]);
      final err = decideMessageNotices(plan: plan, verdict: VerifyResult.unavailable(), bankName: 'DemoBank');
      expect(err.first.title.key, 'verdict.cannot_check.title');
      final malformed = decideMessageNotices(plan: plan, verdict: VerifyResult.fromJson({'verdict': 'confirmed'}), bankName: 'DemoBank');
      expect(malformed.first.title.key, 'verdict.cannot_check.title');
      expect(combineVerdicts([notConfirmed(), VerifyResult.unavailable()]).verdict, Verdict.cannotCheck);
      expect(combineVerdicts([]).verdict, Verdict.cannotCheck);
      expect(combineVerdicts([notConfirmed(), confirmed()]).verdict, Verdict.confirmed);
    });

    test('ZC-2: a message that is not bank-looking and not a credit alert is not checked', () {
      final plan = planMessage(sender: 'Mum', text: 'Please buy bread', banks: [demo()]);
      expect(plan.check, isFalse);
      expect(decideMessageNotices(plan: plan, verdict: notConfirmed(), bankName: 'DemoBank'), isEmpty);
    });

    test('ZC-1/ZC-2: nothing but an open call or a registry confirmation can say "really" or "confirmed"', () {
      for (final n in everyUnconfirmedOutcome()) {
        expect(n?.confirms ?? false, isFalse, reason: '$n');
      }
    });
  });

  group('ZC-3: credit alerts', () {
    test('ZC-3: credit alerts are recognised and other messages are not', () {
      expect(isCreditAlert(creditAlert), isTrue);
      expect(isCreditAlert('Your account has been credited with N50,000'), isTrue);
      expect(isCreditAlert('CREDIT ALERT: \u20A6 12,500.00 has been paid in'), isTrue);
      expect(isCreditAlert('Debit: NGN5,000.00 POS purchase'), isFalse);
      expect(isCreditAlert('Get a credit card today'), isFalse);
    });

    test('ZC-3: a credit alert from a random sender is checked and, when not confirmed, warned about', () {
      final plan = planMessage(sender: '+2348123456789', text: creditAlert, banks: [demo()]);
      expect(plan.bankLooking, isFalse);
      expect(plan.check, isTrue);
      expect(verifyTargets(plan, [demo(), acme()]).map((b) => b.id), ['demobank', 'acme']);
      final n = decideMessageNotices(plan: plan, verdict: notConfirmed(), bankName: 'DemoBank');
      expect(n.first.title.key, 'shield.creditAlert.title');
      expect(n.first.tone, ShieldTone.danger);
    });

    test('ZC-3: a credit alert the registry cannot check says "cannot check", not "no record"', () {
      final plan = planMessage(sender: '+2348123456789', text: creditAlert, banks: [demo()]);
      final n = decideMessageNotices(plan: plan, verdict: VerifyResult.unavailable(), bankName: 'DemoBank');
      expect(n.first.title.key, 'verdict.cannot_check.title');
      expect(n.map((x) => x.title.key), isNot(contains('shield.creditAlert.title')));
    });
  });

  group('ZC-4: a one-time code during a call', () {
    test('ZC-4: one-time codes are recognised', () {
      expect(isOneTimeCode(bankOtp), isTrue);
      expect(isOneTimeCode('Use 4471 as your verification code'), isTrue);
      expect(isOneTimeCode(creditAlert), isFalse);
      expect(isOneTimeCode('Your code is ready'), isFalse);
    });

    test('ZC-4: a code during an unannounced call raises the alarm', () {
      final n = decideOneTimeCode(oneTimeCode: true, inCall: true, calls: [notCalling()])!;
      expect(n.title.key, 'shield.otp.title');
      expect(n.kind, ShieldKind.overlay);
    });

    test('ZC-4: a code during a call the bank announced does not', () {
      expect(decideOneTimeCode(oneTimeCode: true, inCall: true, calls: [notCalling(), calling('9031')]), isNull);
    });

    test('ZC-4: a failed call check counts as unannounced; no call, no alarm', () {
      expect(decideOneTimeCode(oneTimeCode: true, inCall: true, calls: [failed()])?.title.key, 'shield.otp.title');
      expect(decideOneTimeCode(oneTimeCode: true, inCall: false, calls: [notCalling()]), isNull);
      expect(decideOneTimeCode(oneTimeCode: false, inCall: true, calls: [notCalling()]), isNull);
    });
  });

  group('ZC-5: links', () {
    test('ZC-5: links are read from a message, without mistaking abbreviations for websites', () {
      expect(extractLinks('Verify at https://demobank-secure.xyz/login now, or www.demobank.ng.'), ['https://demobank-secure.xyz/login', 'www.demobank.ng']);
      expect(extractLinks('Acct.No 0123 Mr.Ade'), isEmpty);
      expect(linkDomain('https://WWW.Demobank.ng/x'), 'demobank.ng');
    });

    test('ZC-5: a link the check says is not the bank\'s is warned about; a failed check says nothing', () {
      LinkResult r(bool belongs) => LinkResult(belongs: belongs, host: 'x', matchedDomain: null, reasons: const [], bank: 'DemoBank');
      expect(unofficialLinks({'https://demobank-secure.xyz': r(false), 'https://demobank.ng': r(true), 'https://down.example': null}), ['https://demobank-secure.xyz']);
      final plan = planMessage(sender: 'DEMOBNK', text: 'DemoBank: verify at https://demobank-secure.xyz', banks: [demo()]);
      final n = decideMessageNotices(plan: plan, verdict: notConfirmed(), bankName: 'DemoBank', unofficialLinks: const ['https://demobank-secure.xyz']);
      expect(n.map((x) => x.title.key), contains('shield.link.title'));
    });
  });

  group('ZC-6: numbers in a message', () {
    test('ZC-6: a number that is not an official phone is warned about, matched on the phone', () {
      final plan = planMessage(sender: 'DEMOBNK', text: 'DemoBank: call our care line 0809 999 8888 or 07000000001', banks: [demo()]);
      expect(plan.phones, containsAll([scamNumber, official]));
      final bad = unofficialNumbers(plan, demo(), [demo()])!;
      expect(bad, [scamNumber]);
      final n = decideMessageNotices(plan: plan, verdict: notConfirmed(), bankName: 'DemoBank', unofficialNumbers: bad);
      final w = n.firstWhere((x) => x.title.key == 'shield.number.title');
      expect(w.body.single.params['number'], scamNumber);
    });

    test('ZC-6: with no official list known, nothing is said about numbers', () {
      final plan = planMessage(sender: 'DEMOBNK', text: 'DemoBank: call 08099998888', banks: [demo()]);
      expect(unofficialNumbers(plan, ShieldBank(id: 'demobank', name: 'DemoBank'), const []), isNull);
    });

    test('ZC-6: Nigerian numbers are normalised to E.164', () {
      expect(normaliseNumber('08099998888'), scamNumber);
      expect(normaliseNumber('2348099998888'), scamNumber);
      expect(normaliseNumber('+234 809 999 8888'), scamNumber);
      expect(normaliseNumber('tel:+2348099998888'), scamNumber);
      expect(normaliseNumber('002348099998888'), scamNumber);
      expect(normaliseNumber('737'), isNull);
    });
  });

  group('ZC-7: dialled numbers', () {
    final t0 = DateTime.utc(2026, 10, 20, 12);

    test('ZC-7: a dialled number not in the flagged list produces no warning', () {
      final flagged = FlaggedNumbers()..add(scamNumber, bankId: 'demobank', source: 'message', now: t0);
      expect(decideOutgoingCall(number: official, flagged: flagged, now: t0, banks: [demo()], yourBank: 'your bank'), isNull);
      expect(decideOutgoingCall(number: '08011112222', flagged: FlaggedNumbers(), now: t0, banks: [demo()], yourBank: 'your bank'), isNull);
    });

    test('ZC-7: a number flagged in a message warns with the bank\'s real number', () {
      final flagged = FlaggedNumbers()..add('0809 999 8888', bankId: 'demobank', source: 'message', now: t0);
      final n = decideOutgoingCall(number: '08099998888', flagged: flagged, now: t0.add(const Duration(days: 2)), banks: [demo()], yourBank: 'your bank')!;
      expect(n.title.key, 'shield.dialled.title');
      expect(n.body.single.key, 'shield.dialled.body');
      expect(n.body.single.params, {'bank': 'DemoBank', 'number': scamNumber, 'official': official});
      expect(n.kind, ShieldKind.overlay);
    });

    test('ZC-7: a number a scam campaign reported uses the reported wording', () {
      final flagged = FlaggedNumbers()..add(scamNumber, bankId: 'demobank', source: 'campaign', now: t0);
      final n = decideOutgoingCall(number: scamNumber, flagged: flagged, now: t0, banks: [demo()], yourBank: 'your bank')!;
      expect(n.body.single.key, 'shield.dialled.reportedBody');
    });

    test('ZC-7: flagged numbers expire after 7 days', () {
      final flagged = FlaggedNumbers()..add(scamNumber, bankId: 'demobank', source: 'message', now: t0);
      expect(flagged.lookup(scamNumber, t0.add(const Duration(days: 6, hours: 23))), isNotNull);
      expect(flagged.lookup(scamNumber, t0.add(const Duration(days: 7))), isNull);
      expect(decideOutgoingCall(number: scamNumber, flagged: flagged, now: t0.add(const Duration(days: 8)), banks: [demo()], yourBank: 'your bank'), isNull);
      final again = FlaggedNumbers.decode(flagged.encode())..prune(t0.add(const Duration(days: 7)));
      expect(again.entries, isEmpty);
    });

    test('ZC-7: the flagged list keeps only numbers, bank ids, sources and times', () {
      final flagged = FlaggedNumbers()..add(scamNumber, bankId: 'demobank', source: 'message', now: t0);
      final stored = (jsonDecode(flagged.encode()) as List).single as Map<String, dynamic>;
      expect(stored.keys.toSet(), {'n', 'b', 's', 't'});
    });
  });

  group('ZC-8: scam campaigns', () {
    test('ZC-8: a campaign match is shown with the report count', () {
      final plan = planMessage(sender: 'DEMOBNK', text: 'DemoBank: verify at demobank-secure.xyz', banks: [demo()]);
      final n = decideMessageNotices(
        plan: plan,
        verdict: notConfirmed(),
        bankName: 'DemoBank',
        indicators: IndicatorResult([
          IndicatorMatch(kind: 'domain', value: 'demobank-secure.xyz', campaignId: 'c1', reports: 12),
          IndicatorMatch(kind: 'phone', value: scamNumber, campaignId: 'c1', reports: 3),
        ]),
      );
      final c = n.firstWhere((x) => x.title.key == 'shield.campaign.title');
      expect(c.body.single.params['count'], 12);
    });

    test('ZC-8: a malformed indicators answer is "cannot check", never "no match"', () {
      expect(IndicatorResult.fromJson({'matches': 'nope'}).cannotCheck, isTrue);
      expect(IndicatorResult.fromJson({
        'matches': [
          {'kind': 'other', 'value': 'x', 'campaignId': 'c', 'reports': 1}
        ]
      }).cannotCheck, isTrue);
    });
  });

  group('ZC-1..ZC-8: the background runtime', () {
    late List<http.Request> requests;
    late List<Map<String, Object?>> shown;
    late Map<String, Object?> registry;

    Future<ShieldRuntime> runtime({DateTime? now}) async {
      SharedPreferences.setMockInitialValues({
        'language': 'en',
        'links': jsonEncode([
          {
            'bank': {'id': 'demobank', 'name': 'DemoBank', 'kind': 'bank', 'domains': ['demobank.ng'], 'customerTokenUrl': 'http://bank/sim/demobank/customer-token', 'demoInboxUrl': null},
            'phone': '+2348031234567',
          }
        ]),
      });
      final client = MockClient((req) async {
        requests.add(req);
        final path = req.url.path;
        if (path.endsWith('/customer-token')) return http.Response(jsonEncode({'token': 'tok', 'expiresIn': 3600}), 200);
        final answer = registry[path];
        if (answer == null) return http.Response('{"code":"unavailable"}', 503);
        return http.Response(jsonEncode(answer), 200);
      });
      return ShieldRuntime(host: _FakeHost(shown), httpClient: client, apiHttp: () => client, clock: now == null ? null : () => now);
    }

    setUp(() {
      requests = [];
      shown = [];
      registry = {
        '/v1/official-contacts': demoContacts().toJson(),
        '/v1/calls/open': {'calling': false, 'bank': 'DemoBank'},
        '/v1/verify/message': {'verdict': 'not_confirmed', 'bank': 'DemoBank'},
        '/v1/verify/link': {'verdict': 'not_official', 'host': 'demobank-secure.xyz', 'reasons': [], 'bank': 'DemoBank'},
        '/v1/verify/indicators': {
          'matches': [
            {'kind': 'phone', 'value': scamNumber, 'campaignId': 'c1', 'reports': 5, 'lastSeen': '2026-10-19T10:00:00Z'}
          ]
        },
      };
    });

    test('ZC-2/ZC-5/ZC-6/ZC-8: message text is never part of any request; only digests, link addresses and numbers are sent', () async {
      const text = 'DemoBank: Dear customer your account is SUSPENDED. Verify at https://demobank-secure.xyz/login or call 0809 999 8888 today.';
      final rt = await runtime();
      final notices = await rt.onMessage(sender: 'DEMOBNK', text: text, inCall: false);
      final registryCalls = requests.where((r) => r.url.path.startsWith('/v1/')).toList();
      expect(registryCalls.map((r) => r.url.path).toSet(), {'/v1/official-contacts', '/v1/verify/message', '/v1/verify/link', '/v1/verify/indicators'});
      for (final r in requests) {
        expect(r.body, isNot(contains('SUSPENDED')), reason: r.url.path);
        expect(r.body, isNot(contains('Dear customer')), reason: r.url.path);
        expect(r.url.query, isEmpty);
        final body = r.body.isEmpty ? const <String, dynamic>{} : jsonDecode(r.body) as Map<String, dynamic>;
        switch (r.url.path) {
          case '/v1/verify/message':
            expect(body, {'contentDigest': contentDigest(text)});
          case '/v1/verify/link':
            expect(body, {'url': 'https://demobank-secure.xyz/login'});
          case '/v1/verify/indicators':
            expect(body, {'domains': ['demobank-secure.xyz'], 'phones': [scamNumber]});
          case '/v1/official-contacts':
            expect(r.method, 'GET');
            expect(body, isEmpty);
          default:
            expect(body, {'phone': '+2348031234567'});
        }
      }
      expect(notices.map((n) => n.title.key), ['verdict.not_confirmed.title', 'shield.campaign.title', 'shield.link.title', 'shield.number.title']);
      expect(shown.map((s) => s['title']), contains(Copy.I.t('shield.link.title', {'bank': 'DemoBank'})));
      expect(shown.every((s) => s['kind'] == 'notify'), isTrue);
    });

    test('ZC-7/ZC-8: numbers flagged in a message warn when dialled, without sending the dialled number', () async {
      final rt = await runtime();
      await rt.onMessage(sender: 'DEMOBNK', text: 'DemoBank: call our care desk on 08099998888 now.', inCall: false);
      requests.clear();
      final n = await rt.onOutgoingCall('08099998888');
      expect(n?.title.key, 'shield.dialled.title');
      expect(n?.body.single.key, 'shield.dialled.reportedBody');
      for (final r in requests) {
        expect(r.body, isNot(contains('8099998888')));
        expect(r.url.toString(), isNot(contains('8099998888')));
      }
      expect(shown.last['kind'], 'overlay');
      expect(await rt.onOutgoingCall('08011112222'), isNull);
    });

    test('ZC-1: the incoming number is matched on the phone and never sent', () async {
      final rt = await runtime();
      final n = await rt.onIncomingCall('+2347000000001');
      expect(n?.title.key, 'shield.call.notCalling.title');
      for (final r in requests) {
        expect(r.body, isNot(contains('7000000001')));
        expect(r.url.toString(), isNot(contains('7000000001')));
      }
      expect(shown.single['title'], Copy.I.t('shield.call.notCalling.title', {'bank': 'DemoBank'}));
      expect(shown.single['close'], Copy.I.t('shield.close'));
    });

    test('ZC-1: an open registry call shows shield.call.really with its code', () async {
      registry['/v1/calls/open'] = {
        'calling': true,
        'bank': 'DemoBank',
        'calls': [
          {'id': 'call_1', 'purpose': 'fraud_check', 'code': '9031', 'status': 'open', 'expiresAt': '2099-01-01T00:00:00Z'}
        ]
      };
      final rt = await runtime();
      final n = await rt.onIncomingCall('+447700900123');
      expect(n?.title.key, 'shield.call.really.title');
      expect(shown.single['body'], contains('9031'));
    });

    test('ZC-1/ZC-2: when the registry is down nothing is confirmed', () async {
      registry.clear();
      final rt = await runtime();
      expect(await rt.onIncomingCall(official), isNull);
      final notices = await rt.onMessage(sender: 'DEMOBNK', text: 'DemoBank: your statement is ready', inCall: false);
      expect(notices.single.title.key, 'verdict.cannot_check.title');
      expect(notices.any((n) => n.confirms), isFalse);
    });

    test('ZC-2: a confirmed message notifies verdict.confirmed', () async {
      registry['/v1/verify/message'] = {'verdict': 'confirmed', 'bank': 'DemoBank', 'channel': 'sms', 'category': 'service_update', 'sentAt': '2026-10-20T10:00:00Z'};
      final rt = await runtime();
      final notices = await rt.onMessage(sender: 'DEMOBNK', text: 'DemoBank: your statement is ready', inCall: false);
      expect(notices.single.title.key, 'verdict.confirmed.title');
      expect(requests.map((r) => r.url.path), isNot(contains('/v1/verify/indicators')));
    });

    test('ZC-4: a code during an unannounced call shows the alarm over the screen', () async {
      registry['/v1/verify/message'] = {'verdict': 'confirmed', 'bank': 'DemoBank', 'channel': 'sms', 'category': 'otp', 'sentAt': '2026-10-20T10:00:00Z'};
      final rt = await runtime();
      final notices = await rt.onMessage(sender: 'DEMOBNK', text: bankOtp, inCall: true);
      expect(notices.first.title.key, 'shield.otp.title');
      expect(shown.first['kind'], 'overlay');
    });

    test('ZC-3: a credit alert from a random number is checked and warned about', () async {
      final rt = await runtime();
      final notices = await rt.onMessage(sender: '+2348123456789', text: creditAlert, inCall: false);
      expect(notices.first.title.key, 'shield.creditAlert.title');
      expect(requests.where((r) => r.url.path == '/v1/verify/message'), hasLength(1));
    });

    test('ZC-2: the same message posted twice is checked once', () async {
      final rt = await runtime();
      await rt.onMessage(sender: 'DEMOBNK', text: 'DemoBank: your statement is ready', inCall: false);
      final again = await rt.onMessage(sender: 'DEMOBNK', text: 'DemoBank: your statement is ready', inCall: false);
      expect(again, isEmpty);
      expect(requests.where((r) => r.url.path == '/v1/verify/message'), hasLength(1));
    });

    test('ZC-1: the runtime answers channel events and never throws to Android', () async {
      final rt = await runtime();
      await rt.handle(const MethodCall('onIncomingCall', {'number': '+2347000000001'}));
      await rt.handle(const MethodCall('onMessage', {'app': 'sms', 'sender': 'x', 'text': null, 'inCall': false}));
      await rt.handle(const MethodCall('unknown'));
      expect(shown.single['title'], Copy.I.t('shield.call.notCalling.title', {'bank': 'DemoBank'}));
    });
  });
}

class _FakeHost implements ShieldHost {
  _FakeHost(this.shown);
  final List<Map<String, Object?>> shown;

  @override
  Future<void> notify({required int id, required String title, required String body, required ShieldTone tone, required String channelName}) async =>
      shown.add({'kind': 'notify', 'title': title, 'body': body, 'tone': tone.name, 'channelName': channelName});

  @override
  Future<void> showOverlay({required String title, required String body, required ShieldTone tone, required String close, required String channelName}) async =>
      shown.add({'kind': 'overlay', 'title': title, 'body': body, 'tone': tone.name, 'close': close});
}
