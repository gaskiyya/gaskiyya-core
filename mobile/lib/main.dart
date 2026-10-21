import 'dart:ui';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import 'src/core/copy.dart';
import 'src/core/session.dart';
import 'src/shield/shield_runtime.dart';
import 'src/ui/screens/home.dart';
import 'src/ui/screens/link_screen.dart';
import 'src/ui/screens/onboarding.dart';
import 'src/ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  final state = AppState();
  await Future.wait([Copy.load(), state.load()]);
  Copy.I.language = state.language;
  runApp(GaskiyaApp(state: state));
}

@pragma('vm:entry-point')
Future<void> shieldMain() async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  await ShieldRuntime.start();
}

class GaskiyaApp extends StatelessWidget {
  const GaskiyaApp({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final brightness = MediaQuery.platformBrightnessOf(context);
    return CupertinoApp(
      title: 'Gaskiyya',
      debugShowCheckedModeBanner: false,
      theme: G.theme(brightness),
      home: _Root(state: state),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final Widget page;
        if (!state.onboarded) {
          page = OnboardingScreen(key: const ValueKey('onboarding'), onDone: state.finishOnboarding);
        } else if (!state.linked) {
          page = LinkScreen(key: const ValueKey('link'), state: state);
        } else {
          page = HomeScreen(key: const ValueKey('home'), state: state);
        }
        return AnimatedSwitcher(
          duration: G.motion(context, G.springSlow),
          switchInCurve: G.spring,
          switchOutCurve: Curves.easeOut,
          transitionBuilder: (child, a) => FadeTransition(
            opacity: a,
            child: ScaleTransition(scale: Tween(begin: 1.04, end: 1.0).animate(a), child: child),
          ),
          child: page,
        );
      },
    );
  }
}
