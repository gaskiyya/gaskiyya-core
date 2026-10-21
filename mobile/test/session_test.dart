import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/copy.dart';
import 'package:gaskiya/src/core/push.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

class HangingPush implements PushTransport {
  final _never = Completer<void>().future;
  StreamController<T> _stuck<T>() => StreamController<T>(onCancel: () => _never);
  @override
  Future<bool> start() async => true;
  @override
  Future<String?> token() async => 'fcm-token-1';
  @override
  late final Stream<String> tokenRefresh = _stuck<String>().stream;
  @override
  late final Stream<Map<String, dynamic>> messages = _stuck<Map<String, dynamic>>().stream;
  @override
  late final Stream<Map<String, dynamic>> opened = _stuck<Map<String, dynamic>>().stream;
  @override
  Future<Map<String, dynamic>?> launchedFrom() async => null;
  @override
  String get platform => 'ios';
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() => Copy.fromJson(File('assets/copy.json').readAsStringSync()));

  group('F1: unlink', () {
    test('clears every link and the saved number even when push never stops', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank'), testBank('acme', 'Acme Bank')]);
      final state = await linkedState(registry, ['demobank', 'acme'], push: HangingPush());
      await pumpEventQueue();
      expect(state.push.enabled, isTrue);
      var notified = 0;
      state.addListener(() => notified++);

      await state.unlink().timeout(const Duration(seconds: 1));

      expect(state.linked, isFalse);
      expect(state.links, isEmpty);
      expect(state.phone, isNull);
      expect(notified, greaterThan(0));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('links'), isFalse);
      expect(prefs.containsKey('selectedBank'), isFalse);
      expect(prefs.containsKey('phone'), isFalse);
      state.dispose();
      await registry.close();
    });

    test('a later start shows the link screen, not the old number', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank'], push: HangingPush());
      await state.unlink().timeout(const Duration(seconds: 1));
      state.dispose();
      final mock = registry.client;
      final again = AppState(httpClient: mock, push: NoPush(), apiHttp: () => mock);
      await again.load();
      expect(again.linked, isFalse);
      again.dispose();
      await registry.close();
    });

    test('removing the last bank one by one also never waits on push', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank'], push: HangingPush());
      await pumpEventQueue();
      await state.unlinkBank('demobank').timeout(const Duration(seconds: 1));
      expect(state.linked, isFalse);
      state.dispose();
      await registry.close();
    });
  });

  group('F4: a refused token is renewed and the request retried once', () {
    test('after a key rotation a genuine check, the call check and the inbox work without waiting for the token to expire', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '4719';
      final state = await linkedState(registry, ['demobank']);
      await pumpEventQueue();
      final before = registry.signIns;
      registry.rotateKeys();

      expect((await state.client!.verifyText('hello')).verdict, Verdict.notConfirmed);
      expect(registry.signIns, before + 1);
      expect(registry.refused, ['/v1/verify/message']);
      expect((await state.client!.openCall()).calls.map((c) => c.code), ['4719']);
      registry.rotateKeys();
      expect(await state.inbox(), isEmpty);
      expect(registry.calls.map((c) => c.path), contains('/sim/demobank/inbox'));
      expect(registry.signIns, before + 2);
      state.dispose();
      await registry.close();
    });

    test('fails closed: a fresh token that is refused too is retried only once and the answer is cannot check', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '4719';
      final state = await linkedState(registry, ['demobank']);
      await pumpEventQueue();
      registry.refuseAll = true;
      expect((await state.client!.verifyText('hello')).verdict, Verdict.cannotCheck);
      expect(registry.refused.where((p) => p == '/v1/verify/message'), hasLength(2));
      expect((await state.client!.openCall()).cannotCheck, isTrue);
      state.dispose();
      await registry.close();
    });

    test('fails closed: when signing in again fails, the check is cannot check', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await pumpEventQueue();
      registry.rotateKeys();
      registry.failingSignIn.add('demobank');
      expect((await state.client!.verifyText('hello')).verdict, Verdict.cannotCheck);
      expect(registry.refused.where((p) => p == '/v1/verify/message'), hasLength(1));
      state.dispose();
      await registry.close();
    });

    test('requests refused at the same moment share one sign-in', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await linkedState(registry, ['demobank']);
      await pumpEventQueue();
      final before = registry.signIns;
      registry.rotateKeys();
      final rs = await Future.wait([state.client!.verifyText('a'), state.client!.verifyText('b'), state.client!.activity()]);
      expect((rs[0] as VerifyResult).verdict, Verdict.notConfirmed);
      expect((rs[1] as VerifyResult).verdict, Verdict.notConfirmed);
      expect(rs[2], isNotNull);
      expect(registry.signIns, before + 1);
      state.dispose();
      await registry.close();
    });
  });

  group('F2: the Calls answer stays current', () {
    Future<AppState> make(FakeRegistry registry, {DateTime Function()? clock, Duration poll = const Duration(seconds: 10)}) async {
      SharedPreferences.setMockInitialValues({'onboarded': true});
      final mock = registry.client;
      final state = AppState(httpClient: mock, push: NoPush(), apiHttp: () => mock, clock: clock, callPollEvery: poll);
      await state.load();
      await state.link('+2348012345678', registry.bank('demobank'));
      await pumpEventQueue();
      return state;
    }

    test('polling while on screen drops an ended call and picks up a new one without any live notice', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '1442';
      final state = await make(registry, poll: const Duration(milliseconds: 40));
      expect(state.calling.single.liveCalls.map((c) => c.code), ['1442']);
      state.startCallPolling();

      registry.calling.remove('demobank');
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(state.calling, isEmpty);
      expect(state.callUnchecked, isEmpty);

      registry.calling['demobank'] = '9031';
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(state.calling.single.liveCalls.map((c) => c.code), ['9031']);

      state.stopCallPolling();
      final asked = registry.calls.where((c) => c.path == '/v1/calls/open').length;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(registry.calls.where((c) => c.path == '/v1/calls/open').length, asked);
      state.dispose();
      await registry.close();
    });

    test('an answer older than 30 seconds is cannot check: no stale code and no stale not calling', () async {
      var now = DateTime(2026, 10, 20, 12);
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '1442';
      final state = await make(registry, clock: () => now);
      expect(state.calling, hasLength(1));

      now = now.add(const Duration(seconds: 31));
      expect(state.calling, isEmpty, reason: 'an old code is not shown as calling');
      expect(state.callUnchecked.map((l) => l.id), ['demobank']);

      await state.refreshCall();
      expect(state.calling, hasLength(1));

      registry.calling.remove('demobank');
      await state.refreshCall();
      expect(state.callUnchecked, isEmpty);
      now = now.add(const Duration(seconds: 31));
      expect(state.callUnchecked.map((l) => l.id), ['demobank'], reason: 'an old "not calling" is not trusted either');
      state.dispose();
      await registry.close();
    });

    test('a failed poll is cannot check at once, never the last answer', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')])..calling['demobank'] = '1442';
      final state = await make(registry);
      registry.failingCallChecks.add('demobank');
      await state.refreshCall();
      expect(state.calling, isEmpty);
      expect(state.callUnchecked.map((l) => l.id), ['demobank']);
      state.dispose();
      await registry.close();
    });

    test('a renewed token reopens the live event stream with the new token', () async {
      final registry = FakeRegistry([testBank('demobank', 'DemoBank')]);
      final state = await make(registry);
      int streams() => registry.calls.where((c) => c.path == '/v1/events').length;
      final before = streams();
      expect(before, 1);
      registry.rotateKeys();
      expect((await state.client!.verifyText('hello')).verdict, Verdict.notConfirmed);
      await pumpEventQueue();
      expect(streams(), before + 1);
      state.dispose();
      await registry.close();
    });
  });
}
