import 'package:flutter/foundation.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:image/image.dart' as img;

import 'api.dart';

class TextBlock {
  const TextBlock(this.text, {this.top = 0});
  final String text;
  final double top;
}

abstract class TextReader {
  bool get available;

  Future<List<TextBlock>> read(String path);
}

class NoTextReader implements TextReader {
  const NoTextReader();
  @override
  bool get available => false;
  @override
  Future<List<TextBlock>> read(String path) async => const [];
}

class Screenshot {
  Screenshot({this.path, required this.bytes, required this.mediaType});
  final String? path;
  final Uint8List bytes;
  final String mediaType;
}

const _minMessageLength = 20;

const maxCandidates = 3;

List<String> screenshotCandidates(List<TextBlock> blocks) {
  final ordered = [...blocks.where((b) => canonicalise(b.text).isNotEmpty)]..sort((a, b) => a.top.compareTo(b.top));
  final long = ordered.where((b) => canonicalise(b.text).length >= _minMessageLength).toList();
  if (long.isEmpty) return const [];
  var longest = long.first;
  for (final b in long) {
    if (canonicalise(b.text).length > canonicalise(longest.text).length) longest = b;
  }
  final out = <String>[];
  final seen = <String>{};
  void add(String text) {
    if (out.length < maxCandidates && seen.add(canonicalise(text))) out.add(text);
  }

  add(longest.text);
  final i = ordered.indexOf(longest);
  if (i + 1 < ordered.length) add('${longest.text}\n${ordered[i + 1].text}');
  add(long.last.text);
  return out;
}

const uploadMaxEdge = 1200;

const uploadQuality = 75;

({Uint8List bytes, String mediaType})? prepareForUpload(Uint8List bytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) return null;
  var image = decoded;
  final longEdge = image.width > image.height ? image.width : image.height;
  if (longEdge > uploadMaxEdge) {
    image = image.width >= image.height
        ? img.copyResize(image, width: uploadMaxEdge, interpolation: img.Interpolation.average)
        : img.copyResize(image, height: uploadMaxEdge, interpolation: img.Interpolation.average);
  }
  return (bytes: img.encodeJpg(image, quality: uploadQuality), mediaType: 'image/jpeg');
}

Future<({Uint8List bytes, String mediaType})> _shrink(Screenshot s) async {
  final r = await compute(prepareForUpload, s.bytes);
  return r ?? (bytes: s.bytes, mediaType: s.mediaType);
}

Future<VerifyResult> checkScreenshot(
  GaskiyaClient client,
  TextReader reader,
  Screenshot shot, {
  Future<({Uint8List bytes, String mediaType})> Function(Screenshot)? shrink,
}) async {
  List<String> candidates = const [];
  if (reader.available && shot.path != null) {
    try {
      candidates = screenshotCandidates(await reader.read(shot.path!));
    } catch (_) {
      candidates = const [];
    }
  }
  if (candidates.isNotEmpty) return client.verifyCandidates(candidates);
  final upload = await (shrink ?? _shrink)(shot);
  return client.verifyScreenshot(upload.bytes, upload.mediaType);
}
