import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api.dart';
import '../core/config.dart';
import '../core/copy.dart';
import 'shield_logic.dart';

abstract class ShieldHost {
  Future<void> showOverlay({required String title, required String body, required ShieldTone tone, required String close, required String channelName});
  Future<void> notify({required int id, required String title, required String body, required ShieldTone tone, required String channelName});
}

class MethodChannelShieldHost implements ShieldHost {
  MethodChannelShieldHost(this.channel);
  final MethodChannel channel;

  @override
  Future<void> showOverlay({required String title, required String body, required ShieldTone tone, required String close, required String channelName}) =>
      channel.invokeMethod('showOverlay', {'title': title, 'body': body, 'tone': tone.name, 'close': close, 'channelName': channelName});

  @override
  Future<void> notify({required int id, required String title, required String body, required ShieldTone tone, required String channelName}) =>
      channel.invokeMethod('notify', {'id': id, 'title': title, 'body': body, 'tone': tone.name, 'channelName': channelName});
}

class _Link {
  _Link(this.bank, this.phone, this._http, http.Client api) {
    client = GaskiyaClient(baseUrl: Config.apiUrl, token: token, renewToken: renew, httpClient: api);
  }
  final Bank bank;
  final String phone;
  final http.Client _http;
  late final GaskiyaClient client;
  String? _token;
  DateTime _expiry = DateTime.fromMillisecondsSinceEpoch(0);
  Future<String>? _renewing;

  String get key => '${bank.id}|$phone|${bank.customerTokenUrl}';

  Future<String> token() async => _token != null && DateTime.now().isBefore(_expiry) ? _token! : renew();

  Future<String> renew() {
    _token = null;
    return _renewing ??= () async {
      try {
        final res = await _http
            .post(Uri.parse(bank.customerTokenUrl), headers: {'content-type': 'application/json'}, body: jsonEncode({'phone': phone}))
            .timeout(const Duration(seconds: 8));
        if (res.statusCode != 200) throw ApiException(res.statusCode, 'link_failed', 'Could not link to the bank');
        final j = jsonDecode(res.body) as Map<String, dynamic>;
        _token = j['token'] as String;
        _expiry = DateTime.now().add(Duration(seconds: (j['expiresIn'] as int) - 60));
        return _token!;
      } finally {
        _renewing = null;
      }
    }();
  }
}

class ShieldRuntime {
  ShieldRuntime({required this.host, http.Client? httpClient, http.Client Function()? apiHttp, DateTime Function()? clock})
      : _http = httpClient ?? http.Client(),
        _apiHttp = apiHttp ?? http.Client.new,
        _now = clock ?? DateTime.now;

  final ShieldHost host;
  final http.Client _http;
  final http.Client Function() _apiHttp;
  final DateTime Function() _now;

  static const channelName = 'ng.gaskiya/shield';
  static const contactsKey = 'shield.contacts';
  static const flaggedKey = 'shield.flagged';

  static const contactsFreshFor = Duration(hours: 6);

  static const retryAfter = Duration(minutes: 10);

  static const dedupeFor = Duration(minutes: 10);

  final Map<String, _Link> _links = {};
  final Map<String, DateTime> _seen = {};
  final Map<String, DateTime> _lastAttempt = {};
  int _nextId = 0;

  static Future<ShieldRuntime> start() async {
    const channel = MethodChannel(channelName);
    final runtime = ShieldRuntime(host: MethodChannelShieldHost(channel));
    if (!Copy.loaded) await Copy.load();
    channel.setMethodCallHandler(runtime.handle);
    await channel.invokeMethod('ready');
    return runtime;
  }

  Future<Object?> handle(MethodCall call) async {
    final a = (call.arguments as Map?)?.cast<String, Object?>() ?? const {};
    try {
      switch (call.method) {
        case 'onIncomingCall':
          await onIncomingCall(a['number'] as String? ?? '');
        case 'onOutgoingCall':
          await onOutgoingCall(a['number'] as String? ?? '');
        case 'onMessage':
          await onMessage(sender: a['sender'] as String? ?? '', text: a['text'] as String? ?? '', inCall: a['inCall'] == true);
      }
    } catch (_) {
    }
    return null;
  }

  Future<SharedPreferences> _prefs() async {
    final p = await SharedPreferences.getInstance();
    await p.reload();
    return p;
  }

  Future<List<_Link>> _load(SharedPreferences p) async {
    final lang = p.getString('language');
    if (Copy.loaded) Copy.I.language = lang;
    final raw = p.getString('links');
    final out = <_Link>[];
    if (raw == null) return out;
    try {
      for (final e in jsonDecode(raw) as List) {
        final j = e as Map<String, dynamic>;
        final b = Bank.fromJson(j['bank'] as Map<String, dynamic>, Config.apiUrl);
        final l = _Link(b, j['phone'] as String, _http, _apiHttp());
        final kept = _links[l.key];
        if (kept != null) {
          l.client.close();
          out.add(kept);
        } else {
          _links[l.key] = l;
          out.add(l);
        }
      }
    } catch (_) {}
    return out;
  }

  Map<String, dynamic> _contactsCache(SharedPreferences p) {
    try {
      return (jsonDecode(p.getString(contactsKey) ?? '{}') as Map<String, dynamic>);
    } catch (_) {
      return {};
    }
  }

  Future<OfficialContacts?> _contacts(SharedPreferences p, _Link l) async {
    final cache = _contactsCache(p);
    final entry = cache[l.bank.id] as Map<String, dynamic>?;
    OfficialContacts? cached;
    DateTime? at;
    try {
      if (entry != null) {
        cached = OfficialContacts.fromJson(entry['contacts'] as Map<String, dynamic>);
        at = DateTime.fromMillisecondsSinceEpoch(entry['at'] as int);
      }
    } catch (_) {
      cached = null;
    }
    final now = _now();
    if (cached != null && at != null && now.difference(at) < contactsFreshFor) return cached;
    final tried = _lastAttempt[l.bank.id];
    if (tried != null && now.difference(tried) < retryAfter) return cached;
    _lastAttempt[l.bank.id] = now;
    final fresh = await l.client.officialContacts();
    if (fresh == null) return cached;
    cache[l.bank.id] = {'at': now.millisecondsSinceEpoch, 'contacts': fresh.toJson()};
    await p.setString(contactsKey, jsonEncode(cache));
    return fresh;
  }

  Future<List<(_Link, ShieldBank)>> _banks(SharedPreferences p, List<_Link> links) => Future.wait(links.map((l) async {
        final c = await _contacts(p, l);
        return (l, ShieldBank(id: l.bank.id, name: l.bank.name, kind: l.bank.kind, contacts: c, domains: l.bank.domains));
      }));

  String get _yourBank => Copy.I.t('app.common.yourBank');

  Future<void> _show(List<ShieldNotice> notices) async {
    final c = Copy.I;
    String text(ShieldText t) => t.orgKind == null ? c.t(t.key, t.params) : c.tOrg(t.key, t.orgKind, t.params);
    for (final n in notices) {
      final title = text(n.title);
      final body = n.body.map(text).join(' ');
      if (n.kind == ShieldKind.overlay) {
        await host.showOverlay(title: title, body: body, tone: n.tone, close: c.t('shield.close'), channelName: c.t('shield.channelName'));
      } else {
        _nextId = (_nextId + 1) % 1000;
        await host.notify(id: 7000 + _nextId, title: title, body: body, tone: n.tone, channelName: c.t('shield.channelName'));
      }
    }
  }

  Future<ShieldNotice?> onIncomingCall(String number) async {
    final p = await _prefs();
    final links = await _load(p);
    if (links.isEmpty) return null;
    final banks = await _banks(p, links);
    final statuses = await Future.wait(banks.map((b) => b.$1.client.openCall()));
    final notice = decideIncomingCall(number: number, checks: [for (var i = 0; i < banks.length; i++) (bank: banks[i].$2, status: statuses[i])]);
    if (notice != null) await _show([notice]);
    return notice;
  }

  Future<ShieldNotice?> onOutgoingCall(String number) async {
    final p = await _prefs();
    final flagged = FlaggedNumbers.decode(p.getString(flaggedKey))..prune(_now());
    if (flagged.lookup(number, _now()) == null) return null;
    final links = await _load(p);
    final banks = await _banks(p, links);
    final notice = decideOutgoingCall(number: number, flagged: flagged, now: _now(), banks: banks.map((b) => b.$2).toList(), yourBank: _yourBank);
    if (notice != null) await _show([notice]);
    return notice;
  }

  Future<List<ShieldNotice>> onMessage({required String sender, required String text, required bool inCall}) async {
    if (text.trim().isEmpty) return const [];
    final now = _now();
    final digest = contentDigest(text);
    _seen.removeWhere((_, at) => now.difference(at) >= dedupeFor);
    if (_seen.containsKey(digest)) return const [];
    _seen[digest] = now;

    final p = await _prefs();
    final links = await _load(p);
    if (links.isEmpty) return const [];
    final banks = await _banks(p, links);
    final shieldBanks = banks.map((b) => b.$2).toList();
    final plan = planMessage(sender: sender, text: text, banks: shieldBanks);
    final shown = <ShieldNotice>[];

    if (plan.oneTimeCode && inCall) {
      final calls = await Future.wait(links.map((l) => l.client.openCall()));
      final alarm = decideOneTimeCode(oneTimeCode: true, inCall: true, calls: calls);
      if (alarm != null) {
        await _show([alarm]);
        shown.add(alarm);
      }
    }
    if (!plan.check) return shown;

    final targets = verifyTargets(plan, shieldBanks);
    final results = await Future.wait(targets.map((t) async {
      final l = banks.firstWhere((b) => b.$2.id == t.id).$1;
      try {
        return await l.client.verifyText(text);
      } catch (_) {
        return VerifyResult.unavailable();
      }
    }));
    final verdict = combineVerdicts(results);
    final target = plan.banks.firstOrNull ?? (shieldBanks.length == 1 ? shieldBanks.single : null);
    final bankName = target?.name ?? _yourBank;

    var badLinks = const <String>[];
    List<String>? badNumbers;
    IndicatorResult? indicators;
    if (verdict.verdict != Verdict.confirmed) {
      final client = (target == null ? banks.first.$1 : banks.firstWhere((b) => b.$2.id == target.id).$1).client;
      final linkChecks = <String, LinkResult?>{};
      await Future.wait(plan.links.take(3).map((u) async {
        try {
          linkChecks[u] = await client.verifyLink(u);
        } catch (_) {
          linkChecks[u] = null;
        }
      }));
      badLinks = unofficialLinks(linkChecks);
      badNumbers = unofficialNumbers(plan, target, shieldBanks);
      if (plan.domains.isNotEmpty || plan.phones.isNotEmpty) {
        indicators = await client.verifyIndicators(domains: plan.domains, phones: plan.phones);
      }
      final flagged = FlaggedNumbers.decode(p.getString(flaggedKey))..prune(now);
      for (final n in badNumbers ?? const <String>[]) {
        flagged.add(n, bankId: target?.id, source: 'message', now: now);
      }
      for (final m in indicators?.matches ?? const <IndicatorMatch>[]) {
        if (m.kind == 'phone') flagged.add(m.value, bankId: target?.id, source: 'campaign', now: now);
      }
      await p.setString(flaggedKey, flagged.encode());
    }

    final notices = decideMessageNotices(
      plan: plan,
      verdict: verdict,
      bankName: bankName,
      bankKind: target?.kind,
      unofficialLinks: badLinks,
      unofficialNumbers: badNumbers,
      indicators: indicators,
    );
    await _show(notices);
    return [...shown, ...notices];
  }
}
