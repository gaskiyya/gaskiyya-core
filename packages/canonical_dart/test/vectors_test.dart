import 'dart:convert';
import 'dart:io';

import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:test/test.dart';

void main() {
  final file = File('../test-vectors/vectors.json');
  final data = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  final vectors = (data['vectors'] as List).cast<Map<String, dynamic>>();
  final byId = {for (final v in vectors) v['id'] as String: v};

  test('CAN-4: at least 30 shared vectors', () {
    expect(vectors.length, greaterThanOrEqualTo(30));
  });

  group('CAN-1: Dart digests match the shared vectors', () {
    for (final v in vectors) {
      test(v['id'], () {
        expect(canonicalise(v['input'] as String), v['canonical']);
        expect(contentDigest(v['input'] as String), v['digest']);
      });
    }
  });

  test('CAN-2: equivalent texts share a digest', () {
    for (final group in (data['sameDigestGroups'] as List).cast<List>()) {
      final digests = group.map((id) => contentDigest(byId[id]!['input'] as String)).toSet();
      expect(digests.length, 1, reason: '$group');
    }
  });

  test('CAN-3: one-character changes give different digests', () {
    for (final pair in (data['differentDigestPairs'] as List).cast<List>()) {
      expect(
        contentDigest(byId[pair[0]]!['input'] as String),
        isNot(contentDigest(byId[pair[1]]!['input'] as String)),
        reason: '$pair',
      );
    }
  });

  test('F13: NFKC is pinned to Unicode 15.1; later code points are kept', () {
    expect(unicodeVersion, '15.1');
    expect(isAssigned(0x41), isTrue);
    expect(isAssigned(0x1ECB), isTrue);
    const later = [0x0558, 0x058B, 0x209D, 0xD7A4, 0x107BB, 0x1B123, 0x1D6A6, 0x1DF95, 0x1DFFF, 0x1AEF, 0x1D252, 0x1CCD6, 0xA7F1];
    for (final cp in later) {
      final ch = String.fromCharCode(cp);
      expect(isAssigned(cp), isFalse, reason: cp.toRadixString(16));
      expect(canonicalise(ch), ch, reason: cp.toRadixString(16));
      expect(
        canonicalise('e${String.fromCharCode(0x301)}$ch${String.fromCharCode(0x323)}'),
        '${String.fromCharCode(0xE9)}$ch${String.fromCharCode(0x323)}',
        reason: cp.toRadixString(16),
      );
    }
  });

  test('digest is 64 lowercase hex characters', () {
    expect(digestPattern.hasMatch(contentDigest('hello')), isTrue);
  });
}
