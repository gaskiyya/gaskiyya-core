library;

import 'dart:convert';

import 'package:crypto/crypto.dart';

const receiptVersion = 'GR1';

class ReceiptFields {
  const ReceiptFields({
    required this.beneficiaryAccount,
    required this.beneficiaryBank,
    required this.amountKobo,
    required this.reference,
    required this.valueDate,
  });

  final String beneficiaryAccount;
  final String beneficiaryBank;
  final Object amountKobo;
  final String reference;
  final String valueDate;
}

class ReceiptFieldError implements Exception {
  ReceiptFieldError(this.field, this.message);
  final String field;
  final String message;
  @override
  String toString() => 'ReceiptFieldError($field): $message';
}

final _separators = RegExp('[ \t\n\r\u00A0-]');
const _maxAmountDigits = 15;

String normaliseAccount(String value) {
  final v = value.replaceAll(_separators, '');
  if (!RegExp(r'^[0-9]{10}$').hasMatch(v)) {
    throw ReceiptFieldError('beneficiaryAccount', 'beneficiaryAccount must be a 10-digit account number');
  }
  return v;
}

String normaliseBankCode(String value) {
  final v = value.replaceAll(_separators, '');
  if (!RegExp(r'^[0-9]{6}$').hasMatch(v)) {
    throw ReceiptFieldError('beneficiaryBank', 'beneficiaryBank must be a 6-digit NIBSS institution code');
  }
  return v;
}

String normaliseAmountKobo(Object value) {
  String v;
  if (value is int) {
    v = value.toString();
  } else if (value is double) {
    if (!value.isFinite || value != value.truncateToDouble() || value.abs() > 9007199254740991) {
      throw ReceiptFieldError('amountKobo', 'amountKobo must be a whole number of kobo');
    }
    v = value.toInt().toString();
  } else if (value is String) {
    v = value;
  } else {
    throw ReceiptFieldError('amountKobo', 'amountKobo must be a whole number of kobo');
  }
  if (!RegExp(r'^[1-9][0-9]*$').hasMatch(v) || v.length > _maxAmountDigits) {
    throw ReceiptFieldError('amountKobo', 'amountKobo must be a whole number of kobo from 1 to $_maxAmountDigits digits');
  }
  return v;
}

String normaliseReference(String value) {
  final v = value
      .replaceAll(_separators, '')
      .replaceAllMapped(RegExp('[a-z]'), (m) => m[0]!.toUpperCase());
  if (!RegExp(r'^[A-Z0-9]{6,64}$').hasMatch(v)) {
    throw ReceiptFieldError('reference', 'reference must be 6 to 64 letters and digits');
  }
  return v;
}

const _daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

String normaliseValueDate(String value) {
  final m = RegExp(r'^(20[0-9]{2})-([0-9]{2})-([0-9]{2})$').firstMatch(value);
  ReceiptFieldError bad() => ReceiptFieldError('valueDate', 'valueDate must be a calendar date written YYYY-MM-DD');
  if (m == null) throw bad();
  final year = int.parse(m[1]!);
  final month = int.parse(m[2]!);
  final day = int.parse(m[3]!);
  if (month < 1 || month > 12) throw bad();
  final leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  final max = month == 2 && leap ? 29 : _daysInMonth[month - 1];
  if (day < 1 || day > max) throw bad();
  return value;
}

String canonicalReceipt(ReceiptFields f) => [
      receiptVersion,
      normaliseAccount(f.beneficiaryAccount),
      normaliseBankCode(f.beneficiaryBank),
      normaliseAmountKobo(f.amountKobo),
      normaliseReference(f.reference),
      normaliseValueDate(f.valueDate),
    ].join('|');

String receiptDigest(ReceiptFields f) => sha256.convert(utf8.encode(canonicalReceipt(f))).toString();

final _amountSpaces = RegExp('[ \u00A0]');
final _currency = RegExp('^(?:NGN|N|\u20A6)', caseSensitive: false);
final _amount = RegExp(r'^([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]{1,2}))?$');

int? parseAmountToKobo(String text) {
  var v = text.replaceAll(_amountSpaces, '');
  v = v.replaceFirst(_currency, '');
  final m = _amount.firstMatch(v);
  if (m == null) return null;
  final naira = m[1]!.replaceAll(',', '').replaceFirst(RegExp(r'^0+(?=[0-9])'), '');
  final kobo = (m[2] ?? '').padRight(2, '0');
  final digits = '$naira$kobo'.replaceFirst(RegExp('^0+'), '');
  if (digits.isEmpty || digits.length > _maxAmountDigits) return null;
  return int.parse(digits);
}

String lagosDate(DateTime instant) {
  final t = instant.toUtc().add(const Duration(hours: 1));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${t.year.toString().padLeft(4, '0')}-${two(t.month)}-${two(t.day)}';
}
