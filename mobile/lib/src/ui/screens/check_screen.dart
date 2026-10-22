import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/copy.dart';
import '../../core/screenshot.dart';
import '../../core/session.dart';
import '../../core/text_tools.dart';
import '../theme.dart';
import '../widgets/widgets.dart';
import 'licence_sheet.dart';
import 'receipt_screen.dart';
import 'result_sheet.dart';

CheckRequest requestFor(String text, {bool asContact = false}) {
  if (asContact || looksLikeContact(text)) return CheckRequest.contact(text.trim());
  if (looksLikeLink(text)) return CheckRequest.link(text.trim());
  return CheckRequest.message(text);
}

Future<void> checkText(BuildContext context, AppState state, String text, {bool asContact = false}) async {
  final client = state.client;
  if (client == null || text.trim().isEmpty) return;
  await showResult(context, client, state.bankName ?? Copy.I.t('app.common.yourBank'), requestFor(text, asContact: asContact),
      kind: state.bank?.kind ?? 'bank', others: othersFor(state));
}

List<CheckTarget> othersFor(AppState state) => [
      for (final l in state.links)
        if (l != state.selected) (bank: l.bank.name, kind: l.bank.kind, client: l.client),
    ];

class CheckScreen extends StatefulWidget {
  const CheckScreen({super.key, required this.state});
  final AppState state;

  @override
  State<CheckScreen> createState() => _CheckScreenState();
}

class _CheckScreenState extends State<CheckScreen> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  List<InboxMessage> _inbox = const [];

  bool _contactMode = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _ctrl.addListener(() => setState(() {}));
    _loadInbox();
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _loadInbox());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _loadInbox() async {
    final id = widget.state.bank?.id;
    final items = await widget.state.inbox();
    if (mounted && id == widget.state.bank?.id) setState(() => _inbox = items);
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null) {
      _ctrl.text = data!.text!;
      HapticFeedback.selectionClick();
    }
  }

  Future<void> _screenshot() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, requestFullMetadata: false);
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    final type = file.mimeType ?? (file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    if (!mounted) return;
    final shot = Screenshot(path: kIsWeb ? null : file.path, bytes: bytes, mediaType: type);
    await showResult(context, widget.state.client!, widget.state.bankName ?? Copy.I.t('app.common.yourBank'), CheckRequest.screenshot(shot), kind: widget.state.bank?.kind ?? 'bank', others: othersFor(widget.state));
  }

  Future<void> _licence() async {
    final client = widget.state.client;
    if (client == null) return;
    _focus.unfocus();
    await showLicenceCheck(context, client);
  }

  Future<void> _check([String? text]) async {
    _focus.unfocus();
    await checkText(context, widget.state, text ?? _ctrl.text, asContact: text == null && _contactMode);
  }

  void _checkContact() {
    setState(() => _contactMode = true);
    if (_ctrl.text.trim().isNotEmpty) {
      _check();
    } else {
      _focus.requestFocus();
    }
  }

  void _clear() {
    _ctrl.clear();
    setState(() => _contactMode = false);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(listenable: widget.state, builder: (context, _) => _build(context));

  Widget _receiptTile(BuildContext context) {
    final c = Copy.I;
    return Pressable(
      key: const ValueKey('open-receipt'),
      scale: 0.985,
      onTap: () {
        final client = widget.state.client;
        if (client == null) return;
        Navigator.of(context).push(CupertinoPageRoute<void>(builder: (_) => ReceiptScreen(client: client)));
      },
      child: GroupCard(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: G.tint.resolveFrom(context).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(CupertinoIcons.creditcard_fill, size: 19, color: G.tint.resolveFrom(context)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.t('receipt.title'), style: G.headline(context)),
              const SizedBox(height: 2),
              Text(c.t('receipt.subtitle'), style: G.footnote(context)),
            ]),
          ),
          const SizedBox(width: 6),
          Icon(CupertinoIcons.chevron_forward, size: 14, color: G.label3.resolveFrom(context)),
        ]),
      ),
    );
  }

  Widget _build(BuildContext context) {
    final hasText = _ctrl.text.trim().isNotEmpty;
    final isContact = hasText && (_contactMode || looksLikeContact(_ctrl.text));
    final isLink = !isContact && hasText && looksLikeLink(_ctrl.text);
    final c = Copy.I;
    return CupertinoPageScaffold(
      child: GestureDetector(
        onTap: () => _focus.unfocus(),
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
          slivers: [
            CupertinoSliverNavigationBar(
              largeTitle: Text(c.t('app.tabs.check')),
              border: null,
              backgroundColor: G.bg.resolveFrom(context).withValues(alpha: 0.85),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
              sliver: SliverList.list(children: [
                Reveal(
                  child: GroupCard(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        CupertinoTextField.borderless(
                          controller: _ctrl,
                          focusNode: _focus,
                          minLines: 4,
                          maxLines: 9,
                          padding: EdgeInsets.zero,
                          placeholder: c.t(_contactMode ? 'official.app.placeholder' : 'app.check.placeholder'),
                          placeholderStyle: G.body(context).copyWith(color: G.label3.resolveFrom(context)),
                          style: G.body(context),
                          keyboardType: TextInputType.multiline,
                        ),
                        const SizedBox(height: 14),
                        Row(children: [
                          Expanded(
                            child: Wrap(spacing: 8, runSpacing: 8, children: [
                              TintedButton(label: c.t('app.check.paste'), icon: CupertinoIcons.doc_on_clipboard, onTap: _paste),
                              TintedButton(label: c.t('app.check.screenshot'), icon: CupertinoIcons.photo, onTap: _screenshot),
                              TintedButton(
                                key: const ValueKey('check-contact'),
                                label: c.t('official.app.checkContact'),
                                icon: CupertinoIcons.person_crop_circle_badge_checkmark,
                                onTap: _checkContact,
                              ),
                            ]),
                          ),
                          AnimatedOpacity(
                            opacity: hasText ? 1 : 0,
                            duration: G.motion(context, const Duration(milliseconds: 200)),
                            child: CupertinoButton(
                              padding: EdgeInsets.zero,
                              minimumSize: const Size(28, 28),
                              onPressed: hasText ? _clear : null,
                              child: Icon(CupertinoIcons.xmark_circle_fill, color: G.label3.resolveFrom(context), size: 22),
                            ),
                          ),
                        ]),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Reveal(
                  delay: const Duration(milliseconds: 60),
                  child: PrimaryButton(
                    label: isContact
                        ? c.t('official.app.checkContact')
                        : isLink
                            ? c.t('app.check.checkLink')
                            : c.t('app.check.checkMessage'),
                    icon: isContact
                        ? CupertinoIcons.person_crop_circle_badge_checkmark
                        : isLink
                            ? CupertinoIcons.link
                            : CupertinoIcons.checkmark_shield_fill,
                    gradient: hasText,
                    onTap: hasText ? _check : null,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  c.t('app.check.fingerprintNote'),
                  textAlign: TextAlign.center,
                  style: G.caption(context),
                ),
                if (widget.state.client != null) ...[
                  const SizedBox(height: 18),
                  Reveal(delay: const Duration(milliseconds: 90), child: _receiptTile(context)),
                ],
                SectionHeader(c.t('app.check.recentMessages'), trailing: Text(c.t('app.check.demoInbox'), style: G.footnote(context))),
                if (_inbox.isEmpty)
                  Reveal(
                    delay: const Duration(milliseconds: 120),
                    child: GroupCard(
                      child: Row(children: [
                        const Art3D('message', size: 64),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(c.t('app.check.inboxEmpty'),
                              style: G.subhead(context)),
                        ),
                      ]),
                    ),
                  )
                else
                  GroupCard(
                    padding: EdgeInsets.zero,
                    child: Column(children: [
                      for (var i = 0; i < _inbox.length && i < 8; i++) ...[
                        if (i > 0) Container(height: 0.5, margin: const EdgeInsets.only(left: 64), color: G.separator.resolveFrom(context)),
                        _InboxRow(item: _inbox[i], onTap: () => _check(_inbox[i].text)),
                      ],
                    ]),
                  ),
                const SizedBox(height: 18),
                Reveal(
                  delay: const Duration(milliseconds: 90),
                  child: Semantics(
                    button: true,
                    label: '${c.t('licence.title')} ${c.t('licence.entryHint')}',
                    excludeSemantics: true,
                    child: Pressable(
                      key: const ValueKey('licence-entry'),
                      scale: 0.985,
                      onTap: _licence,
                      child: GroupCard(
                        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
                        child: Row(children: [
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(color: G.tint.resolveFrom(context).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                            child: Icon(CupertinoIcons.checkmark_seal_fill, size: 20, color: G.tint.resolveFrom(context)),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(c.t('licence.title'), style: G.headline(context)),
                              const SizedBox(height: 2),
                              Text(c.t('licence.entryHint'), style: G.subhead(context)),
                            ]),
                          ),
                          Icon(CupertinoIcons.chevron_forward, size: 14, color: G.label3.resolveFrom(context)),
                        ]),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(CupertinoIcons.lock_shield_fill, size: 15, color: G.label3.resolveFrom(context)),
                  const SizedBox(width: 6),
                  Flexible(child: Text(c.t('safety.neverAsks'), textAlign: TextAlign.center, style: G.caption(context))),
                ]),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _InboxRow extends StatelessWidget {
  const _InboxRow({required this.item, required this.onTap});
  final InboxMessage item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = item.at;
    return Pressable(
      scale: 0.985,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: const BoxDecoration(shape: BoxShape.circle, gradient: G.brandGradient),
            child: Text(item.from.substring(0, 1), style: G.headline(context).copyWith(color: CupertinoColors.white)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(item.from, style: G.headline(context))),
                if (item.channel != null) Text('${Copy.I.channel(item.channel!)} \u00b7 ', style: G.footnote(context)),
                Text('${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}', style: G.footnote(context)),
                const SizedBox(width: 4),
                Icon(CupertinoIcons.chevron_forward, size: 14, color: G.label3.resolveFrom(context)),
              ]),
              const SizedBox(height: 2),
              Text(item.text, maxLines: 2, overflow: TextOverflow.ellipsis, style: G.subhead(context)),
            ]),
          ),
        ]),
      ),
    );
  }
}
