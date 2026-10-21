import 'dart:convert';

import '../core/api.dart';
import '../core/text_tools.dart';

enum ShieldTone { safe, warn, danger }

enum ShieldKind { overlay, notification }

class ShieldText {
  const ShieldText(this.key, [this.params = const {}, this.orgKind]);
  final String key;
  final Map<String, Object?> params;
  final String? orgKind;

  @override
  String toString() => '$key$params';
}

class ShieldNotice {
  const ShieldNotice._(this.kind, this.tone, this.title, this.body);

  final ShieldKind kind;
  final ShieldTone tone;
  final ShieldText title;
  final List<ShieldText> body;

  static const confirmingTitles = {'shield.call.really.title', 'verdict.confirmed.title'};

  bool get confirms => confirmingTitles.contains(title.key);

  @override
  String toString() => 'ShieldNotice(${title.key}, $tone, $body)';
}

class ShieldBank {
  const ShieldBank({required this.id, required this.name, this.kind = 'bank', this.contacts, this.domains = const []});
  final String id;
  final String name;
  final String kind;
  final OfficialContacts? contacts;

  final List<String> domains;

  Set<String> get officialPhones => {for (final p in contacts?.phones ?? const <String>[]) ?normaliseNumber(p)};
}

String? normaliseNumber(String raw) {
  final t = raw.trim().replaceFirst(RegExp(r'^tel:', caseSensitive: false), '');
  var d = t.replaceAll(RegExp(r'[^\d+]'), '');
  if (d.startsWith('00')) d = '+${d.substring(2)}';
  return normalisePhone(d);
}

String _squash(String s) => s.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

bool _hasWord(String text, String word) {
  final w = word.trim();
  if (w.length < 3) return false;
  return RegExp('(?<![A-Za-z0-9])${RegExp.escape(w)}(?![A-Za-z0-9])', caseSensitive: false).hasMatch(text);
}

bool looksLikeBankMessage(String sender, String text, ShieldBank bank) {
  final s = _squash(sender);
  final name = _squash(bank.name);
  final ids = {for (final id in bank.contacts?.senderIds ?? const <String>[]) _squash(id)}..remove('');
  if (s.isNotEmpty) {
    if (ids.contains(s) || s == name) return true;
    if (name.length >= 4 && s.contains(name)) return true;
    final number = normaliseNumber(sender);
    if (number != null && bank.officialPhones.contains(number)) return true;
  }
  if (_hasWord(text, bank.name)) return true;
  for (final id in bank.contacts?.senderIds ?? const <String>[]) {
    if (_hasWord(text, id)) return true;
  }
  final hosts = {...bank.domains, ...?bank.contacts?.domains}.map((d) => d.toLowerCase());
  for (final link in extractLinks(text)) {
    final h = linkDomain(link);
    if (h != null && hosts.any((d) => h == d || h.endsWith('.$d'))) return true;
  }
  return false;
}

final _creditWord = RegExp(r'(?<![A-Za-z])(credit(ed)?|cr)(?![A-Za-z])', caseSensitive: false);
final _amount = RegExp(r'((NGN|N|\u20A6)\s?\d[\d,]*(\.\d{1,2})?)|((?<![\d,])\d{1,3}(,\d{3})+(\.\d{2})?)|((?<![\d.])\d+\.\d{2}(?![\d]))', caseSensitive: false);

bool isCreditAlert(String text) => _creditWord.hasMatch(text) && _amount.hasMatch(text);

final _codeWord = RegExp(r'(?<![A-Za-z])(otp|one[\s-]?time|passcode|verification|token|code)(?![A-Za-z])', caseSensitive: false);
final _codeDigits = RegExp(r'(?<![\d,.])\d{4,8}(?![\d,]|\.\d)');

bool isOneTimeCode(String text) => _codeWord.hasMatch(text) && _codeDigits.hasMatch(text);

const _linkTlds = {
  'com', 'ng', 'net', 'org', 'info', 'biz', 'xyz', 'link', 'top', 'site', 'online', 'app', 'io', 'co', 'me', 'ly', 'ru', 'cc',
  'live', 'click', 'shop', 'store', 'bank', 'africa', 'vip', 'icu', 'cn', 'tk', 'ml', 'ga', 'cf', 'gq', 'page', 'dev', 'support', 'help',
  'website', 'cloud', 'web', 'world', 'today', 'tech', 'pro', 'finance', 'money', 'pw', 'su', 'ws', 'uk', 'us', 'gov', 'edu',
};

List<String> extractLinks(String text) {
  final out = <String>[];
  for (final m in RegExp(r'(https?://[^\s<>"]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s<>"]*)?)', caseSensitive: false).allMatches(text)) {
    var link = m[0]!.replaceFirst(RegExp(r'[.,;:!?)\]]+$'), '');
    final host = linkDomain(link);
    if (host == null) continue;
    final explicit = RegExp(r'^(https?://|www\.)', caseSensitive: false).hasMatch(link);
    if (!explicit && !_linkTlds.contains(host.split('.').last)) continue;
    if (!out.contains(link)) out.add(link);
  }
  return out;
}

String? linkDomain(String link) {
  final uri = Uri.tryParse(RegExp(r'^https?://', caseSensitive: false).hasMatch(link) ? link : 'https://$link');
  final host = uri?.host.toLowerCase();
  if (host == null || host.isEmpty || !host.contains('.')) return null;
  return host.replaceFirst(RegExp(r'^www\.'), '');
}

List<String> extractNumbers(String text) => {for (final n in extractPhoneNumbers(text)) ?normaliseNumber(n)}.toList();

typedef CallCheck = ({ShieldBank bank, CallStatus status});

ShieldNotice? decideIncomingCall({required String number, required List<CallCheck> checks}) {
  for (final c in checks) {
    final s = c.status;
    final calls = s.calls.where((x) => x.code.isNotEmpty).toList();
    if (s.calling && !s.cannotCheck && calls.isNotEmpty) {
      return ShieldNotice._(ShieldKind.overlay, ShieldTone.safe, ShieldText('shield.call.really.title', {'bank': c.bank.name}), [
        ShieldText('shield.call.really.body', {'bank': c.bank.name, 'code': calls.map((x) => x.code).join(' / ')}),
      ]);
    }
  }
  final n = normaliseNumber(number);
  if (n == null) return null;
  for (final c in checks) {
    if (!c.bank.officialPhones.contains(n)) continue;
    final name = {'bank': c.bank.name};
    if (c.status.cannotCheck) {
      return ShieldNotice._(ShieldKind.overlay, ShieldTone.warn, const ShieldText('shield.call.cannotCheck.title'), [ShieldText('shield.call.cannotCheck.body', name)]);
    }
    return ShieldNotice._(ShieldKind.overlay, ShieldTone.danger, ShieldText('shield.call.notCalling.title', name), [ShieldText('shield.call.notCalling.body', name)]);
  }
  return null;
}

class MessagePlan {
  const MessagePlan({required this.banks, required this.creditAlert, required this.oneTimeCode, required this.links, required this.domains, required this.phones});

  final List<ShieldBank> banks;
  final bool creditAlert;
  final bool oneTimeCode;
  final List<String> links;
  final List<String> domains;

  final List<String> phones;

  bool get bankLooking => banks.isNotEmpty;

  bool get check => bankLooking || creditAlert;
}

final _hostName = RegExp(r'^([a-z0-9-]{1,63}\.)+[a-z]{2,63}$');

MessagePlan planMessage({required String sender, required String text, required List<ShieldBank> banks}) {
  final links = extractLinks(text);
  return MessagePlan(
    banks: banks.where((b) => looksLikeBankMessage(sender, text, b)).toList(),
    creditAlert: isCreditAlert(text),
    oneTimeCode: isOneTimeCode(text),
    links: links,
    domains: {for (final l in links) ?linkDomain(l)}.where(_hostName.hasMatch).take(10).toList(),
    phones: extractNumbers(text).take(10).toList(),
  );
}

List<ShieldBank> verifyTargets(MessagePlan plan, List<ShieldBank> linked) => plan.bankLooking ? plan.banks : (plan.creditAlert ? linked : const []);

VerifyResult combineVerdicts(List<VerifyResult> results) {
  for (final r in results) {
    if (r.verdict == Verdict.confirmed) return r;
  }
  if (results.isEmpty || results.any((r) => r.verdict == Verdict.cannotCheck)) return VerifyResult.unavailable();
  return results.first;
}

List<String>? unofficialNumbers(MessagePlan plan, ShieldBank? bank, List<ShieldBank> linked) {
  final lists = bank != null ? [bank] : linked;
  if (lists.isEmpty || lists.any((b) => b.contacts == null)) return null;
  final official = {for (final b in lists) ...b.officialPhones};
  return plan.phones.where((p) => !official.contains(p)).toList();
}

List<String> unofficialLinks(Map<String, LinkResult?> results) =>
    [for (final e in results.entries) if (e.value != null && !e.value!.belongs && !e.value!.officialApp) e.key];

List<ShieldNotice> decideMessageNotices({
  required MessagePlan plan,
  required VerifyResult verdict,
  required String bankName,
  String? bankKind,
  List<String> unofficialLinks = const [],
  List<String>? unofficialNumbers,
  IndicatorResult? indicators,
}) {
  if (!plan.check) return const [];
  if (verdict.verdict == Verdict.confirmed) {
    final name = verdict.bank ?? bankName;
    return [
      ShieldNotice._(ShieldKind.notification, ShieldTone.safe, ShieldText('verdict.confirmed.title', {'bank': name}, bankKind), const [ShieldText('shield.message.open')]),
    ];
  }
  final bank = {'bank': bankName};
  final out = <ShieldNotice>[];
  if (plan.creditAlert && verdict.verdict == Verdict.notConfirmed) {
    out.add(ShieldNotice._(ShieldKind.notification, ShieldTone.danger, const ShieldText('shield.creditAlert.title'), [ShieldText('shield.creditAlert.body', bank)]));
  } else {
    final title = verdict.verdict == Verdict.notConfirmed ? 'verdict.not_confirmed.title' : 'verdict.cannot_check.title';
    out.add(ShieldNotice._(ShieldKind.notification, ShieldTone.warn, ShieldText(title, bank, bankKind),
        const [ShieldText('shield.message.notConfirmedBody'), ShieldText('shield.message.open')]));
  }
  final matches = indicators?.matches ?? const <IndicatorMatch>[];
  if (matches.isNotEmpty) {
    final count = matches.map((m) => m.reports).reduce((a, b) => a > b ? a : b);
    out.add(ShieldNotice._(ShieldKind.notification, ShieldTone.danger, const ShieldText('shield.campaign.title'), [ShieldText('shield.campaign.body', {'count': count})]));
  }
  for (final _ in unofficialLinks.take(2)) {
    out.add(ShieldNotice._(ShieldKind.notification, ShieldTone.danger, ShieldText('shield.link.title', bank), const [ShieldText('shield.link.body')]));
  }
  for (final n in (unofficialNumbers ?? const <String>[]).take(2)) {
    out.add(ShieldNotice._(ShieldKind.notification, ShieldTone.danger, ShieldText('shield.number.title', bank), [ShieldText('shield.number.body', {...bank, 'number': n})]));
  }
  return out;
}

ShieldNotice? decideOneTimeCode({required bool oneTimeCode, required bool inCall, required List<CallStatus> calls}) {
  if (!oneTimeCode || !inCall) return null;
  final announced = calls.any((s) => s.calling && !s.cannotCheck && s.calls.isNotEmpty);
  if (announced) return null;
  return const ShieldNotice._(ShieldKind.overlay, ShieldTone.danger, ShieldText('shield.otp.title'), [ShieldText('shield.otp.body')]);
}

class FlaggedNumber {
  const FlaggedNumber({required this.number, required this.bankId, required this.source, required this.at});
  factory FlaggedNumber.fromJson(Map<String, dynamic> j) =>
      FlaggedNumber(number: j['n'] as String, bankId: j['b'] as String?, source: j['s'] as String, at: DateTime.fromMillisecondsSinceEpoch(j['t'] as int, isUtc: true));
  final String number;
  final String? bankId;
  final String source;
  final DateTime at;
  Map<String, dynamic> toJson() => {'n': number, 'b': bankId, 's': source, 't': at.millisecondsSinceEpoch};
}

class FlaggedNumbers {
  FlaggedNumbers([List<FlaggedNumber> entries = const []]) : _entries = [...entries];

  static const keepFor = Duration(days: 7);
  static const maxEntries = 200;

  final List<FlaggedNumber> _entries;

  List<FlaggedNumber> get entries => List.unmodifiable(_entries);

  factory FlaggedNumbers.decode(String? raw) {
    if (raw == null) return FlaggedNumbers();
    try {
      return FlaggedNumbers((jsonDecode(raw) as List).map((e) => FlaggedNumber.fromJson(e as Map<String, dynamic>)).toList());
    } catch (_) {
      return FlaggedNumbers();
    }
  }

  String encode() => jsonEncode(_entries.map((e) => e.toJson()).toList());

  void prune(DateTime now) => _entries.removeWhere((e) => now.difference(e.at) >= keepFor);

  void add(String number, {required String? bankId, required String source, required DateTime now}) {
    final n = normaliseNumber(number);
    if (n == null) return;
    final old = _entries.where((e) => e.number == n).firstOrNull;
    _entries.removeWhere((e) => e.number == n);
    final src = old?.source == 'campaign' ? 'campaign' : source;
    _entries.add(FlaggedNumber(number: n, bankId: bankId ?? old?.bankId, source: src, at: now));
    if (_entries.length > maxEntries) _entries.removeRange(0, _entries.length - maxEntries);
  }

  FlaggedNumber? lookup(String number, DateTime now) {
    final n = normaliseNumber(number);
    if (n == null) return null;
    return _entries.where((e) => e.number == n && now.difference(e.at) < keepFor).firstOrNull;
  }
}

ShieldNotice? decideOutgoingCall({required String number, required FlaggedNumbers flagged, required DateTime now, required List<ShieldBank> banks, required String yourBank}) {
  final hit = flagged.lookup(number, now);
  if (hit == null) return null;
  final bank = banks.where((b) => b.id == hit.bankId).firstOrNull ?? (banks.length == 1 ? banks.single : null);
  final name = bank?.name ?? yourBank;
  final official = bank?.contacts?.phones.firstOrNull;
  final body = hit.source == 'message' && official != null
      ? ShieldText('shield.dialled.body', {'bank': name, 'number': hit.number, 'official': official})
      : ShieldText('shield.dialled.reportedBody', {'bank': name, 'number': hit.number});
  return ShieldNotice._(ShieldKind.overlay, ShieldTone.danger, ShieldText('shield.dialled.title', {'bank': name}), [body]);
}
