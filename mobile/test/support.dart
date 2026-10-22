import 'dart:async';
import 'dart:convert';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/push.dart';
import 'package:gaskiya/src/core/session.dart';
import 'package:gaskiya/src/ui/theme.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class NoPush implements PushTransport {
  NoPush({this.available = false});
  final bool available;
  @override
  Future<bool> start() async => available;
  @override
  Future<String?> token() async => available ? 'fcm-token-1' : null;
  @override
  Stream<String> get tokenRefresh => const Stream.empty();
  @override
  Stream<Map<String, dynamic>> get messages => const Stream.empty();
  @override
  Stream<Map<String, dynamic>> get opened => const Stream.empty();
  @override
  Future<Map<String, dynamic>?> launchedFrom() async => null;
  @override
  String get platform => 'android';
}

Bank testBank(String id, String name) => Bank(
      id: id,
      name: name,
      domains: ['$id.ng'],
      customerTokenUrl: 'http://registry/sim/$id/customer-token',
      demoInboxUrl: 'http://registry/sim/$id/inbox',
    );

class FakeRegistry {
  FakeRegistry(this.banks);

  final List<Bank> banks;

  final calls = <({String bank, String phone, String path})>[];

  final calling = <String, String>{};

  final failingSignIn = <String>{};

  /// Numbers a bank does not know: its sign-in answers 404 for them.
  final strangers = <String, Set<String>>{};

  final failingCallChecks = <String>{};

  final inboxItems = <String, List<Map<String, dynamic>>>{};

  final advisories = <String, List<Map<String, dynamic>>>{};

  final failingAdvisories = <String>{};

  final _bankStreams = <String, List<StreamController<List<int>>>>{};

  void emit(String bankId, Map<String, dynamic> data) {
    for (final c in _bankStreams[bankId] ?? const <StreamController<List<int>>>[]) {
      if (!c.isClosed) c.add(utf8.encode('event: ${data['type']}\ndata: ${jsonEncode(data)}\n\n'));
    }
  }

  final moreCalls = <String, List<String>>{};

  final revoked = <String>{};
  final _issued = <String>{};

  void rotateKeys() => revoked.addAll(_issued);

  bool refuseAll = false;

  final refused = <String>[];
  int signIns = 0;

  final _streams = <StreamController<List<int>>>[];

  Bank bank(String id) => banks.firstWhere((b) => b.id == id);

  http.Client get client => MockClient.streaming((req, body) async {
        final bytes = await body.toBytes();
        final path = req.url.path;
        final signIn = RegExp(r'^/sim/(\w+)/customer-token$').firstMatch(path);
        if (signIn != null) {
          final id = signIn[1]!;
          if (failingSignIn.contains(id)) return _json({'code': 'down'}, 503);
          final phone = (jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>)['phone'];
          if (strangers[id]?.contains(phone) ?? false) return _json({'code': 'not_found'}, 404);
          final token = 'tok:$id:$phone';
          signIns++;
          _issued.add(token);
          revoked.remove(token);
          return _json({'token': token, 'expiresIn': 3600});
        }
        if (path == '/v1/banks') return _json({'banks': [for (final b in banks) _bankJson(b)]});
        final auth = req.headers['authorization'] ?? '';
        final bearer = auth.replaceFirst('Bearer ', '');
        final parts = bearer.split(':');
        if (parts.length != 3 || parts[0] != 'tok' || refuseAll || revoked.contains(bearer)) {
          refused.add(path);
          return _json({'code': 'unauthorized'}, 401);
        }
        final id = parts[1];
        final name = bank(id).name;
        calls.add((bank: id, phone: parts[2], path: path));
        if (RegExp(r'^/sim/\w+/inbox$').hasMatch(path)) return _json({'items': inboxItems[id] ?? []});
        switch (path) {
          case '/v1/events':
            final c = StreamController<List<int>>();
            _streams.add(c);
            (_bankStreams[id] ??= []).add(c);
            return http.StreamedResponse(c.stream, 200, headers: {'content-type': 'text/event-stream'});
          case '/v1/calls/open':
            if (failingCallChecks.contains(id)) return _json({'code': 'error', 'message': 'Internal error'}, 500);
            final code = calling[id];
            Map<String, dynamic> session(String callId, String c) => {
                  'id': callId,
                  'purpose': 'card_activation',
                  'code': c,
                  'status': 'open',
                  'expiresAt': DateTime.now().add(const Duration(minutes: 3)).toUtc().toIso8601String(),
                };
            final more = [for (final (i, c) in (moreCalls[id] ?? const <String>[]).indexed) session('call_${id}_$i', c)];
            return _json(code == null
                ? {'calling': false, 'bank': name}
                : {
                    'calling': true,
                    'bank': name,
                    'call': session('call_$id', code),
                    if (more.isNotEmpty) 'calls': [session('call_$id', code), ...more],
                  });
          case '/v1/verify/message':
            return _json({'verdict': 'not_confirmed', 'recentActivity': [], 'activityText': 'In the last 24 hours $name sent you no messages.', 'bank': name});
          case '/v1/devices':
            return http.StreamedResponse(const Stream.empty(), 204);
          case '/v1/advisories':
            if (failingAdvisories.contains(id)) return _json({'code': 'cannot_check', 'message': 'Advisories cannot be read right now'}, 503);
            return _json({'bank': name, 'advisories': advisories[id] ?? []});
          case '/v1/activity':
            return _json({'recentActivity': [], 'activityText': 'In the last 24 hours $name sent you no messages.'});
        }
        return _json({'code': 'not_found'}, 404);
      });

  Future<void> close() async {
    for (final s in _streams) {
      await s.close();
    }
  }

  static Map<String, dynamic> _bankJson(Bank b) => b.toJson();

  static http.StreamedResponse _json(Object body, [int status = 200]) =>
      http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(body))), status, headers: {'content-type': 'application/json'});
}

Future<AppState> linkedState(FakeRegistry registry, List<String> linkTo, {String phone = '+2348012345678', PushTransport? push}) async {
  SharedPreferences.setMockInitialValues({'onboarded': true});
  final mock = registry.client;
  final state = AppState(httpClient: mock, push: push ?? NoPush(), apiHttp: () => mock);
  await state.load();
  for (final id in linkTo) {
    await state.link(phone, registry.bank(id));
  }
  return state;
}

void mockSharing(WidgetTester tester) {
  final messenger = tester.binding.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(const MethodChannel('receive_sharing_intent/messages'), (_) async => null);
  messenger.setMockStreamHandler(const EventChannel('receive_sharing_intent/events-media'), MockStreamHandler.inline(onListen: (_, _) {}));
}

Widget hostWith(Widget child, {double textScale = 1, bool disableAnimations = false}) => CupertinoApp(
      theme: G.theme(Brightness.light),
      builder: (context, page) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale), disableAnimations: disableAnimations),
        child: page!,
      ),
      home: child,
    );

void phoneSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}
