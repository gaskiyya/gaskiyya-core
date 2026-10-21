import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/text_tools.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

const genuine = 'DemoBank: our app now has instant card controls. Update today at https://www.demobank.ng/app';
const tampered = 'DemoBank: our app now has instant card controls. Update today at https://www.demo-bank.ng/app';

({GaskiyaClient client, List<http.Request> requests}) fakeRegistry() {
  final requests = <http.Request>[];
  final registered = contentDigest(genuine);
  final mock = MockClient((req) async {
    requests.add(req);
    if (req.url.path == '/v1/verify/message') {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final ok = body['contentDigest'] == registered;
      return http.Response(
        jsonEncode(ok
            ? {'verdict': 'confirmed', 'channel': 'sms', 'category': 'service_update', 'sentAt': '2026-10-20T13:02:11Z', 'bank': 'DemoBank'}
            : {'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': 'In the last 24 hours DemoBank sent you no messages.', 'bank': 'DemoBank'}),
        200,
      );
    }
    if (req.url.path == '/v1/explain' || req.url.path == '/v1/reports') return http.Response('{"indicators":[],"explanation":"x is risky here.","action":"Do not click.","source":"fallback"}', 200);
    return http.Response('{"code":"not_found","message":"no"}', 404);
  });
  return (client: GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: mock), requests: requests);
}

void main() {
  group('CH-1: the verify request carries a digest and no message text', () {
    test('pasted text', () async {
      final f = fakeRegistry();
      final r = await f.client.verifyText(genuine);
      expect(r.verdict, Verdict.confirmed);
      final body = jsonDecode(f.requests.single.body) as Map<String, dynamic>;
      expect(body.keys, ['contentDigest']);
      expect(body['contentDigest'], contentDigest(genuine));
      expect(f.requests.single.body, isNot(contains('demobank')));
      expect(f.requests.single.body, isNot(contains('instant card')));
      expect(f.requests.single.headers['authorization'], 'Bearer tok');
    });

    test('a tampered copy gives not confirmed', () async {
      final f = fakeRegistry();
      expect((await f.client.verifyText(tampered)).verdict, Verdict.notConfirmed);
    });

    test('shared-in text follows the same path', () async {
      final f = fakeRegistry();
      final text = sharedText([
        SharedMediaFile(path: genuine, type: SharedMediaType.text),
        SharedMediaFile(path: '/tmp/photo.jpg', type: SharedMediaType.image),
      ]);
      expect(text, genuine);
      expect((await f.client.verifyText(text)).verdict, Verdict.confirmed);
      expect(f.requests.single.body, isNot(contains('instant card')));
      final f2 = fakeRegistry();
      expect((await f2.client.verifyText(sharedText([SharedMediaFile(path: tampered, type: SharedMediaType.text)]))).verdict, Verdict.notConfirmed);
    });

    test('whitespace differences from copy-paste still match', () async {
      final f = fakeRegistry();
      expect((await f.client.verifyText('  ${genuine.replaceAll(' ', '\n')}  ')).verdict, Verdict.confirmed);
    });
  });

  test('fails closed: network errors are cannot check, never confirmed', () async {
    final client = GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) async => throw Exception('offline')));
    expect((await client.verifyText(genuine)).verdict, Verdict.cannotCheck);
    final c500 = GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: MockClient((_) async => http.Response('{}', 503)));
    expect((await c500.verifyText(genuine)).verdict, Verdict.cannotCheck);
  });

  test('AI-4 on the device: explanations and reports carry masked text only', () async {
    final f = fakeRegistry();
    const fake = 'Your card 5399831244109921 is blocked. Call 08031234567 now.';
    await f.client.explain(fake);
    await f.client.report(fake, const ['callback_number']);
    for (final req in f.requests) {
      final masked = (jsonDecode(req.body) as Map<String, dynamic>)['maskedText'] as String;
      expect(masked, isNot(contains(RegExp(r'\d{4,}'))));
    }
    final report = jsonDecode(f.requests.last.body) as Map<String, dynamic>;
    expect(report['consent'], true);
    expect(report['callbackDigests'], [callbackDigest('08031234567')]);
  });

  test('text tools', () {
    expect(maskDigits('acct 0123456789, amt 5,000'), 'acct ##########, amt 5,000');
    expect(looksLikeLink('https://www.demobank.ng/app'), isTrue);
    expect(looksLikeLink('demobank.ng'), isTrue);
    expect(looksLikeLink('Your account is blocked'), isFalse);
    expect(normalisePhone('0801 234 5678'), '+2348012345678');
    expect(normalisePhone('+2348012345678'), '+2348012345678');
    expect(normalisePhone('12'), isNull);
  });

  test('the bank list comes from the registry; its own paths resolve against it', () async {
    final mock = MockClient((req) async {
      expect(req.url.toString(), 'https://registry.example.ng/v1/banks');
      return http.Response(
        jsonEncode({
          'banks': [
            {'id': 'demobank', 'name': 'DemoBank', 'domains': ['demobank.ng'], 'customerTokenUrl': '/sim/customer-token', 'demoInboxUrl': '/sim/inbox'},
            {'id': 'acme', 'name': 'Acme Bank', 'domains': ['acme.ng'], 'customerTokenUrl': 'https://api.acme.ng/gaskiyya/token', 'demoInboxUrl': null},
          ],
        }),
        200,
      );
    });
    final banks = await fetchBanks('https://registry.example.ng', mock);
    expect(banks.map((b) => b.name), ['DemoBank', 'Acme Bank']);
    expect(banks[0].customerTokenUrl, 'https://registry.example.ng/sim/customer-token');
    expect(banks[0].demoInboxUrl, 'https://registry.example.ng/sim/inbox');
    expect(banks[0].isDemo, isTrue);
    expect(banks[1].customerTokenUrl, 'https://api.acme.ng/gaskiyya/token');
    expect(banks[1].isDemo, isFalse);
    final again = Bank.fromJson(jsonDecode(jsonEncode(banks[1].toJson())) as Map<String, dynamic>, 'http://10.0.2.2:8080');
    expect(again.customerTokenUrl, banks[1].customerTokenUrl);
  });
}
