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

/// The receipt fields a payment alert carries, to fill in the receipt check.
typedef ReceiptPrefill = ({String? orgId, int amountKobo, String reference, String valueDate});

/// A demo message or payment alert that reached the phone.
class ArrivedNotice {
  const ArrivedNotice({required this.id, required this.from, this.orgId, this.receipt});

  final String id;
  final String from;
  final String? orgId;

  /// Set for a payment alert; null for a message.
  final ReceiptPrefill? receipt;

  static ArrivedNotice? fromData(Map<String, dynamic> d) {
    final from = d['bank'] as String? ?? '';
    final orgId = d['orgId'] as String?;
    if (d['type'] == 'message.received') {
      final id = d['itemId'];
      return id is String && id.isNotEmpty ? ArrivedNotice(id: id, from: from, orgId: orgId) : null;
    }
    if (d['type'] == 'transfer.received') {
      final id = d['transferId'];
      final kobo = int.tryParse('${d['amountKobo']}');
      final reference = d['reference'];
      final date = d['valueDate'];
      if (id is! String || kobo == null || reference is! String || date is! String) return null;
      return ArrivedNotice(id: id, from: from, orgId: orgId, receipt: (orgId: orgId, amountKobo: kobo, reference: reference, valueDate: date));
    }
    return null;
  }
}

enum CallOutcome { ringing, active, answered, missed, declined }

class CallRecord {
  CallRecord({
    required this.id,
    required this.orgId,
    required this.bank,
    required this.code,
    this.purpose,
    required this.at,
    this.outcome = CallOutcome.ringing,
    this.answeredAt,
    this.endedAt,
    this.unverified = false,
  });
  factory CallRecord.fromJson(Map<String, dynamic> j) => CallRecord(
        id: j['id'] as String,
        orgId: j['orgId'] as String? ?? '',
        bank: j['bank'] as String? ?? '',
        code: j['code'] as String? ?? '',
        purpose: j['purpose'] as String?,
        at: DateTime.parse(j['at'] as String).toLocal(),
        outcome: CallOutcome.values.asNameMap()[j['outcome']] ?? CallOutcome.missed,
        answeredAt: j['answeredAt'] == null ? null : DateTime.parse(j['answeredAt'] as String).toLocal(),
        endedAt: j['endedAt'] == null ? null : DateTime.parse(j['endedAt'] as String).toLocal(),
        unverified: j['unverified'] == true,
      );

  final String id;
  final String orgId;
  String bank;
  String code;
  String? purpose;
  final DateTime at;
  CallOutcome outcome;
  DateTime? answeredAt;
  DateTime? endedAt;

  /// A call no bank vouches for (the demo's fraud call): [bank] is the name the caller showed, and there is no code.
  final bool unverified;

  bool get settled => outcome != CallOutcome.ringing && outcome != CallOutcome.active;

  Duration? get duration {
    final a = answeredAt, e = endedAt;
    return a == null || e == null ? null : e.difference(a);
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'orgId': orgId,
        'bank': bank,
        'code': code,
        'purpose': ?purpose,
        'at': at.toUtc().toIso8601String(),
        'outcome': outcome.name,
        'answeredAt': ?answeredAt?.toUtc().toIso8601String(),
        'endedAt': ?endedAt?.toUtc().toIso8601String(),
        if (unverified) 'unverified': true,
      };
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
  final _rung = <String>{};
  StreamSubscription<Map<String, dynamic>>? _native;

  final List<CallRecord> _callLog = [];
  static const _callLogKey = 'callLog';
  static const _callLogMax = 100;

  /// Every bank call the app heard about, newest first.
  List<CallRecord> get callLog => List.unmodifiable(_callLog);

  /// The answered call still in progress.
  CallRecord? get activeCall => _callLog.where((r) => r.outcome == CallOutcome.active).firstOrNull;

  static const unverifiedRingsFor = Duration(minutes: 2);

  /// A call ringing or on right now that no bank vouches for (the demo's fraud call). While it lasts, the
  /// Calls tab says the bank isn't calling.
  CallRecord? get unverifiedCall => _callLog
      .where((r) => r.unverified && (r.outcome == CallOutcome.active || (r.outcome == CallOutcome.ringing && _now().difference(r.at) < unverifiedRingsFor)))
      .firstOrNull;

  final http.Client _http;
  final http.Client Function() _apiHttp;
  final PushService push;

  final openCallsTab = ValueNotifier<int>(0);

  final openAlerts = ValueNotifier<int>(0);

  final arrivedAlert = ValueNotifier<({String bank, String id})?>(null);

  /// Goes up when a message reaches the demo inbox, so the Check screen reloads it at once.
  final inboxChanged = ValueNotifier<int>(0);

  /// A message or payment receipt that arrived while the app was open: the Home screen shows a banner for it.
  final arrivedMessage = ValueNotifier<ArrivedNotice?>(null);

  /// The inbox message to open on the Check screen, set by a tapped notification. The screen clears it once shown.
  final openMessage = ValueNotifier<String?>(null);

  /// The payment receipt to check, set by a tapped payment alert. The Home screen clears it once opened.
  final openReceipt = ValueNotifier<ReceiptPrefill?>(null);

  /// Opens what a demo notice points at: the message on the Check screen, or the receipt check.
  void openArrived(ArrivedNotice n) {
    arrivedMessage.value = null;
    if (n.receipt != null) {
      openReceipt.value = n.receipt;
    } else {
      openMessage.value = n.id;
    }
  }

  /// The client of the organisation a notice is from, else the selected one.
  GaskiyaClient? clientFor(String? orgId) => (_links.where((l) => l.id == orgId).firstOrNull ?? selected)?.client;
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
        if (b.kind != 'bank' || _links.any((l) => l.id == b.id)) continue;
        _links.add(_newLink(b, j['phone'] as String));
      }
    }
    _selectedId = _prefs!.getString(_selectedKey);
    final log = _prefs!.getString(_callLogKey);
    if (log != null) {
      try {
        _callLog.addAll((jsonDecode(log) as List).map((e) => CallRecord.fromJson(e as Map<String, dynamic>)));
        for (final r in _callLog.where((r) => r.outcome == CallOutcome.active)) {
          r.outcome = CallOutcome.answered;
        }
        // An unverified call has no session to settle it: one still "ringing" from before is over.
        for (final r in _callLog.where((r) => r.unverified && r.outcome == CallOutcome.ringing)) {
          r.outcome = CallOutcome.missed;
        }
      } catch (_) {}
    }
    _native ??= NativeCalls.instance.events.listen(handleNativeCall);
    unawaited(NativeCalls.instance.sendConfig(Config.apiUrl));
    for (final l in _links) {
      unawaited(l._refreshToken().then((_) => _listen(l)).catchError((_) {}));
    }
    if (_links.isNotEmpty) {
      unawaited(_startPush());
      unawaited(_rediscover());
    }
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
    await adopt([l]);
  }

  /// Asks every organisation on the registry whether it knows this number. Each
  /// one decides through its own customer-token endpoint; those that issue a
  /// token come back as links that are not yet saved.
  Future<List<BankLink>> discover(String e164) async {
    // Only banks are linked.
    final banks = (await loadBanks()).where((b) => b.kind == 'bank');
    final found = await Future.wait(banks.map((b) async {
      final l = _newLink(b, e164);
      try {
        await l._refreshToken();
        return l;
      } catch (_) {
        l._close();
        return null;
      }
    }));
    return found.whereType<BankLink>().toList();
  }

  void discard(List<BankLink> found) {
    for (final l in found) {
      if (!_links.contains(l)) l._close();
    }
  }

  Future<void> adopt(List<BankLink> found) async {
    if (found.isEmpty) return;
    for (final l in found) {
      final i = _links.indexWhere((x) => x.id == l.id);
      if (i >= 0) {
        _links[i]._close();
        _links[i] = l;
      } else {
        _links.add(l);
      }
    }
    _selectedId = found.first.id;
    await _save();
    for (final l in found) {
      _listen(l);
    }
    unawaited(_startPush());
    _notify();
  }

  Future<void> _rediscover() async {
    final phone = this.phone;
    if (phone == null) return;
    try {
      final found = await discover(phone);
      final fresh = found.where((l) => !_links.any((x) => x.id == l.id)).toList();
      discard(found.where((l) => !fresh.contains(l)).toList());
      if (fresh.isEmpty || _disposed || this.phone != phone) {
        discard(fresh);
        return;
      }
      _links.addAll(fresh);
      await _save();
      for (final l in fresh) {
        _listen(l);
      }
      unawaited(_startPush());
      _notify();
    } catch (_) {}
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
      } else if (!const {'message.received', 'transfer.received', 'transfer.sent'}.contains(data['type'])) {
        openCallsTab.value++;
      }
    });
  }

  static bool _isAdvisory(Map<String, dynamic> data) => (data['type'] as String? ?? '').startsWith('advisory.');

  void handleNotice(Map<String, dynamic> data, [BankLink? from, bool opened = false]) {
    final type = data['type'];
    if (type == 'message.received' || type == 'transfer.received') {
      if (type == 'message.received') inboxChanged.value++;
      final n = ArrivedNotice.fromData(data);
      if (n == null) return;
      if (opened) {
        openArrived(n);
      } else {
        arrivedMessage.value = n;
      }
      return;
    }
    if (type == 'transfer.sent') return;
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
    } else if (type == 'call.unverified') {
      _ringUnverified(data, from);
    } else if (type == 'call.closed') {
      // The agent hung up, or the customer did on another device: the call ends here too.
      final id = data['callId'];
      if (id is String) {
        unawaited(NativeCalls.instance.endCall(id));
        _settle(id, declined: data['endedBy'] == 'customer');
      }
      for (final l in from == null ? _links : [from]) {
        if (l.liveCalls.isEmpty) continue;
        final left = id == null ? const <CallSession>[] : l.liveCalls.where((c) => c.id != id).toList();
        if (left.length != l.liveCalls.length) _setCalls(l, left);
      }
    }
  }

  // The demo's fraud call: it rings the phone's call screen with the name it shows and no code, and the
  // registry is checked again, so the Calls tab says the bank isn't calling. It is never a call session.
  void _ringUnverified(Map<String, dynamic> data, BankLink? from) {
    final id = data['callId'];
    if (id is! String || id.isEmpty) return;
    final l = from ?? _linkNamed(data['bank'] as String?);
    final caller = (data['caller'] as String?)?.trim() ?? '';
    final name = caller.isNotEmpty ? caller : l?.bank.name ?? data['bank'] as String? ?? '';
    final expiresAt = DateTime.tryParse(data['expiresAt'] as String? ?? '') ?? _now().add(const Duration(minutes: 1));
    _logCall(id: id, orgId: l?.id ?? '', bank: name, code: '', unverified: true);
    if (_rung.add(id)) {
      final token = data['token'];
      unawaited(NativeCalls.instance.ring(
        callId: id,
        orgId: l?.id ?? '',
        bank: name,
        code: '',
        expiresAt: expiresAt,
        token: token is String && token.isNotEmpty ? token : null,
        apiUrl: Config.apiUrl,
        unverified: true,
      ));
    }
    unawaited(refreshCall());
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

  void _setCalls(BankLink l, List<CallSession> calls, {DateTime? asOf}) {
    if (l._closed || _disposed) return;
    l._expiry?.cancel();
    final now = DateTime.now();
    final before = l.liveCalls;
    l.liveCalls = calls.where((c) => c.expiresAt.isAfter(now)).toList();
    final live = l.liveCalls.map((c) => c.id).toSet();
    for (final c in before) {
      if (!live.contains(c.id) && !c.expiresAt.isAfter(now)) _settle(c.id, ringingOnly: true);
    }
    if (asOf != null) {
      // The registry no longer has it open: the agent hung up, so the phone's call ends too.
      for (final r in _callLog.where((r) => r.orgId == l.id && !r.unverified && !r.settled && !live.contains(r.id) && r.at.isBefore(asOf)).toList()) {
        unawaited(NativeCalls.instance.endCall(r.id));
        _settle(r.id);
      }
    }
    for (final c in l.liveCalls) {
      if (c.code.isNotEmpty) _logCall(id: c.id, orgId: l.id, bank: l.bank.name, code: c.code, purpose: c.purpose);
    }
    // Ring only the newest of calls that arrive together.
    final fresh = [for (final c in l.liveCalls) if (c.status == 'open' && c.code.isNotEmpty && _rung.add(c.id)) c];
    if (fresh.isNotEmpty) {
      final c = fresh.first;
      unawaited(NativeCalls.instance.ring(callId: c.id, orgId: l.bank.id, bank: l.bank.name, code: c.code, expiresAt: c.expiresAt, token: c.token, apiUrl: Config.apiUrl));
    }
    if (l.liveCalls.isNotEmpty) {
      final next = l.liveCalls.map((c) => c.expiresAt).reduce((a, b) => a.isBefore(b) ? a : b);
      l._expiry = Timer(next.difference(now), () => _setCalls(l, l.liveCalls));
    }
    _notify();
  }

  Future<void> _refreshCall(BankLink l) => l._checking ??= () async {
        try {
          final asked = _now();
          final s = await l.client.openCall();
          if (l._closed || _disposed) return;
          _answered(l, !s.cannotCheck);
          _setCalls(l, s.calling ? s.calls : const [], asOf: s.cannotCheck ? null : asked);
        } finally {
          l._checking = null;
        }
      }();

  CallRecord _logCall({required String id, required String orgId, required String bank, required String code, String? purpose, DateTime? at, bool unverified = false}) {
    final known = _callLog.where((r) => r.id == id).firstOrNull;
    if (known != null) {
      if (purpose != null && known.purpose == null) {
        known.purpose = purpose;
        unawaited(_saveCallLog());
      }
      return known;
    }
    final r = CallRecord(id: id, orgId: orgId, bank: bank, code: unverified ? '' : code, purpose: purpose, at: at ?? _now(), unverified: unverified);
    _callLog.insert(0, r);
    if (_callLog.length > _callLogMax) _callLog.removeRange(_callLogMax, _callLog.length);
    unawaited(_saveCallLog());
    _notify();
    return r;
  }

  void _settle(String id, {bool ringingOnly = false, bool declined = false}) {
    final r = _callLog.where((r) => r.id == id).firstOrNull;
    if (r == null || r.settled || (ringingOnly && r.outcome == CallOutcome.active)) return;
    if (r.outcome == CallOutcome.active) {
      r
        ..outcome = CallOutcome.answered
        ..endedAt = _now();
    } else {
      r.outcome = declined ? CallOutcome.declined : CallOutcome.missed;
    }
    unawaited(_saveCallLog());
    _notify();
  }

  Future<void> _saveCallLog() async => _prefs?.setString(_callLogKey, jsonEncode(_callLog.map((r) => r.toJson()).toList()));

  /// The person answered on the phone's call screen.
  void answerCall(String id, [DateTime? at]) {
    final r = _callLog.where((r) => r.id == id).firstOrNull;
    if (r == null || r.settled) return;
    for (final other in _callLog.where((o) => o.id != id && o.outcome == CallOutcome.active).toList()) {
      unawaited(NativeCalls.instance.endCall(other.id));
      _settle(other.id);
    }
    r
      ..outcome = CallOutcome.active
      ..answeredAt = at ?? _now();
    unawaited(_saveCallLog());
    _notify();
  }

  /// The person ended the call from the app's in-call screen.
  void hangUp([String? id]) {
    final r = id == null ? activeCall : _callLog.where((r) => r.id == id).firstOrNull;
    if (r == null) return;
    unawaited(NativeCalls.instance.endCall(r.id));
    _settle(r.id, declined: true);
    unawaited(_linkOf(r.orgId)?.client.endCall(r.id));
  }

  BankLink? _linkOf(String orgId) => _links.where((l) => l.id == orgId).firstOrNull;

  void handleNativeCall(Map<String, dynamic> e) {
    final id = e['callId'];
    if (id is! String || id.isEmpty) return;
    final orgId = e['orgId'] as String? ?? '';
    final l = _links.where((l) => l.id == orgId).firstOrNull;
    final ms = e['at'];
    final at = ms is int ? DateTime.fromMillisecondsSinceEpoch(ms) : null;
    final unverified = e['kind'] == 'unverified';
    final shown = e['bank'] as String? ?? '';
    _logCall(id: id, orgId: orgId, bank: unverified && shown.isNotEmpty ? shown : l?.bank.name ?? shown, code: e['code'] as String? ?? '', at: at, unverified: unverified);
    // The phone has told the registry already when it could; the app says it again, which the registry ignores
    // if it heard. Then the agent's side ends with this one.
    switch (e['event']) {
      case 'answered':
        answerCall(id, at);
        if (l != null) unawaited(l.client.answerCall(id));
      case 'ended':
        _settle(id, declined: true);
        if (l != null) unawaited(l.client.endCall(id));
      case 'missed':
        _settle(id, ringingOnly: true);
      case 'closed':
        // The agent hung up while the call rang or was on.
        _settle(id);
    }
  }

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
    final all = await Future.wait(_links.map(_inboxOf));
    return all.expand((x) => x).toList()..sort((a, b) => b.at.compareTo(a.at));
  }

  Future<List<InboxMessage>> _inboxOf(BankLink l) async {
    final url = l.bank.demoInboxUrl;
    if (url == null) return [];
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
    _native?.cancel();
    stopCallPolling();
    for (final l in _links) {
      l._close();
    }
    super.dispose();
  }
}
