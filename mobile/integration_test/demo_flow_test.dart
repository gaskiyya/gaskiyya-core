// Demo script against a running server with SIM_ENABLED=true; acts as the console through /sim.
//   flutter test integration_test/demo_flow_test.dart -d <device> \
//     --dart-define=API_URL=http://localhost:8080 --dart-define=PHONE=8012345678
import 'dart:convert';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/main.dart' as app;
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _api = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:8080');
const _local = String.fromEnvironment('PHONE', defaultValue: '8012345678');
const _phone = '+234$_local';

Future<Map<String, dynamic>> _console(String method, String path, [Map<String, Object?>? body]) async {
  final req = http.Request(method, Uri.parse('$_api$path'))..headers['content-type'] = 'application/json';
  if (body != null) req.body = jsonEncode(body);
  final res = await http.Response.fromStream(await req.send());
  expect(res.statusCode, 200, reason: '$method $path: ${res.body}');
  return jsonDecode(res.body) as Map<String, dynamic>;
}

Future<void> _until(WidgetTester tester, Finder f, {Duration timeout = const Duration(seconds: 20)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $f');
}

Future<void> _settle(WidgetTester tester, [int ms = 800]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Finder _onCalls(Finder f) => find.descendant(of: find.byType(CallsScreen), matching: f);

Finder _code(String code) => _onCalls(find.byWidgetPredicate((w) => w is CodeDigits && w.code == code));

Future<void> _checkInboxItem(WidgetTester tester, String text, String verdict) async {
  final row = find.text(text);
  await _until(tester, row);
  await tester.ensureVisible(row.first);
  await _settle(tester, 300);
  await tester.tap(row.first);
  await _until(tester, find.text(verdict));
  await _settle(tester, 1500);
  await tester.tap(find.text('Done'));
  await _settle(tester);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('demo flow for $_phone: link, messages, call', (tester) async {
    (await SharedPreferences.getInstance()).clear();
    await app.main();
    await _settle(tester, 1500);

    // Onboarding and sign-in with DemoBank.
    await _until(tester, find.text('Skip'));
    await tester.tap(find.text('Skip'));
    await _until(tester, find.text('DemoBank'));
    await tester.tap(find.text('DemoBank'));
    await _settle(tester, 400);
    await tester.enterText(find.byType(CupertinoTextField), _local);
    await tester.tap(find.byKey(const ValueKey('signIn')));
    await _until(tester, find.text('Recent messages'));

    // Messages: genuine, tampered copy, fake.
    final genuine = await _console('POST', '/sim/send', {'phone': _phone, 'category': 'transaction_alert'});
    await _checkInboxItem(tester, genuine['item']['text'] as String, 'Sent by your bank');

    final tampered = await _console('POST', '/sim/send-tampered', {'phone': _phone, 'itemId': genuine['item']['id']});
    await _checkInboxItem(tester, tampered['item']['text'] as String, 'Not confirmed');

    final fake = await _console('POST', '/sim/send-fake', {'phone': _phone});
    await _checkInboxItem(tester, fake['item']['text'] as String, 'Not confirmed');

    // Calls: not calling, then announce and call, then end.
    await tester.tap(find.text('Calls'));
    await _settle(tester);
    expect(_onCalls(find.text('DemoBank is calling you now')), findsNothing);

    final call = await _console('POST', '/sim/calls', {'phone': _phone, 'purpose': 'card_activation'});
    final code = call['code'] as String;
    await _until(tester, _code(code));
    expect(_onCalls(find.text('DemoBank is calling you now')), findsOneWidget);

    await _console('PATCH', '/sim/calls/${call['id']}', {'status': 'answered'});
    await _console('PATCH', '/sim/calls/${call['id']}', {'status': 'ended'});
    await tester.tap(_onCalls(find.text('Check again')).first);
    final gone = DateTime.now().add(const Duration(seconds: 20));
    while (_code(code).evaluate().isNotEmpty && DateTime.now().isBefore(gone)) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(_code(code), findsNothing, reason: 'call code still shown after the bank ended the call');
  });
}
