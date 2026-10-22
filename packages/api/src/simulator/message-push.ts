import { InvalidPushTokenError, type DemoNotice, type PushProvider } from '../channels/channels.ts';
import type { GaskiyaService, Logger } from '../service.ts';

export const PREVIEW_MAX = 120;

export function preview(text: string, max = PREVIEW_MAX) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Demo only. Alerts a customer's phones to something the bank console sent them (a message in the
 * demo inbox, a payment receipt), the way the phone's own SMS or bank alert would. It goes to the
 * devices linked to the organisation it is from, the only one whose app view shows it. Nothing is
 * stored: the registry keeps hashes only, and the demo text stays in the simulator's memory.
 */
export function demoCustomerPusher(svc: Pick<GaskiyaService, 'tenant' | 'recipientKeys' | 'store'>, push: PushProvider, log?: Logger) {
  return async (tenantId: string, phone: string, notice: DemoNotice): Promise<number> => {
    if (!svc.tenant(tenantId)) return 0;
    let devices;
    try {
      devices = (await Promise.all(svc.recipientKeys(tenantId, phone).map((k) => svc.store.devices(tenantId, k)))).flat();
    } catch (err) {
      log?.warn({ err: (err as Error).message }, 'demo push: device list failed');
      return 0;
    }
    const byToken = new Map(devices.map((d) => [d.pushToken, d]));
    const sent = await Promise.all(
      [...byToken.values()].map((d) =>
        push.send(d.pushToken, notice).then(
          () => 1,
          async (err: Error) => {
            if (err instanceof InvalidPushTokenError) await svc.store.removeDevice(tenantId, d.recipientKey, d.pushToken).catch(() => {});
            else log?.warn({ err: err.message }, 'demo push failed');
            return 0;
          },
        ),
      ),
    );
    return sent.reduce((a: number, b: number) => a + b, 0);
  };
}
