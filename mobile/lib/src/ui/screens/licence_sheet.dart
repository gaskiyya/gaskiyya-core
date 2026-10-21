import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

Future<void> showLicenceCheck(BuildContext context, GaskiyaClient client) {
  return showCupertinoSheet<void>(
    context: context,
    scrollableBuilder: (_, controller) => LicenceSheet(client: client, controller: controller),
  );
}

class LicenceSheet extends StatefulWidget {
  const LicenceSheet({super.key, required this.client, this.controller, this.initialQuery});
  final GaskiyaClient client;
  final ScrollController? controller;
  final String? initialQuery;

  @override
  State<LicenceSheet> createState() => _LicenceSheetState();
}

class _LicenceSheetState extends State<LicenceSheet> {
  late final _ctrl = TextEditingController(text: widget.initialQuery ?? '');
  final _focus = FocusNode();
  LicenceResult? _result;
  bool _checking = false;
  bool _rateLimited = false;

  Copy get c => Copy.I;

  @override
  void initState() {
    super.initState();
    _ctrl.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  bool get _canCheck => _ctrl.text.trim().length >= 2 && !_checking;

  Future<void> _check() async {
    if (!_canCheck) return;
    _focus.unfocus();
    setState(() {
      _checking = true;
      _rateLimited = false;
    });
    LicenceResult r;
    try {
      r = await widget.client.checkLicence(_ctrl.text);
    } on ApiException catch (e) {
      _rateLimited = e.status == 429;
      r = LicenceResult.unavailable();
    }
    if (!mounted) return;
    setState(() {
      _result = r;
      _checking = false;
    });
    switch (r.verdict) {
      case LicenceVerdict.licensed:
        HapticFeedback.selectionClick();
      case LicenceVerdict.notListed:
        HapticFeedback.heavyImpact();
      case LicenceVerdict.cannotCheck:
        HapticFeedback.lightImpact();
    }
  }

  String _category(String key) {
    final t = c.t('licence.categories.$key');
    return t == 'licence.categories.$key' ? key : t;
  }

  ({String art, Color tint, String tag, String title, String body}) _view(LicenceResult r) {
    final regulators = c.orList(r.regulators.map((x) => x.name).toList());
    switch (r.verdict) {
      case LicenceVerdict.licensed:
        final f = r.firm!;
        return (
          art: 'shield',
          tint: CupertinoColors.systemBlue,
          tag: c.t('licence.licensed.short'),
          title: c.t('licence.licensed.title'),
          body: c.t('licence.licensed.body', {'name': f.name, 'regulator': f.regulator, 'category': _category(f.category)}),
        );
      case LicenceVerdict.notListed:
        return (
          art: 'verdict_not_confirmed',
          tint: G.orange,
          tag: c.t('licence.not_listed.short'),
          title: c.t('licence.not_listed.title'),
          body: c.t('licence.not_listed.body', {'regulators': regulators.isEmpty ? 'FCCPC, CBN, SEC' : regulators}),
        );
      case LicenceVerdict.cannotCheck:
        return (
          art: 'verdict_cannot_check',
          tint: CupertinoColors.systemGrey,
          tag: c.t('licence.cannot_check.short'),
          title: c.t('licence.cannot_check.title'),
          body: c.t('licence.cannot_check.body'),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      backgroundColor: G.bg.resolveFrom(context),
      child: SafeArea(
        bottom: false,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
            child: Row(children: [
              Expanded(child: Semantics(header: true, child: Text(c.t('licence.title'), style: G.headline(context)))),
              CupertinoButton(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                onPressed: () => Navigator.of(context).pop(),
                child: Text(c.t('app.common.done'), style: G.headline(context).copyWith(color: G.tint.resolveFrom(context))),
              ),
            ]),
          ),
          Expanded(
            child: ListView(
              controller: widget.controller,
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
              children: [
                Text(c.t('licence.intro'), style: G.subhead(context)),
                const SizedBox(height: 14),
                GroupCard(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: CupertinoTextField.borderless(
                    key: const ValueKey('licence-query'),
                    controller: _ctrl,
                    focusNode: _focus,
                    padding: EdgeInsets.zero,
                    placeholder: c.t('licence.placeholder'),
                    placeholderStyle: G.body(context).copyWith(color: G.label3.resolveFrom(context)),
                    style: G.body(context),
                    maxLength: 200,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _check(),
                  ),
                ),
                const SizedBox(height: 14),
                PrimaryButton(
                  key: const ValueKey('licence-check'),
                  label: c.t('licence.check'),
                  icon: CupertinoIcons.checkmark_seal_fill,
                  gradient: _canCheck,
                  loading: _checking,
                  onTap: _canCheck ? _check : null,
                ),
                if (_checking) ...[
                  const SizedBox(height: 18),
                  Center(child: Text(c.t('licence.checking'), style: G.subhead(context))),
                ],
                if (_result != null && !_checking) ..._content(context, _result!),
                const SizedBox(height: 26),
                Text(c.t('safety.neverAsks'), textAlign: TextAlign.center, style: G.caption(context)),
              ],
            ),
          ),
        ]),
      ),
    );
  }

  List<Widget> _content(BuildContext context, LicenceResult r) {
    final v = _view(r);
    final tint = CupertinoDynamicColor.resolve(v.tint, context);
    final sample = (r.firm?.source.sample ?? false) || r.sources.any((s) => s.sample);
    return [
      const SizedBox(height: 18),
      Reveal(
        child: Semantics(
          liveRegion: true,
          container: true,
          child: Column(children: [
            Art3D(v.art, size: 132),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(color: tint.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(99)),
              child: Text(v.tag.toUpperCase(), style: G.caption(context).copyWith(color: tint, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
            ),
            const SizedBox(height: 12),
            Text(v.title, textAlign: TextAlign.center, style: G.title2(context)),
            const SizedBox(height: 10),
            Text(v.body, textAlign: TextAlign.center, style: G.callout(context).copyWith(color: G.label2.resolveFrom(context), height: 1.45)),
          ]),
        ),
      ),
      if (_rateLimited) ...[const SizedBox(height: 12), Text(c.t('app.result.rateLimited'), textAlign: TextAlign.center, style: G.footnote(context))],
      if (r.similarTo != null) ...[
        const SizedBox(height: 16),
        GroupCard(
          key: const ValueKey('licence-similar'),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(CupertinoIcons.exclamationmark_triangle_fill, size: 18, color: G.orange.resolveFrom(context)),
            const SizedBox(width: 10),
            Expanded(child: Text(c.t('licence.similar', {'name': r.similarTo!.name}), style: G.subhead(context).copyWith(color: G.label.resolveFrom(context), fontWeight: FontWeight.w600))),
          ]),
        ),
      ],
      if (r.firm != null) ...[
        const SizedBox(height: 18),
        GroupCard(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
          child: Column(children: [
            _row(context, c.t('licence.regulator'), r.firm!.regulator),
            _row(context, c.t('licence.category'), _category(r.firm!.category).cap),
            if (r.firm!.status != null) _row(context, c.t('licence.status'), r.firm!.status!),
            _row(context, c.t('licence.source'), r.firm!.source.title),
            _row(context, c.t('licence.listDate'), r.firm!.source.retrievedAt, last: true),
          ]),
        ),
      ],
      if (r.verdict == LicenceVerdict.notListed && r.sources.isNotEmpty) ...[
        const SizedBox(height: 14),
        Text(
          c.t('licence.listsChecked', {'lists': {for (final s in r.sources) s.regulator: '${s.regulator} (${s.retrievedAt})'}.values.join(', ')}),
          textAlign: TextAlign.center,
          style: G.caption(context),
        ),
      ],
      if (r.regulators.isNotEmpty) ...[
        const SizedBox(height: 8),
        Text(r.regulators.map((x) => '${x.name}: ${x.url}').join('\n'), textAlign: TextAlign.center, style: G.caption(context)),
      ],
      if (sample) ...[const SizedBox(height: 8), Text(c.t('licence.sample'), textAlign: TextAlign.center, style: G.caption(context))],
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
}
