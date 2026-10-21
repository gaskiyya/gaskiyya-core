import type { SimSwapProbe } from '../domain/verdict.ts';
import { SimSwapError, type SimSwapProvider } from './simswap.ts';

export interface SimSwapSettings {
  warnHours: number;
  waitMs: number;
  cacheSeconds: number;
}

export const DEFAULT_SIM_SWAP: SimSwapSettings = { warnHours: 72, waitMs: 800, cacheSeconds: 60 };

interface Logger {
  warn(obj: object, msg?: string): void;
}

export interface SimSwapDeps {
  clock: () => Date;
  log: Logger;
  count: (tenantId: string, key: string) => void;
  onSwap?: (tenantId: string, recipientKey: string, latestSimChange: string | null) => Promise<void>;
}

export class SimSwapMonitor {
  private cache = new Map<string, { at: number; probe: SimSwapProbe }>();
  private notified = new Set<string>();

  constructor(
    readonly provider: SimSwapProvider,
    readonly cfg: SimSwapSettings,
    private deps: SimSwapDeps,
  ) {}

  async ask(phone: string, maxAgeHours: number): Promise<SimSwapProbe> {
    try {
      const r = await this.provider.check(phone, maxAgeHours);
      if (typeof r?.swapped !== 'boolean') return { ok: false };
      return { ok: true, swapped: r.swapped, latestSimChange: r.latestSimChange ?? null };
    } catch (err) {
      // Log code and status only: a provider error message could quote the phone number.
      const e = err as SimSwapError;
      this.deps.log.warn({ err: { code: e instanceof SimSwapError ? e.code : 'error', status: e instanceof SimSwapError ? e.status : undefined } }, 'SIM swap check failed');
      return { ok: false };
    }
  }

  start(tenantId: string, recipientKey: string, phone: string, { notify = true } = {}): () => Promise<SimSwapProbe> {
    const started = Date.now();
    const key = `${tenantId}:${recipientKey}`;
    const now = this.deps.clock().getTime();
    const hit = this.cache.get(key);
    let pending: Promise<SimSwapProbe>;
    if (hit && now - hit.at < this.cfg.cacheSeconds * 1000) {
      if (notify && hit.probe.ok && hit.probe.swapped) this.notify(tenantId, recipientKey, hit.probe.latestSimChange ?? null);
      pending = Promise.resolve(hit.probe);
    } else {
      pending = this.ask(phone, this.cfg.warnHours).then((probe) => {
        if (probe.ok) this.remember(key, now, probe);
        if (notify && probe.ok && probe.swapped) this.notify(tenantId, recipientKey, probe.latestSimChange ?? null);
        return probe;
      });
    }
    return () => {
      const left = Math.max(0, this.cfg.waitMs - (Date.now() - started));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<SimSwapProbe>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), left);
        (timer as { unref?: () => void }).unref?.();
      });
      return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
    };
  }

  private remember(key: string, at: number, probe: SimSwapProbe) {
    this.cache.set(key, { at, probe });
    if (this.cache.size > 10_000) {
      for (const k of [...this.cache.keys()].slice(0, 5_000)) this.cache.delete(k);
    }
  }

  private notify(tenantId: string, recipientKey: string, latest: string | null) {
    const once = `${tenantId}:${recipientKey}:${latest ?? 'unknown'}`;
    if (!this.deps.onSwap || this.notified.has(once)) return;
    this.notified.add(once);
    if (this.notified.size > 10_000) this.notified.clear();
    this.deps.count(tenantId, 'bank_notified');
    this.deps.onSwap(tenantId, recipientKey, latest).catch((err: Error) => this.deps.log.warn({ err: { message: err.message } }, 'SIM swap notice to the bank failed'));
  }

  clear() {
    this.cache.clear();
  }
}
