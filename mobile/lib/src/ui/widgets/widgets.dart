
import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import '../../core/copy.dart';
import '../theme.dart';

void rebuildAllText() {
  void mark(Element e) {
    e.markNeedsBuild();
    e.visitChildren(mark);
  }

  WidgetsBinding.instance.rootElement?.visitChildren(mark);
}

class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onTap, this.scale = 0.96, this.haptic = true});
  final Widget child;
  final VoidCallback? onTap;
  final double scale;
  final bool haptic;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    final reduce = G.reduceMotion(context);
    return Semantics(
      button: true,
      enabled: enabled,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTap: enabled
            ? () {
                if (widget.haptic) HapticFeedback.selectionClick();
                widget.onTap!();
              }
            : null,
        child: AnimatedScale(
          scale: _down && !reduce ? widget.scale : 1,
          duration: reduce ? Duration.zero : Duration(milliseconds: _down ? 120 : 380),
          curve: _down ? Curves.easeOut : G.spring,
          child: AnimatedOpacity(opacity: enabled ? 1 : 0.4, duration: G.motion(context, const Duration(milliseconds: 200)), child: widget.child),
        ),
      ),
    );
  }
}

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, this.onTap, this.loading = false, this.icon, this.color, this.textColor, this.gradient = false});
  final String label;
  final VoidCallback? onTap;
  final bool loading;
  final IconData? icon;
  final Color? color;
  final Color? textColor;
  final bool gradient;

  @override
  Widget build(BuildContext context) {
    final bg = color ?? G.tint.resolveFrom(context);
    return Pressable(
      onTap: loading ? null : onTap,
      child: AnimatedContainer(
        duration: G.motion(context, const Duration(milliseconds: 300)),
        constraints: const BoxConstraints(minHeight: 54),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: gradient ? null : bg,
          gradient: gradient ? G.brandGradient : null,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: (gradient ? const Color(0xFF0A7A55) : bg).withValues(alpha: 0.28), blurRadius: 18, offset: const Offset(0, 8))],
        ),
        alignment: Alignment.center,
        child: AnimatedSwitcher(
          duration: G.motion(context, const Duration(milliseconds: 220)),
          child: loading
              ? const CupertinoActivityIndicator(color: CupertinoColors.white, key: ValueKey('l'))
              : Row(
                  key: ValueKey(label),
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[Icon(icon, color: textColor ?? CupertinoColors.white, size: 20), const SizedBox(width: 8)],
                    Flexible(child: Text(label, textAlign: TextAlign.center, style: G.headline(context).copyWith(color: textColor ?? CupertinoColors.white))),
                  ],
                ),
        ),
      ),
    );
  }
}

class TintedButton extends StatelessWidget {
  const TintedButton({super.key, required this.label, this.onTap, this.icon, this.color});
  final String label;
  final VoidCallback? onTap;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? G.tint.resolveFrom(context);
    return Pressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(980)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 17, color: c), const SizedBox(width: 6)],
          Flexible(child: Text(label, style: G.subhead(context).copyWith(color: c, fontWeight: FontWeight.w600))),
        ]),
      ),
    );
  }
}

class GroupCard extends StatelessWidget {
  const GroupCard({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.color});
  final Widget child;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final dark = CupertinoTheme.brightnessOf(context) == Brightness.dark;
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? G.card.resolveFrom(context),
        borderRadius: BorderRadius.circular(22),
        boxShadow: dark ? null : const [BoxShadow(color: Color(0x0A000000), blurRadius: 24, offset: Offset(0, 8)), BoxShadow(color: Color(0x05000000), blurRadius: 2)],
      ),
      child: child,
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(6, 26, 6, 10),
        child: Row(children: [
          Expanded(child: Text(text, style: G.title3(context))),
          ?trailing,
        ]),
      );
}

class Art3D extends StatelessWidget {
  const Art3D(this.asset, {super.key, this.size = 220});
  final String asset;
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: Image.asset(
          'assets/3d/$asset.png',
          width: size,
          height: size,
          filterQuality: FilterQuality.medium,
          gaplessPlayback: true,
          excludeFromSemantics: true,
        ),
      );
}

class PageDots extends StatelessWidget {
  const PageDots({super.key, required this.count, required this.page, this.color});
  final int count;
  final double page;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? G.label.resolveFrom(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(count, (i) {
        final d = (page - i).abs().clamp(0.0, 1.0);
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 4),
          width: 8 + 18 * (1 - d),
          height: 8,
          decoration: BoxDecoration(color: c.withValues(alpha: 0.22 + 0.78 * (1 - d)), borderRadius: BorderRadius.circular(4)),
        );
      }),
    );
  }
}

class CodeDigits extends StatelessWidget {
  const CodeDigits({super.key, required this.code, this.light = false});
  final String code;
  final bool light;

  static String semanticsLabel(String code) => Copy.I.t('a11y.callCode', {'digits': code.split('').join(' ')});

  @override
  Widget build(BuildContext context) {
    final reduce = G.reduceMotion(context);
    final digits = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < code.length; i++)
          TweenAnimationBuilder<double>(
            key: ValueKey('$code$i'),
            tween: Tween(begin: reduce ? 1 : 0, end: 1),
            duration: reduce ? Duration.zero : Duration(milliseconds: 560 + i * 90),
            curve: G.spring,
            builder: (context, v, child) => Opacity(
              opacity: v.clamp(0, 1),
              child: Transform(
                alignment: Alignment.center,
                transform: Matrix4.identity()
                  ..setEntry(3, 2, 0.002)
                  ..rotateX((1 - v) * -1.2)
                  ..translateByDouble(0, (1 - v) * 14, 0, 1),
                child: child,
              ),
            ),
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 6),
              width: 62,
              height: 78,
              alignment: Alignment.center,
              clipBehavior: Clip.hardEdge,
              decoration: BoxDecoration(
                color: light ? CupertinoColors.white.withValues(alpha: 0.22) : G.fill.resolveFrom(context),
                borderRadius: BorderRadius.circular(16),
                border: light ? Border.all(color: CupertinoColors.white.withValues(alpha: 0.35)) : null,
              ),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                code[i],
                style: TextStyle(
                  fontFamily: G.displayFamily,
                  fontSize: 42,
                  fontWeight: FontWeight.w700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: light ? CupertinoColors.white : G.label.resolveFrom(context),
                ),
              ),
              ),
            ),
          ),
      ],
    );
    return Semantics(
      container: true,
      label: semanticsLabel(code),
      child: ExcludeSemantics(child: FittedBox(fit: BoxFit.scaleDown, child: digits)),
    );
  }
}

class Reveal extends StatelessWidget {
  const Reveal({super.key, required this.child, this.delay = Duration.zero, this.offset = 16});
  final Widget child;
  final Duration delay;
  final double offset;

  @override
  Widget build(BuildContext context) {
    if (G.reduceMotion(context)) return child;
    final total = const Duration(milliseconds: 650) + delay;
    final start = delay.inMilliseconds / total.inMilliseconds;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: total,
      builder: (context, raw, child) {
        final v = G.spring.transform(((raw - start) / (1 - start)).clamp(0.0, 1.0));
        return Opacity(opacity: v, child: Transform.translate(offset: Offset(0, offset * (1 - v)), child: child));
      },
      child: child,
    );
  }
}

class Shimmer extends StatefulWidget {
  const Shimmer({super.key, this.lines = 3});
  final int lines;

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (G.reduceMotion(context)) {
      _c.stop();
      _c.value = 0.5;
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = G.fill.resolveFrom(context);
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: List.generate(widget.lines, (i) {
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            height: 13,
            width: i == widget.lines - 1 ? 160 : double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(7),
              gradient: LinearGradient(
                begin: Alignment(-1.5 + 3 * _c.value, 0),
                end: Alignment(-0.5 + 3 * _c.value, 0),
                colors: [base, base.withValues(alpha: base.a * 0.35), base],
              ),
            ),
          );
        }),
      ),
    );
  }
}

class BankLogo extends StatelessWidget {
  const BankLogo({super.key, required this.name, this.url, this.size = 40});
  final String name;
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(size * 0.26);
    final monogram = Container(
      decoration: BoxDecoration(gradient: G.brandGradient, borderRadius: radius),
      alignment: Alignment.center,
      child: Text(name.isEmpty ? '' : name.substring(0, 1).toUpperCase(),
          style: G.headline(context).copyWith(color: CupertinoColors.white, fontSize: size * 0.42)),
    );
    return ExcludeSemantics(
      child: SizedBox(
        width: size,
        height: size,
        child: url == null
            ? monogram
            : ClipRRect(
                borderRadius: radius,
                child: Image.network(
                  url!,
                  fit: BoxFit.contain,
                  filterQuality: FilterQuality.medium,
                  errorBuilder: (_, _, _) => monogram,
                  frameBuilder: (context, child, frame, sync) => sync || frame != null
                      ? Container(
                          decoration: BoxDecoration(
                            color: CupertinoColors.white,
                            borderRadius: radius,
                            border: Border.all(color: G.separator.resolveFrom(context), width: 0.5),
                          ),
                          padding: EdgeInsets.all(size * 0.12),
                          child: child,
                        )
                      : Container(decoration: BoxDecoration(color: G.fill.resolveFrom(context), borderRadius: radius)),
                ),
              ),
      ),
    );
  }
}

/// A grouped settings list in the iOS inset style: a small grey capitals header, one rounded card of
/// rows divided by hairlines inset to the row text, and an optional grey footer.
class SettingsSection extends StatelessWidget {
  const SettingsSection({super.key, this.header, this.footer, required this.children});
  final String? header;
  final String? footer;
  final List<Widget> children;

  /// Where row text starts inside the card: the row inset, the icon badge and the gap after it.
  static const textStart = SettingsRow.inset + SettingsRow.badge + SettingsRow.gap;

  @override
  Widget build(BuildContext context) {
    final line = G.separator.resolveFrom(context);
    final hairline = 1 / MediaQuery.devicePixelRatioOf(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (header != null)
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(SettingsRow.inset, 26, SettingsRow.inset, 7),
            child: Semantics(header: true, child: Text(header!.toUpperCase(), style: G.footnote(context).copyWith(letterSpacing: 0.2))),
          )
        else
          const SizedBox(height: 20),
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: ColoredBox(
            color: G.card.resolveFrom(context),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0)
                  Padding(
                    padding: EdgeInsetsDirectional.only(start: children[i] is SettingsRow && (children[i] as SettingsRow).icon == null ? SettingsRow.inset : textStart),
                    child: Container(height: hairline, color: line),
                  ),
                children[i],
              ],
            ]),
          ),
        ),
        if (footer != null)
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(SettingsRow.inset, 7, SettingsRow.inset, 0),
            child: Text(footer!, style: G.footnote(context)),
          ),
      ]),
    );
  }
}

/// One settings row: an optional coloured icon badge, a title with an optional grey subtitle, and a
/// right-aligned value, control or chevron. Titles in a section all start on the same vertical line.
class SettingsRow extends StatefulWidget {
  const SettingsRow({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    this.iconColor,
    this.value,
    this.trailing,
    this.onTap,
    this.chevron = false,
    this.destructive = false,
  });

  static const inset = 16.0;
  static const badge = 30.0;
  static const gap = 14.0;

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color? iconColor;
  final String? value;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool chevron;
  final bool destructive;

  @override
  State<SettingsRow> createState() => _SettingsRowState();
}

class _SettingsRowState extends State<SettingsRow> {
  bool _down = false;

  void _press(bool down) {
    if (_down != down) setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) {
    final w = widget;
    final red = G.red.resolveFrom(context);
    final badgeColor = w.destructive ? red : (w.iconColor ?? G.tint.resolveFrom(context));
    // At accessibility text sizes the value or control moves under the title, as iOS does, so the title keeps the width.
    final stacked = MediaQuery.textScalerOf(context).scale(10) >= 16;
    final row = Padding(
      padding: EdgeInsetsDirectional.fromSTEB(SettingsRow.inset, 10, w.chevron ? 12 : SettingsRow.inset, 10),
      child: Row(children: [
        if (w.icon != null) ...[
          Container(
            width: SettingsRow.badge,
            height: SettingsRow.badge,
            decoration: BoxDecoration(color: badgeColor, borderRadius: BorderRadius.circular(8)),
            child: Icon(w.icon, size: 18, color: CupertinoColors.white),
          ),
          const SizedBox(width: SettingsRow.gap),
        ],
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(w.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: G.body(context).copyWith(color: w.destructive ? red : null)),
            if (w.subtitle != null) ...[
              const SizedBox(height: 2),
              Text(w.subtitle!, style: G.footnote(context)),
            ],
            if (stacked && w.value != null) Text(w.value!, style: G.body(context).copyWith(color: G.label2.resolveFrom(context))),
            if (stacked && w.trailing != null) Padding(padding: const EdgeInsets.only(top: 4), child: w.trailing),
          ]),
        ),
        if (!stacked && w.value != null) ...[
          const SizedBox(width: 10),
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.32),
            child: Text(w.value!, maxLines: 1, overflow: TextOverflow.ellipsis, style: G.body(context).copyWith(color: G.label2.resolveFrom(context))),
          ),
        ],
        if (!stacked && w.trailing != null) ...[const SizedBox(width: 10), w.trailing!],
        if (w.chevron) ...[
          const SizedBox(width: 6),
          Icon(CupertinoIcons.chevron_forward, size: 16, color: G.label3.resolveFrom(context)),
        ],
      ]),
    );
    final body = AnimatedContainer(
      duration: G.motion(context, Duration(milliseconds: _down ? 0 : 220)),
      color: _down ? CupertinoColors.systemFill.resolveFrom(context) : const Color(0x00000000),
      constraints: const BoxConstraints(minHeight: 52),
      alignment: AlignmentDirectional.centerStart,
      child: row,
    );
    if (w.onTap == null) return MergeSemantics(child: body);
    return MergeSemantics(
      child: Semantics(
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (_) => _press(true),
          onTapUp: (_) => _press(false),
          onTapCancel: () => _press(false),
          onTap: w.onTap,
          child: body,
        ),
      ),
    );
  }
}

/// A small tinted capsule button for a settings row, keeping a 44pt tap target.
class SettingsButton extends StatelessWidget {
  const SettingsButton({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = G.tint.resolveFrom(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Semantics(
        button: true,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44, minWidth: 44),
          child: Center(
            widthFactor: 1,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(980)),
              child: Text(label, maxLines: 1, style: G.subhead(context).copyWith(color: c, fontWeight: FontWeight.w600)),
            ),
          ),
        ),
      ),
    );
  }
}

/// A plain "On" status for a settings row, with a check mark so it does not rely on colour alone.
class SettingsOn extends StatelessWidget {
  const SettingsOn(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = G.greenInk.resolveFrom(context);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(CupertinoIcons.checkmark_alt, size: 16, color: c),
      const SizedBox(width: 4),
      Text(label, maxLines: 1, style: G.body(context).copyWith(color: c)),
    ]);
  }
}
