import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../../core/session.dart';
import '../../core/text_tools.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

class LinkScreen extends StatefulWidget {
  const LinkScreen({super.key, required this.state, this.adding = false});
  final AppState state;

  final bool adding;

  @override
  State<LinkScreen> createState() => _LinkScreenState();
}

class _LinkScreenState extends State<LinkScreen> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  bool _busy = false;
  String? _error;
  List<Bank>? _banks;
  Bank? _bank;
  bool _loadFailed = false;

  @override
  void initState() {
    super.initState();
    if (widget.adding) _ctrl.text = widget.state.phone ?? '';
    _loadBanks();
  }

  Future<void> _loadBanks() async {
    setState(() => _loadFailed = false);
    try {
      final banks = await widget.state.loadBanks();
      if (!mounted) return;
      setState(() {
        _banks = banks;
        final linked = widget.state.links.map((l) => l.id).toSet();
        final open = banks.where((b) => !linked.contains(b.id)).toList();
        _bank = banks.length == 1 ? banks.single : (widget.adding && open.length == 1 ? open.single : null);
      });
      if (_bank != null) _focus.requestFocus();
    } catch (_) {
      if (mounted) setState(() => _loadFailed = true);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _choose(Bank bank) {
    setState(() {
      _bank = bank;
      _error = null;
    });
    _focus.requestFocus();
  }

  Future<void> _signIn() async {
    final bank = _bank;
    if (bank == null) {
      HapticFeedback.heavyImpact();
      setState(() => _error = Copy.I.t('app.link.chooseBank'));
      return;
    }
    final phone = normalisePhone(_ctrl.text);
    if (phone == null) {
      HapticFeedback.heavyImpact();
      setState(() => _error = Copy.I.t('app.link.enterNumber'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.state.link(phone, bank);
      HapticFeedback.mediumImpact();
      if (widget.adding && mounted) Navigator.of(context).pop();
    } catch (_) {
      setState(() => _error = Copy.I.t('app.link.cannotReachBank'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    return CupertinoPageScaffold(
      navigationBar: widget.adding ? CupertinoNavigationBar(middle: Text(Copy.I.t('banks.add')), border: null, transitionBetweenRoutes: false) : null,
      child: GestureDetector(
        onTap: () => _focus.unfocus(),
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            children: [
              const SizedBox(height: 28),
              const Reveal(child: Center(child: Art3D('app_tile', size: 140))),
              const SizedBox(height: 18),
              Reveal(
                delay: const Duration(milliseconds: 80),
                child: Text(c.t('app.link.title'), textAlign: TextAlign.center, style: G.largeTitle(context)),
              ),
              const SizedBox(height: 10),
              Reveal(
                delay: const Duration(milliseconds: 140),
                child: Text(
                  c.t('app.link.intro'),
                  textAlign: TextAlign.center,
                  style: G.callout(context).copyWith(color: G.label2.resolveFrom(context)),
                ),
              ),
              const SizedBox(height: 30),
              _bankSection(context),
              const SizedBox(height: 14),
              Reveal(
                delay: const Duration(milliseconds: 200),
                child: GroupCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  child: Row(
                    children: [
                      const _NigeriaFlag(),
                      const SizedBox(width: 8),
                      Text('+234', style: G.body(context).copyWith(fontWeight: FontWeight.w600)),
                      Container(width: 1, height: 28, margin: const EdgeInsets.symmetric(horizontal: 12), color: G.separator.resolveFrom(context)),
                      Expanded(
                        child: CupertinoTextField.borderless(
                          controller: _ctrl,
                          focusNode: _focus,
                          placeholder: c.t('app.link.mobileNumber'),
                          keyboardType: TextInputType.phone,
                          autofillHints: const [AutofillHints.telephoneNumber],
                          autocorrect: false,
                          style: G.body(context).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          textInputAction: TextInputAction.go,
                          onSubmitted: (_) => _signIn(),
                          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]')), LengthLimitingTextInputFormatter(16)],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (G.reduceMotion(context)) _errorLine(context) else AnimatedSize(duration: G.springFast, curve: G.spring, child: _errorLine(context)),
              const SizedBox(height: 14),
              Reveal(
                delay: const Duration(milliseconds: 260),
                child: PrimaryButton(key: const ValueKey('signIn'), label: c.t('app.link.title'), loading: _busy, onTap: _signIn, gradient: true),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _errorLine(BuildContext context) => _error == null
      ? const SizedBox(height: 12)
      : Padding(
          padding: const EdgeInsets.fromLTRB(6, 10, 6, 0),
          child: Text(_error!, style: G.footnote(context).copyWith(color: G.red.resolveFrom(context))),
        );

  Widget _bankSection(BuildContext context) {
    final c = Copy.I;
    final banks = _banks;
    if (_loadFailed) {
      return GroupCard(
        child: Row(
          children: [
            Expanded(child: Text(c.t('app.link.banksUnreachable'), style: G.subhead(context))),
            CupertinoButton(padding: EdgeInsets.zero, onPressed: _loadBanks, child: Text(c.t('app.common.tryAgain'))),
          ],
        ),
      );
    }
    if (banks == null) return const Padding(padding: EdgeInsets.symmetric(vertical: 14), child: CupertinoActivityIndicator());
    if (banks.isEmpty) {
      return GroupCard(child: Text(c.t('app.link.noBanks'), style: G.subhead(context)));
    }
    return Reveal(
      delay: const Duration(milliseconds: 180),
      child: GroupCard(
        padding: EdgeInsets.zero,
        child: Column(
          children: [
            for (var i = 0; i < banks.length; i++) ...[
              if (i > 0) Container(height: 0.5, margin: const EdgeInsets.only(left: 66), color: G.separator.resolveFrom(context)),
              Pressable(
                scale: 0.98,
                onTap: _busy || banks.length == 1 ? null : () => _choose(banks[i]),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    children: [
                      Container(
                        width: 38,
                        height: 38,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: G.tint.resolveFrom(context)),
                        child: Text(banks[i].name.substring(0, 1), style: G.subhead(context).copyWith(color: CupertinoColors.white, fontWeight: FontWeight.w700)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(banks[i].name, style: G.headline(context)),
                            if (banks[i].domains.isNotEmpty) Text(banks[i].domains.first, style: G.footnote(context)),
                          ],
                        ),
                      ),
                      if (_bank?.id == banks[i].id)
                        Icon(CupertinoIcons.checkmark_alt, size: 20, color: G.tint.resolveFrom(context))
                      else if (widget.state.links.any((l) => l.id == banks[i].id))
                        Text(Copy.I.t('banks.linked'), style: G.footnote(context).copyWith(color: G.greenInk.resolveFrom(context))),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _NigeriaFlag extends StatelessWidget {
  const _NigeriaFlag();

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: Container(
          width: 26,
          height: 18,
          foregroundDecoration: BoxDecoration(
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: const Color(0x1F000000), width: 0.5),
          ),
          child: const Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: ColoredBox(color: Color(0xFF008751))),
            Expanded(child: ColoredBox(color: Color(0xFFFFFFFF))),
            Expanded(child: ColoredBox(color: Color(0xFF008751))),
          ]),
        ),
      );
}
