import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart' as mlkit;

import 'screenshot.dart';

class MlKitTextReader implements TextReader {
  // Simulator builds have no ML Kit (ios/Podfile).
  static final bool _iosSimulator = !kIsWeb && Platform.isIOS && Platform.environment.containsKey('SIMULATOR_DEVICE_NAME');

  @override
  bool get available => !kIsWeb && !_iosSimulator && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  @override
  Future<List<TextBlock>> read(String path) async {
    final recognizer = mlkit.TextRecognizer(script: mlkit.TextRecognitionScript.latin);
    try {
      final result = await recognizer.processImage(mlkit.InputImage.fromFilePath(path));
      return [for (final b in result.blocks) TextBlock(b.lines.map((l) => l.text).join('\n'), top: b.boundingBox.top)];
    } finally {
      await recognizer.close();
    }
  }
}

TextReader defaultTextReader() => MlKitTextReader();
