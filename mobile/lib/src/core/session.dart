import 'dart:async';
import 'dart:convert';
import 'dart:ui' show Locale, PlatformDispatcher;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'calls.dart';
import 'config.dart';
import 'copy.dart';
import 'push.dart';

class InboxMessage {
  InboxMessage({required this.id, required this.from, required this.text, required this.at, this.channel});
  factory InboxMessage.fromJson(Map<String, dynamic> j) => InboxMessage(
        id: j['id'] as String,
        from: j['from'] as String,
        text: j['text'] as String,
        at: DateTime.parse(j['at'] as String).toLocal(),
        channel: VerifyResult.channels.contains(j['channel']) ? j['channel'] as String : null,
      );
  final String id;
  final String from;
  final String text;
  final DateTime at;

  final String? channel;
}

class BankLink {
  BankLink._(this.bank, this.phone, this._http, http.Client api, this._now) {
    client = GaskiyaClient(baseUrl: Config.apiUrl, token: token, renewToken: renewToken, httpClient: api);
  }

  final Bank bank;
  final String phone;
  final http.Client _http;
  final DateTime Function() _now;
  late final GaskiyaClient client;

  void Function()? onRenewed;

  String? _token;
  DateTime _tokenExpiry = DateTime.fromMillisecondsSinceEpoch(0);

  List<CallSession> liveCalls = const [];

  CallSession? get liveCall => liveCalls.firstOrNull;

  AdvisoryList? advisories;
  Future<void>? _advising;

  DateTime? callCheckedAt;

  static const callFreshFor = Duration(seconds: 30);

  bool get callChecked {
    final at = callCheckedAt;
    return at != null && _now().difference(at) < callFreshFor;
  }

  StreamSubscription<Map<String, dynamic>>? _events;
  Timer? _retry;
  Timer? _expiry;
  Timer? _stale;
  Future<void>? _checking;
  bool _closed = false;

  String get id => bank.id;

  Future<String> _refreshToken() async {
    final res = await _http
        .post(Uri.parse(bank.customerTokenUrl), headers: {'content-type': 'application/json'}, body: jsonEncode({'phone': phone}))
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) throw ApiException(res.statusCode, 'link_failed', 'Could not link to the bank');
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final renewed = _token != null || _renewing != null;
    _token = j['token'] as String;
    _tokenExpiry = DateTime.now().add(Duration(seconds: (j['expiresIn'] as int) - 60));
    final token = _token!;
    if (renewed && !_closed) onRenewed?.call();
    return token;
  }

  Future<String> token() async {
    if (_token != null && DateTime.now().isBefore(_tokenExpiry)) return _token!;
    return renewToken();
  }

  Future<String>? _renewing;

  Future<String> renewToken() {
    _token = null;
    return _renewing ??= _refreshToken().whenComplete(() => _renewing = null);
  }

  Map<String, dynamic> toJson() => {'bank': bank.toJson(), 'phone': phone};

  void _close() {
    _closed = true;
    _events?.cancel();
    _retry?.cancel();
    _expiry?.cancel();
    _stale?.cancel();
    client.close();
  }
}

class AppState extends ChangeNotifier {
  AppState({
    http.Client? httpClient,
    PushTransport? push,
    http.Client Function()? apiHttp,
    DateTime Function()? clock,
    List<Locale> Function()? deviceLocales,
    this.callPollEvery = const Duration(seconds: 10),
  })  : _http = httpClient ?? http.Client(),
        _deviceLocales = deviceLocales ?? (() => PlatformDispatcher.instance.locales),
        _apiHttp = apiHttp ?? http.Client.new,
        _now = clock ?? DateTime.now,
        push = PushService(push ?? FirebasePushTransport());

  final Duration callPollEvery;
  final DateTime Function() _now;
  final List<Locale> Function() _deviceLocales;
  Timer? _poll;

  final http.Client _http;
  final http.Client Function() _apiHttp;
  final PushService push;

  final openCallsTab = ValueNotifier<int>(0);

  final openAlerts = ValueNotifier<int>(0);

  final arrivedAlert = ValueNotifier<({String bank, String id})?>(null);
  SharedPreferences? _prefs;
  bool _disposed = false;

  static const _linksKey = 'links';
  static const _selectedKey = 'selectedBank';

  bool onboarded = false;

  String language = 'en';
  final List<BankLink> _links = [];
  String? _selectedId;

  List<BankLink> get links => List.unmodifiable(_links);

  BankLink? get selected => _links.where((l) => l.id == _selectedId).firstOrNull ?? _links.firstOrNull;

  Bank? get bank => selected?.bank;
  String? get bankName => bank?.name;
  String? get phone => selected?.phone;
  GaskiyaClient? get client => selected?.client;

  bool get linked => _links.isNotEmpty;

  List<BankLink> get calling => _links.where((l) => l.liveCall != null && l.callChecked).toList();

  List<BankLink> get callUnchecked => _links.where((l) => !l.callChecked).toList();

  BankLink? get latestCall {
    final c = calling..sort((a, b) => b.liveCall!.expiresAt.compareTo(a.liveCall!.expiresAt));
    return c.firstOrNull;
  }

  CallSession? get liveCall => latestCall?.liveCall;

  Future<void> load() async {
    _prefs = await SharedPreferences.getInstance();
    onboarded = _prefs!.getBool('onboarded') ?? false;
    final saved = _prefs!.getString('language');
    if (Copy.languages.contains(saved)) {
      language = saved!;
    } else {
      language = languageFor(_deviceLocales());
      await _prefs!.setString('language', language);
    }
    await _migrateSingleBank();
    final raw = _prefs!.getString(_linksKey);
    if (raw != null) {
      for (final e in jsonDecode(raw) as List) {
        final j = e as Map<String, dynamic>;
        final b = Bank.fromJson(j['bank'] as Map<String, dynamic>, Config.apiUrl);
        if (_links.any((l) => l.id == b.id)) continue;
        _links.add(_newLink(b, j['phone'] as String));
      }
    }
    _selectedId = _prefs!.getString(_selectedKey);
    for (final l in _links) {
      unawaited(l._refreshToken().then((_) => _listen(l)).catchError((_) {}));
    }
    if (_links.isNotEmpty) unawaited(_startPush());
  }

  Future<void> _migrateSingleBank() async {
    final p = _prefs!;
    if (p.containsKey(_linksKey)) return;
    final phone = p.getString('phone');
    if (phone == null) return;
    final saved = p.getString('bank');
    Bank? b;
    if (saved != null) {
      b = Bank.fromJson(jsonDecode(saved) as Map<String, dynamic>, Config.apiUrl);
    } else {
      final banks = await loadBanks().catchError((_) => <Bank>[]);
      if (banks.length == 1) b = banks.single;
    }
    if (b == null) return;
    await p.setString(_linksKey, jsonEncode([
      {'bank': b.toJson(), 'phone': phone},
    ]));
    await p.setString(_selectedKey, b.id);
    await p.remove('phone');
    await p.remove('bank');
  }

  static String languageFor(List<Locale> locales) {
    for (final l in locales) {
      final code = l.languageCode.toLowerCase();
      if (code == 'en') return 'en';
      if (Copy.languages.contains(code)) return code;
    }
    return 'en';
  }

  Future<void> setLanguage(String lang) async {
    language = Copy.languages.contains(lang) ? lang : 'en';
    if (Copy.loaded) Copy.I.language = language;
    await _prefs?.setString('language', language);
    notifyListeners();
  }

  Future<void> finishOnboarding() async {
    onboarded = true;
    await _prefs?.setBool('onboarded', true);
    _notify();
  }

  Future<List<Bank>> loadBanks() => fetchBanks(Config.apiUrl, _http);

  BankLink _newLink(Bank b, String phone) => BankLink._(b, phone, _http, _apiHttp(), _now);

  Future<void> _save() async {
    await _prefs?.setString(_linksKey, jsonEncode(_links.map((l) => l.toJson()).toList()));
    final id = selected?.id;
    if (id == null) {
      await _prefs?.remove(_selectedKey);
    } else {
      await _prefs?.setString(_selectedKey, id);
    }
  }

  Future<void> link(String e164, Bank b) async {
    final l = _newLink(b, e164);
    try {
      await l._refreshToken();
    } catch (_) {
      l._close();
      rethrow;
    }
    final i = _links.indexWhere((x) => x.id == b.id);
    if (i >= 0) {
      _links[i]._close();
      _links[i] = l;
    } else {
      _links.add(l);
    }
    _selectedId = b.id;
    await _save();
    _listen(l);
    unawaited(_startPush());
    _notify();
  }

  Future<void> select(String bankId) async {
    if (!_links.any((l) => l.id == bankId) || _selectedId == bankId) return;
    _selectedId = bankId;
    await _save();
    _notify();
  }

  Future<void> unlinkBank(String bankId) async {
    final i = _links.indexWhere((l) => l.id == bankId);
    if (i < 0) return;
    _links.removeAt(i)._close();
    if (_selectedId == bankId) _selectedId = _links.firstOrNull?.id;
    await _save();
    _notify();
    if (_links.isEmpty) {
      unawaited(push.stop());
    } else {
      unawaited(_startPush());
    }
  }

  Future<void> unlink() async {
    for (final l in _links) {
      l._close();
    }
    _links.clear();
    _selectedId = null;
    _notify();
    await _prefs?.remove(_linksKey);
    await _prefs?.remove(_selectedKey);
    await _prefs?.remove('phone');
    await _prefs?.remove('bank');
    unawaited(push.stop());
  }

  Future<void> _startPush() async {
    if (_links.isEmpty) return;
    await push.start(clients: _links.map((l) => l.client).toList(), onNotice: handleNotice, onOpened: (data) {
      handleNotice(data, null, true);
      if (_isAdvisory(data)) {
        openAlerts.value++;
      } else {
        openCallsTab.value++;
      }
    });
  }

  static bool _isAdvisory(Map<String, dynamic> data) => (data['type'] as String? ?? '').startsWith('advisory.');

  void handleNotice(Map<String, dynamic> data, [BankLink? from, bool opened = false]) {
    final type = data['type'];
    if (type == 'advisory.published' || type == 'advisory.withdrawn') {
      final l = from ?? _linkNamed(data['bank'] as String?);
      final targets = l == null ? _links : [l];
      final id = data['advisoryId'] as String?;
      if (type == 'advisory.withdrawn' && id != null) {
        for (final t in targets) {
          final list = t.advisories;
          if (list != null && !list.cannotCheck) t.advisories = AdvisoryList(list.advisories.where((a) => a.id != id).toList());
        }
        _notify();
      } else if (!opened && id != null) {
        arrivedAlert.value = (bank: l?.bank.name ?? (data['bank'] as String? ?? ''), id: id);
      }
      for (final t in targets) {
        unawaited(refreshAdvisories(t));
      }
      return;
    }
    if (type == 'call.opened' && (data['code'] as String? ?? '').isNotEmpty) {
      final l = from ?? _linkNamed(data['bank'] as String?);
      if (l != null) {
        final call = CallSession.fromJson(data);
        _answered(l, true);
        _setCalls(l, [call, ...l.liveCalls.where((c) => c.id != call.id)]);
      } else {
        unawaited(refreshCall());
      }
    } else if (type == 'call.closed') {
      final id = data['callId'];
      if (id is String) unawaited(NativeCalls.instance.endCall(id));
      for (final l in from == null ? _links : [from]) {
        if (l.liveCalls.isEmpty) continue;
        final left = id == null ? const <CallSession>[] : l.liveCalls.where((c) => c.id != id).toList();
        if (left.length != l.liveCalls.length) _setCalls(l, left);
      }
    }
  }

  BankLink? _linkNamed(String? name) {
    if (_links.length == 1) return _links.single;
    final named = _links.where((l) => l.bank.name == name).toList();
    return named.length == 1 ? named.single : null;
  }

  Future<void> resetOnboarding() async {
    onboarded = false;
    await _prefs?.setBool('onboarded', false);
    _notify();
  }

  void _listen(BankLink l) {
    if (l._closed || _disposed) return;
    unawaited(_refreshCall(l));
    _subscribe(l);
  }

  void _subscribe(BankLink l) {
    l._events?.cancel();
    l._events = null;
    l._retry?.cancel();
    if (l._closed || _disposed) return;
    l.onRenewed = () {
      if (l._events != null) _subscribe(l);
    };
    l._events = l.client.events().listen(
      (data) => handleNotice(data, l),
      onError: (Object e) {
        l._events = null;
        if (e is ApiException && e.status == 401) unawaited(l.renewToken().then((_) {}, onError: (_) {}));
        l._retry = Timer(const Duration(seconds: 3), () => _listen(l));
      },
      onDone: () {
        l._events = null;
        l._retry = Timer(const Duration(seconds: 1), () => _listen(l));
      },
      cancelOnError: true,
    );
  }

  void _answered(BankLink l, bool ok) {
    l._stale?.cancel();
    l.callCheckedAt = ok ? _now() : null;
    if (ok) l._stale = Timer(BankLink.callFreshFor, _notify);
  }

  void startCallPolling() {
    if (_poll != null || _disposed) return;
    unawaited(refreshCall());
    _poll = Timer.periodic(callPollEvery, (_) => unawaited(refreshCall()));
  }

  void stopCallPolling() {
    _poll?.cancel();
    _poll = null;
  }

  void _setCalls(BankLink l, List<CallSession> calls) {
    if (l._closed || _disposed) return;
    l._expiry?.cancel();
    final now = DateTime.now();
    l.liveCalls = calls.where((c) => c.expiresAt.isAfter(now)).toList();
    if (l.liveCalls.isNotEmpty) {
      final next = l.liveCalls.map((c) => c.expiresAt).reduce((a, b) => a.isBefore(b) ? a : b);
      l._expiry = Timer(next.difference(now), () => _setCalls(l, l.liveCalls));
    }
    _notify();
  }

  Future<void> _refreshCall(BankLink l) => l._checking ??= () async {
        try {
          final s = await l.client.openCall();
          if (l._closed || _disposed) return;
          _answered(l, !s.cannotCheck);
          _setCalls(l, s.calling ? s.calls : const []);
        } finally {
          l._checking = null;
        }
      }();

  Future<void> refreshCall() => Future.wait(_links.map(_refreshCall));

  Future<void> refreshAdvisories([BankLink? only]) => Future.wait((only == null ? _links : [only]).map((l) => l._advising ??= () async {
        try {
          final r = await l.client.advisories();
          if (l._closed || _disposed) return;
          l.advisories = r;
          _notify();
        } finally {
          l._advising = null;
        }
      }()));

  Future<List<InboxMessage>> inbox() async {
    final l = selected;
    final url = l?.bank.demoInboxUrl;
    if (l == null || url == null) return [];
    try {
      Future<http.Response> get(String token) => _http.get(Uri.parse(url), headers: {'authorization': 'Bearer $token'}).timeout(const Duration(seconds: 6));
      var res = await get(await l.token());
      if (res.statusCode == 401) res = await get(await l.renewToken());
      if (res.statusCode != 200) return [];
      return ((jsonDecode(res.body) as Map<String, dynamic>)['items'] as List).map((e) => InboxMessage.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    stopCallPolling();
    for (final l in _links) {
      l._close();
    }
    super.dispose();
  }
}
