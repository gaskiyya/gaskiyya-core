import 'package:flutter/cupertino.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../../core/session.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

class AdvisoriesSection extends StatelessWidget {
  const AdvisoriesSection({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: state,
        builder: (context, _) {
          final c = Copy.I;
          final links = state.links;
          return Column(
            key: const ValueKey('alerts'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(header: true, child: SectionHeader(c.t('advisory.section'))),
              for (final l in links) ..._bank(context, l),
            ],
          );
        },
      );

  List<Widget> _bank(BuildContext context, BankLink l) {
    final c = Copy.I;
    final list = l.advisories;
    final name = l.bank.name;
    if (list == null) return [const Padding(padding: EdgeInsets.only(bottom: 10), child: GroupCard(child: Shimmer(lines: 2)))];
    if (list.cannotCheck) {
      return [
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: GroupCard(
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(CupertinoIcons.exclamationmark_circle, color: G.orangeInk.resolveFrom(context), size: 22),
              const SizedBox(width: 12),
              Expanded(child: Text(c.t('advisory.unavailable', {'bank': name}), style: G.subhead(context))),
            ]),
          ),
        ),
      ];
    }
    if (list.advisories.isEmpty) {
      return [
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: GroupCard(
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(CupertinoIcons.shield, color: G.label2.resolveFrom(context), size: 22),
              const SizedBox(width: 12),
              Expanded(child: Text(c.t('advisory.none', {'bank': name}), style: G.subhead(context))),
            ]),
          ),
        ),
      ];
    }
    return [
      for (final (i, a) in list.advisories.indexed)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Reveal(delay: Duration(milliseconds: 60 * i), child: AdvisoryCard(advisory: a)),
        ),
    ];
  }
}

class AdvisoryCard extends StatelessWidget {
  const AdvisoryCard({super.key, required this.advisory});
  final Advisory advisory;

  static String date(DateTime d) => '${d.day} ${Copy.I.t('app.result.months').split(',')[d.month - 1]} ${d.year}';

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final a = advisory;
    final red = G.red.resolveFrom(context);
    return Semantics(
      container: true,
      child: GroupCard(
        key: ValueKey('advisory-${a.id}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ExcludeSemantics(
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: G.orange.resolveFrom(context).withValues(alpha: 0.14), borderRadius: BorderRadius.circular(9)),
                child: Icon(CupertinoIcons.exclamationmark_shield_fill, size: 20, color: G.orangeInk.resolveFrom(context)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Semantics(header: true, child: Text(c.t('advisory.title', {'bank': a.bank}), style: G.headline(context))),
                Text(c.t('advisory.issued', {'date': date(a.approvedAt)}), style: G.footnote(context)),
              ]),
            ),
          ]),
          const SizedBox(height: 10),
          Text(a.text, style: G.callout(context)),
          if (a.linkDomains.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(c.t('advisory.lookalikeLabel'), style: G.footnote(context)),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final d in a.linkDomains)
                Semantics(
                  container: true,
                  label: '${c.t('advisory.lookalikeLabel')}: $d',
                  excludeSemantics: true,
                  child: Container(
                    key: ValueKey('lookalike-$d'),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: red.withValues(alpha: 0.10),
                      border: Border.all(color: red.withValues(alpha: 0.55)),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(CupertinoIcons.xmark_octagon_fill, size: 15, color: red),
                      const SizedBox(width: 6),
                      Flexible(child: Text(d, style: G.subhead(context).copyWith(fontFamily: 'monospace', fontWeight: FontWeight.w700, color: red))),
                    ]),
                  ),
                ),
            ]),
          ],
          if (a.asksCallback) ...[
            const SizedBox(height: 12),
            Text(c.t('advisory.callbackNote'), style: G.subhead(context)),
          ],
          const SizedBox(height: 12),
          Text(c.t('advisory.until', {'date': date(a.expiresAt)}), style: G.caption(context)),
        ]),
      ),
    );
  }
}

class AlertBanner extends StatelessWidget {
  const AlertBanner({super.key, required this.bank, required this.onTap});

  final String? bank;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final shown = bank != null;
    final motion = G.motion(context, const Duration(milliseconds: 520));
    return AnimatedPositioned(
      duration: motion,
      curve: shown ? G.spring : Curves.easeInCubic,
      top: shown ? top + 6 : -220,
      left: 10,
      right: 10,
      child: Semantics(
        button: true,
        liveRegion: shown,
        label: shown ? '${Copy.I.t('advisory.title', {'bank': bank!})}. ${Copy.I.t('advisory.open')}' : null,
        excludeSemantics: true,
        child: Pressable(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 16, 12),
            decoration: BoxDecoration(
              color: const Color(0xF2111113),
              borderRadius: BorderRadius.circular(26),
              boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 30, offset: Offset(0, 12))],
            ),
            child: Row(children: [
              const Icon(CupertinoIcons.exclamationmark_shield_fill, color: Color(0xFFFF9F0A), size: 26),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(shown ? Copy.I.t('advisory.title', {'bank': bank!}) : '', style: G.headline(context).copyWith(color: CupertinoColors.white, fontSize: 15)),
                  Text(Copy.I.t('advisory.open'), style: G.footnote(context).copyWith(color: const Color(0xB3FFFFFF))),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
