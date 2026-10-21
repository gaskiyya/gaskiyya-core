import 'dart:convert';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/screens/calls_screen.dart';
import 'package:gaskiya/src/ui/screens/check_screen.dart';
import 'package:gaskiya/src/ui/screens/home.dart';
import 'package:gaskiya/src/ui/screens/link_screen.dart';
import 'package:gaskiya/src/ui/widgets/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

const amina = '+2348012345678';
const tunde = '+2348098765432';

FakeRegistry twoBanks() => FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')]);

Future<AppState> restart(FakeRegistry registry) async {
  final mock = registry.client;
  final state = AppState(httpClient: mock, push: NoPush(), apiHttp: () => mock);
  await state.load();
  await pumpEventQueue();
  return state;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('BANK-1: an install from before multi-bank keeps its bank on upgrade', () {
    test('a saved phone and bank become the one linked bank', () async {
      final registry = twoBanks();
      SharedPreferences.setMockInitialValues({'onboarded': true, 'phone': amina, 'bank': jsonEncode(registry.bank('acme').toJson())});
      final state = await restart(registry);
      expect(state.links.map((l) => l.id), ['acme']);
      expect(state.selected!.phone, amina);
      expect(state.bankName, 'Acme Bank');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('phone'), isFalse);
      expect(prefs.containsKey('bank'), isFalse);
      expect(jsonDecode(prefs.getString('links')!), [
        {'bank': registry.bank('acme').toJson(), 'phone': amina},
      ]);
      expect((await state.client!.verifyText('hello')).verdict, Verdict.notConfirmed);
      expect(registry.calls.last, (bank: 'acme', phone: amina, path: '/v1/verify/message'));
      state.dispose();
      await registry.close();
    });

    test('a saved phone from before the bank list links to the only bank', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      SharedPreferences.setMockInitialValues({'onboarded': true, 'phone': amina});
      final state = await restart(registry);
      expect(state.links.map((l) => l.id), ['demobank']);
      expect(state.phone, amina);
      state.dispose();
      await registry.close();
    });

    test('with a choice of banks and no saved bank, the customer is asked again', () async {
      final registry = twoBanks();
      SharedPreferences.setMockInitialValues({'onboarded': true, 'phone': amina});
      final state = await restart(registry);
      expect(state.linked, isFalse);
      state.dispose();
      await registry.close();
    });
  });

  group('BANK-2: the customer adds and removes linked banks', () {
    test('adding a second bank keeps the first, selects the new one, and survives a restart', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await state.link(tunde, registry.bank('acme'));
      expect(state.links.map((l) => (l.id, l.phone)), [('demobank', '+2348012345678'), ('acme', tunde)]);
      expect(state.bank!.id, 'acme');
      state.dispose();

      final again = await restart(registry);
      expect(again.links.map((l) => (l.id, l.phone)), [('demobank', '+2348012345678'), ('acme', tunde)]);
      expect(again.bank!.id, 'acme');
      again.dispose();
      await registry.close();
    });

    test('removing a bank leaves the others linked and selects one of them', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await state.unlinkBank('acme');
      expect(state.links.map((l) => l.id), ['demobank']);
      expect(state.bank!.id, 'demobank');
      expect(state.linked, isTrue);
      state.dispose();
      final again = await restart(registry);
      expect(again.links.map((l) => l.id), ['demobank']);
      await again.unlinkBank('demobank');
      expect(again.linked, isFalse);
      again.dispose();
      expect((await restart(registry)).linked, isFalse);
      await registry.close();
    });

    test('linking the same bank again replaces it rather than adding a duplicate', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await state.link(tunde, registry.bank('demobank'));
      expect(state.links.map((l) => (l.id, l.phone)), [('demobank', tunde)]);
      state.dispose();
      await registry.close();
    });

    test('a bank whose sign-in fails is not added, and the others are untouched', () async {
      final registry = twoBanks()..failingSignIn.add('acme');
      final state = await linkedState(registry, ['demobank']);
      await expectLater(state.link(amina, registry.bank('acme')), throwsA(isA<ApiException>()));
      expect(state.links.map((l) => l.id), ['demobank']);
      expect(state.bank!.id, 'demobank');
      state.dispose();
      await registry.close();
    });
  });

  group('BANK-3: a check goes to the selected bank, bound to its number', () {
    test('selecting a bank routes verify, activity and inbox to that tenant only', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await state.link(tunde, registry.bank('acme'));

      await state.select('demobank');
      registry.calls.clear();
      final r = await state.client!.verifyText('Your account is blocked');
      expect(r.bank, 'DemoBank');
      await state.client!.activity();
      await state.inbox();
      final checks = registry.calls.where((c) => c.path != '/v1/events' && c.path != '/v1/calls/open');
      expect(checks.map((c) => c.path), ['/v1/verify/message', '/v1/activity', '/sim/demobank/inbox']);
      expect(checks.map((c) => (c.bank, c.phone)).toSet(), {('demobank', amina)});

      await state.select('acme');
      registry.calls.clear();
      expect((await state.client!.verifyText('Your account is blocked')).bank, 'Acme Bank');
      expect(registry.calls.where((c) => c.path == '/v1/verify/message').single, (bank: 'acme', phone: tunde, path: '/v1/verify/message'));

      state.dispose();
      expect((await restart(registry)).bank!.id, 'acme');
      await registry.close();
    });

    test('an unknown bank id cannot be selected', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await state.select('acme');
      expect(state.bank!.id, 'demobank');
      state.dispose();
      await registry.close();
    });
  });

  group('BANK-4: calls from any linked bank are shown', () {
    test('each linked bank is asked; a call is held against the bank that opened it', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      registry.calling['acme'] = '4719';
      await state.refreshCall();
      expect(state.calling.map((l) => l.id), ['acme']);
      expect(state.latestCall!.bank.name, 'Acme Bank');
      expect(state.liveCall!.code, '4719');

      registry.calling['demobank'] = '1234';
      await state.refreshCall();
      expect(state.calling.map((l) => (l.id, l.liveCall!.code)), [('demobank', '1234'), ('acme', '4719')]);

      state.handleNotice({'type': 'call.closed', 'callId': 'call_acme'});
      expect(state.calling.map((l) => l.id), ['demobank']);
      state.handleNotice({
        'type': 'call.opened',
        'callId': 'call_9',
        'bank': 'Acme Bank',
        'purpose': 'fraud_check',
        'code': '5555',
        'expiresAt': DateTime.now().add(const Duration(minutes: 2)).toUtc().toIso8601String(),
      });
      expect(state.links.firstWhere((l) => l.id == 'acme').liveCall!.code, '5555');
      state.dispose();
      await registry.close();
    });

    testWidgets('the calls screen shows every bank that is calling, each with its own code', (tester) async {
      phoneSize(tester);
      final registry = twoBanks()
        ..calling['demobank'] = '1234'
        ..calling['acme'] = '4719';
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.byType(CodeDigits), findsNWidgets(2));
      expect(find.text(Copy.I.t('call.calling.title', {'bank': 'DemoBank'})), findsOneWidget);
      expect(find.text(Copy.I.t('call.calling.title', {'bank': 'Acme Bank'})), findsOneWidget);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });

    testWidgets('with no call, the calls screen names every linked bank', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.text(Copy.I.t('call.not_calling.body', {'bank': 'DemoBank or Acme Bank'})), findsOneWidget);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });
  });

  test('BANK-4: the device is registered for call notices with every linked bank, each for its own number', () async {
    final registry = twoBanks();
    final state = await linkedState(registry, ['demobank'], push: NoPush(available: true));
    await state.link(tunde, registry.bank('acme'));
    await pumpEventQueue();
    final devices = registry.calls.where((c) => c.path == '/v1/devices').map((c) => (c.bank, c.phone)).toSet();
    expect(devices, {('demobank', amina), ('acme', tunde)});
    state.dispose();
    await registry.close();
  });

  group('BANK-5: the screens', () {
    testWidgets('the check screen asks which bank, and the pick routes the check', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.text(Copy.I.t('banks.pickerHeading')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('pick-demobank')));
      await tester.pump();
      expect(state.bank!.id, 'demobank');
      registry.calls.clear();
      await tester.enterText(find.byType(CupertinoTextField), 'Your account is blocked');
      await tester.pump();
      await tester.tap(find.text('Check message'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(registry.calls.where((c) => c.path == '/v1/verify/message').map((c) => c.bank), ['demobank']);
      await tester.pumpWidget(hostWith(const SizedBox()));
      await tester.pump(const Duration(seconds: 1));
      state.dispose();
      await registry.close();
    });

    testWidgets('with one bank linked there is no bank picker', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.text(Copy.I.t('banks.pickerHeading')), findsNothing);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });

    testWidgets('settings lists each linked bank and removes one after confirming', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(SettingsScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.byKey(const ValueKey('bank-demobank')), findsOneWidget);
      expect(find.byKey(const ValueKey('bank-acme')), findsOneWidget);
      expect(find.text(Copy.I.t('banks.add')), findsOneWidget);
      await tester.tap(find.descendant(of: find.byKey(const ValueKey('bank-acme')), matching: find.byType(CupertinoButton)));
      await tester.pumpAndSettle();
      expect(find.text(Copy.I.t('banks.removeTitle', {'bank': 'Acme Bank'})), findsOneWidget);
      await tester.tap(find.text(Copy.I.t('banks.remove')));
      await tester.pumpAndSettle();
      expect(state.links.map((l) => l.id), ['demobank']);
      expect(find.byKey(const ValueKey('bank-acme')), findsNothing);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });

    testWidgets('add a bank from settings links it and returns', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await tester.pumpWidget(hostWith(SettingsScreen(state: state), disableAnimations: true));
      await tester.pump();
      await tester.tap(find.text(Copy.I.t('banks.add')));
      await tester.pumpAndSettle();
      expect(find.text('Acme Bank'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(state.links.map((l) => (l.id, l.phone)), [('demobank', amina), ('acme', amina)]);
      expect(find.byKey(const ValueKey('bank-acme')), findsOneWidget);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });
  });

  group('BANK-6: sign-in is the customer\'s own bank and number, nothing else', () {
    Future<void> open(WidgetTester tester, AppState state) async {
      await tester.pumpWidget(hostWith(LinkScreen(state: state), disableAnimations: true));
      await tester.pumpAndSettle();
    }

    Future<void> close(WidgetTester tester, AppState state, FakeRegistry registry) async {
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    }

    testWidgets('the screen reads as sign-in, lists no demo customers and has the number as its only field', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      await open(tester, state);
      expect(find.text(Copy.I.t('app.link.title')), findsWidgets);
      expect(find.descendant(of: find.byKey(const ValueKey('signIn')), matching: find.text(Copy.I.t('app.link.title'))), findsOneWidget);
      for (final name in ['Amina Bello', 'Tunde Okafor', 'Chidinma Eze', amina, tunde, '+2348031112222']) {
        expect(find.text(name), findsNothing);
      }
      expect(find.byType(CupertinoTextField), findsOneWidget);
      final field = tester.widget<CupertinoTextField>(find.byType(CupertinoTextField));
      expect(field.keyboardType, TextInputType.phone);
      expect(field.obscureText, isFalse);
      await close(tester, state, registry);
    });

    testWidgets('picking a bank, typing a number and pressing Sign in signs in for that number', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      await open(tester, state);
      await tester.tap(find.text('Acme Bank'));
      await tester.pumpAndSettle();
      expect(tester.widget<CupertinoTextField>(find.byType(CupertinoTextField)).focusNode!.hasFocus, isTrue);
      await tester.enterText(find.byType(CupertinoTextField), '0809 876 5432');
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(state.links.map((l) => (l.id, l.phone)), [('acme', tunde)]);
      await close(tester, state, registry);
    });

    for (final typed in ['08012345678', '+2348012345678', '2348012345678', '8012345678']) {
      testWidgets('a Nigerian number typed as $typed signs in as $amina', (tester) async {
        phoneSize(tester);
        final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
        final state = await linkedState(registry, const []);
        await open(tester, state);
        expect(tester.widget<CupertinoTextField>(find.byType(CupertinoTextField)).focusNode!.hasFocus, isTrue);
        await tester.enterText(find.byType(CupertinoTextField), typed);
        await tester.tap(find.byKey(const ValueKey('signIn')));
        await tester.pumpAndSettle();
        expect(state.links.map((l) => (l.id, l.phone)), [('demobank', amina)]);
        await close(tester, state, registry);
      });
    }

    testWidgets('signing in needs a bank and a valid number first', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      await open(tester, state);
      await tester.enterText(find.byType(CupertinoTextField), '08012345678');
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(find.text(Copy.I.t('app.link.chooseBank')), findsOneWidget);
      await tester.tap(find.text('DemoBank'));
      await tester.enterText(find.byType(CupertinoTextField), '123');
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(find.text(Copy.I.t('app.link.enterNumber')), findsOneWidget);
      expect(state.links, isEmpty);
      await close(tester, state, registry);
    });
  });
}
