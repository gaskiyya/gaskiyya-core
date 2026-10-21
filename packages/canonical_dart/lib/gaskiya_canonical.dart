library;

import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'src/nfkc.dart';

export 'src/nfkc.dart' show isAssigned, nfkcPinned, unicodeVersion;
export 'src/receipt.dart';

final _zeroWidth = RegExp('[\u200B\u200C\u200D\u2060\uFEFF]');

final _whitespaceRun = RegExp(
  '[\t\n\u000B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+',
);
final _edgeSpaces = RegExp(r'^ +| +$');

String canonicalise(String text) {
  final noZeroWidth = text.replaceAll(_zeroWidth, '');
  final normalised = nfkcPinned(noZeroWidth);
  return normalised.replaceAll(_whitespaceRun, ' ').replaceAll(_edgeSpaces, '');
}

String contentDigest(String text) =>
    sha256.convert(utf8.encode(canonicalise(text))).toString();

final digestPattern = RegExp(r'^[0-9a-f]{64}$');
