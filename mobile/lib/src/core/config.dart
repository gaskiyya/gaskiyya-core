import 'package:flutter/foundation.dart';

class Config {
  static const _api = String.fromEnvironment('API_URL');
  static const _legacySim = String.fromEnvironment('SIM_URL');

  static String get apiUrl {
    if (_api.isNotEmpty) return _api.replaceAll(RegExp(r'/+$'), '');
    if (_legacySim.isNotEmpty) return Uri.parse(_legacySim).replace(port: 8080, path: '').toString().replaceAll(RegExp(r'/+$'), '');
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:8080';
    return 'http://localhost:8080';
  }
}
