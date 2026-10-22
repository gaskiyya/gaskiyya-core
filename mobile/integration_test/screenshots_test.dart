// Walks the app through the screens used in docs/screens and prints `SHOT <name>` at each one,
// for a host script to capture with `xcrun simctl io <device> screenshot`.
// Needs a running server with SIM_ENABLED=true, demo sign-in on, and freshly reset demo data.
//   flutter test integration_test/screenshots_test.dart -d <device> --dart-define=API_URL=http://localhost:8080
import 'dart:convert';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/main.dart' as app;
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _api = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:8080');
const _amina = '+2348012345678';
const _tunde = '+2348098765432';

Future<Map<String, dynamic>> _sim(String method, String path, [Map<String, Object?>? body]) async {
  final req = http.Request(method, Uri.parse('$_api$path'))..headers['content-type'] = 'application/json';
  if (body != null) req.body = jsonEncode(body);
  final res = await http.Response.fromStream(await req.send());
  expect(res.statusCode, lessThan(300), reason: '$method $path: ${res.body}');
  return jsonDecode(res.body) as Map<String, dynamic>;
}

Future<void> _wait(WidgetTester tester, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _until(WidgetTester tester, Finder f, {Duration timeout = const Duration(seconds: 25)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (f.evaluate().isNotEmpty) return;
  }
  final texts = find.byType(Text).evaluate().map((e) => (e.widget as Text).data).whereType<String>().toList();
  debugPrint('SHOT _timeout');
  await _wait(tester, const Duration(seconds: 3));
  fail('Timed out waiting for $f. On screen: ${texts.join(' | ')}');
}

Future<void> _shot(WidgetTester tester, String name) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await _wait(tester, const Duration(milliseconds: 1600));
  debugPrint('SHOT $name');
  await _wait(tester, const Duration(seconds: 3));
}

Finder _scroller(Type screen) => find.descendant(of: find.byType(screen), matching: find.byType(Scrollable)).first;

Future<void> _done(WidgetTester tester) async {
  await tester.tap(find.text('Done').last);
  await _wait(tester, const Duration(milliseconds: 900));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('screenshots', (tester) async {
    (await SharedPreferences.getInstance()).clear();
    await app.main();
    await _until(tester, find.text('Skip'));
    await _shot(tester, '01_onboarding_1');

    await tester.tap(find.text('Skip'));
    await _until(tester, find.byType(CupertinoTextField));
    await tester.enterText(find.byType(CupertinoTextField), '8012345678');
    await _until(tester, find.byKey(const ValueKey('found-demobank')));
    await _shot(tester, '05_link_bank');
    await tester.tap(find.byKey(const ValueKey('signIn')));
    await _until(tester, find.text('Recent messages'));

    final alert = await _sim('POST', '/sim/send', {'phone': _amina, 'category': 'transaction_alert'});
    final tampered = await _sim('POST', '/sim/send-tampered', {'phone': _amina, 'itemId': alert['item']['id']});
    await _sim('POST', '/sim/send-fake', {'phone': _amina});
    await _sim('POST', '/sim/send', {'phone': _amina, 'category': 'service_update'});
    final security = await _sim('POST', '/sim/send', {'phone': _amina, 'category': 'security_notice'});
    await _until(tester, find.text(security['item']['text'] as String));
    await _shot(tester, '06_check');
    await tester.drag(_scroller(CheckScreen), const Offset(0, -330));
    await _wait(tester, const Duration(milliseconds: 600));
    await _shot(tester, '06b_check_messages');

    await tester.tap(find.text(security['item']['text'] as String).first);
    await _until(tester, find.text('Sent by your bank'));
    await _shot(tester, '07_result_confirmed');
    await _done(tester);

    final tamperedText = tampered['item']['text'] as String;
    await tester.ensureVisible(find.text(tamperedText).first);
    await _wait(tester, const Duration(milliseconds: 400));
    await tester.tap(find.text(tamperedText).first);
    await _until(tester, find.text('Not confirmed'));
    await _shot(tester, '08_result_not_confirmed');
    await _done(tester);

    await tester.drag(_scroller(CheckScreen), const Offset(0, 1200));
    await _wait(tester, const Duration(milliseconds: 600));
    await tester.enterText(find.byType(CupertinoTextField).first, 'https://demobank-restore.com/verify');
    await _wait(tester, const Duration(milliseconds: 400));
    await tester.tap(find.text('Check link'));
    await _until(tester, find.text('Not confirmed'));
    await _shot(tester, '11_result_link');
    await _done(tester);
    await tester.enterText(find.byType(CupertinoTextField).first, '');

    await tester.tap(find.text('Calls'));
    await _until(tester, find.text('Check again'));
    await _shot(tester, '12_calls_not_calling');
    final call = await _sim('POST', '/sim/calls', {'phone': _amina, 'purpose': 'card_activation'});
    final code = find.descendant(of: find.byType(CallsScreen), matching: find.byType(CodeDigits));
    await tester.tap(find.text('Check again').first);
    await _until(tester, code);
    await _shot(tester, '14_calls_calling');
    await _sim('PATCH', '/sim/calls/${call['id']}', {'status': 'ended'});

    await tester.tap(find.text('Activity'));
    await _until(tester, find.byKey(const ValueKey('alerts')));
    await _shot(tester, '15_activity');

    await tester.tap(find.text('Settings'));
    await _wait(tester, const Duration(milliseconds: 800));
    await _shot(tester, '16_settings');

    await _sim('POST', '/sim/seed-reports');
    await _sim('POST', '/sim/agent/run');
    final campaigns = (await _sim('GET', '/sim/campaigns'))['campaigns'] as List;
    await _sim('POST', '/sim/campaigns/${(campaigns.first as Map)['id']}/approve', {'analyst': 'Ada Eze'});
    await tester.tap(find.text('Activity'));
    await _wait(tester, const Duration(milliseconds: 600));
    await tester.drag(_scroller(ActivityScreen), const Offset(0, 320));
    await _until(tester, find.byWidgetPredicate((w) => w.key is ValueKey && '${(w.key as ValueKey).value}'.startsWith('advisory-')));
    await _shot(tester, '19_alerts');

    await tester.tap(find.text('Check'));
    await _wait(tester, const Duration(milliseconds: 600));
    final transfer = (await _sim('POST', '/sim/transfers', {'from': _tunde, 'to': _amina, 'amountKobo': 2500000}))['transfer'] as Map;
    await tester.scrollUntilVisible(find.byKey(const ValueKey('open-receipt')), 300, scrollable: _scroller(CheckScreen));
    await tester.tap(find.byKey(const ValueKey('open-receipt')));
    await _until(tester, find.byKey(const ValueKey('receipt-amount')));
    await tester.enterText(find.byKey(const ValueKey('receipt-amount')), '25,000.00');
    await tester.enterText(find.byKey(const ValueKey('receipt-reference')), transfer['reference'] as String);
    FocusManager.instance.primaryFocus?.unfocus();
    await _wait(tester, const Duration(milliseconds: 600));
    await tester.tap(find.byKey(const ValueKey('receipt-check')));
    await _until(tester, find.text('Payment received'));
    await _shot(tester, '17_receipt_received');
    await _done(tester);
    await tester.pageBack();
    await _wait(tester, const Duration(milliseconds: 900));

    await tester.scrollUntilVisible(find.byKey(const ValueKey('licence-entry')), 300, scrollable: _scroller(CheckScreen));
    await tester.tap(find.byKey(const ValueKey('licence-entry')));
    await _until(tester, find.byKey(const ValueKey('licence-query')));
    await _wait(tester, const Duration(milliseconds: 900));
    await tester.enterText(find.byKey(const ValueKey('licence-query')), 'FairMoney');
    FocusManager.instance.primaryFocus?.unfocus();
    await _wait(tester, const Duration(milliseconds: 700));
    await tester.tap(find.byKey(const ValueKey('licence-check')));
    await _until(tester, find.text('On a licence list'));
    await _shot(tester, '18_licence');
  }, timeout: const Timeout(Duration(minutes: 10)));
}
