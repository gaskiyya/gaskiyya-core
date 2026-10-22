import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';

import '../../core/copy.dart';
import '../../core/session.dart';
import '../../core/text_tools.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

class LinkScreen extends StatefulWidget {
  const LinkScreen({super.key, required this.state});
  final AppState state;

  @override
  State<LinkScreen> createState() => _LinkScreenState();
}

class _LinkScreenState extends State<LinkScreen> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  Timer? _debounce;
  int _lookup = 0;
  String? _phone;
  bool _finding = false;
  bool _busy = false;
  String? _error;
  List<BankLink>? _found;

  @override
  void initState() {
    super.initState();
    _ctrl.addListener(_onChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    widget.state.discard(_found ?? const []);
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onChanged() {
    final phone = normalisePhone(_ctrl.text);
    if (phone == _phone) return;
    _debounce?.cancel();
    _lookup++;
    widget.state.discard(_found ?? const []);
    setState(() {
      _phone = phone;
      _found = null;
      _finding = false;
      _error = null;
    });
    if (phone != null) _debounce = Timer(const Duration(milliseconds: 350), () => _find(phone));
  }

  Future<void> _find(String phone) async {
    final id = ++_lookup;
    setState(() => _finding = true);
    try {
      final found = await widget.state.discover(phone);
      if (!mounted || id != _lookup) {
        widget.state.discard(found);
        return;
      }
      setState(() => _found = found);
      HapticFeedback.selectionClick();
    } catch (_) {
      if (mounted && id == _lookup) setState(() => _error = Copy.I.t('app.link.cannotReachBank'));
    } finally {
      if (mounted && id == _lookup) setState(() => _finding = false);
    }
  }

  Future<void> _proceed() async {
    final found = _found;
    if (found == null || found.isEmpty) {
      final phone = normalisePhone(_ctrl.text);
      if (phone == null) {
        HapticFeedback.heavyImpact();
        setState(() => _error = Copy.I.t('app.link.enterNumber'));
      } else if (!_finding) {
        unawaited(_find(phone));
      }
      return;
    }
    setState(() => _busy = true);
    _focus.unfocus();
    HapticFeedback.mediumImpact();
    _found = null;
    await widget.state.adopt(found);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final ready = (_found?.isNotEmpty ?? false) && !_finding;
    return CupertinoPageScaffold(
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
                child: Semantics(header: true, child: Text(c.t('app.link.title'), textAlign: TextAlign.center, style: G.largeTitle(context))),
              ),
              const SizedBox(height: 8),
              Reveal(
                delay: const Duration(milliseconds: 140),
                child: Text(
                  c.t('app.link.intro'),
                  textAlign: TextAlign.center,
                  style: G.callout(context).copyWith(color: G.label2.resolveFrom(context)),
                ),
              ),
              const SizedBox(height: 30),
              Reveal(
                delay: const Duration(milliseconds: 200),
                child: GroupCard(
                  padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                  child: Row(
                    children: [
                      const _NigeriaFlag(),
                      const SizedBox(width: 8),
                      Text('+234', style: G.body(context).copyWith(fontWeight: FontWeight.w600)),
                      Container(width: 1, height: 28, margin: const EdgeInsets.symmetric(horizontal: 12), color: G.separator.resolveFrom(context)),
                      Expanded(
                        child: CupertinoTextField.borderless(
                          key: const ValueKey('phone'),
                          controller: _ctrl,
                          focusNode: _focus,
                          autofocus: true,
                          placeholder: c.t('app.link.mobileNumber'),
                          keyboardType: TextInputType.phone,
                          autofillHints: const [AutofillHints.telephoneNumber],
                          autocorrect: false,
                          style: G.body(context).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          textInputAction: TextInputAction.go,
                          onSubmitted: (_) => _proceed(),
                          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]')), LengthLimitingTextInputFormatter(16)],
                        ),
                      ),
                      _ProceedButton(ready: ready, finding: _finding || _busy, onTap: _proceed),
                    ],
                  ),
                ),
              ),
              if (G.reduceMotion(context))
                _below(context)
              else
                AnimatedSize(duration: G.springFast, curve: G.spring, alignment: Alignment.topCenter, child: _below(context)),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _below(BuildContext context) {
    final c = Copy.I;
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(6, 10, 6, 0),
        child: Text(_error!, style: G.footnote(context).copyWith(color: G.red.resolveFrom(context))),
      );
    }
    final found = _found;
    if (_finding) {
      return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Text(c.t('app.link.finding'), textAlign: TextAlign.center, style: G.footnote(context)),
      );
    }
    if (found == null || found.isNotEmpty) return const SizedBox(width: double.infinity);
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 12, 6, 0),
      child: Text(c.t('app.link.notFound'), textAlign: TextAlign.center, style: G.footnote(context)),
    );
  }
}

class _ProceedButton extends StatelessWidget {
  const _ProceedButton({required this.ready, required this.finding, required this.onTap});
  final bool ready;
  final bool finding;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final motion = G.motion(context, const Duration(milliseconds: 220));
    return Semantics(
      button: true,
      enabled: ready,
      label: Copy.I.t('app.common.continue'),
      excludeSemantics: true,
      child: Pressable(
        key: const ValueKey('signIn'),
        onTap: ready ? onTap : null,
        child: AnimatedContainer(
          duration: motion,
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: ready ? G.brandGradient : null,
            color: ready ? null : G.fill.resolveFrom(context),
          ),
          alignment: Alignment.center,
          child: finding
              ? CupertinoActivityIndicator(color: ready ? CupertinoColors.white : null)
              : Icon(CupertinoIcons.arrow_right, size: 20, color: ready ? CupertinoColors.white : G.label3.resolveFrom(context)),
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
