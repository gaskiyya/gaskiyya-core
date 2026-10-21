import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:gaskiya/src/core/api.dart';
import 'package:gaskiya/src/core/screenshot.dart';
import 'package:gaskiya/src/core/text_tools.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;

const genuine = 'DemoBank: our app now has instant card controls. Update today at https://www.demobank.ng/app';
const scam = 'DemoBank: your account 0123456789 is blocked. Call 08031234567 now to restore it.';

class FakeReader implements TextReader {
  FakeReader(this.blocks, {this.available = true, this.fails = false});
  final List<TextBlock> blocks;
  @override
  final bool available;
  final bool fails;
  final paths = <String>[];
  @override
  Future<List<TextBlock>> read(String path) async {
    paths.add(path);
    if (fails) throw StateError('ocr failed');
    return blocks;
  }
}

({GaskiyaClient client, List<http.Request> requests}) registry({int messageStatus = 200}) {
  final requests = <http.Request>[];
  final registered = contentDigest(genuine);
  final mock = MockClient((req) async {
    requests.add(req);
    switch (req.url.path) {
      case '/v1/verify/message':
        if (messageStatus != 200) return http.Response('', messageStatus);
        final ok = (jsonDecode(req.body) as Map)['contentDigest'] == registered;
        return http.Response(jsonEncode(ok ? {'verdict': 'confirmed', 'bank': 'DemoBank', 'channel': 'sms', 'category': 'service_update', 'sentAt': '2026-10-20T12:41:00Z'} : {'verdict': 'not_confirmed', 'bank': 'DemoBank'}), 200);
      case '/v1/verify/screenshot':
        return http.Response(jsonEncode({'verdict': 'not_confirmed', 'bank': 'DemoBank', 'extractedText': scam}), 200);
      case '/v1/explain':
        return http.Response('{"indicators":[],"explanation":"x","action":"y","source":"fallback"}', 200);
    }
    return http.Response('{"code":"not_found","message":"no"}', 404);
  });
  return (client: GaskiyaClient(baseUrl: 'http://registry', token: () async => 'tok', httpClient: mock), requests: requests);
}

final pngBytes = Uint8List.fromList(img.encodePng(img.Image(width: 8, height: 8)));
Uint8List busyPng(int width, int height) {
  final image = img.Image(width: width, height: height);
  var seed = 7;
  for (final p in image) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    final v = (p.y ~/ 24).isEven && seed % 3 == 0 ? 20 : 235;
    p.setRgb(v, v, v);
  }
  return Uint8List.fromList(img.encodePng(image));
}

Screenshot shot({String? path = '/tmp/shot.png'}) => Screenshot(path: path, bytes: pngBytes, mediaType: 'image/png');

Future<({Uint8List bytes, String mediaType})> noShrink(Screenshot s) async => (bytes: s.bytes, mediaType: s.mediaType);

void main() {
  group('screenshot read on the device', () {
    test('the OCR path sends digests only, never the image', () async {
      final f = registry();
      final reader = FakeReader([const TextBlock('12:41', top: 0), const TextBlock('DemoBank', top: 40), const TextBlock(genuine, top: 120)]);
      final r = await checkScreenshot(f.client, reader, shot(), shrink: noShrink);
      expect(r.verdict, Verdict.confirmed);
      expect(r.extractedText, genuine);
      expect(reader.paths, ['/tmp/shot.png']);
      expect(f.requests.map((q) => q.url.path).toSet(), {'/v1/verify/message'});
      final b64 = base64Encode(pngBytes);
      for (final q in f.requests) {
        expect((jsonDecode(q.body) as Map).keys, ['contentDigest']);
        expect(q.body, isNot(contains(b64)));
        expect(q.body, isNot(contains('imageBase64')));
        expect(q.body, isNot(contains('instant card')));
      }
    });

    test('a misread or tampered message is not confirmed, and is not sent as an image', () async {
      final f = registry();
      final reader = FakeReader([TextBlock(genuine.replaceAll('demobank.ng', 'demo-bank.ng'))]);
      final r = await checkScreenshot(f.client, reader, shot(), shrink: noShrink);
      expect(r.verdict, Verdict.notConfirmed);
      expect(f.requests.where((q) => q.url.path == '/v1/verify/screenshot'), isEmpty);
    });

    test('a registry error on any candidate is cannot check, never genuine', () async {
      final f = registry(messageStatus: 503);
      final r = await checkScreenshot(f.client, FakeReader([const TextBlock(genuine)]), shot(), shrink: noShrink);
      expect(r.verdict, Verdict.cannotCheck);
    });

    test('at most three digests are checked', () async {
      final f = registry();
      final blocks = [for (var i = 0; i < 8; i++) TextBlock('Message number $i with enough words in it', top: i * 10.0)];
      await checkScreenshot(f.client, FakeReader(blocks), shot(), shrink: noShrink);
      expect(f.requests.length, lessThanOrEqualTo(maxCandidates));
    });
  });

  group('OCR failure falls back to the registry screenshot route', () {
    for (final (name, reader, path) in [
      ('OCR throws', FakeReader(const [], fails: true), '/tmp/shot.png'),
      ('OCR finds no text', FakeReader(const []), '/tmp/shot.png'),
      ('OCR finds only short fragments', FakeReader(const [TextBlock('12:41'), TextBlock('DemoBank')]), '/tmp/shot.png'),
      ('OCR unavailable (web, desktop)', FakeReader(const [TextBlock(genuine)], available: false), '/tmp/shot.png'),
      ('no file path (web)', FakeReader(const [TextBlock(genuine)]), null),
    ]) {
      test(name, () async {
        final f = registry();
        final r = await checkScreenshot(f.client, reader, shot(path: path), shrink: noShrink);
        expect(f.requests.map((q) => q.url.path), ['/v1/verify/screenshot']);
        expect(r.verdict, Verdict.notConfirmed);
        expect(r.extractedText, scam);
      });
    }
  });

  group('candidates', () {
    test('longest block first, then with the next block, then the last long block', () {
      final c = screenshotCandidates(const [
        TextBlock('Second paragraph of it.', top: 30),
        TextBlock('A long first paragraph of the message.', top: 20),
        TextBlock('09:12', top: 0),
        TextBlock('The newest message at the bottom', top: 90),
      ]);
      expect(c, [
        'A long first paragraph of the message.',
        'A long first paragraph of the message.\nSecond paragraph of it.',
        'The newest message at the bottom',
      ]);
    });

    test('nothing long enough means no candidates', () {
      expect(screenshotCandidates(const [TextBlock('09:12'), TextBlock('  '), TextBlock('Bank')]), isEmpty);
    });
  });

  group('AI-4: masking of text sent for an explanation', () {
    test('account and phone numbers read from a screenshot are masked before /v1/explain', () async {
      final f = registry();
      final r = await checkScreenshot(f.client, FakeReader(const [TextBlock(scam)]), shot(), shrink: noShrink);
      expect(r.verdict, Verdict.notConfirmed);
      await f.client.explain(r.extractedText!);
      final body = jsonDecode(f.requests.last.body) as Map<String, dynamic>;
      expect(body['maskedText'], 'DemoBank: your account ########## is blocked. Call ########### now to restore it.');
      expect(f.requests.last.body, isNot(contains('0123456789')));
    });

    test('masking matches the server rule: runs of four or more digits', () {
      expect(maskDigits('PIN 123 code 1234 acct 0123456789 N5,000'), 'PIN 123 code #### acct ########## N5,000');
    });
  });

  group('3.4: uploads are small', () {
    test('a large screenshot is shrunk to 1200px on the long edge as JPEG quality 75', () {
      final big = busyPng(1179, 2556);
      final out = prepareForUpload(big)!;
      expect(out.mediaType, 'image/jpeg');
      final decoded = img.decodeJpg(out.bytes)!;
      expect(decoded.height, uploadMaxEdge);
      expect(decoded.width, closeTo(1179 * 1200 / 2556, 1));
      expect(uploadQuality, 75);
      expect(out.bytes.length, lessThan(big.length));
    });

    test('a landscape image is limited by its width', () {
      final out = prepareForUpload(Uint8List.fromList(img.encodePng(img.Image(width: 2400, height: 1000))))!;
      final decoded = img.decodeJpg(out.bytes)!;
      expect((decoded.width, decoded.height), (1200, 500));
    });

    test('a small image keeps its size', () {
      final out = prepareForUpload(Uint8List.fromList(img.encodePng(img.Image(width: 600, height: 900))))!;
      final decoded = img.decodeJpg(out.bytes)!;
      expect((decoded.width, decoded.height), (600, 900));
    });

    test('undecodable bytes give null', () {
      expect(prepareForUpload(Uint8List.fromList([1, 2, 3, 4])), isNull);
    });

    test('the fallback uploads the shrunk image', () async {
      final f = registry();
      final big = Uint8List.fromList(img.encodePng(img.Image(width: 1179, height: 2556)));
      await checkScreenshot(f.client, const NoTextReader(), Screenshot(path: null, bytes: big, mediaType: 'image/png'));
      final body = jsonDecode(f.requests.single.body) as Map<String, dynamic>;
      expect(body['mediaType'], 'image/jpeg');
      final sent = img.decodeJpg(base64Decode(body['imageBase64'] as String))!;
      expect(sent.height, 1200);
    });
  });
}
