import 'dart:convert';
import 'dart:io';

import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:test/test.dart';

void main() {
  final data = jsonDecode(File('../test-vectors/vectors.json').readAsStringSync()) as Map<String, dynamic>;
  final receipts = (data['receipts'] as List).cast<Map<String, dynamic>>();
  final byId = {for (final r in receipts) r['id'] as String: r};

  ReceiptFields fields(Map<String, dynamic> r) {
    final f = r['fields'] as Map<String, dynamic>;
    return ReceiptFields(
      beneficiaryAccount: f['beneficiaryAccount'] as String,
      beneficiaryBank: f['beneficiaryBank'] as String,
      amountKobo: f['amountKobo'] as Object,
      reference: f['reference'] as String,
      valueDate: f['valueDate'] as String,
    );
  }

  test('RCPT-8: at least 30 shared receipt vectors, valid and invalid', () {
    expect(receipts.length, greaterThanOrEqualTo(30));
    expect(receipts.where((r) => r['error'] != null).length, greaterThanOrEqualTo(10));
  });

  group('RCPT-8: Dart receipt digests match the shared vectors', () {
    for (final r in receipts) {
      test(r['id'], () {
        if (r['error'] != null) {
          expect(
            () => canonicalReceipt(fields(r)),
            throwsA(isA<ReceiptFieldError>().having((e) => e.field, 'field', r['error'])),
          );
        } else {
          expect(canonicalReceipt(fields(r)), r['canonical']);
          expect(receiptDigest(fields(r)), r['digest']);
        }
      });
    }
  });

  test('RCPT-8: formatting variants share a digest; one changed field does not', () {
    for (final group in (data['receiptSameGroups'] as List).cast<List>()) {
      expect(group.map((id) => receiptDigest(fields(byId[id]!))).toSet().length, 1, reason: '$group');
    }
    for (final pair in (data['receiptDifferentPairs'] as List).cast<List>()) {
      expect(receiptDigest(fields(byId[pair[0]]!)), isNot(receiptDigest(fields(byId[pair[1]]!))), reason: '$pair');
    }
  });

  test('RCPT-8: amounts read from receipts match the shared vectors', () {
    for (final a in (data['amounts'] as List).cast<Map<String, dynamic>>()) {
      expect(parseAmountToKobo(a['input'] as String), a['kobo'], reason: a['input'] as String);
    }
  });

  test('RCPT-8: Lagos dates match the shared vectors', () {
    for (final d in (data['lagosDates'] as List).cast<Map<String, dynamic>>()) {
      expect(lagosDate(DateTime.parse(d['instant'] as String)), d['date'], reason: d['instant'] as String);
    }
  });

  test('a receipt error never carries the value it refused', () {
    try {
      normaliseAccount('98765Z4321');
      fail('expected a ReceiptFieldError');
    } on ReceiptFieldError catch (e) {
      expect(e.message.contains('98765'), isFalse);
    }
  });
}
