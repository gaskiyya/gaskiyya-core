import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../core/copy.dart';
import '../ui/theme.dart';

class ShieldStatus {
  const ShieldStatus({this.screening = false, this.redirection = false, this.overlay = false, this.notifications = false, this.supported = false});
  factory ShieldStatus.fromMap(Map<Object?, Object?> m) => ShieldStatus(
        screening: m['screening'] == true,
        redirection: m['redirection'] == true,
        overlay: m['overlay'] == true,
        notifications: m['notifications'] == true,
        supported: m['supported'] == true,
      );
  final bool screening;
  final bool redirection;
  final bool overlay;
  final bool notifications;

  final bool supported;
}

class ShieldSetup {
  static const channel = MethodChannel('ng.gaskiya/shield.setup');

  static bool get available => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

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

  final Widget header;

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
    if (!ShieldSetup.available) return;
    final s = await ShieldSetup.status();
    if (mounted) setState(() => _status = s);
  }

  Widget _row(BuildContext context, String perm, bool on, String method) {
    final c = Copy.I;
    return CupertinoListTile(
      key: ValueKey('shield-$perm'),
      title: Text(c.t('shield.perm.$perm.title'), maxLines: 3, overflow: TextOverflow.visible),
      subtitle: Text(c.t('shield.perm.$perm.body'), maxLines: 6, overflow: TextOverflow.visible),
      trailing: on
          ? Text(c.t('shield.on'), style: TextStyle(color: G.greenInk.resolveFrom(context)))
          : CupertinoButton(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(44, 44),
              onPressed: () async {
                await ShieldSetup.request(method);
                await _refresh();
              },
              child: Text(c.t('shield.turnOn')),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Copy.I;
    final s = _status;
    final android = ShieldSetup.available;
    return CupertinoListSection.insetGrouped(
      header: widget.header,
      footer: android ? Text(c.t('shield.settingsIntro')) : null,
      children: [
        if (!android)
          CupertinoListTile(padding: const EdgeInsetsDirectional.fromSTEB(20, 11, 14, 11), leading: const Icon(CupertinoIcons.shield), title: Text(c.t('shield.androidOnly'), maxLines: 4, overflow: TextOverflow.visible))
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
