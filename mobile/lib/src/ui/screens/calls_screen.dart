import 'dart:async';

import 'package:flutter/cupertino.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../../core/session.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

String callTime(Duration d) {
  final s = d.inSeconds.clamp(0, 359999);
  final mmss = '${(s ~/ 60) % 60}:${(s % 60).toString().padLeft(2, '0')}';
  return s >= 3600 ? '${s ~/ 3600}:${mmss.padLeft(5, '0')}' : mmss;
}

class CallsScreen extends StatefulWidget {
  const CallsScreen({super.key, required this.state});
  final AppState state;

  @override
  State<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends State<CallsScreen> {
  bool _checking = false;

  Future<void> _refresh() async {
    setState(() => _checking = true);
    await widget.state.refreshCall();
    if (mounted) setState(() => _checking = false);
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    return CupertinoPageScaffold(
      child: CustomScrollView(
        physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
        slivers: [
          CupertinoSliverNavigationBar(largeTitle: Text(c.t('app.tabs.calls')), border: null, backgroundColor: G.bg.resolveFrom(context).withValues(alpha: 0.85)),
          CupertinoSliverRefreshControl(onRefresh: _refresh),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            sliver: SliverToBoxAdapter(
              child: ListenableBuilder(
                listenable: widget.state,
                builder: (context, _) {
                  final state = widget.state;
                  final calls = [for (final l in state.calling) for (final x in l.liveCalls) (bank: l.bank.name, call: x)];
                  final unchecked = state.callUnchecked;
                  final names = state.links.map((l) => l.bank.name).toList();
                  final bank = names.length == 1 ? names.single : c.t('app.common.yourBank');
                  final log = state.callLog;
                  // Only while a call no bank vouches for is ringing or on (the demo's fraud call): say who isn't calling.
                  final spoofed = state.unverifiedCall;
                  final spoofedBank = spoofed == null
                      ? null
                      : state.links.where((l) => l.id == spoofed.orgId).firstOrNull?.bank.name ?? (spoofed.bank.isNotEmpty ? spoofed.bank : bank);
                  return Column(children: [
                    AnimatedSwitcher(
                      duration: G.motion(context, const Duration(milliseconds: 520)),
                      switchInCurve: G.spring,
                      switchOutCurve: Curves.easeIn,
                      // Drop the outgoing view so quick updates never overlap.
                      layoutBuilder: (current, previous) => Stack(alignment: Alignment.topCenter, children: [?current]),
                      transitionBuilder: (child, a) => FadeTransition(
                        opacity: a,
                        child: ScaleTransition(scale: Tween(begin: 0.94, end: 1.0).animate(a), child: child),
                      ),
                      child: calls.isNotEmpty
                          ? _calling(context, c, calls)
                          : unchecked.isNotEmpty
                              ? _cannotCheck(context, c, [for (final l in unchecked) l.bank.name], named: names.length > 1)
                              : spoofedBank != null
                                  ? _notCalling(context, c, spoofedBank)
                                  : _idle(context, c, empty: log.isEmpty),
                    ),
                    if (log.isNotEmpty) ...[
                      SectionHeader(c.t('app.calls.recent')),
                      GroupCard(
                        padding: EdgeInsets.zero,
                        child: Column(children: [
                          for (final (i, r) in log.indexed) ...[
                            if (i > 0) Container(height: 0.5, margin: const EdgeInsets.only(left: 64), color: G.separator.resolveFrom(context)),
                            _LogRow(record: r),
                          ],
                        ]),
                      ),
                    ],
                  ]);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _calling(BuildContext context, Copy c, List<({String bank, CallSession call})> calls) {
    return Column(
      key: const ValueKey('calling'),
      children: [
        for (final x in calls) ...[_callCard(context, c, x.bank, x.call), const SizedBox(height: 16)],
        GroupCard(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(CupertinoIcons.exclamationmark_triangle_fill, size: 18, color: G.orange.resolveFrom(context)),
            const SizedBox(width: 10),
            Expanded(child: Text(c.t(calls.length > 1 ? 'call.mismatchMany' : 'call.mismatch'), style: G.subhead(context).copyWith(color: G.label.resolveFrom(context), fontWeight: FontWeight.w600))),
          ]),
        ),
        const SizedBox(height: 22),
        PrimaryButton(label: c.t('app.calls.checkAgain'), icon: CupertinoIcons.arrow_clockwise, loading: _checking, onTap: _refresh),
      ],
    );
  }

  Widget _cannotCheck(BuildContext context, Copy c, List<String> banks, {bool named = false}) {
    final bank = c.orList(banks);
    return Column(
      key: const ValueKey('unchecked'),
      children: [
        Icon(CupertinoIcons.exclamationmark_circle, size: 64, color: G.orange.resolveFrom(context)),
        const SizedBox(height: 14),
        if (named) ...[
          Text(bank, textAlign: TextAlign.center, style: G.headline(context)),
          const SizedBox(height: 4),
        ],
        Text(c.t('verdict.cannot_check.title'), textAlign: TextAlign.center, style: G.title1(context)),
        const SizedBox(height: 10),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(c.t('verdict.cannot_check.body', {'bank': bank}),
              textAlign: TextAlign.center, style: G.callout(context).copyWith(color: G.label2.resolveFrom(context), height: 1.45)),
        ),
        const SizedBox(height: 26),
        PrimaryButton(label: c.t('app.calls.checkAgain'), icon: CupertinoIcons.arrow_clockwise, loading: _checking, onTap: _refresh),
      ],
    );
  }

  Widget _callCard(BuildContext context, Copy c, String bank, CallSession call) {
    return Column(
      key: ValueKey(call.id),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(20, 26, 20, 24),
          decoration: BoxDecoration(
            gradient: G.brandGradient,
            borderRadius: BorderRadius.circular(28),
            boxShadow: const [BoxShadow(color: Color(0x550A7A55), blurRadius: 32, offset: Offset(0, 14))],
          ),
          child: Column(children: [
            const _Pulse(),
            const SizedBox(height: 14),
            Text(c.t('call.calling.title', {'bank': bank}),
                textAlign: TextAlign.center, style: G.title2(context).copyWith(color: CupertinoColors.white)),
            const SizedBox(height: 6),
            Text(c.purpose(call.purpose).cap, style: G.subhead(context).copyWith(color: CupertinoColors.white.withValues(alpha: 0.85))),
            const SizedBox(height: 22),
            Text(c.t('call.calling.codeLabel').toUpperCase(),
                style: G.caption(context).copyWith(color: CupertinoColors.white.withValues(alpha: 0.8), fontWeight: FontWeight.w700, letterSpacing: 1.2)),
            const SizedBox(height: 10),
            CodeDigits(code: call.code, light: true),
            const SizedBox(height: 18),
            if (call.status == 'open') _Countdown(expiresAt: call.expiresAt),
          ]),
        ),
      ],
    );
  }

  // No call is coming in: nothing to warn about. How it works, and the call log below (or that there is none yet).
  Widget _idle(BuildContext context, Copy c, {required bool empty}) {
    return Column(
      key: const ValueKey('idle'),
      children: [
        if (empty) ...[
          const SizedBox(height: 4),
          const Art3D('call', size: 200),
          const SizedBox(height: 6),
          Text(c.t('app.calls.empty'), textAlign: TextAlign.center, style: G.title2(context)),
          const SizedBox(height: 18),
        ],
        _howItWorks(context, c),
      ],
    );
  }

  Widget _howItWorks(BuildContext context, Copy c) {
    return GroupCard(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(color: G.green.resolveFrom(context).withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
          child: Icon(CupertinoIcons.bolt_fill, size: 18, color: G.greenInk.resolveFrom(context)),
        ),
        const SizedBox(width: 14),
        Expanded(child: Text(c.t('app.calls.howItWorks'), style: G.subhead(context))),
      ]),
    );
  }

  // A phone call is ringing or on that no bank vouches for: the bank it claims to be isn't calling.
  Widget _notCalling(BuildContext context, Copy c, String bank) {
    return Column(
      key: const ValueKey('none'),
      children: [
        const SizedBox(height: 4),
        Icon(CupertinoIcons.exclamationmark_shield_fill, size: 72, color: G.red.resolveFrom(context)),
        const SizedBox(height: 14),
        Text(c.t('official.org.notCallingTitle', {'bank': bank}), textAlign: TextAlign.center, style: G.title1(context)),
        const SizedBox(height: 10),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(c.t('call.not_calling.body', {'bank': bank}),
              textAlign: TextAlign.center, style: G.callout(context).copyWith(color: G.label2.resolveFrom(context), height: 1.45)),
        ),
        const SizedBox(height: 26),
        PrimaryButton(label: c.t('app.calls.checkAgain'), icon: CupertinoIcons.arrow_clockwise, loading: _checking, onTap: _refresh),
      ],
    );
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse();
  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (G.reduceMotion(context)) {
      _c.stop();
      _c.value = 0.3;
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
    return SizedBox(
      width: 84,
      height: 84,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => Stack(alignment: Alignment.center, children: [
          for (final o in [0.0, 0.5])
            Builder(builder: (context) {
              final t = (_c.value + o) % 1;
              return Container(
                width: 44 + 40 * t,
                height: 44 + 40 * t,
                decoration: BoxDecoration(shape: BoxShape.circle, color: CupertinoColors.white.withValues(alpha: 0.28 * (1 - t))),
              );
            }),
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: CupertinoColors.white),
            child: const Icon(CupertinoIcons.phone_fill, color: Color(0xFF0A7A55), size: 26),
          ),
        ]),
      ),
    );
  }
}

class _Countdown extends StatefulWidget {
  const _Countdown({required this.expiresAt});
  final DateTime expiresAt;
  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown> {
  late final Timer _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.expiresAt.difference(DateTime.now()).inSeconds.clamp(0, 9999);
    return Text(Copy.I.t('app.calls.validFor', {'time': '${left ~/ 60}:${(left % 60).toString().padLeft(2, '0')}'}),
        style: G.footnote(context).copyWith(color: CupertinoColors.white.withValues(alpha: 0.85), fontFeatures: const [FontFeature.tabularFigures()]));
  }
}

class _LogRow extends StatelessWidget {
  const _LogRow({required this.record});
  final CallRecord record;

  static String _when(DateTime t) {
    final now = DateTime.now();
    final clock = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    return t.year == now.year && t.month == now.month && t.day == now.day ? clock : '${t.day}/${t.month} $clock';
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final r = record;
    final missed = r.outcome == CallOutcome.missed;
    final color = switch (r.outcome) {
      CallOutcome.missed || CallOutcome.declined => G.red,
      CallOutcome.ringing || CallOutcome.active => G.tint,
      CallOutcome.answered => G.greenInk,
    }.resolveFrom(context);
    final duration = r.duration;
    final outcome = c.t('app.calls.outcome.${r.outcome.name}');
    final detail = [
      if (r.unverified) c.t('app.calls.notVerified'),
      if (r.code.isNotEmpty) c.t('app.calls.codeIs', {'code': r.code}),
      if (r.purpose != null) c.purpose(r.purpose!),
    ].join(' \u00b7 ');
    return Semantics(
      container: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 16, 12),
        child: Row(children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
            child: Icon(missed ? CupertinoIcons.phone_down_fill : CupertinoIcons.phone_fill, size: 18, color: color),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r.bank, style: G.headline(context).copyWith(color: missed ? color : null)),
              if (detail.isNotEmpty) Text(detail.cap, style: G.footnote(context)),
              Text.rich(TextSpan(children: [
                TextSpan(text: duration == null ? outcome : '$outcome \u00b7 ${callTime(duration)}', style: TextStyle(color: color, fontWeight: FontWeight.w600)),
                TextSpan(text: ' \u00b7 ${_when(r.at)}'),
              ]), style: G.footnote(context).copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
            ]),
          ),
        ]),
      ),
    );
  }
}
