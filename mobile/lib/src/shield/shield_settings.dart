import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../core/copy.dart';
import '../ui/theme.dart';
import '../ui/widgets/widgets.dart';

class ShieldStatus {
  const ShieldStatus({this.screening = false, this.redirection = false, this.overlay = false, this.notifications = false, this.alerts = false, this.supported = false});
  factory ShieldStatus.fromMap(Map<Object?, Object?> m) => ShieldStatus(
        screening: m['screening'] == true,
        redirection: m['redirection'] == true,
        overlay: m['overlay'] == true,
        notifications: m['notifications'] == true,
        alerts: m['alerts'] == true,
        supported: m['supported'] == true,
      );
  final bool screening;
  final bool redirection;
  final bool overlay;
  final bool notifications;

  /// iPhone: bank calls and warnings may ring and notify.
  final bool alerts;

  final bool supported;
}

class ShieldSetup {
  static const channel = MethodChannel('ng.gaskiya/shield.setup');

  static bool get available => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool get ios => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  static Future<ShieldStatus> status() async {
    try {
      final m = await channel.invokeMethod<Map<Object?, Object?>>('status');
      return m == null ? const ShieldStatus() : ShieldStatus.fromMap(m);
    } catch (_) {
      return const ShieldStatus();
    }
  }

  static Future<void> request(String method) async {
    try {
      await channel.invokeMethod<Object?>(method);
    } catch (_) {}
  }
}

class ShieldSettingsSection extends StatefulWidget {
  const ShieldSettingsSection({super.key, required this.header});

  final String header;

  @override
  State<ShieldSettingsSection> createState() => _ShieldSettingsSectionState();
}

class _ShieldSettingsSectionState extends State<ShieldSettingsSection> with WidgetsBindingObserver {
  ShieldStatus? _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    if (!ShieldSetup.available && !ShieldSetup.ios) return;
    final s = await ShieldSetup.status();
    if (mounted) setState(() => _status = s);
  }

  Future<void> _turnOn(String method) async {
    await ShieldSetup.request(method);
    await _refresh();
  }

  static const _icons = <String, (IconData, CupertinoDynamicColor)>{
    'calls': (CupertinoIcons.phone_fill, G.green),
    'dialled': (CupertinoIcons.phone_fill_arrow_up_right, G.blue),
    'overlay': (CupertinoIcons.square_stack_fill, G.indigo),
    'messages': (CupertinoIcons.chat_bubble_text_fill, G.orange),
    'alerts': (CupertinoIcons.bell_fill, G.red),
  };

  Widget _row(BuildContext context, String perm, bool on, String method, {String? copy}) {
    final c = Copy.I;
    final k = copy ?? 'shield.perm.$perm';
    final (icon, color) = _icons[perm]!;
    return SettingsRow(
      key: ValueKey('shield-$perm'),
      icon: icon,
      iconColor: color.resolveFrom(context),
      title: c.t('$k.title'),
      subtitle: c.t('$k.body'),
      onTap: on ? null : () => _turnOn(method),
      trailing: on ? SettingsOn(c.t('shield.on')) : SettingsButton(label: c.t('shield.turnOn'), onTap: () => _turnOn(method)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final s = _status;
    final android = ShieldSetup.available;
    return SettingsSection(
      header: widget.header,
      footer: c.t(android ? 'shield.settingsIntro' : 'shield.ios.note'),
      children: [
        if (!android)
          _row(context, 'alerts', s?.alerts ?? false, 'requestAlerts', copy: 'shield.ios.alerts')
        else ...[
          _row(context, 'calls', s?.screening ?? false, 'requestScreeningRole'),
          _row(context, 'dialled', s?.redirection ?? false, 'requestRedirectionRole'),
          _row(context, 'overlay', s?.overlay ?? false, 'openOverlaySettings'),
          _row(context, 'messages', s?.notifications ?? false, 'openNotificationAccess'),
        ],
      ],
    );
  }
}
