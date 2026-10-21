import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import '../../core/api.dart';
import '../../core/copy.dart';
import '../../core/session.dart';
import '../../shield/shield_settings.dart';
import '../theme.dart';
import '../widgets/widgets.dart';
import 'alerts.dart';
import 'calls_screen.dart';
import 'check_screen.dart';
import 'link_screen.dart';

String sharedText(List<SharedMediaFile> files) =>
    files.where((f) => f.type == SharedMediaType.text || f.type == SharedMediaType.url).map((f) => f.path).join('\n');

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.state});
  final AppState state;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  final _tabs = CupertinoTabController();
  StreamSubscription<List<SharedMediaFile>>? _share;
  String? _lastCallId;
  CallSession? _banner;
  String? _bannerBank;

  String? _alertBank;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_onState);
    widget.state.openCallsTab.addListener(_showCalls);
    widget.state.openAlerts.addListener(_showAlerts);
    widget.state.arrivedAlert.addListener(_onAlert);
    WidgetsBinding.instance.addObserver(this);
    _tabs.addListener(_onTab);
    widget.state.startCallPolling();
    _initSharing();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) {
      widget.state.startCallPolling();
    } else if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden || s == AppLifecycleState.detached) {
      widget.state.stopCallPolling();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tabs.removeListener(_onTab);
    widget.state.stopCallPolling();
    widget.state.removeListener(_onState);
    widget.state.openCallsTab.removeListener(_showCalls);
    widget.state.openAlerts.removeListener(_showAlerts);
    widget.state.arrivedAlert.removeListener(_onAlert);
    _share?.cancel();
    _tabs.dispose();
    super.dispose();
  }

  void _initSharing() {
    if (kIsWeb || !(defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS)) return;
    void handle(List<SharedMediaFile> files) {
      final text = sharedText(files);
      if (text.trim().isEmpty || !mounted) return;
      _tabs.index = 0;
      WidgetsBinding.instance.addPostFrameCallback((_) => checkText(context, widget.state, text));
    }

    _share = ReceiveSharingIntent.instance.getMediaStream().listen(handle, onError: (_) {});
    ReceiveSharingIntent.instance.getInitialMedia().then((f) {
      handle(f);
      ReceiveSharingIntent.instance.reset();
    });
  }

  void _showCalls() {
    if (mounted) setState(() => _tabs.index = 1);
  }

  void _showAlerts() {
    if (!mounted) return;
    setState(() {
      _alertBank = null;
      _tabs.index = 2;
    });
    unawaited(widget.state.refreshAdvisories());
  }

  void _onAlert() {
    final a = widget.state.arrivedAlert.value;
    if (a == null || !mounted || _tabs.index == 2) return;
    setState(() => _alertBank = a.bank);
    Future<void>.delayed(const Duration(seconds: 8), () {
      if (mounted && widget.state.arrivedAlert.value == a) setState(() => _alertBank = null);
    });
  }

  void _onTab() {
    if (_tabs.index == 1 && _banner != null && mounted) setState(() => _banner = null);
    if (_tabs.index == 2 && _alertBank != null && mounted) setState(() => _alertBank = null);
  }

  void _onState() {
    final latest = widget.state.latestCall;
    final call = latest?.liveCall;
    if (call != null && call.id != _lastCallId) {
      _lastCallId = call.id;
      HapticFeedback.heavyImpact();
      if (_tabs.index == 1) return;
      setState(() {
        _banner = call;
        _bannerBank = latest!.bank.name;
      });
      Future<void>.delayed(const Duration(seconds: 6), () {
        if (mounted && _banner?.id == call.id) setState(() => _banner = null);
      });
    } else if (call == null && _banner != null) {
      setState(() => _banner = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        CupertinoTabScaffold(
          controller: _tabs,
          tabBar: CupertinoTabBar(
            backgroundColor: CupertinoTheme.of(context).barBackgroundColor,
            items: [
              BottomNavigationBarItem(icon: const Icon(CupertinoIcons.checkmark_shield), activeIcon: const Icon(CupertinoIcons.checkmark_shield_fill), label: Copy.I.t('app.tabs.check')),
              BottomNavigationBarItem(icon: const Icon(CupertinoIcons.phone), activeIcon: const Icon(CupertinoIcons.phone_fill), label: Copy.I.t('app.tabs.calls')),
              BottomNavigationBarItem(icon: const Icon(CupertinoIcons.clock), activeIcon: const Icon(CupertinoIcons.clock_fill), label: Copy.I.t('app.tabs.activity')),
              BottomNavigationBarItem(icon: const Icon(CupertinoIcons.gear), activeIcon: const Icon(CupertinoIcons.gear_solid), label: Copy.I.t('app.tabs.settings')),
            ],
          ),
          tabBuilder: (context, i) => CupertinoTabView(
            builder: (context) => switch (i) {
              0 => CheckScreen(state: widget.state),
              1 => CallsScreen(state: widget.state),
              2 => ActivityScreen(state: widget.state),
              _ => SettingsScreen(state: widget.state),
            },
          ),
        ),
        AlertBanner(bank: _banner == null ? _alertBank : null, onTap: () => widget.state.openAlerts.value++),
        _CallBanner(
          call: _banner,
          bank: _bannerBank ?? widget.state.bankName ?? Copy.I.t('app.common.yourBank').cap,
          onTap: () {
            setState(() => _banner = null);
            _tabs.index = 1;
          },
        ),
      ],
    );
  }
}

class _CallBanner extends StatelessWidget {
  const _CallBanner({required this.call, required this.bank, required this.onTap});
  final CallSession? call;
  final String bank;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final shown = call != null;
    final motion = G.motion(context, const Duration(milliseconds: 620));
    return AnimatedPositioned(
      duration: motion,
      curve: shown ? G.spring : Curves.easeInCubic,
      top: shown ? top + 6 : -140,
      left: 10,
      right: 10,
      child: AnimatedScale(
        scale: shown ? 1 : 0.7,
        duration: motion,
        curve: G.spring,
        child: Pressable(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 16, 12),
            decoration: BoxDecoration(
              color: const Color(0xF2111113),
              borderRadius: BorderRadius.circular(30),
              boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 30, offset: Offset(0, 12))],
            ),
            child: Row(children: [
              Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(shape: BoxShape.circle, gradient: G.brandGradient),
                child: const Icon(CupertinoIcons.phone_fill, color: CupertinoColors.white, size: 21),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(Copy.I.t('call.calling.title', {'bank': bank}),
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: G.headline(context).copyWith(color: CupertinoColors.white, fontSize: 15)),
                  Text(call == null ? '' : Copy.I.purpose(call!.purpose).cap, style: G.footnote(context).copyWith(color: const Color(0xB3FFFFFF))),
                ]),
              ),
              Text(call?.code ?? '',
                  style: TextStyle(
                      fontFamily: G.displayFamily,
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 3,
                      color: const Color(0xFF30D158),
                      fontFeatures: const [FontFeature.tabularFigures()])),
            ]),
          ),
        ),
      ),
    );
  }
}

class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.state});
  final AppState state;

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  ({List<ActivityItem> items, String text})? _data;
  bool _loaded = false;
  String? _bankId;

  @override
  void initState() {
    super.initState();
    _bankId = widget.state.bank?.id;
    widget.state.addListener(_onBank);
    _load();
  }

  @override
  void dispose() {
    widget.state.removeListener(_onBank);
    super.dispose();
  }

  void _onBank() {
    if (widget.state.bank?.id == _bankId) return;
    _bankId = widget.state.bank?.id;
    setState(() => _loaded = false);
    _load();
  }

  Future<void> _load() async {
    final id = widget.state.bank?.id;
    unawaited(widget.state.refreshAdvisories());
    final d = await widget.state.client?.activity();
    if (mounted && id == widget.state.bank?.id) {
      setState(() {
        _data = d;
        _loaded = true;
      });
    }
  }

  IconData _icon(String category) => switch (category) {
        'otp' => CupertinoIcons.number_square_fill,
        'transaction_alert' => CupertinoIcons.arrow_right_arrow_left_square_fill,
        'security_notice' => CupertinoIcons.lock_shield_fill,
        'service_update' => CupertinoIcons.sparkles,
        'marketing' => CupertinoIcons.gift_fill,
        _ => CupertinoIcons.phone_fill,
      };

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    return CupertinoPageScaffold(
      child: CustomScrollView(
        physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
        slivers: [
          CupertinoSliverNavigationBar(largeTitle: Text(c.t('app.tabs.activity')), border: null, backgroundColor: G.bg.resolveFrom(context).withValues(alpha: 0.85)),
          CupertinoSliverRefreshControl(onRefresh: _load),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
            sliver: SliverList.list(children: [
              AdvisoriesSection(state: widget.state),
              const SizedBox(height: 16),
              if (!_loaded)
                const GroupCard(child: Shimmer())
              else if (_data == null)
                GroupCard(child: Text(c.tOrg('verdict.cannot_check.body', widget.state.bank?.kind, {'bank': widget.state.bankName}), style: G.subhead(context)))
              else ...[
                Reveal(
                  child: GroupCard(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(c.tOrg('activity.heading', widget.state.bank?.kind, {'bank': widget.state.bankName}), style: G.headline(context)),
                      const SizedBox(height: 6),
                      Text(_data!.text, style: G.callout(context).copyWith(color: G.label2.resolveFrom(context))),
                    ]),
                  ),
                ),
                if (_data!.items.isNotEmpty) ...[
                  SectionHeader(c.t('app.activity.last24h')),
                  GroupCard(
                    padding: EdgeInsets.zero,
                    child: Column(children: [
                      for (var i = 0; i < _data!.items.length; i++) ...[
                        if (i > 0) Container(height: 0.5, margin: const EdgeInsets.only(left: 62), color: G.separator.resolveFrom(context)),
                        Reveal(
                          delay: Duration(milliseconds: 60 * i),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            child: Row(children: [
                              Container(
                                width: 34,
                                height: 34,
                                decoration: BoxDecoration(color: G.tint.resolveFrom(context).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(9)),
                                child: Icon(_icon(_data!.items[i].category), size: 19, color: G.tint.resolveFrom(context)),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(c.category(_data!.items[i].category).cap, style: G.headline(context)),
                                  Text('${c.t('app.activity.by', {'channel': c.channel(_data!.items[i].channel)})}${_data!.items[i].anyWithLink ? ' \u00B7 ${c.t('app.activity.withLink')}' : ''}', style: G.footnote(context)),
                                ]),
                              ),
                              Text('${_data!.items[i].count}', style: G.title3(context)),
                            ]),
                          ),
                        ),
                      ],
                    ]),
                  ),
                ],
              ],
              const SizedBox(height: 18),
              Text(c.t('app.activity.footer'),
                  textAlign: TextAlign.center, style: G.caption(context)),
            ]),
          ),
        ],
      ),
    );
  }
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.state});
  final AppState state;

  Future<void> _pickLanguage(BuildContext context) async {
    final c = Copy.I;
    final picked = await showCupertinoModalPopup<String>(
      context: context,
      builder: (ctx) => CupertinoActionSheet(
        title: Text(c.t('app.language.title')),
        actions: [
          for (final lang in Copy.languages)
            CupertinoActionSheetAction(
              isDefaultAction: lang == c.language,
              onPressed: () => Navigator.pop(ctx, lang),
              child: Text(c.t('app.language.names.$lang')),
            ),
        ],
        cancelButton: CupertinoActionSheetAction(onPressed: () => Navigator.pop(ctx), child: Text(c.t('app.common.cancel'))),
      ),
    );
    if (picked == null || picked == c.language) return;
    await state.setLanguage(picked);
    rebuildAllText();
  }

  static Future<void> addBank(BuildContext context, AppState state) =>
      Navigator.of(context, rootNavigator: true).push(CupertinoPageRoute<void>(builder: (_) => LinkScreen(state: state, adding: true)));

  Future<void> _confirmRemove(BuildContext context, BankLink link) => showCupertinoDialog<void>(
        context: context,
        builder: (ctx) => CupertinoAlertDialog(
          title: Text(Copy.I.t('banks.removeTitle', {'bank': link.bank.name})),
          content: Text(Copy.I.t('banks.removeBody', {'bank': link.bank.name})),
          actions: [
            CupertinoDialogAction(onPressed: () => Navigator.pop(ctx), child: Text(Copy.I.t('banks.cancel'))),
            CupertinoDialogAction(
              isDestructiveAction: true,
              onPressed: () {
                Navigator.pop(ctx);
                state.unlinkBank(link.id);
              },
              child: Text(Copy.I.t('banks.remove')),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(listenable: state, builder: (context, _) => _build(context));
  }

  static Widget _wrapped(String text) => Text(text, maxLines: 6, overflow: TextOverflow.visible);

  static Widget _sectionHeader(BuildContext context, String text) =>
      Semantics(header: true, child: Text(text.toUpperCase(), style: G.footnote(context).copyWith(letterSpacing: 0.2)));

  Widget _build(BuildContext context) {
    final c = Copy.I;
    return CupertinoPageScaffold(
      child: CustomScrollView(
        slivers: [
          CupertinoSliverNavigationBar(largeTitle: Text(c.t('app.tabs.settings')), border: null, backgroundColor: G.bg.resolveFrom(context).withValues(alpha: 0.85)),
          SliverList.list(children: [
            CupertinoListSection.insetGrouped(
              header: _sectionHeader(context, Copy.I.t('banks.heading')),
              children: [
                for (final link in state.links)
                  CupertinoListTile(
                    key: ValueKey('bank-${link.id}'),
                    leadingSize: 44,
                    leading: Container(
                      decoration: const BoxDecoration(shape: BoxShape.circle, gradient: G.brandGradient),
                      alignment: Alignment.center,
                      child: Text(link.bank.name.substring(0, 1), style: G.title3(context).copyWith(color: CupertinoColors.white)),
                    ),
                    title: Text(link.bank.name),
                    subtitle: Text(link.phone.length > 4 ? '\u2022\u2022\u2022\u2022 ${link.phone.substring(link.phone.length - 4)}' : link.phone),
                    additionalInfo: Text(Copy.I.t('banks.linked'), style: TextStyle(color: G.greenInk.resolveFrom(context))),
                    trailing: CupertinoButton(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(44, 44),
                      onPressed: () => _confirmRemove(context, link),
                      child: Semantics(
                        label: '${Copy.I.t('banks.remove')} ${link.bank.name}',
                        child: Icon(CupertinoIcons.minus_circle_fill, color: G.red.resolveFrom(context), semanticLabel: null),
                      ),
                    ),
                  ),
                CupertinoListTile(
                  key: const ValueKey('add-bank'),
                  leading: Icon(CupertinoIcons.add_circled_solid, color: G.tint.resolveFrom(context)),
                  title: Text(Copy.I.t('banks.add'), style: TextStyle(color: G.tint.resolveFrom(context))),
                  onTap: () => addBank(context, state),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              children: [
                CupertinoListTile(
                  key: const ValueKey('language'),
                  leading: const Icon(CupertinoIcons.globe),
                  title: Text(c.t('app.language.title')),
                  additionalInfo: Text(c.t('app.language.names.${c.language}')),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () => _pickLanguage(context),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: _sectionHeader(context, c.t('app.settings.privacy')),
              children: [
                CupertinoListTile(leading: const Icon(CupertinoIcons.lock_fill), title: _wrapped(c.t('app.settings.textStays'))),
                CupertinoListTile(leading: const Icon(CupertinoIcons.number), title: _wrapped(c.t('app.settings.numbersMasked'))),
                CupertinoListTile(leading: const Icon(CupertinoIcons.hand_raised_fill), title: _wrapped(c.t('app.settings.reportsConsent'))),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: _sectionHeader(context, c.t('app.settings.about')),
              footer: Text(c.t('safety.neverAsks')),
              children: [
                CupertinoListTile(
                  leading: const Icon(CupertinoIcons.play_circle_fill),
                  title: Text(c.t('app.settings.showIntro')),
                  trailing: const CupertinoListTileChevron(),
                  onTap: state.resetOnboarding,
                ),
                CupertinoListTile(
                  leading: Icon(CupertinoIcons.square_arrow_right, color: G.red.resolveFrom(context)),
                  title: Text(c.t('app.settings.unlink'), style: TextStyle(color: G.red.resolveFrom(context))),
                  onTap: () => showCupertinoDialog<void>(
                    context: context,
                    builder: (ctx) => CupertinoAlertDialog(
                      title: Text(c.t('app.settings.unlinkConfirm')),
                      content: Text(c.t('app.settings.unlinkBody')),
                      actions: [
                        CupertinoDialogAction(onPressed: () => Navigator.pop(ctx), child: Text(c.t('app.common.cancel'))),
                        CupertinoDialogAction(
                          isDestructiveAction: true,
                          onPressed: () {
                            Navigator.pop(ctx);
                            state.unlink();
                          },
                          child: Text(c.t('app.settings.unlinkAction')),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            ShieldSettingsSection(header: _sectionHeader(context, c.t('shield.settingsTitle'))),
            const SizedBox(height: 30),
          ]),
        ],
      ),
    );
  }
}
