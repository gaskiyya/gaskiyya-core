import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:http/http.dart' as http;

import 'text_tools.dart';

class ActivityItem {
  ActivityItem({required this.category, required this.channel, required this.count, required this.anyWithLink});
  factory ActivityItem.fromJson(Map<String, dynamic> j) =>
      ActivityItem(category: j['category'] as String, channel: j['channel'] as String, count: j['count'] as int, anyWithLink: j['anyWithLink'] as bool);
  final String category;
  final String channel;
  final int count;
  final bool anyWithLink;
}

enum Verdict { confirmed, notConfirmed, cannotCheck }

class VerifyResult {
  VerifyResult({required this.verdict, this.bank, this.channel, this.category, this.sentAt, this.activity = const [], this.activityText, this.extractedText, this.warnings = const []});

  static const channels = {'sms', 'whatsapp', 'email', 'push'};

  factory VerifyResult.fromJson(Map<String, dynamic> j) {
    final v = switch (j['verdict']) { 'confirmed' => Verdict.confirmed, 'not_confirmed' => Verdict.notConfirmed, _ => Verdict.cannotCheck };
    if (v == Verdict.confirmed) {
      final sentAt = j['sentAt'] is String ? DateTime.tryParse(j['sentAt'] as String) : null;
      final channel = j['channel'];
      final category = j['category'];
      if (sentAt == null || channel is! String || !channels.contains(channel) || category is! String || category.isEmpty) return unavailable();
    }
    return VerifyResult(
      verdict: v,
      bank: j['bank'] as String?,
      channel: j['channel'] as String?,
      category: j['category'] as String?,
      sentAt: j['sentAt'] == null ? null : DateTime.parse(j['sentAt'] as String).toLocal(),
      activity: ((j['recentActivity'] as List?) ?? []).map((e) => ActivityItem.fromJson(e as Map<String, dynamic>)).toList(),
      activityText: j['activityText'] as String?,
      extractedText: j['extractedText'] as String?,
      warnings: ((j['warnings'] as List?) ?? []).whereType<String>().toList(),
    );
  }

  static VerifyResult unavailable() => VerifyResult(verdict: Verdict.cannotCheck);

  VerifyResult withExtractedText(String text) => VerifyResult(
      verdict: verdict, bank: bank, channel: channel, category: category, sentAt: sentAt, activity: activity, activityText: activityText, extractedText: text, warnings: warnings);

  final Verdict verdict;
  final String? bank;
  final String? channel;
  final String? category;
  final DateTime? sentAt;
  final List<ActivityItem> activity;
  final String? activityText;
  final String? extractedText;

  final List<String> warnings;

  static const simSwapWarnings = {'sim_swapped_recently', 'sim_status_unknown'};

  bool get simSwapped => warnings.contains('sim_swapped_recently');

  bool get simStatusUnknown => warnings.contains('sim_status_unknown');

  List<String> get senderWarnings => warnings.where((w) => !simSwapWarnings.contains(w)).toList();
}

class LinkResult {
  LinkResult({required this.belongs, required this.host, required this.matchedDomain, required this.reasons, required this.bank, this.officialApp = false, this.appStore, this.appId});

  factory LinkResult.fromJson(Map<String, dynamic> j) {
    final officialApp = j['verdict'] == 'official_app';
    final app = j['app'];
    if (officialApp && (app is! Map<String, dynamic> || app['official'] != true || app['store'] is! String)) {
      throw const FormatException('official_app without its app');
    }
    return LinkResult(
      belongs: j['verdict'] == 'belongs',
      officialApp: officialApp,
      appStore: app is Map<String, dynamic> ? app['store'] as String? : null,
      appId: app is Map<String, dynamic> ? app['id'] as String? : null,
      host: j['host'] as String?,
      matchedDomain: j['matchedDomain'] as String?,
      reasons: ((j['reasons'] as List?) ?? []).whereType<String>().toList(),
      bank: j['bank'] as String? ?? '',
    );
  }
  final bool belongs;

  final bool officialApp;

  final String? appStore;
  final String? appId;
  final String? host;
  final String? matchedDomain;
  final List<String> reasons;
  final String bank;
}

enum LicenceVerdict { licensed, notListed, cannotCheck }

class LicenceSource {
  LicenceSource({required this.regulator, required this.title, required this.url, required this.retrievedAt, required this.sample});
  factory LicenceSource.fromJson(Map<String, dynamic> j) => LicenceSource(
        regulator: j['regulator'] as String,
        title: j['title'] as String,
        url: j['url'] as String,
        retrievedAt: j['retrievedAt'] as String,
        sample: j['sample'] == true,
      );
  final String regulator;
  final String title;
  final String url;
  final String retrievedAt;
  final bool sample;
}

class LicensedFirm {
  LicensedFirm({required this.name, required this.regulator, required this.category, required this.status, required this.source});
  factory LicensedFirm.fromJson(Map<String, dynamic> j) => LicensedFirm(
        name: j['name'] as String,
        regulator: j['regulator'] as String,
        category: j['category'] as String,
        status: j['status'] as String?,
        source: LicenceSource.fromJson(j['source'] as Map<String, dynamic>),
      );
  final String name;
  final String regulator;
  final String category;
  final String? status;
  final LicenceSource source;
}

class LicenceResult {
  LicenceResult({required this.verdict, this.firm, this.similarTo, this.regulators = const [], this.sources = const []});

  factory LicenceResult.fromJson(Map<String, dynamic> j) {
    try {
      final regulators = ((j['regulators'] as List?) ?? [])
          .map((e) => (name: (e as Map<String, dynamic>)['name'] as String, url: e['url'] as String))
          .toList();
      switch (j['verdict']) {
        case 'licensed':
          return LicenceResult(verdict: LicenceVerdict.licensed, firm: LicensedFirm.fromJson(j['firm'] as Map<String, dynamic>), regulators: regulators);
        case 'not_listed':
          return LicenceResult(
            verdict: LicenceVerdict.notListed,
            similarTo: j['similarTo'] == null ? null : LicensedFirm.fromJson(j['similarTo'] as Map<String, dynamic>),
            regulators: regulators,
            sources: ((j['sources'] as List?) ?? []).map((e) => LicenceSource.fromJson(e as Map<String, dynamic>)).toList(),
          );
        case 'cannot_check':
          return LicenceResult(verdict: LicenceVerdict.cannotCheck, regulators: regulators);
      }
    } catch (_) {}
    return LicenceResult.unavailable();
  }

  static LicenceResult unavailable() => LicenceResult(verdict: LicenceVerdict.cannotCheck);

  final LicenceVerdict verdict;
  final LicensedFirm? firm;

  final LicensedFirm? similarTo;
  final List<({String name, String url})> regulators;
  final List<LicenceSource> sources;
}

class OrgRef {
  OrgRef({required this.id, required this.name, this.kind = 'bank', this.as = const [], this.platforms = const []});
  factory OrgRef.fromJson(Map<String, dynamic> j) => OrgRef(
        id: j['id'] as String,
        name: j['name'] as String,
        kind: j['kind'] as String? ?? 'bank',
        as: ((j['as'] as List?) ?? []).whereType<String>().toList(),
        platforms: ((j['platforms'] as List?) ?? []).whereType<String>().toList(),
      );
  final String id;
  final String name;

  final String kind;

  final List<String> as;

  final List<String> platforms;
}

enum ContactVerdict { official, notOfficial, cannotCheck, notAContact }

class ContactResult {
  ContactResult({required this.verdict, this.type, this.value, this.platform, this.matches = const [], this.organisation, this.reasons = const [], this.impersonates = const []});

  static const types = {'phone', 'whatsapp', 'email', 'social', 'handle'};

  factory ContactResult.fromJson(Map<String, dynamic> j) {
    try {
      final verdict = j['verdict'];
      if (verdict != 'official' && verdict != 'not_official') return unavailable();
      final contact = j['contact'];
      if (contact is! Map<String, dynamic>) return unavailable();
      final type = contact['type'];
      final value = contact['value'];
      if (type is! String || !types.contains(type) || value is! String || value.isEmpty) return unavailable();
      final platform = contact['platform'] as String?;
      if (verdict == 'official') {
        final matches = ((j['matches'] as List?) ?? []).map((e) => OrgRef.fromJson(e as Map<String, dynamic>)).toList();
        if (matches.isEmpty || matches.any((m) => m.as.isEmpty)) return unavailable();
        return ContactResult(verdict: ContactVerdict.official, type: type, value: value, platform: platform, matches: matches);
      }
      final org = j['organisation'];
      return ContactResult(
        verdict: ContactVerdict.notOfficial,
        type: type,
        value: value,
        platform: platform,
        organisation: org is Map<String, dynamic> ? OrgRef.fromJson(org) : null,
        reasons: ((j['reasons'] as List?) ?? []).whereType<String>().toList(),
        impersonates: ((j['impersonates'] as List?) ?? []).map((e) => OrgRef.fromJson(e as Map<String, dynamic>)).toList(),
      );
    } catch (_) {
      return unavailable();
    }
  }

  static ContactResult unavailable() => ContactResult(verdict: ContactVerdict.cannotCheck);
  static ContactResult notAContact() => ContactResult(verdict: ContactVerdict.notAContact);

  final ContactVerdict verdict;

  final String? type;

  final String? value;

  final String? platform;

  final List<OrgRef> matches;

  final OrgRef? organisation;
  final List<String> reasons;

  final List<OrgRef> impersonates;
}

class Explanation {
  Explanation({required this.indicators, required this.explanation, required this.action, required this.fromModel});
  factory Explanation.fromJson(Map<String, dynamic> j) => Explanation(
        indicators: ((j['indicators'] as List?) ?? []).cast<String>(),
        explanation: j['explanation'] as String,
        action: j['action'] as String,
        fromModel: j['source'] == 'model',
      );
  final List<String> indicators;
  final String explanation;
  final String action;
  final bool fromModel;
}

class CallSession {
  CallSession({required this.id, required this.purpose, required this.code, required this.status, required this.expiresAt, this.token});
  factory CallSession.fromJson(Map<String, dynamic> j) => CallSession(
        id: (j['id'] ?? j['callId']) as String,
        purpose: j['purpose'] as String,
        code: (j['code'] as String?) ?? '',
        status: (j['status'] as String?) ?? 'open',
        expiresAt: DateTime.parse(j['expiresAt'] as String),
        token: j['token'] is String && (j['token'] as String).isNotEmpty ? j['token'] as String : null,
      );
  final String id;
  final String purpose;
  final String code;
  final String status;
  final DateTime expiresAt;

  /// This call's own token: the phone's call screen answers and ends the call with it, even with the app closed.
  final String? token;
}

class CallStatus {
  CallStatus({required this.calling, required this.bank, this.call, this.calls = const [], this.cannotCheck = false});

  factory CallStatus.fromJson(Map<String, dynamic> j) {
    final bank = j['bank'] as String? ?? '';
    if (j['verdict'] == 'cannot_check') return CallStatus.unavailable(bank);
    try {
      if (j['calling'] == true) {
        final raw = (j['calls'] as List?) ?? [j['call']];
        final calls = raw.map((e) => CallSession.fromJson(e as Map<String, dynamic>)).toList();
        if (calls.isEmpty || calls.any((c) => c.code.isEmpty)) return CallStatus.unavailable(bank);
        return CallStatus(calling: true, bank: bank, call: calls.first, calls: calls);
      }
      if (j['calling'] == false) return CallStatus(calling: false, bank: bank);
    } catch (_) {}
    return CallStatus.unavailable(bank);
  }

  factory CallStatus.unavailable([String bank = '']) => CallStatus(calling: false, bank: bank, cannotCheck: true);

  final bool calling;
  final String bank;

  final CallSession? call;

  final List<CallSession> calls;

  final bool cannotCheck;
}

class Advisory {
  Advisory({required this.id, required this.bank, required this.title, required this.text, required this.approvedAt, required this.expiresAt, this.indicators = const [], this.linkDomains = const [], this.asksCallback = false});

  factory Advisory.fromJson(Map<String, dynamic> j) => Advisory(
        id: j['id'] as String,
        bank: j['bank'] as String,
        title: j['title'] as String,
        text: j['text'] as String,
        approvedAt: DateTime.parse(j['approvedAt'] as String).toLocal(),
        expiresAt: DateTime.parse(j['expiresAt'] as String).toLocal(),
        indicators: ((j['indicators'] as List?) ?? const []).cast<String>(),
        linkDomains: ((j['linkDomains'] as List?) ?? const []).cast<String>(),
        asksCallback: j['asksCallback'] == true,
      );

  final String id;
  final String bank;
  final String title;
  final String text;
  final DateTime approvedAt;
  final DateTime expiresAt;
  final List<String> indicators;
  final List<String> linkDomains;
  final bool asksCallback;
}

class AdvisoryList {
  AdvisoryList(this.advisories) : cannotCheck = false;
  AdvisoryList.unavailable()
      : advisories = const [],
        cannotCheck = true;

  factory AdvisoryList.fromJson(Map<String, dynamic> j) {
    try {
      final list = j['advisories'];
      if (list is! List) return AdvisoryList.unavailable();
      return AdvisoryList(list.map((e) => Advisory.fromJson(e as Map<String, dynamic>)).toList());
    } catch (_) {
      return AdvisoryList.unavailable();
    }
  }

  final List<Advisory> advisories;
  final bool cannotCheck;
}

class Bank {
  Bank({required this.id, required this.name, required this.domains, required this.customerTokenUrl, this.demoInboxUrl, this.kind = 'bank', this.logoUrl});

  static const kinds = {'bank', 'agency', 'company'};

  factory Bank.fromJson(Map<String, dynamic> j, String apiUrl) => Bank(
        id: j['id'] as String,
        name: j['name'] as String,
        kind: kinds.contains(j['kind']) ? j['kind'] as String : 'bank',
        domains: ((j['domains'] as List?) ?? []).cast<String>(),
        customerTokenUrl: resolveUrl(apiUrl, j['customerTokenUrl'] as String),
        demoInboxUrl: j['demoInboxUrl'] == null ? null : resolveUrl(apiUrl, j['demoInboxUrl'] as String),
        logoUrl: j['logoUrl'] is String ? resolveUrl(apiUrl, j['logoUrl'] as String) : null,
      );

  final String id;
  final String name;
  final List<String> domains;

  final String kind;

  final String customerTokenUrl;

  final String? demoInboxUrl;

  /// The organisation's own logo, as it registered it. Null shows a monogram.
  final String? logoUrl;

  bool get isDemo => demoInboxUrl != null;

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'kind': kind, 'domains': domains, 'customerTokenUrl': customerTokenUrl, 'demoInboxUrl': demoInboxUrl, 'logoUrl': logoUrl};
}

String resolveUrl(String apiUrl, String url) => Uri.parse(apiUrl.endsWith('/') ? apiUrl : '$apiUrl/').resolve(url).toString();

Future<List<Bank>> fetchBanks(String apiUrl, http.Client client) async {
  final res = await client.get(Uri.parse('$apiUrl/v1/banks')).timeout(const Duration(seconds: 8));
  if (res.statusCode != 200) throw ApiException(res.statusCode, 'banks', 'Could not load the list of banks');
  final list = (jsonDecode(res.body) as Map<String, dynamic>)['banks'] as List? ?? const [];
  return list.map((e) => Bank.fromJson(e as Map<String, dynamic>, apiUrl)).toList();
}

enum ReceiptVerdict { received, notConfirmed, cannotCheck }

class ReceiptResult {
  ReceiptResult({required this.verdict, this.bank, this.paidFrom, this.registeredAt});

  factory ReceiptResult.fromJson(Map<String, dynamic> j) {
    final v = switch (j['verdict']) { 'received' => ReceiptVerdict.received, 'not_confirmed' => ReceiptVerdict.notConfirmed, _ => ReceiptVerdict.cannotCheck };
    final bank = j['bank'] is String ? j['bank'] as String : null;
    if (v == ReceiptVerdict.received) {
      final paidFrom = j['paidFrom'];
      final at = j['registeredAt'] is String ? DateTime.tryParse(j['registeredAt'] as String) : null;
      if (paidFrom is! String || paidFrom.trim().isEmpty || at == null) return unavailable();
      return ReceiptResult(verdict: v, bank: bank, paidFrom: paidFrom, registeredAt: at.toLocal());
    }
    if (v == ReceiptVerdict.notConfirmed) return ReceiptResult(verdict: v, bank: bank);
    return unavailable();
  }

  static ReceiptResult unavailable() => ReceiptResult(verdict: ReceiptVerdict.cannotCheck);

  final ReceiptVerdict verdict;

  final String? bank;

  final String? paidFrom;

  final DateTime? registeredAt;
}

class CustomerInfo {
  CustomerInfo({required this.accounts, this.bankCode, this.bankName});

  factory CustomerInfo.fromJson(Map<String, dynamic> j) {
    final bank = j['bank'] is Map<String, dynamic> ? j['bank'] as Map<String, dynamic> : const <String, dynamic>{};
    final code = bank['bankCode'];
    return CustomerInfo(
      accounts: ((j['accounts'] as List?) ?? const []).whereType<String>().where(_account.hasMatch).toSet().toList(),
      bankCode: code is String && _bankCode.hasMatch(code) ? code : null,
      bankName: bank['name'] is String ? bank['name'] as String : null,
    );
  }

  static final _account = RegExp(r'^[0-9]{10}$');
  static final _bankCode = RegExp(r'^[0-9]{6}$');

  final List<String> accounts;

  final String? bankCode;
  final String? bankName;
}

class OfficialContacts {
  OfficialContacts({required this.bankId, required this.name, this.phones = const [], this.senderIds = const [], this.domains = const [], this.updatedAt});

  factory OfficialContacts.fromJson(Map<String, dynamic> j) => OfficialContacts(
        bankId: j['bankId'] as String,
        name: j['name'] as String,
        phones: (j['phones'] as List).whereType<String>().toList(),
        senderIds: ((j['senderIds'] as List?) ?? const []).whereType<String>().toList(),
        domains: ((j['domains'] as List?) ?? const []).whereType<String>().toList(),
        updatedAt: j['updatedAt'] is String ? DateTime.tryParse(j['updatedAt'] as String) : null,
      );

  final String bankId;
  final String name;

  final List<String> phones;
  final List<String> senderIds;
  final List<String> domains;
  final DateTime? updatedAt;

  Map<String, dynamic> toJson() => {'bankId': bankId, 'name': name, 'phones': phones, 'senderIds': senderIds, 'domains': domains, 'updatedAt': updatedAt?.toIso8601String()};
}

class IndicatorMatch {
  IndicatorMatch({required this.kind, required this.value, required this.campaignId, required this.reports, this.lastSeen});
  factory IndicatorMatch.fromJson(Map<String, dynamic> j) {
    final kind = j['kind'];
    if (kind != 'domain' && kind != 'phone') throw const FormatException('unknown indicator kind');
    return IndicatorMatch(
      kind: kind as String,
      value: j['value'] as String,
      campaignId: j['campaignId'] as String,
      reports: (j['reports'] as num).toInt(),
      lastSeen: j['lastSeen'] is String ? DateTime.tryParse(j['lastSeen'] as String) : null,
    );
  }

  final String kind;
  final String value;
  final String campaignId;
  final int reports;
  final DateTime? lastSeen;
}

class IndicatorResult {
  IndicatorResult(this.matches) : cannotCheck = false;
  IndicatorResult.unavailable()
      : matches = const [],
        cannotCheck = true;

  factory IndicatorResult.fromJson(Map<String, dynamic> j) {
    try {
      return IndicatorResult((j['matches'] as List).map((e) => IndicatorMatch.fromJson(e as Map<String, dynamic>)).toList());
    } catch (_) {
      return IndicatorResult.unavailable();
    }
  }

  final List<IndicatorMatch> matches;
  final bool cannotCheck;
}

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;
  @override
  String toString() => 'ApiException($status, $code)';
}

class GaskiyaClient {
  GaskiyaClient({required this.baseUrl, required this.token, this.renewToken, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final Future<String> Function() token;

  final Future<String> Function()? renewToken;
  final http.Client _http;

  Future<Map<String, dynamic>> _send(String method, String path, [Map<String, dynamic>? body]) async {
    Future<http.Response> attempt(String bearer) async {
      final req = http.Request(method, Uri.parse('$baseUrl$path'));
      req.headers['authorization'] = 'Bearer $bearer';
      if (body != null) {
        req.headers['content-type'] = 'application/json';
        req.body = jsonEncode(body);
      }
      return http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 12)));
    }

    var res = await attempt(await token());
    if (res.statusCode == 401 && renewToken != null) res = await attempt(await renewToken!());
    final data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, data['code'] as String? ?? 'error', data['message'] as String? ?? 'Request failed');
    }
    return data;
  }

  Future<VerifyResult> verifyText(String text) async {
    final digest = contentDigest(text);
    try {
      return VerifyResult.fromJson(await _send('POST', '/v1/verify/message', {'contentDigest': digest}));
    } on ApiException catch (e) {
      if (e.status == 429) rethrow;
      return VerifyResult.unavailable();
    } catch (_) {
      return VerifyResult.unavailable();
    }
  }

  Future<VerifyResult> verifyCandidates(List<String> candidates) async {
    VerifyResult? first;
    var incomplete = false;
    for (final text in candidates) {
      final r = (await verifyText(text)).withExtractedText(text);
      if (r.verdict == Verdict.confirmed) return r;
      if (r.verdict == Verdict.cannotCheck) incomplete = true;
      first ??= r;
    }
    if (first == null || incomplete) return VerifyResult.unavailable();
    return first;
  }

  Future<VerifyResult> verifyScreenshot(Uint8List bytes, String mediaType) async {
    try {
      return VerifyResult.fromJson(await _send('POST', '/v1/verify/screenshot', {'imageBase64': base64Encode(bytes), 'mediaType': mediaType}));
    } on ApiException catch (e) {
      if (e.status == 422 || e.status == 429) rethrow;
      return VerifyResult.unavailable();
    } catch (_) {
      return VerifyResult.unavailable();
    }
  }

  Future<ContactResult> verifyContact(String contact) async {
    try {
      return ContactResult.fromJson(await _send('POST', '/v1/verify/contact', {'contact': contact.trim()}));
    } on ApiException catch (e) {
      if (e.status == 429) rethrow;
      if (e.status == 422) return ContactResult.notAContact();
      return ContactResult.unavailable();
    } catch (_) {
      return ContactResult.unavailable();
    }
  }

  Future<LinkResult?> verifyLink(String url) async {
    try {
      return LinkResult.fromJson(await _send('POST', '/v1/verify/link', {'url': url.trim()}));
    } on ApiException catch (e) {
      if (e.status == 429) rethrow;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<LicenceResult> checkLicence(String query) async {
    try {
      return LicenceResult.fromJson(await _send('POST', '/v1/verify/licence', {'query': query.trim()}));
    } on ApiException catch (e) {
      if (e.status == 429) rethrow;
      return LicenceResult.unavailable();
    } catch (_) {
      return LicenceResult.unavailable();
    }
  }

  Future<CustomerInfo?> me() async {
    try {
      return CustomerInfo.fromJson(await _send('GET', '/v1/me'));
    } catch (_) {
      return null;
    }
  }

  Future<ReceiptResult> verifyReceipt({required String account, required String digest}) async {
    if (!digestPattern.hasMatch(digest)) return ReceiptResult.unavailable();
    try {
      return ReceiptResult.fromJson(await _send('POST', '/v1/verify/receipt', {'receiptDigest': digest, 'beneficiaryAccount': account}));
    } on ApiException catch (e) {
      if (e.status == 429) rethrow;
      return ReceiptResult.unavailable();
    } catch (_) {
      return ReceiptResult.unavailable();
    }
  }

  Future<ReceiptResult> checkReceipt({
    required String account,
    required String? bankCode,
    required int amountKobo,
    required String reference,
    required String valueDate,
  }) async {
    if (bankCode == null) return ReceiptResult.unavailable();
    final String digest;
    final String beneficiary;
    try {
      beneficiary = normaliseAccount(account);
      digest = receiptDigest(ReceiptFields(beneficiaryAccount: beneficiary, beneficiaryBank: bankCode, amountKobo: amountKobo, reference: reference, valueDate: valueDate));
    } on ReceiptFieldError {
      return ReceiptResult.unavailable();
    }
    return verifyReceipt(account: beneficiary, digest: digest);
  }

  Future<Explanation?> explain(String text, {String language = 'en'}) async {
    try {
      return Explanation.fromJson(await _send('POST', '/v1/explain', {'maskedText': maskDigits(text), 'language': language}));
    } catch (_) {
      return null;
    }
  }

  Future<bool> report(String text, List<String> indicators) async {
    try {
      await _send('POST', '/v1/reports', {
        'maskedText': maskDigits(text),
        'consent': true,
        'indicators': indicators,
        'callbackDigests': extractPhoneNumbers(text).take(5).map(callbackDigest).toList(),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<CallStatus> openCall() async {
    try {
      return CallStatus.fromJson(await _send('GET', '/v1/calls/open'));
    } catch (_) {
      return CallStatus.unavailable();
    }
  }

  /// The person answered or hung up (or declined) on the phone, so the agent's call follows. False if the registry did not take it.
  Future<bool> answerCall(String id) => _callAction(id, 'answer');
  Future<bool> endCall(String id) => _callAction(id, 'end');

  Future<bool> _callAction(String id, String action) async {
    try {
      await _send('POST', '/v1/calls/${Uri.encodeComponent(id)}/$action', const {});
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<({List<ActivityItem> items, String text})?> activity() async {
    try {
      final j = await _send('GET', '/v1/activity');
      return (
        items: ((j['recentActivity'] as List?) ?? []).map((e) => ActivityItem.fromJson(e as Map<String, dynamic>)).toList(),
        text: j['activityText'] as String? ?? '',
      );
    } catch (_) {
      return null;
    }
  }

  Future<AdvisoryList> advisories() async {
    try {
      return AdvisoryList.fromJson(await _send('GET', '/v1/advisories'));
    } catch (_) {
      return AdvisoryList.unavailable();
    }
  }

  Future<OfficialContacts?> officialContacts() async {
    try {
      return OfficialContacts.fromJson(await _send('GET', '/v1/official-contacts'));
    } catch (_) {
      return null;
    }
  }

  Future<IndicatorResult> verifyIndicators({List<String> domains = const [], List<String> phones = const []}) async {
    final d = domains.take(10).toList();
    final p = phones.take(10).toList();
    if (d.isEmpty && p.isEmpty) return IndicatorResult(const []);
    try {
      return IndicatorResult.fromJson(await _send('POST', '/v1/verify/indicators', {if (d.isNotEmpty) 'domains': d, if (p.isNotEmpty) 'phones': p}));
    } catch (_) {
      return IndicatorResult.unavailable();
    }
  }

  Future<void> registerDevice(String pushToken, String platform, {String? voipToken}) =>
      _send('POST', '/v1/devices', {'pushToken': pushToken, 'platform': platform, 'voipToken': ?voipToken});

  Stream<Map<String, dynamic>> events() async* {
    if (kIsWeb) {
      String? last;
      while (true) {
        final s = await openCall();
        final key = s.call?.id ?? 'none';
        if (!s.cannotCheck && key != last) {
          last = key;
          yield s.calling
              ? {'type': 'call.opened', 'callId': s.call!.id, 'purpose': s.call!.purpose, 'code': s.call!.code, 'expiresAt': s.call!.expiresAt.toIso8601String(), 'bank': s.bank}
              : {'type': 'call.closed'};
        }
        await Future<void>.delayed(const Duration(seconds: 2));
      }
    }
    Future<http.StreamedResponse> open(String bearer) => _http.send(http.Request('GET', Uri.parse('$baseUrl/v1/events'))
      ..headers['authorization'] = 'Bearer $bearer'
      ..headers['accept'] = 'text/event-stream');
    final res = await open(await token());
    if (res.statusCode != 200) throw ApiException(res.statusCode, 'events', 'event stream refused');
    var buffer = '';
    await for (final chunk in res.stream.transform(utf8.decoder)) {
      buffer += chunk;
      int idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        final frame = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        final data = frame.split('\n').where((l) => l.startsWith('data: ')).map((l) => l.substring(6)).join();
        if (data.isNotEmpty) yield jsonDecode(data) as Map<String, dynamic>;
      }
    }
  }

  void close() => _http.close();
}
