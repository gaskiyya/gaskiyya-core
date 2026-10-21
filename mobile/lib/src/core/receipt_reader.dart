import 'package:gaskiya_canonical/gaskiya_canonical.dart';

import 'screenshot.dart';

class ReceiptReading {
  const ReceiptReading({this.amountKobo, this.reference, this.valueDate});

  static const empty = ReceiptReading();

  final int? amountKobo;

  final String? reference;

  final String? valueDate;

  bool get isEmpty => amountKobo == null && reference == null && valueDate == null;
}

Future<ReceiptReading> readReceiptImage(TextReader reader, String path) async {
  if (!reader.available) return ReceiptReading.empty;
  try {
    return readReceipt(await reader.read(path));
  } catch (_) {
    return ReceiptReading.empty;
  }
}

String formatKobo(int kobo) {
  final naira = (kobo ~/ 100).toString();
  final grouped = naira.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return '$grouped.${(kobo % 100).toString().padLeft(2, '0')}';
}

final _currencyAmount = RegExp(r'(?:[Nn][Gg][Nn]|\u20A6|(?<![A-Za-z])N)[ \u00A0]?([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9]|[.,][0-9])');

final _plainAmount = RegExp(r'(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+\.[0-9]{2})(?![0-9]|[.,][0-9])');

final _amountLabel = RegExp(r'^\s*(?:(?:transaction|transfer|total|credit)\s+)?amount(?!\s+in\s+words)\b', caseSensitive: false);

final _notTheAmount = RegExp(r'balance|fee|charge|vat|stamp duty', caseSensitive: false);

final _sessionLabel = RegExp(r'session', caseSensitive: false);
final _digitRun = RegExp('[0-9](?:[ \u00A0]?[0-9])*');
final _digitsOnlyLine = RegExp('^[0-9 \u00A0]+\$');
const _sessionIdLength = 30;

final _referenceLabel = RegExp(
  r'^\s*(?:(?:transaction|transfer|payment)\s+)?ref(?:erence)?\.?(?:\s*(?:no\.?|number|id|code))?\s*[:#.\-]?\s*',
  caseSensitive: false,
);
final _referenceToken = RegExp(r'^[A-Za-z0-9][A-Za-z0-9\-]*');

final _dateLabel = RegExp(r'date', caseSensitive: false);
const _months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const _monthName = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
final _dayMonthYear = RegExp('(?<![0-9])([0-3]?[0-9])(?:st|nd|rd|th)?[\\s\\-/.]*$_monthName,?[\\s\\-/.]*(20[0-9]{2})(?![0-9])', caseSensitive: false);
final _monthDayYear = RegExp('(?<![A-Za-z])$_monthName\\s+([0-3]?[0-9])(?:st|nd|rd|th)?,?\\s+(20[0-9]{2})(?![0-9])', caseSensitive: false);
final _isoDate = RegExp(r'(?<![0-9])(20[0-9]{2})-([01]?[0-9])-([0-3]?[0-9])(?![0-9])');
final _numericDate = RegExp(r'(?<![0-9/.\-])([0-3]?[0-9])[/.\-]([01]?[0-9])[/.\-](20[0-9]{2})(?![0-9])');

ReceiptReading readReceipt(List<TextBlock> blocks) {
  final ordered = [...blocks]..sort((a, b) => a.top.compareTo(b.top));
  final lines = [
    for (final b in ordered)
      for (final l in b.text.split('\n'))
        if (l.trim().isNotEmpty) l.trim(),
  ];
  final amount = _amount(lines);
  final reference = _sessionId(lines) ?? _reference(lines);
  if (amount == null && reference == null) return ReceiptReading.empty;
  return ReceiptReading(amountKobo: amount, reference: reference, valueDate: _date(lines));
}

Iterable<String> _labelled(List<String> lines, int i, Match label) sync* {
  final rest = lines[i].substring(label.end).trim();
  if (rest.isNotEmpty) yield rest;
  if (i + 1 < lines.length) yield lines[i + 1];
}

int? _amount(List<String> lines) {
  for (var i = 0; i < lines.length; i++) {
    final label = _amountLabel.firstMatch(lines[i]);
    if (label == null) continue;
    for (final text in _labelled(lines, i, label)) {
      final m = _currencyAmount.firstMatch(text) ?? _plainAmount.firstMatch(text);
      final kobo = m == null ? null : parseAmountToKobo(m[1]!);
      if (kobo != null) return kobo;
    }
  }
  int? largest;
  for (final line in lines) {
    if (_notTheAmount.hasMatch(line)) continue;
    for (final m in _currencyAmount.allMatches(line)) {
      final kobo = parseAmountToKobo(m[1]!);
      if (kobo != null && (largest == null || kobo > largest)) largest = kobo;
    }
  }
  return largest;
}

String? _thirtyDigits(String text) {
  for (final m in _digitRun.allMatches(text)) {
    final digits = m[0]!.replaceAll(RegExp('[^0-9]'), '');
    if (digits.length == _sessionIdLength) return digits;
  }
  return null;
}

String? _sessionId(List<String> lines) {
  for (var i = 0; i < lines.length; i++) {
    final label = _sessionLabel.firstMatch(lines[i]);
    if (label == null) continue;
    for (final text in _labelled(lines, i, label)) {
      final id = _thirtyDigits(text);
      if (id != null) return id;
    }
  }
  for (final line in lines) {
    final id = _thirtyDigits(line);
    if (id != null) return id;
  }
  for (var i = 0; i + 1 < lines.length; i++) {
    if (!_digitsOnlyLine.hasMatch(lines[i]) || !_digitsOnlyLine.hasMatch(lines[i + 1])) continue;
    final digits = '${lines[i]}${lines[i + 1]}'.replaceAll(RegExp('[^0-9]'), '');
    if (digits.length == _sessionIdLength) return digits;
  }
  return null;
}

String? _reference(List<String> lines) {
  for (var i = 0; i < lines.length; i++) {
    final label = _referenceLabel.firstMatch(lines[i]);
    if (label == null) continue;
    for (final text in _labelled(lines, i, label)) {
      final token = _referenceToken.firstMatch(text.trim())?[0];
      if (token == null || !token.contains(RegExp('[0-9]'))) continue;
      try {
        return normaliseReference(token);
      } on ReceiptFieldError {
        continue;
      }
    }
  }
  return null;
}

String? _validDate(int year, int month, int day) {
  String two(int n) => n.toString().padLeft(2, '0');
  try {
    return normaliseValueDate('$year-${two(month)}-${two(day)}');
  } on ReceiptFieldError {
    return null;
  }
}

String? _dateIn(String text) {
  int month(String name) => _months.indexOf(name.substring(0, 3).toLowerCase()) + 1;
  for (final m in _dayMonthYear.allMatches(text)) {
    final d = _validDate(int.parse(m[3]!), month(m[2]!), int.parse(m[1]!));
    if (d != null) return d;
  }
  for (final m in _monthDayYear.allMatches(text)) {
    final d = _validDate(int.parse(m[3]!), month(m[1]!), int.parse(m[2]!));
    if (d != null) return d;
  }
  for (final m in _isoDate.allMatches(text)) {
    final d = _validDate(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
    if (d != null) return d;
  }
  for (final m in _numericDate.allMatches(text)) {
    final d = _validDate(int.parse(m[3]!), int.parse(m[2]!), int.parse(m[1]!));
    if (d != null) return d;
  }
  return null;
}

String? _date(List<String> lines) {
  for (var i = 0; i < lines.length; i++) {
    final label = _dateLabel.firstMatch(lines[i]);
    if (label == null) continue;
    for (final text in [lines[i], if (i + 1 < lines.length) lines[i + 1]]) {
      final d = _dateIn(text);
      if (d != null) return d;
    }
  }
  for (final line in lines) {
    final d = _dateIn(line);
    if (d != null) return d;
  }
  return null;
}
