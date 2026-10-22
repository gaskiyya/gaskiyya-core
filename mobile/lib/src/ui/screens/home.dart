import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import '../../core/api.dart';
import '../../core/calls.dart';
import '../../core/copy.dart';
import '../../core/session.dart';
import '../../shield/shield_settings.dart';
import '../theme.dart';
import '../widgets/tab_bar.dart';
import '../widgets/widgets.dart';
import 'alerts.dart';
import 'calls_screen.dart';
import 'check_screen.dart';

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
    unawaited(NativeCalls.instance.sendLabels());
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
          tabBar: GTabBar(
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
        // The bank that is actually calling, never the bank picked in Settings. An answered call has no
        // screen in the app: the bank and its code are on the phone's own call screen (core/calls.dart).
        _CallBanner(
          call: _banner,
          bank: _bannerBank ?? Copy.I.t('app.common.yourBank').cap,
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
  List<({BankLink link, ({List<ActivityItem> items, String text})? data})>? _data;
  String _ids = '';

  String get _linkIds => widget.state.links.map((l) => l.id).join(',');

  @override
  void initState() {
    super.initState();
    _ids = _linkIds;
    widget.state.addListener(_onLinks);
    _load();
  }

  @override
  void dispose() {
    widget.state.removeListener(_onLinks);
    super.dispose();
  }

  void _onLinks() {
    if (_linkIds == _ids) return;
    _ids = _linkIds;
    setState(() => _data = null);
    _load();
  }

  Future<void> _load() async {
    final ids = _linkIds;
    unawaited(widget.state.refreshAdvisories());
    final links = widget.state.links;
    final all = await Future.wait(links.map((l) async => (link: l, data: await l.client.activity())));
    if (mounted && ids == _linkIds) setState(() => _data = all);
  }

  IconData _icon(String category) => switch (category) {
        'otp' => CupertinoIcons.number_square_fill,
        'transaction_alert' => CupertinoIcons.arrow_right_arrow_left_square_fill,
        'security_notice' => CupertinoIcons.lock_shield_fill,
        'service_update' => CupertinoIcons.sparkles,
        'marketing' => CupertinoIcons.gift_fill,
        _ => CupertinoIcons.phone_fill,
      };

  /// Every organisation's last 24 hours as one list, the same category and channel added together.
  List<ActivityItem> _merged(Iterable<({List<ActivityItem> items, String text})> all) {
    final rows = <String, ActivityItem>{};
    for (final d in all) {
      for (final i in d.items) {
        final k = '${i.category}/${i.channel}';
        final had = rows[k];
        rows[k] = had == null
            ? i
            : ActivityItem(category: i.category, channel: i.channel, count: had.count + i.count, anyWithLink: had.anyWithLink || i.anyWithLink);
      }
    }
    return rows.values.toList()..sort((a, b) => b.count.compareTo(a.count));
  }

  Widget _rows(BuildContext context, List<ActivityItem> items) {
    final c = Copy.I;
    return GroupCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        for (var i = 0; i < items.length; i++) ...[
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
                  child: Icon(_icon(items[i].category), size: 19, color: G.tint.resolveFrom(context)),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(c.category(items[i].category).cap, style: G.headline(context)),
                    Text('${c.t('app.activity.by', {'channel': c.channel(items[i].channel)})}${items[i].anyWithLink ? ' · ${c.t('app.activity.withLink')}' : ''}', style: G.footnote(context)),
                  ]),
                ),
                Text('${items[i].count}', style: G.title3(context)),
              ]),
            ),
          ),
        ],
      ]),
    );
  }

  Widget _note(BuildContext context, IconData icon, String text) => GroupCard(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: G.label2.resolveFrom(context), size: 22),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: G.subhead(context))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final data = _data;
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
              SectionHeader(c.t('app.activity.last24h')),
              if (data == null)
                const GroupCard(child: Shimmer())
              else ...[
                if (data.any((e) => e.data == null)) ...[
                  _note(context, CupertinoIcons.exclamationmark_circle, c.t('app.activity.unavailable', {'bank': c.orList([for (final e in data) if (e.data == null) e.link.bank.name])})),
                  const SizedBox(height: 12),
                ],
                if (data.any((e) => e.data != null))
                  Reveal(
                    key: const ValueKey('activity'),
                    child: switch (_merged([for (final e in data) ?e.data])) {
                      final items when items.isEmpty => _note(context, CupertinoIcons.tray, c.t('app.activity.none')),
                      final items => _rows(context, items),
                    },
                  ),
              ],
              const SizedBox(height: 18),
              Text(c.t('app.activity.footer'), textAlign: TextAlign.center, style: G.caption(context)),
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

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(listenable: state, builder: (context, _) => _build(context));
  }

  void _confirmSignOut(BuildContext context) {
    final c = Copy.I;
    showCupertinoDialog<void>(
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
    );
  }

  Widget _build(BuildContext context) {
    final c = Copy.I;
    return CupertinoPageScaffold(
      child: CustomScrollView(
        slivers: [
          CupertinoSliverNavigationBar(largeTitle: Text(c.t('app.tabs.settings')), border: null, backgroundColor: G.bg.resolveFrom(context).withValues(alpha: 0.85)),
          SliverSafeArea(
            top: false,
            sliver: SliverToBoxAdapter(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                SettingsSection(children: [
                  SettingsRow(
                    key: const ValueKey('language'),
                    icon: CupertinoIcons.globe,
                    iconColor: G.blue.resolveFrom(context),
                    title: c.t('app.language.title'),
                    value: c.t('app.language.names.${c.language}'),
                    chevron: true,
                    onTap: () => _pickLanguage(context),
                  ),
                ]),
                ShieldSettingsSection(header: c.t('shield.settingsTitle')),
                SettingsSection(
                  header: c.t('app.settings.privacy'),
                  children: [
                    SettingsRow(icon: CupertinoIcons.lock_fill, iconColor: G.tint.resolveFrom(context), title: c.t('app.settings.textStays'), subtitle: c.t('app.settings.textStaysBody')),
                    SettingsRow(icon: CupertinoIcons.eye_slash_fill, iconColor: G.indigo.resolveFrom(context), title: c.t('app.settings.numbersMasked')),
                    SettingsRow(icon: CupertinoIcons.hand_raised_fill, iconColor: G.orange.resolveFrom(context), title: c.t('app.settings.reportsConsent')),
                  ],
                ),
                SettingsSection(
                  header: c.t('app.settings.about'),
                  footer: c.t('safety.neverAsks'),
                  children: [
                    SettingsRow(
                      icon: CupertinoIcons.play_fill,
                      iconColor: G.teal.resolveFrom(context),
                      title: c.t('app.settings.showIntro'),
                      chevron: true,
                      onTap: state.resetOnboarding,
                    ),
                  ],
                ),
                SettingsSection(children: [
                  SettingsRow(
                    key: const ValueKey('sign-out'),
                    icon: CupertinoIcons.square_arrow_right,
                    destructive: true,
                    title: c.t('app.settings.unlink'),
                    onTap: () => _confirmSignOut(context),
                  ),
                ]),
                const SizedBox(height: 36),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}
