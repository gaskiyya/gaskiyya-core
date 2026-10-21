import { createHash } from 'node:crypto';
import type { Category, Channel } from '@gaskiya/schemas';
import type { Logger } from './service.ts';
import type { RegistrationAlert, Store, Tenant } from './store/types.ts';

export interface GuardConfig {
  spikeWindowMinutes: number;
  spikeBaselineMinutes: number;
  spikeFactor: number;
  spikeMinCount: number;
}

export const DEFAULT_GUARD: GuardConfig = { spikeWindowMinutes: 5, spikeBaselineMinutes: 60, spikeFactor: 5, spikeMinCount: 200 };

export interface Registered {
  linkDomains: string[];
  category: Category;
  channel: Channel;
}

const MINUTE = 60_000;

export function bankDomain(domain: string, bankDomains: string[]): boolean {
  const d = domain.toLowerCase().replace(/\.$/, '');
  return bankDomains.some((b) => {
    const own = b.toLowerCase();
    return d === own || d.endsWith(`.${own}`);
  });
}

export function isSpike(windowCount: number, baselineCount: number, cfg: GuardConfig): { spike: boolean; expected: number } {
  const expected = (baselineCount * cfg.spikeWindowMinutes) / cfg.spikeBaselineMinutes;
  return { spike: windowCount >= cfg.spikeMinCount && windowCount > cfg.spikeFactor * expected, expected: Math.round(expected * 10) / 10 };
}

const alertId = (...parts: string[]) => `ral_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20)}`;

export class RegistrationGuard {
  private buckets = new Map<string, Map<number, number>>();
  private lastSpike = new Map<string, number>();
  private pending = new Set<Promise<unknown>>();

  constructor(
    private store: Store,
    readonly cfg: GuardConfig = DEFAULT_GUARD,
    private clock: () => Date = () => new Date(),
    private onAlert: ((tenant: Tenant, alert: RegistrationAlert) => Promise<void>) | null = null,
    private log: Logger = { warn: () => {}, error: () => {} },
  ) {}

  async observe(tenant: Tenant, registered: Registered[], clientId: string | null = null): Promise<RegistrationAlert[]> {
    if (registered.length === 0) return [];
    try {
      const now = this.clock();
      const raised: RegistrationAlert[] = [];
      const spike = this.countVolume(tenant, registered.length, now, clientId);
      if (spike) raised.push(spike);
      raised.push(...(await this.checkDomains(tenant, registered, now, clientId)));
      for (const a of raised) {
        if (a.kind === 'volume_spike') await this.store.putAlert(a);
        this.dispatch(tenant, a);
      }
      return raised;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'registration guard failed');
      return [];
    }
  }

  async observeCount(tenant: Tenant, n: number, clientId: string | null = null): Promise<RegistrationAlert[]> {
    if (n <= 0) return [];
    try {
      const spike = this.countVolume(tenant, n, this.clock(), clientId);
      if (!spike) return [];
      await this.store.putAlert(spike);
      this.dispatch(tenant, spike);
      return [spike];
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'registration guard failed');
      return [];
    }
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private dispatch(tenant: Tenant, alert: RegistrationAlert) {
    if (!this.onAlert) return;
    const p = this.onAlert(tenant, alert)
      .catch((err: Error) => this.log.warn({ err: err.message, alertId: alert.id }, 'registration alert notification failed'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  private countVolume(tenant: Tenant, n: number, now: Date, clientId: string | null): RegistrationAlert | null {
    const { spikeWindowMinutes: w, spikeBaselineMinutes: b } = this.cfg;
    const minute = Math.floor(now.getTime() / MINUTE);
    let buckets = this.buckets.get(tenant.id);
    if (!buckets) this.buckets.set(tenant.id, (buckets = new Map()));
    buckets.set(minute, (buckets.get(minute) ?? 0) + n);
    let windowCount = 0;
    let baselineCount = 0;
    for (const [m, count] of buckets) {
      const age = minute - m;
      if (age < 0) continue;
      if (age < w) windowCount += count;
      else if (age < w + b) baselineCount += count;
      else buckets.delete(m);
    }
    const { spike, expected } = isSpike(windowCount, baselineCount, this.cfg);
    if (!spike) return null;
    const last = this.lastSpike.get(tenant.id);
    if (last !== undefined && minute - last < w) return null;
    this.lastSpike.set(tenant.id, minute);
    const at = now.toISOString();
    return {
      id: alertId(tenant.id, 'volume_spike', String(minute)),
      tenantId: tenant.id,
      kind: 'volume_spike',
      domain: null,
      category: null,
      channel: null,
      clientId,
      count: windowCount,
      expected,
      windowMinutes: w,
      firstSeen: at,
      lastSeen: at,
    };
  }

  private async checkDomains(tenant: Tenant, registered: Registered[], now: Date, clientId: string | null): Promise<RegistrationAlert[]> {
    const unknown = new Map<string, { count: number; first: Registered }>();
    for (const r of registered) {
      for (const d of new Set(r.linkDomains.map((x) => x.toLowerCase()))) {
        if (bankDomain(d, tenant.domains)) continue;
        const u = unknown.get(d);
        if (u) u.count++;
        else unknown.set(d, { count: 1, first: r });
      }
    }
    const raised: RegistrationAlert[] = [];
    const at = now.toISOString();
    for (const [domain, { count, first }] of unknown) {
      const id = alertId(tenant.id, 'unknown_link_domain', domain);
      const existing = await this.store.getAlert(tenant.id, id);
      if (existing) {
        await this.store.putAlert({ ...existing, count: existing.count + count, lastSeen: at, clientId: clientId ?? existing.clientId });
        continue;
      }
      const alert: RegistrationAlert = {
        id,
        tenantId: tenant.id,
        kind: 'unknown_link_domain',
        domain,
        category: first.category,
        channel: first.channel,
        clientId,
        count,
        expected: null,
        windowMinutes: null,
        firstSeen: at,
        lastSeen: at,
      };
      await this.store.putAlert(alert);
      raised.push(alert);
    }
    return raised;
  }
}
