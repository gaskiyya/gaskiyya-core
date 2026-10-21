import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/screens/result_sheet.dart';
import 'package:gaskiya/src/ui/theme.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'push_test.dart' show FakeTransport;

Widget host(Widget child) => CupertinoApp(theme: G.theme(Brightness.light), home: child);

Map<String, dynamic> overlay(String lang) => jsonDecode(File('assets/copy.$lang.json').readAsStringSync()) as Map<String, dynamic>;

void main() {
  setUp(() {
    Copy.fromJson(
      File('assets/copy.json').readAsStringSync(),
      overlays: {for (final l in Copy.languages.where((l) => l != 'en')) l: File('assets/copy.$l.json').readAsStringSync()},
    );
  });

  test('LANG-3 on the device: overlays fall back to English key by key', () {
    final c = Copy.I;
    expect(c.language, 'en');
    expect(c.t('verdict.not_confirmed.title'), 'Not confirmed');
    c.language = 'ha';
    expect(c.t('verdict.not_confirmed.title'), (overlay('ha')['verdict'] as Map)['not_confirmed']['title']);
    expect(c.t('verdict.not_confirmed.body', {'bank': 'DemoBank'}), contains('DemoBank'));
    expect(c.t('app.language.names.yo'), 'Yor\u00f9b\u00e1');
    c.language = 'xx';
    expect(c.language, 'en');
  });

  testWidgets('LANG-6: the Settings language picker changes visible text and is remembered', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = AppState(push: FakeTransport(available: false));
    await state.load();
    await tester.pumpWidget(host(SettingsScreen(state: state)));
    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('language')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hausa'));
    await tester.pumpAndSettle();

    final ha = overlay('ha')['app'] as Map;
    expect(find.text('Settings'), findsNothing);
    expect(find.text(ha['tabs']['settings'] as String), findsOneWidget);
    expect(find.text(ha['settings']['showIntro'] as String), findsOneWidget);
    expect(state.language, 'ha');
    expect((await SharedPreferences.getInstance()).getString('language'), 'ha');

    final again = AppState(push: FakeTransport(available: false));
    await again.load();
    expect(again.language, 'ha');
  });

  testWidgets('LANG-6: the explanation request carries the chosen language', (tester) async {
    Copy.I.language = 'yo';
    final explainBodies = <Map<String, dynamic>>[];
    final client = GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async {
        if (req.url.path == '/v1/explain') {
          explainBodies.add(jsonDecode(req.body) as Map<String, dynamic>);
          return http.Response(jsonEncode({'indicators': [], 'explanation': 'Ifiranse yii n kanju.', 'action': 'Ma se te link naa.', 'source': 'model'}), 200);
        }
        return http.Response(jsonEncode({'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': '', 'bank': 'DemoBank'}), 200);
      }),
    );
    await tester.pumpWidget(host(ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.message('URGENT: verify now'))));
    await tester.pump(const Duration(seconds: 2));
    expect(explainBodies.single['language'], 'yo');
    final yo = overlay('yo')['verdict'] as Map;
    expect(find.text(yo['not_confirmed']['title'] as String), findsOneWidget);
    expect(find.text('Ifiranse yii n kanju.'), findsOneWidget);
  });

  testWidgets('a sender warning from the registry shows as an added caution, in the chosen language', (tester) async {
    Copy.I.language = 'ha';
    final client = GaskiyaClient(
      baseUrl: 'http://registry',
      token: () async => 'tok',
      httpClient: MockClient((req) async => req.url.path == '/v1/explain'
          ? http.Response('', 503)
          : http.Response(jsonEncode({'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': '', 'bank': 'DemoBank', 'warnings': ['unknown_sender']}), 200)),
    );
    await tester.pumpWidget(host(ResultSheet(client: client, bank: 'DemoBank', request: CheckRequest.message('URGENT: verify now'))));
    await tester.pump(const Duration(seconds: 2));
    expect(find.byKey(const ValueKey('warning-unknown_sender')), findsOneWidget);
    expect(find.text((overlay('ha')['indicators'] as Map)['unknown_sender'] as String), findsOneWidget);
  });

  group('ZC-9: the app opens in the phone\'s language', () {
    Future<AppState> start(List<Locale> phone) async {
      final state = AppState(push: FakeTransport(available: false), deviceLocales: () => phone);
      await state.load();
      return state;
    }

    test('ZC-9: a Hausa phone opens in Hausa, and the choice is saved for Settings', () async {
      SharedPreferences.setMockInitialValues({});
      final state = await start(const [Locale('ha', 'NG')]);
      expect(state.language, 'ha');
      expect((await SharedPreferences.getInstance()).getString('language'), 'ha');
    });

    test('ZC-9: Yoruba, Igbo and Pidgin phones open in their languages', () async {
      for (final (locale, lang) in [(const Locale('yo', 'NG'), 'yo'), (const Locale('ig'), 'ig'), (const Locale('pcm', 'NG'), 'pcm')]) {
        SharedPreferences.setMockInitialValues({});
        expect((await start([locale])).language, lang);
      }
    });

    test('ZC-9: an English or French phone opens in English', () async {
      for (final locale in const [Locale('en', 'NG'), Locale('en', 'GB'), Locale('fr', 'FR')]) {
        SharedPreferences.setMockInitialValues({});
        final state = await start([locale]);
        expect(state.language, 'en');
        expect((await SharedPreferences.getInstance()).getString('language'), 'en');
      }
      SharedPreferences.setMockInitialValues({});
      expect((await start(const [])).language, 'en');
    });

    test('ZC-9: a saved manual choice is kept even if the phone language changes', () async {
      SharedPreferences.setMockInitialValues({});
      final first = await start(const [Locale('ha', 'NG')]);
      expect(first.language, 'ha');
      await first.setLanguage('yo');

      expect((await start(const [Locale('ig', 'NG')])).language, 'yo');
      expect((await start(const [Locale('en', 'US')])).language, 'yo');

      SharedPreferences.setMockInitialValues({});
      final english = await start(const [Locale('en', 'NG')]);
      await english.setLanguage('pcm');
      expect((await start(const [Locale('ha', 'NG')])).language, 'pcm');
    });

    testWidgets('ZC-9: the Settings picker shows the language taken from the phone', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final state = await start(const [Locale('ha', 'NG')]);
      Copy.I.language = state.language;
      await tester.pumpWidget(host(SettingsScreen(state: state)));
      expect(find.text(Copy.I.t('app.language.names.ha')), findsOneWidget);
      expect(find.text(Copy.I.t('app.language.names.en')), findsNothing);
    });
  });
}
