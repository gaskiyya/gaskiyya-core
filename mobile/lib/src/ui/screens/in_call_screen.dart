import 'dart:async';

import 'package:flutter/cupertino.dart';

import '../../core/copy.dart';
import '../../core/session.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

String callTime(Duration d) {
  final s = d.inSeconds.clamp(0, 359999);
  final mmss = '${(s ~/ 60) % 60}:${(s % 60).toString().padLeft(2, '0')}';
  return s >= 3600 ? '${s ~/ 3600}:${mmss.padLeft(5, '0')}' : mmss;
}

class InCallScreen extends StatefulWidget {
  const InCallScreen({super.key, required this.call, required this.onEnd});
  final CallRecord call;
  final VoidCallback onEnd;

  @override
  State<InCallScreen> createState() => _InCallScreenState();
}

class _InCallScreenState extends State<InCallScreen> {
  late final Timer _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final call = widget.call;
    final white = CupertinoColors.white;
    final soft = white.withValues(alpha: 0.85);
    return BlockSemantics(
      child: Container(
        decoration: const BoxDecoration(gradient: G.brandGradient),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
            child: Column(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: white.withValues(alpha: 0.22)),
                  child: Icon(CupertinoIcons.phone_fill, color: white, size: 30),
                ),
                const SizedBox(height: 16),
                Text(
                  c.t('app.calls.inCall', {'bank': call.bank}),
                  textAlign: TextAlign.center,
                  style: G.title2(context).copyWith(color: white),
                ),
                if (call.purpose != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    c.purpose(call.purpose!).cap,
                    textAlign: TextAlign.center,
                    style: G.subhead(context).copyWith(color: soft),
                  ),
                ],
                const SizedBox(height: 10),
                Text(
                  callTime(DateTime.now().difference(call.answeredAt ?? call.at)),
                  key: const ValueKey('callTimer'),
                  style: G.title3(context).copyWith(color: white, fontFeatures: const [FontFeature.tabularFigures()]),
                ),
                const Spacer(),
                Text(
                  c.t('call.calling.codeLabel').toUpperCase(),
                  style: G.caption(context).copyWith(color: white.withValues(alpha: 0.8), fontWeight: FontWeight.w700, letterSpacing: 1.2),
                ),
                const SizedBox(height: 10),
                CodeDigits(code: call.code, light: true),
                const SizedBox(height: 18),
                Text(
                  c.t('call.mismatch'),
                  textAlign: TextAlign.center,
                  style: G.callout(context).copyWith(color: white, fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                Semantics(
                  button: true,
                  label: c.t('app.calls.end'),
                  child: Pressable(
                    onTap: widget.onEnd,
                    child: Container(
                      width: 74,
                      height: 74,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: G.red.resolveFrom(context),
                        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 18, offset: Offset(0, 8))],
                      ),
                      child: Transform.rotate(angle: 2.36, child: Icon(CupertinoIcons.phone_fill, color: white, size: 32)),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                ExcludeSemantics(
                  child: Text(c.t('app.calls.end'), style: G.footnote(context).copyWith(color: soft)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
