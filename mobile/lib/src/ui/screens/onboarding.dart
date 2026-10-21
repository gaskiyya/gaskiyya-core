import 'dart:math' as math;

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import '../../core/copy.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

class _Slide {
  const _Slide(this.asset, this.key, this.colors);
  final String asset;
  final String key;
  final List<Color> colors;

  String get eyebrow => key == 'intro' ? 'GASKIYYA' : Copy.I.t('app.onboarding.$key.eyebrow');
  String get title => Copy.I.t('app.onboarding.$key.title');
  String get body => Copy.I.t('app.onboarding.$key.body');
}

const _slides = [
  _Slide('logo', 'intro', [Color(0xFF1FB07C), Color(0xFF0A7A55)]),
  _Slide('message', 'message', [Color(0xFF0A7A55), Color(0xFF13A39A)]),
  _Slide('call', 'call', [Color(0xFF13A39A), Color(0xFF0A7A55)]),
  _Slide('lock', 'privacy', [Color(0xFF0A7A55), Color(0xFF0E1512)]),
];

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onDone});
  final VoidCallback onDone;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> with SingleTickerProviderStateMixin {
  final _pc = PageController();
  late final AnimationController _ambient = AnimationController(vsync: this, duration: const Duration(seconds: 14));
  double _page = 0;

  @override
  void initState() {
    super.initState();
    _pc.addListener(() => setState(() => _page = _pc.page ?? 0));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (G.reduceMotion(context)) {
      _ambient.stop();
    } else if (!_ambient.isAnimating) {
      _ambient.repeat();
    }
    for (final s in _slides) {
      precacheImage(AssetImage('assets/3d/${s.asset}.png'), context);
    }
    if (CupertinoTheme.brightnessOf(context) == Brightness.dark) {
      precacheImage(const AssetImage('assets/3d/logo_dark.png'), context);
    }
  }

  @override
  void dispose() {
    _pc.dispose();
    _ambient.dispose();
    super.dispose();
  }

  List<Color> _colorsAt(double p) {
    final i = p.floor().clamp(0, _slides.length - 1);
    final j = (i + 1).clamp(0, _slides.length - 1);
    final t = (p - i).clamp(0.0, 1.0);
    return [Color.lerp(_slides[i].colors[0], _slides[j].colors[0], t)!, Color.lerp(_slides[i].colors[1], _slides[j].colors[1], t)!];
  }

  void _next() {
    HapticFeedback.lightImpact();
    if (_page.round() >= _slides.length - 1) {
      widget.onDone();
    } else if (G.reduceMotion(context)) {
      _pc.jumpToPage(_page.round() + 1);
    } else {
      _pc.nextPage(duration: G.springSlow, curve: G.spring);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = _colorsAt(_page);
    final dark = CupertinoTheme.brightnessOf(context) == Brightness.dark;
    final last = _page.round() == _slides.length - 1;
    final size = MediaQuery.sizeOf(context);
    final reduce = G.reduceMotion(context);

    return CupertinoPageScaffold(
      backgroundColor: dark ? const Color(0xFF000000) : G.paper,
      child: Stack(
        children: [
          Positioned.fill(
            child: AnimatedBuilder(
              animation: _ambient,
              builder: (context, _) => RepaintBoundary(child: CustomPaint(painter: _AuroraPainter(colors, _ambient.value, dark))),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                SizedBox(
                  height: 44,
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: AnimatedOpacity(
                      opacity: last ? 0 : 1,
                      duration: G.motion(context, const Duration(milliseconds: 250)),
                      child: CupertinoButton(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        onPressed: last ? null : widget.onDone,
                        child: Text(
                          Copy.I.t('app.onboarding.skip'),
                          style: G.body(context).copyWith(color: G.label2.resolveFrom(context), fontWeight: FontWeight.w500),
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: PageView.builder(
                    controller: _pc,
                    itemCount: _slides.length,
                    itemBuilder: (context, i) {
                      final d = (_page - i);
                      final s = _slides[i];
                      final fade = (1 - d.abs() * 1.4).clamp(0.0, 1.0);
                      return LayoutBuilder(
                        builder: (context, box) {
                          final art = math.min(size.width * 0.8, box.maxHeight * 0.48);
                          return Column(
                            children: [
                              const Spacer(flex: 2),
                              Transform.translate(
                                offset: Offset(reduce ? 0 : d * size.width * 0.38, 0),
                                child: Opacity(
                                  opacity: (1 - d.abs()).clamp(0.0, 1.0),
                                  child: Art3D(dark && s.asset == 'logo' ? 'logo_dark' : s.asset, size: art),
                                ),
                              ),
                              const Spacer(flex: 1),
                              Flexible(
                                flex: 6,
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.topCenter,
                                  child: SizedBox(
                                    width: size.width,
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 32),
                                      child: Opacity(
                                        opacity: fade,
                                        child: Transform.translate(
                                          offset: Offset(reduce ? 0 : d * 60, 0),
                                          child: Column(
                                            children: [
                                              Text(
                                                s.eyebrow,
                                                style: G
                                                    .footnote(context)
                                                    .copyWith(letterSpacing: 1.4, fontWeight: FontWeight.w700, color: G.tint.resolveFrom(context)),
                                              ),
                                              const SizedBox(height: 10),
                                              Text(
                                                s.title,
                                                textAlign: TextAlign.center,
                                                style: G.largeTitle(context).copyWith(height: 1.12, letterSpacing: -0.4),
                                              ),
                                              const SizedBox(height: 14),
                                              Text(
                                                i == 3 ? '${s.body} ${Copy.I.t('safety.neverAsks')}' : s.body,
                                                textAlign: TextAlign.center,
                                                style: G.callout(context).copyWith(color: G.label2.resolveFrom(context), height: 1.45),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                              const Spacer(flex: 1),
                            ],
                          );
                        },
                      );
                    },
                  ),
                ),
                PageDots(count: _slides.length, page: _page),
                const SizedBox(height: 26),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Pressable(
                    onTap: _next,
                    child: AnimatedContainer(
                      duration: G.motion(context, G.springFast),
                      curve: G.spring,
                      height: 56,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: colors, begin: Alignment.centerLeft, end: Alignment.centerRight),
                        borderRadius: BorderRadius.circular(18),
                        boxShadow: [BoxShadow(color: colors[1].withValues(alpha: 0.35), blurRadius: 24, offset: const Offset(0, 10))],
                      ),
                      alignment: Alignment.center,
                      child: AnimatedSwitcher(
                        duration: G.motion(context, const Duration(milliseconds: 260)),
                        transitionBuilder: (c, a) => FadeTransition(
                          opacity: a,
                          child: ScaleTransition(scale: Tween(begin: 0.9, end: 1.0).animate(a), child: c),
                        ),
                        child: Text(
                          last ? Copy.I.t('app.onboarding.getStarted') : Copy.I.t('app.common.continue'),
                          key: ValueKey(last),
                          style: G.headline(context).copyWith(color: CupertinoColors.white, fontSize: 17),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AuroraPainter extends CustomPainter {
  _AuroraPainter(this.colors, this.t, this.dark);
  final List<Color> colors;
  final double t;
  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final a = t * 2 * math.pi;
    final alpha = dark ? 0.42 : 0.30;
    void orb(Color c, Offset center, double r) {
      canvas.drawCircle(
        center,
        r,
        Paint()
          ..shader = RadialGradient(
            colors: [
              c.withValues(alpha: alpha),
              c.withValues(alpha: 0),
            ],
          ).createShader(Rect.fromCircle(center: center, radius: r)),
      );
    }

    orb(colors[0], Offset(size.width * (0.25 + 0.12 * math.sin(a)), size.height * (0.24 + 0.05 * math.cos(a))), size.width * 0.75);
    orb(colors[1], Offset(size.width * (0.8 + 0.1 * math.cos(a * 1.3)), size.height * (0.42 + 0.06 * math.sin(a))), size.width * 0.7);
  }

  @override
  bool shouldRepaint(_AuroraPainter old) => old.t != t || old.colors != colors || old.dark != dark;
}
