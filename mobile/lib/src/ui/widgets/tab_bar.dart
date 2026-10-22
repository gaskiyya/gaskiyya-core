import 'dart:ui' show ImageFilter;

import 'package:flutter/cupertino.dart';

import '../theme.dart';

/// The app's bottom tab bar: a blurred bar with a hairline top border and evenly spaced tabs, each a
/// centred icon over a one-line label. The selected tab gets a tinted pill behind its filled icon and
/// a tinted, bolder label. Long translated labels end in an ellipsis instead of wrapping.
///
/// It extends [CupertinoTabBar] so [CupertinoTabScaffold] keeps handling tab state, insets and
/// per-tab navigation; only the drawing changes.
class GTabBar extends CupertinoTabBar {
  const GTabBar({super.key, required super.items, super.onTap, super.currentIndex, super.backgroundColor, super.height = barHeight})
      : super(iconSize: 22);

  static const barHeight = 60.0;

  @override
  GTabBar copyWith({
    Key? key,
    List<BottomNavigationBarItem>? items,
    Color? backgroundColor,
    Color? activeColor,
    Color? inactiveColor,
    double? iconSize,
    double? height,
    Border? border,
    int? currentIndex,
    ValueChanged<int>? onTap,
  }) =>
      GTabBar(
        key: key ?? this.key,
        items: items ?? this.items,
        backgroundColor: backgroundColor ?? this.backgroundColor,
        height: height ?? this.height,
        currentIndex: currentIndex ?? this.currentIndex,
        onTap: onTap ?? this.onTap,
      );

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final bg = CupertinoDynamicColor.resolve(backgroundColor ?? CupertinoTheme.of(context).barBackgroundColor, context);
    Widget bar = DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        border: Border(top: BorderSide(color: G.separator.resolveFrom(context), width: 0)),
      ),
      child: Padding(
        padding: EdgeInsets.only(bottom: bottom),
        child: SizedBox(
          height: height,
          child: MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.2,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: Row(children: [
                for (var i = 0; i < items.length; i++)
                  Expanded(child: _Tab(item: items[i], selected: i == currentIndex, onTap: () => onTap?.call(i))),
              ]),
            ),
          ),
        ),
      ),
    );
    if (bg.a < 1) {
      bar = ClipRect(child: BackdropFilter(filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20), child: bar));
    }
    return bar;
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.item, required this.selected, required this.onTap});
  final BottomNavigationBarItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tint = G.tint.resolveFrom(context);
    final color = selected ? tint : G.label2.resolveFrom(context);
    final motion = G.motion(context, const Duration(milliseconds: 260));
    return Semantics(
      container: true,
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          AnimatedContainer(
            duration: motion,
            curve: G.spring,
            width: 56,
            height: 30,
            decoration: BoxDecoration(
              color: selected ? tint.withValues(alpha: 0.14) : tint.withValues(alpha: 0),
              borderRadius: BorderRadius.circular(15),
            ),
            alignment: Alignment.center,
            child: ExcludeSemantics(
              child: IconTheme(
                data: IconThemeData(color: color, size: 22),
                child: selected ? item.activeIcon : item.icon,
              ),
            ),
          ),
          const SizedBox(height: 3),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Text(
              item.label ?? '',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: G.textFamily,
                fontSize: 11,
                height: 1.2,
                letterSpacing: 0,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: color,
              ),
            ),
          ),
        ]),
      ),
    );
  }
}
