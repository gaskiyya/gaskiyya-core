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
      final registry = twoBanks()..strangers['demobank'] = {amina};
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

  group('BANK-2: every bank that knows the number is linked', () {
    test('discovery finds each organisation that knows the number, and saves nothing until adopted', () async {
      final registry = twoBanks()..strangers['acme'] = {amina};
      final state = await linkedState(registry, const []);
      final found = await state.discover(amina);
      expect(found.map((l) => (l.id, l.phone)), [('demobank', amina)]);
      expect(state.linked, isFalse);
      await state.adopt(found);
      expect(state.links.map((l) => (l.id, l.phone)), [('demobank', amina)]);
      state.dispose();
      expect((await restart(registry)).links.map((l) => l.id), ['demobank']);
      await registry.close();
    });

    test('only banks are linked: an agency that knows the number is left out, and a saved agency link is dropped', () async {
      final agency = Bank(id: 'taxoffice', name: 'Tax Office (demo)', kind: 'agency', domains: ['taxoffice.example'], customerTokenUrl: 'http://registry/sim/taxoffice/customer-token');
      final registry = FakeRegistry([testBank('demobank', 'DemoBank'), agency]);
      final state = await linkedState(registry, const []);
      expect((await state.discover(amina)).map((l) => l.id), ['demobank']);
      state.dispose();
      (await linkedState(registry, ['demobank', 'taxoffice'], phone: amina)).dispose();
      final again = await restart(registry);
      expect(again.links.map((l) => l.id), ['demobank']);
      again.dispose();
      await registry.close();
    });

    test('an organisation that starts knowing the number is linked on the next launch', () async {
      final registry = twoBanks()..strangers['acme'] = {amina};
      final state = await linkedState(registry, const []);
      await state.adopt(await state.discover(amina));
      state.dispose();
      registry.strangers.clear();
      final again = await restart(registry);
      expect(again.links.map((l) => (l.id, l.phone)), [('demobank', amina), ('acme', amina)]);
      expect(again.bank!.id, 'demobank');
      again.dispose();
      await registry.close();
    });

    test('an organisation whose sign-in fails is left out, and the others are linked', () async {
      final registry = twoBanks()..failingSignIn.add('acme');
      final state = await linkedState(registry, const []);
      await state.adopt(await state.discover(amina));
      expect(state.links.map((l) => l.id), ['demobank']);
      state.dispose();
      await registry.close();
    });

    test('discarded results are never saved', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      state.discard(await state.discover(amina));
      expect(state.linked, isFalse);
      state.dispose();
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
  });

  group('BANK-3: each organisation is asked with its own client, bound to its number', () {
    test('a client talks to its own tenant only, and the inbox gathers every organisation', () async {
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank']);
      await state.link(tunde, registry.bank('acme'));

      await state.select('demobank');
      registry.calls.clear();
      final r = await state.client!.verifyText('Your account is blocked');
      expect(r.bank, 'DemoBank');
      await state.client!.activity();
      await state.inbox();
      final checks = registry.calls.where((c) => c.path == '/v1/verify/message' || c.path == '/v1/activity');
      expect(checks.map((c) => c.path), ['/v1/verify/message', '/v1/activity']);
      expect(checks.map((c) => (c.bank, c.phone)).toSet(), {('demobank', amina)});
      final inboxes = registry.calls.where((c) => c.path.endsWith('/inbox'));
      expect(inboxes.map((c) => (c.bank, c.phone)).toSet(), {('demobank', amina), ('acme', tunde)});

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

    testWidgets('with no call from any organisation, the calls screen says so without listing them', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(CallsScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.text(Copy.I.t('call.not_calling.title')), findsOneWidget);
      expect(find.text(Copy.I.t('call.not_calling.body', {'bank': Copy.I.t('app.common.yourBank')})), findsOneWidget);
      expect(find.textContaining('Acme Bank'), findsNothing);
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
    testWidgets('the check screen has no bank picker, and a message is checked with every organisation', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(CheckScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.text(Copy.I.t('banks.pickerHeading')), findsNothing);
      registry.calls.clear();
      await tester.enterText(find.byType(CupertinoTextField), 'Your account is blocked');
      await tester.pump();
      await tester.tap(find.text(Copy.I.t('app.check.checkMessage')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(registry.calls.where((c) => c.path == '/v1/verify/message').map((c) => c.bank).toSet(), {'demobank', 'acme'});
      expect(find.text(Copy.I.t('verdict.not_confirmed.body', {'bank': 'Acme Bank or DemoBank'})), findsOneWidget);
      await tester.pumpWidget(hostWith(const SizedBox()));
      await tester.pump(const Duration(seconds: 1));
      state.dispose();
      await registry.close();
    });

    testWidgets('activity merges every organisation into one list and names one only when it cannot be loaded', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(ActivityScreen(state: state), disableAnimations: true));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.text(Copy.I.t('app.activity.none')), findsOneWidget);
      expect(find.textContaining('DemoBank'), findsNothing);
      expect(find.textContaining('Acme Bank'), findsNothing);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });

    testWidgets('settings does not list or count linked organisations', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, ['demobank', 'acme']);
      await tester.pumpWidget(hostWith(SettingsScreen(state: state), disableAnimations: true));
      await tester.pump();
      expect(find.byKey(const ValueKey('bank-demobank')), findsNothing);
      expect(find.text(Copy.I.t('banks.add')), findsNothing);
      expect(find.text('DemoBank'), findsNothing);
      expect(find.text('Acme Bank'), findsNothing);
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    });
  });

  group('BANK-6: sign-in asks only for the number and finds every organisation that knows it', () {
    Future<void> open(WidgetTester tester, AppState state) async {
      await tester.pumpWidget(hostWith(LinkScreen(state: state), disableAnimations: true));
      await tester.pumpAndSettle();
    }

    Future<void> type(WidgetTester tester, String number) async {
      await tester.enterText(find.byType(CupertinoTextField), number);
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
    }

    Future<void> close(WidgetTester tester, AppState state, FakeRegistry registry) async {
      await tester.pumpWidget(hostWith(const SizedBox()));
      state.dispose();
      await registry.close();
    }

    testWidgets('the screen reads as sign-in, lists no banks or demo customers and has the number as its only field', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      await open(tester, state);
      expect(find.text(Copy.I.t('app.link.title')), findsOneWidget);
      for (final name in ['DemoBank', 'Acme Bank', 'Amina Bello', 'Tunde Okafor', 'Chidinma Eze', amina, tunde, '+2348031112222']) {
        expect(find.text(name), findsNothing);
      }
      expect(find.byType(CupertinoTextField), findsOneWidget);
      final field = tester.widget<CupertinoTextField>(find.byType(CupertinoTextField));
      expect(field.keyboardType, TextInputType.phone);
      expect(field.obscureText, isFalse);
      expect(field.focusNode!.hasFocus, isTrue);
      await close(tester, state, registry);
    });

    testWidgets('a number lists no organisations, and proceeding links every one that knows it', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      await open(tester, state);
      await type(tester, '0809 876 5432');
      expect(find.byType(BankLogo), findsNothing);
      for (final name in ['DemoBank', 'Acme Bank']) {
        expect(find.text(name), findsNothing);
      }
      expect(state.linked, isFalse);
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(state.links.map((l) => (l.id, l.phone)), [('demobank', tunde), ('acme', tunde)]);
      await close(tester, state, registry);
    });

    testWidgets('only organisations that know the number are linked', (tester) async {
      phoneSize(tester);
      final registry = twoBanks()..strangers['demobank'] = {tunde};
      final state = await linkedState(registry, const []);
      await open(tester, state);
      await type(tester, '08098765432');
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(state.links.map((l) => l.id), ['acme']);
      await close(tester, state, registry);
    });

    for (final typed in ['08012345678', '+2348012345678', '2348012345678', '8012345678']) {
      testWidgets('a Nigerian number typed as $typed signs in as $amina', (tester) async {
        phoneSize(tester);
        final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
        final state = await linkedState(registry, const []);
        await open(tester, state);
        await type(tester, typed);
        await tester.tap(find.byKey(const ValueKey('signIn')));
        await tester.pumpAndSettle();
        expect(state.links.map((l) => (l.id, l.phone)), [('demobank', amina)]);
        await close(tester, state, registry);
      });
    }

    testWidgets('a number no organisation knows says so and cannot proceed', (tester) async {
      phoneSize(tester);
      final registry = twoBanks()
        ..strangers['demobank'] = {amina}
        ..strangers['acme'] = {amina};
      final state = await linkedState(registry, const []);
      await open(tester, state);
      await type(tester, '08012345678');
      expect(find.text(Copy.I.t('app.link.notFound')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('signIn')));
      await tester.pumpAndSettle();
      expect(state.links, isEmpty);
      await close(tester, state, registry);
    });

    testWidgets('an incomplete number looks nothing up and asks for a valid one', (tester) async {
      phoneSize(tester);
      final registry = twoBanks();
      final state = await linkedState(registry, const []);
      await open(tester, state);
      registry.calls.clear();
      final before = registry.signIns;
      await type(tester, '123');
      expect(registry.signIns, before);
      await tester.testTextInput.receiveAction(TextInputAction.go);
      await tester.pumpAndSettle();
      expect(find.text(Copy.I.t('app.link.enterNumber')), findsOneWidget);
      expect(state.links, isEmpty);
      await close(tester, state, registry);
    });
  });
}
