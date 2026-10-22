import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../../core/ocr_mlkit.dart';
import '../../core/screenshot.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

enum CheckKind { message, link, screenshot, contact }

/// One organisation a message or link is checked against.
typedef CheckTarget = ({String bank, String kind, GaskiyaClient client});

class CheckRequest {
  CheckRequest.message(this.text) : kind = CheckKind.message, screenshot = null;
  CheckRequest.link(this.text) : kind = CheckKind.link, screenshot = null;
  CheckRequest.screenshot(Screenshot this.screenshot) : kind = CheckKind.screenshot, text = '';

  CheckRequest.contact(this.text) : kind = CheckKind.contact, screenshot = null;
  final CheckKind kind;
  final String text;
  final Screenshot? screenshot;
}

Future<void> showResult(BuildContext context, GaskiyaClient client, String bank, CheckRequest req, {String kind = 'bank', List<CheckTarget> others = const []}) {
  return showCupertinoSheet<void>(
    context: context,
    scrollableBuilder: (_, controller) => ResultSheet(client: client, bank: bank, kind: kind, request: req, controller: controller, others: others),
  );
}

class ResultSheet extends StatefulWidget {
  const ResultSheet({super.key, required this.client, required this.bank, required this.request, this.controller, this.reader, this.kind = 'bank', this.others = const []});
  final ScrollController? controller;

  final TextReader? reader;
  final GaskiyaClient client;
  final String bank;

  final String kind;
  final CheckRequest request;

  /// Further organisations the number belongs to. Messages and links are
  /// checked against all of them, and the strongest answer is shown.
  final List<CheckTarget> others;

  @override
  State<ResultSheet> createState() => _ResultSheetState();
}

class _ResultSheetState extends State<ResultSheet> {
  VerifyResult? _result;
  LinkResult? _link;
  ContactResult? _contact;
  bool _linkFailed = false;
  bool _rateLimited = false;
  bool _unreadable = false;
  Explanation? _explanation;
  bool _explaining = false;
  bool _reported = false;
  bool _slow = false;
  Timer? _slowTimer;

  late GaskiyaClient _client = widget.client;
  late String _kind = widget.kind;
  String? _pooled;

  Copy get c => Copy.I;
  String get _bank => _pooled ?? _result?.bank ?? _link?.bank ?? widget.bank;

  String _org(String path) => c.tOrg(path, _kind, {'bank': _bank});

  List<CheckTarget> get _targets => [(bank: widget.bank, kind: widget.kind, client: widget.client), ...widget.others];

  void _use(CheckTarget t, {required bool pooled}) {
    _client = t.client;
    _kind = t.kind;
    _pooled = pooled && widget.others.isNotEmpty ? c.orList([for (final x in _targets) x.bank]) : null;
  }

  Future<LinkResult?> _verifyLink(String url) async {
    final ts = _targets;
    final all = await Future.wait(ts.map((t) => t.client.verifyLink(url)));
    var i = all.indexWhere((l) => l != null && (l.belongs || l.officialApp));
    final strong = i >= 0;
    if (i < 0) i = all.indexWhere((l) => l != null);
    if (i < 0) return null;
    _use(ts[i], pooled: !strong);
    return all[i];
  }

  Future<VerifyResult> _verifyMessage(CheckRequest r) async {
    final ts = _targets;
    Future<VerifyResult> one(CheckTarget t) => r.kind == CheckKind.message
        ? t.client.verifyText(r.text)
        : checkScreenshot(t.client, widget.reader ?? defaultTextReader(), r.screenshot!);
    if (ts.length == 1) return one(ts.single);
    ApiException? failed;
    final all = await Future.wait(ts.map((t) => one(t).catchError((Object e) {
          if (e is! ApiException) throw e;
          failed ??= e;
          return VerifyResult.unavailable();
        })));
    if (failed != null && all.every((v) => v.verdict == Verdict.cannotCheck)) throw failed!;
    var i = all.indexWhere((v) => v.verdict == Verdict.confirmed);
    if (i < 0) i = all.indexWhere((v) => v.verdict == Verdict.notConfirmed);
    if (i < 0) i = 0;
    _use(ts[i], pooled: all[i].verdict != Verdict.confirmed);
    return all[i];
  }

  @override
  void initState() {
    super.initState();
    _slowTimer = Timer(const Duration(milliseconds: 180), () => mounted ? setState(() => _slow = true) : null);
    _run();
  }

  @override
  void dispose() {
    _slowTimer?.cancel();
    super.dispose();
  }

  Future<void> _run() async {
    final r = widget.request;
    try {
      switch (r.kind) {
        case CheckKind.link:
          final l = await _verifyLink(r.text);
          if (!mounted) return;
          setState(() => l == null ? _linkFailed = true : _link = l);
          if (l?.belongs == true || l?.officialApp == true) {
            HapticFeedback.selectionClick();
          } else {
            _haptic(l == null ? Verdict.cannotCheck : Verdict.notConfirmed);
          }
        case CheckKind.contact:
          final k = await widget.client.verifyContact(r.text);
          if (!mounted) return;
          setState(() => _contact = k);
          switch (k.verdict) {
            case ContactVerdict.official:
              HapticFeedback.selectionClick();
            case ContactVerdict.notOfficial:
              _haptic(Verdict.notConfirmed);
            case ContactVerdict.cannotCheck:
            case ContactVerdict.notAContact:
              _haptic(Verdict.cannotCheck);
          }
        case CheckKind.message:
        case CheckKind.screenshot:
          final v = await _verifyMessage(r);
          if (!mounted) return;
          setState(() => _result = v);
          _haptic(v.verdict);
          final text = r.kind == CheckKind.message ? r.text : v.extractedText;
          if (v.verdict == Verdict.notConfirmed && text != null && text.trim().isNotEmpty) _explain(text);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _rateLimited = e.status == 429;
        _unreadable = e.status == 422;
        _result = VerifyResult.unavailable();
        if (r.kind == CheckKind.contact) _contact = ContactResult.unavailable();
      });
    }
  }

  void _haptic(Verdict v) {
    switch (v) {
      case Verdict.confirmed:
        HapticFeedback.mediumImpact();
      case Verdict.notConfirmed:
        HapticFeedback.heavyImpact();
        Future<void>.delayed(const Duration(milliseconds: 120), HapticFeedback.heavyImpact);
      case Verdict.cannotCheck:
        HapticFeedback.lightImpact();
    }
  }

  Future<void> _explain(String text) async {
    setState(() => _explaining = true);
    final e = await _client.explain(text, language: c.language);
    if (mounted) {
      setState(() {
        _explanation = e;
        _explaining = false;
      });
    }
  }

  Future<void> _report() async {
    final text = widget.request.kind == CheckKind.message ? widget.request.text : (_result?.extractedText ?? '');
    final ok = await showCupertinoModalPopup<bool>(
      context: context,
      builder: (ctx) => CupertinoActionSheet(
        message: Text(_org('report.prompt')),
        actions: [CupertinoActionSheetAction(isDestructiveAction: true, onPressed: () => Navigator.pop(ctx, true), child: Text(c.t('report.consent')))],
        cancelButton: CupertinoActionSheetAction(onPressed: () => Navigator.pop(ctx, false), child: Text(c.t('app.common.cancel'))),
      ),
    );
    if (ok != true || text.isEmpty) return;
    final sent = await _client.report(text, _explanation?.indicators ?? const []);
    if (!mounted) return;
    HapticFeedback.mediumImpact();
    setState(() => _reported = sent);
  }

  ({String art, Color tint, String tag, String title, String body}) get _view {
    if (_contact != null) return _contactView(_contact!);
    if (_link != null) {
      final l = _link!;
      if (l.officialApp) {
        return (
          art: 'link',
          tint: CupertinoColors.systemBlue,
          tag: c.t('official.apps.short'),
          title: c.t('official.apps.officialTitle', {'org': _bank}),
          body: c.t('official.apps.officialBody', {'org': _bank}),
        );
      }
      return l.belongs
          ? (art: 'link', tint: CupertinoColors.systemBlue, tag: c.t('link.belongs.short'), title: _org('link.belongs.title'), body: c.t('link.belongs.body', {'domain': l.matchedDomain, 'bank': _bank}))
          : (art: 'verdict_not_confirmed', tint: G.orange, tag: c.t('verdict.not_confirmed.short'), title: c.t('link.not_confirmed.title'), body: c.t('link.not_confirmed.body', {'bank': _bank}));
    }
    final r = _result;
    if (_unreadable) {
      return (art: 'verdict_cannot_check', tint: CupertinoColors.systemGrey, tag: c.t('verdict.cannot_check.short'), title: c.t('verdict.cannot_check.title'), body: c.t('bot.screenshotUnread'));
    }
    if (r == null || _linkFailed || r.verdict == Verdict.cannotCheck) {
      return (art: 'verdict_cannot_check', tint: CupertinoColors.systemGrey, tag: c.t('verdict.cannot_check.short'), title: c.t('verdict.cannot_check.title'), body: _org('verdict.cannot_check.body'));
    }
    if (r.verdict == Verdict.confirmed) {
      final at = r.sentAt!;
      return (
        art: 'verdict_confirmed',
        tint: G.tint,
        tag: c.t('verdict.confirmed.short'),
        title: _org('verdict.confirmed.title'),
        body: c.t('verdict.confirmed.body', {'bank': _bank, 'channel': c.channel(r.channel!), 'date': _date(at), 'time': _time(at)}),
      );
    }
    return (art: 'verdict_not_confirmed', tint: G.orange, tag: c.t('verdict.not_confirmed.short'), title: c.t('verdict.not_confirmed.title'), body: c.t('verdict.not_confirmed.body', {'bank': _bank}));
  }

  ({String art, Color tint, String tag, String title, String body}) _contactView(ContactResult k) {
    switch (k.verdict) {
      case ContactVerdict.official:
        return (
          art: 'shield',
          tint: CupertinoColors.systemBlue,
          tag: c.t('official.contact.official.short'),
          title: c.t('official.contact.official.title'),
          body: [for (final m in k.matches) c.t('official.contact.official.body', {'org': m.name, 'contact': _contactKind(k, m)})].join('\n'),
        );
      case ContactVerdict.notOfficial:
        final org = k.organisation;
        return (
          art: 'verdict_not_confirmed',
          tint: G.orange,
          tag: c.t('official.contact.not_official.short'),
          title: c.t('official.contact.not_official.title'),
          body: org == null
              ? c.t('official.contact.not_official.bodyAny', {'contact': _contactKind(k)})
              : c.t('official.contact.not_official.body', {'org': org.name, 'contact': _contactKind(k)}),
        );
      case ContactVerdict.notAContact:
        return (art: 'verdict_cannot_check', tint: CupertinoColors.systemGrey, tag: '', title: '', body: c.t('official.contact.notAContact'));
      case ContactVerdict.cannotCheck:
        return (
          art: 'verdict_cannot_check',
          tint: CupertinoColors.systemGrey,
          tag: c.t('verdict.cannot_check.short'),
          title: c.t('verdict.cannot_check.title'),
          body: c.t('official.contact.cannotCheckBody'),
        );
    }
  }

  String _platform(String p) {
    final name = c.t('official.contact.platforms.$p');
    return name == 'official.contact.platforms.$p' ? p : name;
  }

  String _contactKind(ContactResult k, [OrgRef? match]) {
    var type = k.type ?? 'phone';
    if (match != null && match.as.isNotEmpty && !match.as.contains(type)) type = match.as.first;
    if (type == 'handle') return c.t('official.contact.kinds.social', {'platform': '@${k.value}'});
    if (type == 'social') {
      final p = match?.platforms.firstOrNull ?? k.platform;
      return c.t('official.contact.kinds.social', {'platform': p == null ? '@${k.value}' : _platform(p)});
    }
    return c.t('official.contact.kinds.$type');
  }

  String _contactValue(ContactResult k) => k.type == 'handle' || (k.type == 'social' && !RegExp(r'^\d+$').hasMatch(k.value!)) ? '@${k.value}' : k.value!;

  String _date(DateTime d) => '${d.day} ${c.t('app.result.months').split(',')[d.month - 1]} ${d.year}';
  String _time(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final done = _result != null || _link != null || _linkFailed || _contact != null;
    return CupertinoPageScaffold(
      backgroundColor: G.bg.resolveFrom(context),
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
              child: Row(
                children: [
                  Expanded(child: Text(_heading, style: G.headline(context))),
                  CupertinoButton(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(c.t('app.common.done'), style: G.headline(context).copyWith(color: G.tint.resolveFrom(context))),
                  ),
                ],
              ),
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: G.motion(context, const Duration(milliseconds: 380)),
                switchInCurve: G.spring,
                child: done ? _content(context) : _loading(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String get _heading => switch (widget.request.kind) {
        CheckKind.contact => c.t('official.app.contactCheck'),
        CheckKind.link => _link?.officialApp == true || _link?.appStore != null ? c.t('official.app.appCheck') : c.t('app.result.linkCheck'),
        _ => c.t('app.result.messageCheck'),
      };

  Widget _loading(BuildContext context) => Center(
        key: const ValueKey('loading'),
        child: AnimatedOpacity(
          opacity: _slow ? 1 : 0,
          duration: G.motion(context, const Duration(milliseconds: 200)),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const CupertinoActivityIndicator(radius: 14),
            const SizedBox(height: 14),
            Text(c.t('app.result.checking'), style: G.subhead(context)),
          ]),
        ),
      );

  Widget _content(BuildContext context) {
    final v = _view;
    final tint = CupertinoDynamicColor.resolve(v.tint, context);
    final r = _result;
    final reduce = G.reduceMotion(context);
    return ListView(
      key: const ValueKey('content'),
      controller: widget.controller,
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
      children: [
        SizedBox(
          height: 230,
          child: Stack(
            alignment: Alignment.center,
            children: [
              TweenAnimationBuilder<double>(
                tween: Tween(begin: reduce ? 1 : 0, end: 1),
                duration: reduce ? Duration.zero : const Duration(milliseconds: 900),
                curve: G.spring,
                builder: (context, t, _) => Container(
                  width: 240 * t,
                  height: 240 * t,
                  decoration: BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [tint.withValues(alpha: 0.28), tint.withValues(alpha: 0)])),
                ),
              ),
              Art3D(v.art, size: 196),
            ],
          ),
        ),
        Reveal(
          child: Column(
            children: [
              if (v.tag.isNotEmpty) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(color: tint.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(99)),
                  child: Text(v.tag.toUpperCase(), style: G.caption(context).copyWith(color: tint, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
                ),
                const SizedBox(height: 12),
              ],
              if (v.title.isNotEmpty) ...[
                Semantics(container: true, header: true, child: Text(v.title, textAlign: TextAlign.center, style: G.title1(context))),
                const SizedBox(height: 10),
              ],
              Text(v.body, textAlign: TextAlign.center, style: G.callout(context).copyWith(color: G.label2.resolveFrom(context), height: 1.45)),
            ],
          ),
        ),
        if (_rateLimited) ...[const SizedBox(height: 12), Text(c.t('app.result.rateLimited'), textAlign: TextAlign.center, style: G.footnote(context))],
        if (r != null && r.simSwapped) ...[const SizedBox(height: 18), _simBanner(context, 'sim_swapped_recently', c.t('simswap.title'), c.t('simswap.body'), G.red)],
        if (r != null && !r.simSwapped && r.simStatusUnknown) ...[const SizedBox(height: 18), _simBanner(context, 'sim_status_unknown', c.t('simswap.unknownTitle'), c.t('simswap.unknownBody'), G.orange)],
        if (r != null && r.verdict != Verdict.confirmed)
          for (final w in r.senderWarnings) ...[
            const SizedBox(height: 14),
            Row(key: ValueKey('warning-$w'), mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(CupertinoIcons.exclamationmark_triangle_fill, size: 16, color: G.orange.resolveFrom(context)),
              const SizedBox(width: 8),
              Flexible(child: Text(c.indicator(w), style: G.subhead(context).copyWith(color: G.label.resolveFrom(context), fontWeight: FontWeight.w600))),
            ]),
          ],
        if (_link != null && !_link!.belongs && !_link!.officialApp) ..._linkReasons(context),
        if (_contact != null) ..._contactDetails(context, _contact!),
        if (r != null && r.verdict == Verdict.confirmed) ...[const SizedBox(height: 26), Reveal(delay: const Duration(milliseconds: 120), child: _details(context, r))],
        if (r != null && r.verdict == Verdict.notConfirmed) ...[
          const SizedBox(height: 26),
          Reveal(delay: const Duration(milliseconds: 100), child: _activityCard(context, r)),
          const SizedBox(height: 14),
          Reveal(delay: const Duration(milliseconds: 180), child: _explainCard(context)),
          const SizedBox(height: 22),
          Reveal(
            delay: const Duration(milliseconds: 240),
            child: AnimatedSwitcher(
              duration: G.motion(context, const Duration(milliseconds: 300)),
              child: _reported
                  ? Row(key: const ValueKey('thanks'), mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(CupertinoIcons.checkmark_circle_fill, color: G.green.resolveFrom(context), size: 20),
                      const SizedBox(width: 8),
                      Flexible(child: Text(_org('report.thanks'), style: G.subhead(context))),
                    ])
                  : PrimaryButton(key: const ValueKey('report'), label: c.t('app.result.reportFake'), icon: CupertinoIcons.flag_fill, color: G.red.resolveFrom(context), onTap: _report),
            ),
          ),
        ],
        if (r?.extractedText != null) ...[
          const SizedBox(height: 22),
          Reveal(
            delay: const Duration(milliseconds: 280),
            child: GroupCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(c.t('app.result.screenshotText').toUpperCase(), style: G.caption(context).copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.5)),
                const SizedBox(height: 8),
                Text(r!.extractedText!, style: G.subhead(context).copyWith(color: G.label.resolveFrom(context))),
              ]),
            ),
          ),
        ],
        const SizedBox(height: 26),
        Text(c.t('safety.neverAsks'), textAlign: TextAlign.center, style: G.caption(context)),
      ],
    );
  }

  Widget _warning(BuildContext context, String text, {Key? key, IconData icon = CupertinoIcons.exclamationmark_triangle_fill, Color? color}) => MergeSemantics(
        key: key,
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: color ?? G.orange.resolveFrom(context)),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: G.subhead(context).copyWith(color: G.label.resolveFrom(context)))),
        ]),
      );

  List<Widget> _contactDetails(BuildContext context, ContactResult k) {
    if (k.verdict != ContactVerdict.official && k.verdict != ContactVerdict.notOfficial) return const [];
    final official = k.verdict == ContactVerdict.official;
    return [
      const SizedBox(height: 22),
      Reveal(
        delay: const Duration(milliseconds: 120),
        child: GroupCard(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
          child: Column(children: [
            MergeSemantics(child: _row(context, c.t('official.app.contact'), _contactValue(k), last: !official)),
            if (official) MergeSemantics(child: _row(context, c.t('official.app.organisation'), c.orList([for (final m in k.matches) m.name]), last: true)),
          ]),
        ),
      ),
      if (!official)
        for (final o in k.impersonates) ...[
          const SizedBox(height: 14),
          _warning(context, c.t('official.contact.impersonation', {'org': o.name}), key: ValueKey('impersonates-${o.id}')),
        ],
      if (official) ...[
        const SizedBox(height: 14),
        _warning(context, c.t('official.contact.spoofNote'), key: const ValueKey('spoof-note'), icon: CupertinoIcons.info_circle_fill, color: CupertinoColors.systemBlue.resolveFrom(context)),
      ],
    ];
  }

  Widget _simBanner(BuildContext context, String key, String title, String body, CupertinoDynamicColor color) {
    final tint = color.resolveFrom(context);
    return Semantics(
      key: ValueKey('warning-$key'),
      container: true,
      liveRegion: true,
      label: key == 'sim_swapped_recently' ? '${c.t('simswap.a11y')} $body' : '$title. $body',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: tint.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(16), border: Border.all(color: tint.withValues(alpha: 0.35))),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(CupertinoIcons.exclamationmark_triangle_fill, size: 20, color: tint),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: G.subhead(context).copyWith(color: G.label.resolveFrom(context), fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(body, style: G.footnote(context).copyWith(color: G.label.resolveFrom(context), height: 1.4)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  List<Widget> _linkReasons(BuildContext context) {
    final reasons = <String>[
      if (_link!.reasons.contains('apk')) c.t('official.apps.apk') else if (_link!.reasons.contains('fake_app')) c.t('official.apps.fakeApp', {'org': _bank}),
      if (_link!.reasons.contains('shortened')) c.t('link.shortened'),
      if (_link!.reasons.contains('lookalike') || _link!.reasons.contains('punycode')) _org('link.lookalike'),
    ];
    if (reasons.isEmpty && _link!.host == null) return const [];
    return [
      const SizedBox(height: 22),
      Reveal(
        delay: const Duration(milliseconds: 120),
        child: GroupCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (_link!.host != null) ...[
              Text(c.t('app.result.address').toUpperCase(), style: G.caption(context).copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.5)),
              const SizedBox(height: 4),
              Text(_link!.host!, style: G.headline(context).copyWith(fontFamily: 'monospace', fontSize: 16)),
            ],
            for (final r in reasons) ...[
              const SizedBox(height: 12),
              _warning(context, r),
            ],
          ]),
        ),
      ),
    ];
  }

  Widget _row(BuildContext context, String k, String v, {bool last = false}) => Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: G.separator.resolveFrom(context), width: 0.5))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: G.body(context)),
          const SizedBox(width: 12),
          Expanded(child: Text(v, textAlign: TextAlign.end, style: G.body(context).copyWith(color: G.label2.resolveFrom(context)))),
        ]),
      );

  Widget _details(BuildContext context, VerifyResult r) => GroupCard(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
        child: Column(children: [
          _row(context, c.t('app.result.from'), _bank),
          _row(context, c.t('app.result.channel'), c.channel(r.channel!)),
          _row(context, c.t('app.result.type'), c.category(r.category!).cap),
          _row(context, c.t('app.result.sent'), '${_date(r.sentAt!)}, ${_time(r.sentAt!)}', last: true),
        ]),
      );

  Widget _activityCard(BuildContext context, VerifyResult r) => GroupCard(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: G.tint.resolveFrom(context).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(CupertinoIcons.clock_fill, size: 19, color: G.tint.resolveFrom(context)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_org('activity.heading'), style: G.headline(context)),
              const SizedBox(height: 4),
              Text(r.activityText ?? '', style: G.subhead(context)),
            ]),
          ),
        ]),
      );

  Widget _explainCard(BuildContext context) {
    final e = _explanation;
    return GroupCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: G.orange.resolveFrom(context).withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
            child: Icon(CupertinoIcons.sparkles, size: 19, color: G.orange.resolveFrom(context)),
          ),
          const SizedBox(width: 14),
          Expanded(child: Text(c.t('explain.heading'), style: G.headline(context))),
        ]),
        const SizedBox(height: 14),
        AnimatedSize(
          duration: G.motion(context, G.springFast),
          curve: G.spring,
          alignment: Alignment.topCenter,
          child: AnimatedSwitcher(
            duration: G.motion(context, const Duration(milliseconds: 280)),
            child: _explaining || (e == null && _explaining)
                ? const Shimmer(key: ValueKey('s'))
                : Column(
                    key: const ValueKey('e'),
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (e != null && e.indicators.isNotEmpty) ...[
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          for (final i in e.indicators)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(color: G.red.resolveFrom(context).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(99)),
                              child: Text(c.indicator(i), style: G.caption(context).copyWith(color: G.red.resolveFrom(context), fontWeight: FontWeight.w600)),
                            ),
                        ]),
                        const SizedBox(height: 12),
                      ],
                      Text(e?.explanation ?? _org('explain.fallback'), style: G.subhead(context).copyWith(color: G.label.resolveFrom(context))),
                      const SizedBox(height: 10),
                      Text(e?.action ?? _org('explain.action'), style: G.subhead(context).copyWith(color: G.label.resolveFrom(context), fontWeight: FontWeight.w600)),
                      if (e?.fromModel == true) ...[const SizedBox(height: 10), Text(c.t('explain.aiNote'), style: G.caption(context))],
                    ],
                  ),
          ),
        ),
      ]),
    );
  }
}
