// Signs in and keeps the app open so the console can drive it by hand.
//   flutter test integration_test/live_session_test.dart -d <device> \
//     --dart-define=API_URL=http://localhost:8080 --dart-define=PHONE=8012345678 --dart-define=MINUTES=20
import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/main.dart' as app;
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _local = String.fromEnvironment('PHONE', defaultValue: '8012345678');
const _minutes = int.fromEnvironment('MINUTES', defaultValue: 20);

Future<void> _until(WidgetTester tester, Finder f) async {
  final end = DateTime.now().add(const Duration(seconds: 20));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $f');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('live session for +234$_local', (tester) async {
    (await SharedPreferences.getInstance()).clear();
    await app.main();
    await _until(tester, find.text('Skip'));
    await tester.tap(find.text('Skip'));
    await _until(tester, find.byType(CupertinoTextField));
    await tester.enterText(find.byType(CupertinoTextField), _local);
    await _until(tester, find.byKey(const ValueKey('found-demobank')));
    await tester.tap(find.byKey(const ValueKey('signIn')));
    await _until(tester, find.text('Recent messages'));

    final end = DateTime.now().add(const Duration(minutes: _minutes));
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }, timeout: const Timeout(Duration(minutes: _minutes + 2)));
}
