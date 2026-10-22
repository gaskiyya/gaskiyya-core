import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:gaskiya_canonical/gaskiya_canonical.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../../core/ocr_mlkit.dart';
import '../../core/receipt_reader.dart';
import '../../core/screenshot.dart';
import '../theme.dart';
import '../widgets/widgets.dart';

Future<String?> pickGalleryImage() async {
  if (kIsWeb) return null;
  final file = await ImagePicker().pickImage(source: ImageSource.gallery, requestFullMetadata: false);
  return file?.path;
}

String maskAccount(String account) => account.length <= 4 ? account : '${'*' * (account.length - 4)}${account.substring(account.length - 4)}';

String _last4(String account) => account.length <= 4 ? account : account.substring(account.length - 4);

String _formatDate(DateTime d) => '${d.day} ${Copy.I.t('app.result.months').split(',')[d.month - 1]} ${d.year}';
String _formatTime(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

String formatNaira(int kobo) => 'NGN${formatKobo(kobo)}';

class ReceiptScreen extends StatefulWidget {
  const ReceiptScreen({super.key, required this.client, this.reader, this.pickImage, this.now, this.amountKobo, this.reference, this.valueDate});
  final GaskiyaClient client;

  /// Filled in from a payment alert the person tapped, so the receipt is ready to check.
  final int? amountKobo;
  final String? reference;
  final String? valueDate;

  final TextReader? reader;

  final Future<String?> Function()? pickImage;
  final DateTime Function()? now;

  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  late final TextReader _reader = widget.reader ?? defaultTextReader();
  late String _date = lagosDate(_now());

  CustomerInfo? _me;
  bool _loading = true;
  String? _account;
  String? _amountError;
  String? _referenceError;
  String? _note;
  bool _noteIsWarning = false;
  bool _reading = false;

  Copy get c => Copy.I;
  DateTime _now() => (widget.now ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    if (widget.amountKobo != null) _amount.text = formatKobo(widget.amountKobo!);
    if (widget.reference != null) _reference.text = widget.reference!;
    if (widget.valueDate != null && RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(widget.valueDate!)) _date = widget.valueDate!;
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final me = await widget.client.me();
    if (!mounted) return;
    setState(() {
      _me = me;
      _loading = false;
      _account = me == null || me.accounts.isEmpty ? null : (me.accounts.contains(_account) ? _account : me.accounts.first);
    });
  }

  Future<void> _fromScreenshot() async {
    final path = await (widget.pickImage ?? pickGalleryImage)();
    if (path == null || !mounted) return;
    setState(() => _reading = true);
    final r = await readReceiptImage(_reader, path);
    if (!mounted) return;
    setState(() {
      _reading = false;
      if (r.isEmpty) {
        _note = c.t('receipt.unreadable');
        _noteIsWarning = true;
        return;
      }
      if (r.amountKobo != null) _amount.text = formatKobo(r.amountKobo!);
      if (r.reference != null) _reference.text = r.reference!;
      if (r.valueDate != null) _date = r.valueDate!;
      _amountError = null;
      _referenceError = null;
      _note = c.t('receipt.screenshotNote');
      _noteIsWarning = false;
    });
    HapticFeedback.selectionClick();
  }

  DateTime get _dateValue {
    final p = _date.split('-').map(int.parse).toList();
    return DateTime(p[0], p[1], p[2]);
  }

  Future<void> _pickDate() async {
    FocusScope.of(context).unfocus();
    final today = lagosDate(_now()).split('-').map(int.parse).toList();
    final max = DateTime(today[0], today[1], today[2], 23, 59);
    var picked = _dateValue.isAfter(max) ? DateTime(today[0], today[1], today[2]) : _dateValue;
    await showCupertinoModalPopup<void>(
      context: context,
      builder: (ctx) => Container(
        height: 300,
        color: CupertinoColors.systemBackground.resolveFrom(ctx),
        child: SafeArea(
          top: false,
          child: Column(children: [
            Align(
              alignment: Alignment.centerRight,
              child: CupertinoButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(c.t('app.common.done'), style: G.headline(ctx).copyWith(color: G.tint.resolveFrom(ctx))),
              ),
            ),
            Expanded(
              child: CupertinoDatePicker(
                mode: CupertinoDatePickerMode.date,
                initialDateTime: picked,
                minimumDate: DateTime(2000),
                maximumDate: max,
                onDateTimeChanged: (d) => picked = d,
              ),
            ),
          ]),
        ),
      ),
    );
    if (!mounted) return;
    String two(int n) => n.toString().padLeft(2, '0');
    setState(() => _date = '${picked.year}-${two(picked.month)}-${two(picked.day)}');
  }

  Future<void> _check() async {
    FocusScope.of(context).unfocus();
    final account = _account;
    final me = _me;
    if (account == null || me == null) return;
    final kobo = parseAmountToKobo(_amount.text.trim());
    String? reference;
    try {
      reference = normaliseReference(_reference.text);
    } on ReceiptFieldError {
      reference = null;
    }
    setState(() {
      _amountError = kobo == null ? c.t('receipt.invalidAmount') : null;
      _referenceError = reference == null ? c.t('receipt.invalidReference') : null;
    });
    if (kobo == null || reference == null) {
      HapticFeedback.lightImpact();
      return;
    }
    final date = _date;
    final ref = reference;
    await showCupertinoSheet<void>(
      context: context,
      scrollableBuilder: (_, controller) => ReceiptResultSheet(
        account: account,
        amountKobo: kobo,
        controller: controller,
        run: () => widget.client.checkReceipt(account: account, bankCode: me.bankCode, amountKobo: kobo, reference: ref, valueDate: date),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      backgroundColor: G.bg.resolveFrom(context),
      navigationBar: CupertinoNavigationBar(
        middle: Text(c.t('receipt.title')),
        backgroundColor: G.bg.resolveFrom(context).withValues(alpha: 0.85),
        border: null,
      ),
      child: SafeArea(
        child: GestureDetector(
          onTap: () => FocusScope.of(context).unfocus(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(6, 0, 6, 16),
                child: Text(c.t('receipt.subtitle'), style: G.subhead(context)),
              ),
              ..._body(context),
              const SizedBox(height: 22),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(CupertinoIcons.lock_shield_fill, size: 15, color: G.label3.resolveFrom(context)),
                const SizedBox(width: 6),
                Flexible(child: Text(c.t('safety.neverAsks'), textAlign: TextAlign.center, style: G.caption(context))),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _body(BuildContext context) {
    if (_loading) return const [Padding(padding: EdgeInsets.all(30), child: CupertinoActivityIndicator(radius: 14))];
    final me = _me;
    if (me == null) {
      return [
        GroupCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(c.t('receipt.verdict.cannot_check.title'), style: G.headline(context)),
            const SizedBox(height: 6),
            Text(c.t('receipt.verdict.cannot_check.body'), style: G.subhead(context)),
            const SizedBox(height: 14),
            TintedButton(label: c.t('app.common.tryAgain'), icon: CupertinoIcons.arrow_clockwise, onTap: _load),
          ]),
        ),
      ];
    }
    if (me.accounts.isEmpty) {
      return [
        GroupCard(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(CupertinoIcons.info_circle_fill, size: 20, color: G.label3.resolveFrom(context)),
            const SizedBox(width: 12),
            Expanded(child: Text(c.t('receipt.noAccounts'), key: const ValueKey('receipt-no-accounts'), style: G.subhead(context).copyWith(color: G.label.resolveFrom(context)))),
          ]),
        ),
      ];
    }
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(6, 0, 6, 8),
        child: Text(c.t('receipt.account'), style: G.subhead(context).copyWith(fontWeight: FontWeight.w600)),
      ),
      Wrap(spacing: 8, runSpacing: 8, children: [for (final a in me.accounts) _accountChip(context, a)]),
      const SizedBox(height: 16),
      if (_reader.available) ...[
        Align(
          alignment: Alignment.centerLeft,
          child: TintedButton(
            key: const ValueKey('receipt-screenshot'),
            label: c.t('receipt.fromScreenshot'),
            icon: CupertinoIcons.photo,
            onTap: _reading ? null : _fromScreenshot,
          ),
        ),
        const SizedBox(height: 10),
      ],
      if (_note != null) ...[
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(_noteIsWarning ? CupertinoIcons.exclamationmark_triangle_fill : CupertinoIcons.eye_fill,
              size: 16, color: (_noteIsWarning ? G.orange : G.tint).resolveFrom(context)),
          const SizedBox(width: 8),
          Expanded(child: Text(_note!, key: const ValueKey('receipt-note'), style: G.footnote(context).copyWith(color: G.label.resolveFrom(context)))),
        ]),
        const SizedBox(height: 12),
      ],
      GroupCard(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _field(
            context,
            key: const ValueKey('receipt-amount'),
            label: c.t('receipt.amount'),
            hint: c.t('receipt.amountHint'),
            controller: _amount,
            error: _amountError,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
          ),
          _separator(context),
          _field(
            context,
            key: const ValueKey('receipt-reference'),
            label: c.t('receipt.reference'),
            hint: c.t('receipt.referenceHint'),
            controller: _reference,
            error: _referenceError,
            keyboard: TextInputType.visiblePassword,
            capitalise: true,
          ),
          _separator(context),
          Pressable(
            key: const ValueKey('receipt-date'),
            scale: 0.99,
            onTap: _pickDate,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 13),
              child: Row(children: [
                Expanded(child: Text(c.t('receipt.date'), style: G.body(context))),
                const SizedBox(width: 12),
                Flexible(child: Text(_formatDate(_dateValue), textAlign: TextAlign.end, style: G.body(context).copyWith(color: G.tint.resolveFrom(context)))),
                const SizedBox(width: 4),
                Icon(CupertinoIcons.chevron_forward, size: 14, color: G.label3.resolveFrom(context)),
              ]),
            ),
          ),
        ]),
      ),
      const SizedBox(height: 16),
      PrimaryButton(key: const ValueKey('receipt-check'), label: c.t('receipt.check'), icon: CupertinoIcons.checkmark_shield_fill, gradient: true, onTap: _check),
      const SizedBox(height: 10),
      Text(c.t('receipt.privacyNote'), textAlign: TextAlign.center, style: G.caption(context)),
    ];
  }

  Widget _separator(BuildContext context) => Container(height: 0.5, color: G.separator.resolveFrom(context));

  Widget _accountChip(BuildContext context, String a) {
    final on = a == _account;
    return Semantics(
      selected: on,
      child: Pressable(
        key: ValueKey('account-$a'),
        onTap: () => setState(() => _account = a),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: on ? G.tint.resolveFrom(context) : G.card.resolveFrom(context),
            borderRadius: BorderRadius.circular(980),
            border: Border.all(color: G.tint.resolveFrom(context).withValues(alpha: on ? 1 : 0.35)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (on) ...[const Icon(CupertinoIcons.checkmark_alt, size: 16, color: CupertinoColors.white), const SizedBox(width: 6)],
            Flexible(
              child: Text(c.t('receipt.accountOption', {'last4': _last4(a)}),
                  style: G.subhead(context).copyWith(fontWeight: FontWeight.w600, color: on ? CupertinoColors.white : G.tint.resolveFrom(context))),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _field(
    BuildContext context, {
    required Key key,
    required String label,
    required String hint,
    required TextEditingController controller,
    required String? error,
    required TextInputType keyboard,
    bool capitalise = false,
  }) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: G.footnote(context).copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          CupertinoTextField.borderless(
            key: key,
            controller: controller,
            padding: EdgeInsets.zero,
            placeholder: hint,
            placeholderStyle: G.body(context).copyWith(color: G.label3.resolveFrom(context)),
            style: G.body(context),
            keyboardType: keyboard,
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: capitalise ? TextCapitalization.characters : TextCapitalization.none,
            onChanged: (_) => setState(() {
              if (controller == _amount) _amountError = null;
              if (controller == _reference) _referenceError = null;
            }),
          ),
          if (error != null) ...[
            const SizedBox(height: 6),
            Text(error, style: G.footnote(context).copyWith(color: G.red.resolveFrom(context))),
          ],
        ]),
      );
}

class ReceiptResultSheet extends StatefulWidget {
  const ReceiptResultSheet({super.key, required this.run, required this.account, required this.amountKobo, this.controller});

  final Future<ReceiptResult> Function() run;
  final String account;
  final int amountKobo;
  final ScrollController? controller;

  @override
  State<ReceiptResultSheet> createState() => _ReceiptResultSheetState();
}

class _ReceiptResultSheetState extends State<ReceiptResultSheet> {
  ReceiptResult? _result;
  bool _rateLimited = false;
  bool _slow = false;
  Timer? _slowTimer;

  Copy get c => Copy.I;

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
    ReceiptResult r;
    var limited = false;
    try {
      r = await widget.run();
    } on ApiException catch (e) {
      limited = e.status == 429;
      r = ReceiptResult.unavailable();
    } catch (_) {
      r = ReceiptResult.unavailable();
    }
    if (!mounted) return;
    setState(() {
      _result = r;
      _rateLimited = limited;
    });
    switch (r.verdict) {
      case ReceiptVerdict.received:
        HapticFeedback.mediumImpact();
      case ReceiptVerdict.notConfirmed:
        HapticFeedback.heavyImpact();
        Future<void>.delayed(const Duration(milliseconds: 120), HapticFeedback.heavyImpact);
      case ReceiptVerdict.cannotCheck:
        HapticFeedback.lightImpact();
    }
  }

  ({String art, Color tint, String tag, String title, String body}) _view(ReceiptResult r) {
    final account = maskAccount(widget.account);
    switch (r.verdict) {
      case ReceiptVerdict.received:
        final at = r.registeredAt!;
        return (
          art: 'verdict_confirmed',
          tint: G.tint,
          tag: c.t('receipt.verdict.received.short'),
          title: c.t('receipt.verdict.received.title'),
          body: c.t('receipt.verdict.received.body', {'payer': r.paidFrom, 'amount': formatNaira(widget.amountKobo), 'account': account, 'date': _formatDate(at), 'time': _formatTime(at)}),
        );
      case ReceiptVerdict.notConfirmed:
        return (
          art: 'verdict_not_confirmed',
          tint: G.orange,
          tag: c.t('receipt.verdict.not_confirmed.short'),
          title: c.t('receipt.verdict.not_confirmed.title'),
          body: c.t('receipt.verdict.not_confirmed.body', {'account': account}),
        );
      case ReceiptVerdict.cannotCheck:
        return (
          art: 'verdict_cannot_check',
          tint: CupertinoColors.systemGrey,
          tag: c.t('receipt.verdict.cannot_check.short'),
          title: c.t('receipt.verdict.cannot_check.title'),
          body: c.t('receipt.verdict.cannot_check.body'),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    return CupertinoPageScaffold(
      backgroundColor: G.bg.resolveFrom(context),
      child: SafeArea(
        bottom: false,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
            child: Row(children: [
              Expanded(child: Text(c.t('receipt.heading'), style: G.headline(context))),
              CupertinoButton(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                onPressed: () => Navigator.of(context).pop(),
                child: Text(c.t('app.common.done'), style: G.headline(context).copyWith(color: G.tint.resolveFrom(context))),
              ),
            ]),
          ),
          Expanded(
            child: AnimatedSwitcher(
              duration: G.motion(context, const Duration(milliseconds: 380)),
              switchInCurve: G.spring,
              child: r == null ? _loading(context) : _content(context, r),
            ),
          ),
        ]),
      ),
    );
  }

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

  Widget _content(BuildContext context, ReceiptResult r) {
    final v = _view(r);
    final tint = CupertinoDynamicColor.resolve(v.tint, context);
    final reduce = G.reduceMotion(context);
    return ListView(
      key: const ValueKey('content'),
      controller: widget.controller,
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
      children: [
        SizedBox(
          height: 230,
          child: Stack(alignment: Alignment.center, children: [
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
          ]),
        ),
        Reveal(
          child: Column(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(color: tint.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(99)),
              child: Text(v.tag.toUpperCase(), style: G.caption(context).copyWith(color: tint, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
            ),
            const SizedBox(height: 12),
            Text(v.title, textAlign: TextAlign.center, style: G.title1(context)),
            const SizedBox(height: 10),
            Text(v.body, textAlign: TextAlign.center, style: G.callout(context).copyWith(color: G.label2.resolveFrom(context), height: 1.45)),
          ]),
        ),
        if (_rateLimited) ...[const SizedBox(height: 12), Text(c.t('app.result.rateLimited'), textAlign: TextAlign.center, style: G.footnote(context))],
        if (r.verdict == ReceiptVerdict.received) ...[
          const SizedBox(height: 26),
          Reveal(
            delay: const Duration(milliseconds: 120),
            child: GroupCard(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
              child: Column(children: [
                _row(context, c.t('receipt.account'), maskAccount(widget.account)),
                _row(context, c.t('receipt.amount'), formatNaira(widget.amountKobo)),
                _row(context, c.t('app.result.from'), r.paidFrom!),
                _row(context, c.t('receipt.registered'), '${_formatDate(r.registeredAt!)}, ${_formatTime(r.registeredAt!)}', last: true),
              ]),
            ),
          ),
        ],
        const SizedBox(height: 26),
        Text(c.t('safety.neverAsks'), textAlign: TextAlign.center, style: G.caption(context)),
      ],
    );
  }

  Widget _row(BuildContext context, String k, String v, {bool last = false}) => Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: G.separator.resolveFrom(context), width: 0.5))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Flexible(child: Text(k, style: G.body(context))),
          const SizedBox(width: 12),
          Expanded(child: Text(v, textAlign: TextAlign.end, style: G.body(context).copyWith(color: G.label2.resolveFrom(context)))),
        ]),
      );
}
