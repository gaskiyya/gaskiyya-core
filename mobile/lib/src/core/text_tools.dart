import 'dart:convert';

import 'package:crypto/crypto.dart';

String maskDigits(String text) => text.replaceAllMapped(RegExp(r'\d{4,}'), (m) => '#' * m[0]!.length);

List<String> extractPhoneNumbers(String text) {
  final out = <String>{};
  for (final m in RegExp(r'\+?\d[\d\s-]{8,16}\d').allMatches(text)) {
    var digits = m[0]!.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('234')) digits = '0${digits.substring(3)}';
    if (digits.length >= 10 && digits.length <= 13) out.add(digits);
  }
  return out.toList();
}

String callbackDigest(String digits) => sha256.convert(utf8.encode('tel:$digits')).toString();

String? firstLink(String text) {
  final m = RegExp(r'(https?://\S+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/\S*)?)', caseSensitive: false).firstMatch(text);
  return m?[0];
}

bool looksLikeLink(String text) {
  final t = text.trim();
  return !t.contains(RegExp(r'\s')) && RegExp(r'^(https?://)?([a-z0-9-]+\.)+[a-z]{2,}(/.*)?$', caseSensitive: false).hasMatch(t);
}

String? normalisePhone(String input) {
  var d = input.replaceAll(RegExp(r'[^\d+]'), '');
  if (d.startsWith('+')) return RegExp(r'^\+[1-9]\d{6,14}$').hasMatch(d) ? d : null;
  if (d.startsWith('234') && d.length == 13) return '+$d';
  if (d.startsWith('0') && d.length == 11) return '+234${d.substring(1)}';
  if (d.length == 10) return '+234$d';
  return null;
}

typedef ParsedContact = ({String type, String value, String? platform});

final _emailRe = RegExp(r'''^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$''');
final _handleRe = RegExp(r'^[a-z0-9._]{1,50}$');

const _socialHosts = {
  'x.com': 'x',
  'twitter.com': 'x',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'instagram.com': 'instagram',
  'instagr.am': 'instagram',
  'tiktok.com': 'tiktok',
  't.me': 'telegram',
  'telegram.me': 'telegram',
};
const _whatsappHosts = {'wa.me', 'api.whatsapp.com', 'whatsapp.com'};

const _notAccounts = {
  'home', 'share', 'sharer', 'intent', 'search', 'explore', 'login', 'p', 'reel', 'reels', 'watch', 'groups',
  'profile.php', 'i', 'hashtag', 'joinchat', 's', 'tv', 'stories',
};

String? _e164(String raw) {
  final phone = '+${raw.replaceAll(RegExp(r'\D'), '')}';
  return RegExp(r'^\+[1-9]\d{6,14}$').hasMatch(phone) ? phone : null;
}

String? _contactPhone(String raw) {
  final t = raw.trim();
  if (!RegExp(r'^\+?[\d\s().-]{7,24}$').hasMatch(t)) return null;
  final digits = t.replaceAll(RegExp(r'\D'), '');
  if (!t.startsWith('+') && RegExp(r'^0\d{10}$').hasMatch(digits)) return '+234${digits.substring(1)}';
  if (!t.startsWith('+') && digits.startsWith('00')) return _e164(digits.substring(2));
  return _e164(digits);
}

String _cleanHandle(String h) {
  String decoded;
  try {
    decoded = Uri.decodeComponent(h);
  } catch (_) {
    decoded = h;
  }
  return decoded.trim().replaceFirst(RegExp(r'^@+'), '').toLowerCase();
}

ParsedContact? parseContact(String raw) {
  final t = raw.trim().replaceAll(RegExp(r'^<|>$'), '');
  if (t.isEmpty || t.length > 512) return null;

  final mail = RegExp(r'^mailto:', caseSensitive: false).hasMatch(t) ? t.substring(7).split('?').first : t;
  if (_emailRe.hasMatch(mail.toLowerCase())) return (type: 'email', value: mail.toLowerCase(), platform: null);

  if (RegExp(r'^@[A-Za-z0-9._]{1,50}$').hasMatch(t)) return (type: 'handle', value: _cleanHandle(t), platform: null);

  final phone = _contactPhone(t.replaceFirst(RegExp(r'^tel:', caseSensitive: false), ''));
  if (phone != null) return (type: 'phone', value: phone, platform: null);

  if (RegExp(r'\s').hasMatch(t)) return null;
  final url = Uri.tryParse(RegExp(r'^[a-z][a-z0-9+.-]*://', caseSensitive: false).hasMatch(t) ? t : 'https://$t');
  if (url == null || (url.scheme != 'https' && url.scheme != 'http')) return null;
  final host = url.host.toLowerCase().replaceFirst(RegExp(r'^(www|m|mobile|web)\.'), '');
  final segments = url.pathSegments.where((s) => s.isNotEmpty).toList();

  if (_whatsappHosts.contains(host)) {
    final number = host == 'wa.me' ? segments.firstOrNull : url.queryParameters['phone'];
    final value = number == null ? null : _e164(number);
    return value == null ? null : (type: 'whatsapp', value: value, platform: null);
  }
  final platform = _socialHosts[host];
  if (platform != null) {
    final first = segments.firstOrNull ?? '';
    if (platform == 'facebook' && first == 'profile.php') {
      final id = url.queryParameters['id'];
      return id != null && RegExp(r'^\d{5,20}$').hasMatch(id) ? (type: 'social', value: id, platform: platform) : null;
    }
    final handle = _cleanHandle(first);
    if (handle.isEmpty || _notAccounts.contains(handle) || !_handleRe.hasMatch(handle)) return null;
    return (type: 'social', value: handle, platform: platform);
  }
  return null;
}

bool looksLikeContact(String text) => parseContact(text) != null;
