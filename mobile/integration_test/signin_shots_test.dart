// Walks the number-only sign-in and the four tabs, printing `SHOT <name>` at each screen
// for a host script to capture with `xcrun simctl io <device> screenshot`.
//   flutter test integration_test/signin_shots_test.dart -d <device> --dart-define=API_URL=<registry> --dart-define=PHONE=08081434636
import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/main.dart' as app;
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _phone = String.fromEnvironment('PHONE', defaultValue: '08081434636');

Future<void> _wait(WidgetTester tester, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _until(WidgetTester tester, Finder f) async {
  final end = DateTime.now().add(const Duration(seconds: 30));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (f.evaluate().isNotEmpty) return;
  }
  final texts = find.byType(Text).evaluate().map((e) => (e.widget as Text).data).whereType<String>().toList();
  fail('Timed out waiting for $f. On screen: ${texts.join(' | ')}');
}

Future<void> _shot(WidgetTester tester, String name, {bool unfocus = true}) async {
  if (unfocus) FocusManager.instance.primaryFocus?.unfocus();
  await _wait(tester, const Duration(milliseconds: 1600));
  debugPrint('SHOT $name');
  await _wait(tester, const Duration(seconds: 3));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('number-only sign-in', (tester) async {
    (await SharedPreferences.getInstance()).clear();
    await app.main();
    await _until(tester, find.text('Skip'));
    await _shot(tester, '01_onboarding');
    await tester.tap(find.text('Skip'));

    await _until(tester, find.byType(CupertinoTextField));
    await _shot(tester, '02_signin_empty', unfocus: false);
    await tester.enterText(find.byType(CupertinoTextField), _phone);
    await _until(tester, find.byWidgetPredicate((w) => w is Pressable && w.key == const ValueKey('signIn') && w.onTap != null));
    await _shot(tester, '03_signin_ready');

    await tester.tap(find.byKey(const ValueKey('signIn')));
    await _until(tester, find.text('Recent messages'));
    await _shot(tester, '04_check');

    for (final (tab, name) in [('Calls', '05_calls'), ('Activity', '06_activity'), ('Settings', '07_settings')]) {
      await tester.tap(find.text(tab).last);
      final end = DateTime.now().add(const Duration(seconds: 20));
      while (find.byType(Shimmer).evaluate().isNotEmpty && DateTime.now().isBefore(end)) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      await _shot(tester, name);
    }
  });
}
