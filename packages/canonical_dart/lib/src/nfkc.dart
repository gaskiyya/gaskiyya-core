library;

import 'package:unorm_dart/unorm_dart.dart' as unorm;

import 'unicode_assigned.dart';

export 'unicode_assigned.dart' show unicodeVersion;

bool isAssigned(int cp) {
  var lo = 0;
  var hi = assignedRanges.length ~/ 2 - 1;
  while (lo <= hi) {
    final mid = (lo + hi) >> 1;
    if (cp < assignedRanges[mid * 2]) {
      hi = mid - 1;
    } else if (cp > assignedRanges[mid * 2 + 1]) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

String nfkcPinned(String text) {
  final out = StringBuffer();
  var start = 0;
  var i = 0;
  while (i < text.length) {
    final unit = text.codeUnitAt(i);
    var cp = unit;
    var width = 1;
    if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < text.length) {
      final next = text.codeUnitAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        cp = 0x10000 + ((unit - 0xD800) << 10) + (next - 0xDC00);
        width = 2;
      }
    }
    if (!isAssigned(cp)) {
      out
        ..write(unorm.nfkc(text.substring(start, i)))
        ..write(text.substring(i, i + width));
      start = i + width;
    }
    i += width;
  }
  out.write(unorm.nfkc(text.substring(start)));
  return out.toString();
}
