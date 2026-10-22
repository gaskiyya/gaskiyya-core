// Phone side of the console run: the console UI sends and calls, this test only taps and checks.
// Prints E2E markers that the console driver waits on.
//   flutter test integration_test/console_flow_test.dart -d <device> \
//     --dart-define=API_URL=http://localhost:8080 --dart-define=PHONE=8012345678 --dart-define=MESSAGES=3
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
const _messages = int.fromEnvironment('MESSAGES', defaultValue: 3);
const _phone = '+234$_local';

void _mark(String s) => debugPrint('E2E $_phone $s');

Future<List<Map<String, dynamic>>> _sent() async {
  final res = await http.get(Uri.parse('$_api/sim/inbox/admin?phone=${Uri.encodeQueryComponent(_phone)}'));
  return ((jsonDecode(res.body) as Map<String, dynamic>)['items'] as List).cast<Map<String, dynamic>>();
}

Future<void> _until(WidgetTester tester, bool Function() done, String what, {Duration timeout = const Duration(seconds: 20)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (done()) return;
  }
  fail('Timed out waiting for $what');
}

Future<void> _wait(WidgetTester tester, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Finder _onCalls(Finder f) => find.descendant(of: find.byType(CallsScreen), matching: f);
final _anyCode = _onCalls(find.byType(CodeDigits));

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('console drives $_phone', (tester) async {
    (await SharedPreferences.getInstance()).clear();
    await app.main();
    await _until(tester, () => find.text('Skip').evaluate().isNotEmpty, 'onboarding');
    await tester.tap(find.text('Skip'));
    await _until(tester, () => find.byType(CupertinoTextField).evaluate().isNotEmpty, 'sign-in');
    await tester.enterText(find.byType(CupertinoTextField), _local);
    await _until(tester, () => find.byWidgetPredicate((w) => w is Pressable && w.key == const ValueKey('signIn') && w.onTap != null).evaluate().isNotEmpty, 'number lookup');
    await tester.tap(find.byKey(const ValueKey('signIn')));
    await _until(tester, () => find.text('Recent messages').evaluate().isNotEmpty, 'home');
    _mark('READY');

    // Messages: wait for what the console sent to this number, then check each one in the app.
    var sent = <Map<String, dynamic>>[];
    final end = DateTime.now().add(const Duration(minutes: 6));
    while (sent.length < _messages && DateTime.now().isBefore(end)) {
      sent = await _sent();
      await _wait(tester, const Duration(seconds: 1));
    }
    expect(sent.length, _messages, reason: 'messages the console sent to $_phone');
    for (final item in sent) {
      final text = item['text'] as String;
      final want = item['kind'] == 'genuine' ? 'Sent by your bank' : 'Not confirmed';
      await _until(tester, () => find.text(text).evaluate().isNotEmpty, 'inbox row: $text');
      await tester.ensureVisible(find.text(text).first);
      await _wait(tester, const Duration(milliseconds: 300));
      await tester.tap(find.text(text).first);
      await _until(tester, () => find.byKey(const ValueKey('preview-check')).evaluate().isNotEmpty, 'preview of $text');
      await tester.tap(find.byKey(const ValueKey('preview-check')));
      await _until(tester, () => find.text(want).evaluate().isNotEmpty, '"$want" for ${item['kind']}');
      _mark('VERDICT ${item['kind']} -> $want');
      await _wait(tester, const Duration(milliseconds: 1500));
      await tester.tap(find.text('Done'));
      await _wait(tester, const Duration(milliseconds: 800));
    }
    final shown = find.textContaining('DemoBank:').evaluate().length;
    expect(shown, sent.length, reason: 'inbox shows only messages sent to $_phone');
    _mark('MESSAGES OK ${sent.length}');

    // Calls: the console announces; the app must show the agent's code, then clear it when the call ends.
    await tester.tap(find.text('Calls'));
    await _wait(tester, const Duration(milliseconds: 800));
    expect(_anyCode, findsNothing, reason: 'no call yet');
    _mark('CALLS READY');
    await _until(tester, () => _anyCode.evaluate().isNotEmpty, 'call code', timeout: const Duration(minutes: 6));
    final code = (_anyCode.evaluate().first.widget as CodeDigits).code;
    _mark('CODE $code');
    final ended = DateTime.now().add(const Duration(minutes: 3));
    while (_anyCode.evaluate().isNotEmpty && DateTime.now().isBefore(ended)) {
      await _wait(tester, const Duration(seconds: 3));
      final again = _onCalls(find.text('Check again'));
      if (again.evaluate().isNotEmpty) await tester.tap(again.first);
    }
    expect(_anyCode, findsNothing, reason: 'code still shown after the console ended the call');
    _mark('CALL ENDED');
    await _wait(tester, const Duration(seconds: 2));
  }, timeout: const Timeout(Duration(minutes: 20)));
}
