import 'dart:convert';

import 'package:flutter/services.dart';

class Copy {
  Copy(this._data, [Map<String, Map<String, dynamic>> overlays = const {}]) : _overlays = overlays;

  static const languages = ['en', 'pcm', 'ha', 'yo', 'ig'];

  final Map<String, dynamic> _data;
  final Map<String, Map<String, dynamic>> _overlays;
  String _language = 'en';

  static Copy? _instance;
  static Copy get I => _instance ?? (throw StateError('Copy not loaded'));
  static bool get loaded => _instance != null;

  static Future<Copy> load([AssetBundle? bundle]) async {
    final b = bundle ?? rootBundle;
    final raw = await b.loadString('assets/copy.json');
    final overlays = <String, String>{};
    for (final lang in languages.skip(1)) {
      try {
        overlays[lang] = await b.loadString('assets/copy.$lang.json');
      } catch (_) {
      }
    }
    return fromJson(raw, overlays: overlays);
  }

  static Copy fromJson(String raw, {Map<String, String> overlays = const {}}) => _instance = Copy(
        jsonDecode(raw) as Map<String, dynamic>,
        overlays.map((lang, json) => MapEntry(lang, jsonDecode(json) as Map<String, dynamic>)),
      );

  String get language => _language;
  set language(String? value) => _language = languages.contains(value) ? value! : 'en';

  static Object? _lookup(Map<String, dynamic>? data, String path) {
    Object? node = data;
    for (final part in path.split('.')) {
      node = node is Map<String, dynamic> ? node[part] : null;
    }
    return node;
  }

  String t(String path, [Map<String, Object?> values = const {}]) {
    var node = _language == 'en' ? null : _lookup(_overlays[_language], path);
    if (node is! String) node = _lookup(_data, path);
    if (node is! String) return path;
    return fill(node, values);
  }

  static const orgVariants = {
    'verdict.confirmed.title': 'official.org.confirmedTitle',
    'verdict.cannot_check.body': 'official.org.cannotCheckBody',
    'call.not_calling.title': 'official.org.notCallingTitle',
    'call.not_calling.body': 'official.org.notCallingBody',
    'explain.fallback': 'official.org.explainFallback',
    'explain.action': 'official.org.explainAction',
    'bot.otpAdvice': 'official.org.otpAdvice',
    'link.belongs.title': 'official.org.linkBelongsTitle',
    'link.lookalike': 'official.org.linkLookalike',
    'report.prompt': 'official.org.reportPrompt',
    'report.thanks': 'official.org.reportThanks',
    'activity.heading': 'official.org.activityHeading',
  };

  String tOrg(String path, String? kind, [Map<String, Object?> values = const {}]) {
    final variant = orgVariants[path];
    final isBank = kind != 'agency' && kind != 'company';
    return t(isBank || variant == null ? path : variant, values);
  }

  static String fill(String template, Map<String, Object?> values) =>
      template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) => values.containsKey(m[1]) ? '${values[m[1]]}' : m[0]!);

  String category(String key) => t('categories.$key');
  String channel(String key) => t('channels.$key');
  String purpose(String key) => t('purposes.$key');
  String indicator(String key) => t('indicators.$key');

  String orList(List<String> items) => items.length < 2
      ? items.join()
      : t('banks.or', {'first': items.sublist(0, items.length - 1).join(', '), 'last': items.last});
}

extension Capitalise on String {
  String get cap => isEmpty ? this : this[0].toUpperCase() + substring(1);
}
