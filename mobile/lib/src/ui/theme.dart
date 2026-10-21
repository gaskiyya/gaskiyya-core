import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';

class G {
  static const tint = CupertinoDynamicColor.withBrightness(color: Color(0xFF0A7A55), darkColor: Color(0xFF34C48E));
  static const ink = Color(0xFF0E1512);
  static const paper = Color(0xFFF6F5F1);
  static const blue = CupertinoDynamicColor.withBrightness(color: Color(0xFF007AFF), darkColor: Color(0xFF0A84FF));
  static const green = CupertinoDynamicColor.withBrightness(color: Color(0xFF34C759), darkColor: Color(0xFF30D158));
  static const greenInk = CupertinoDynamicColor.withBrightness(color: Color(0xFF1C8A3A), darkColor: Color(0xFF30D158));
  static const orange = CupertinoDynamicColor.withBrightness(color: Color(0xFFFF9500), darkColor: Color(0xFFFF9F0A));
  static const orangeInk = CupertinoDynamicColor.withBrightness(color: Color(0xFFC25E00), darkColor: Color(0xFFFF9F0A));
  static const red = CupertinoDynamicColor.withBrightness(color: Color(0xFFFF3B30), darkColor: Color(0xFFFF453A));
  static const teal = CupertinoDynamicColor.withBrightness(color: Color(0xFF00B3A6), darkColor: Color(0xFF40CBE0));
  static const indigo = CupertinoDynamicColor.withBrightness(color: Color(0xFF5856D6), darkColor: Color(0xFF5E5CE6));

  static const bg = CupertinoDynamicColor.withBrightness(color: Color(0xFFF4F3EF), darkColor: Color(0xFF000000));
  static const card = CupertinoColors.secondarySystemGroupedBackground;
  static const fill = CupertinoColors.tertiarySystemFill;
  static const label = CupertinoColors.label;
  static const label2 = CupertinoColors.secondaryLabel;
  static const label3 = CupertinoColors.tertiaryLabel;
  static const separator = CupertinoColors.separator;

  static const brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF1FB07C), Color(0xFF0A7A55)],
  );

  static String? get textFamily => _apple ? null : 'Inter';
  static String? get displayFamily => _apple ? null : 'InterDisplay';
  static bool get _apple => !kIsWeb && (defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS);

  static TextStyle largeTitle(BuildContext c) => TextStyle(fontFamily: displayFamily, fontSize: 34, fontWeight: FontWeight.w700, letterSpacing: 0.37, height: 1.2, color: label.resolveFrom(c));
  static TextStyle title1(BuildContext c) => TextStyle(fontFamily: displayFamily, fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: 0.36, height: 1.2, color: label.resolveFrom(c));
  static TextStyle title2(BuildContext c) => TextStyle(fontFamily: displayFamily, fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: 0.35, height: 1.25, color: label.resolveFrom(c));
  static TextStyle title3(BuildContext c) => TextStyle(fontFamily: displayFamily, fontSize: 20, fontWeight: FontWeight.w600, letterSpacing: 0.38, height: 1.25, color: label.resolveFrom(c));
  static TextStyle headline(BuildContext c) => TextStyle(fontFamily: textFamily, fontSize: 17, fontWeight: FontWeight.w600, letterSpacing: -0.41, height: 1.3, color: label.resolveFrom(c));
  static TextStyle body(BuildContext c) => TextStyle(fontFamily: textFamily, fontSize: 17, fontWeight: FontWeight.w400, letterSpacing: -0.41, height: 1.35, color: label.resolveFrom(c));
  static TextStyle callout(BuildContext c) => TextStyle(fontFamily: textFamily, fontSize: 16, fontWeight: FontWeight.w400, letterSpacing: -0.32, height: 1.35, color: label.resolveFrom(c));
  static TextStyle subhead(BuildContext c) => TextStyle(fontFamily: textFamily, fontSize: 15, fontWeight: FontWeight.w400, letterSpacing: -0.24, height: 1.35, color: label2.resolveFrom(c));
  static TextStyle footnote(BuildContext c) => TextStyle(fontFamily: textFamily, fontSize: 13, fontWeight: FontWeight.w400, letterSpacing: -0.08, height: 1.35, color: label2.resolveFrom(c));
  static TextStyle caption(BuildContext c) => TextStyle(fontFamily: textFamily, fontSize: 12, fontWeight: FontWeight.w400, letterSpacing: 0, height: 1.3, color: label2.resolveFrom(c));

  static CupertinoThemeData theme(Brightness? b) => CupertinoThemeData(
        brightness: b,
        primaryColor: tint,
        scaffoldBackgroundColor: bg,
        barBackgroundColor: const CupertinoDynamicColor.withBrightness(color: Color(0xCCF9F9F9), darkColor: Color(0xCC1D1D1D)),
        textTheme: CupertinoTextThemeData(
          primaryColor: tint,
          textStyle: TextStyle(fontFamily: textFamily, fontSize: 17, letterSpacing: -0.41, color: label),
          navLargeTitleTextStyle: TextStyle(fontFamily: displayFamily, fontSize: 34, fontWeight: FontWeight.w700, letterSpacing: 0.37, color: label),
          navTitleTextStyle: TextStyle(fontFamily: textFamily, fontSize: 17, fontWeight: FontWeight.w600, letterSpacing: -0.41, color: label),
          tabLabelTextStyle: TextStyle(fontFamily: textFamily, fontSize: 10, fontWeight: FontWeight.w500, letterSpacing: -0.1),
        ),
      );

  static bool reduceMotion(BuildContext c) => MediaQuery.maybeDisableAnimationsOf(c) ?? false;

  static Duration motion(BuildContext c, Duration d) => reduceMotion(c) ? Duration.zero : d;

  static const spring = Cubic(0.32, 0.72, 0, 1);
  static const springFast = Duration(milliseconds: 420);
  static const springSlow = Duration(milliseconds: 700);
}
