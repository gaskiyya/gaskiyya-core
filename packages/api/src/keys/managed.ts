import { createHmac } from 'node:crypto';
import type { KeyPurpose, KeyService } from './keys.ts';

interface Version {
  key: Buffer;
  activatesAt: number;
}

export interface ManagedKeyEntry {
  tenantId: string;
  version: number;
  key: Buffer | null;
  activatesAt: number;
  retired: boolean;
}

export class ManagedKeyService implements KeyService {
  private extra = new Map<string, Map<number, Version>>();
  private retired = new Map<string, Set<number>>();

  constructor(
    private base: KeyService,
    private clock: () => Date = () => new Date(),
  ) {}

  load(entries: ManagedKeyEntry[]) {
    const extra = new Map<string, Map<number, Version>>();
    const retired = new Map<string, Set<number>>();
    for (const e of entries) {
      if (e.retired) {
        if (!retired.has(e.tenantId)) retired.set(e.tenantId, new Set());
        retired.get(e.tenantId)!.add(e.version);
        continue;
      }
      if (!e.key) continue;
      if (!extra.has(e.tenantId)) extra.set(e.tenantId, new Map());
      extra.get(e.tenantId)!.set(e.version, { key: e.key, activatesAt: e.activatesAt });
    }
    this.extra = extra;
    this.retired = retired;
  }

  add(tenantId: string, version: number, key: Buffer, activatesAt: number) {
    if (!this.extra.has(tenantId)) this.extra.set(tenantId, new Map());
    this.extra.get(tenantId)!.set(version, { key, activatesAt });
    this.retired.get(tenantId)?.delete(version);
  }

  retire(tenantId: string, version: number) {
    if (!this.retired.has(tenantId)) this.retired.set(tenantId, new Set());
    this.retired.get(tenantId)!.add(version);
    this.extra.get(tenantId)?.delete(version);
  }

  private isRetired(tenantId: string, v: number) {
    return this.retired.get(tenantId)?.has(v) ?? false;
  }

  private baseVersions(tenantId: string): number[] {
    return this.base.has(tenantId) ? this.base.versions(tenantId).filter((v) => !this.isRetired(tenantId, v)) : [];
  }

  describe(tenantId: string): { version: number; source: 'env' | 'admin'; activatesAt: number | null; current: boolean }[] {
    const versions = new Map<number, { source: 'env' | 'admin'; activatesAt: number | null }>();
    for (const v of this.baseVersions(tenantId)) versions.set(v, { source: 'env', activatesAt: null });
    for (const [v, x] of this.extra.get(tenantId) ?? []) versions.set(v, { source: 'admin', activatesAt: x.activatesAt });
    if (versions.size === 0) return [];
    const current = this.currentVersion(tenantId);
    return [...versions.entries()].sort((a, b) => b[0] - a[0]).map(([version, x]) => ({ version, ...x, current: version === current }));
  }

  retiredVersions(tenantId: string): number[] {
    return [...(this.retired.get(tenantId) ?? [])].sort((a, b) => b - a);
  }

  highestVersion(tenantId: string): number {
    const all = [...(this.base.has(tenantId) ? this.base.versions(tenantId) : []), ...(this.extra.get(tenantId)?.keys() ?? []), ...(this.retired.get(tenantId) ?? [])];
    return all.length ? Math.max(...all) : 0;
  }

  has(tenantId: string) {
    return this.baseVersions(tenantId).length > 0 || (this.extra.get(tenantId)?.size ?? 0) > 0;
  }

  currentVersion(tenantId: string) {
    const now = this.clock().getTime();
    const active = [...(this.extra.get(tenantId) ?? [])].filter(([, x]) => x.activatesAt <= now).map(([v]) => v);
    const base = this.baseVersions(tenantId);
    const baseCurrent = base.length && this.base.has(tenantId) && !this.isRetired(tenantId, this.base.currentVersion(tenantId)) ? this.base.currentVersion(tenantId) : null;
    const best = active.length ? Math.max(...active) : null;
    if (best !== null && (baseCurrent === null || best > baseCurrent)) return best;
    if (baseCurrent !== null) return baseCurrent;
    if (best !== null) return best;
    const pending = [...(this.extra.get(tenantId)?.keys() ?? [])];
    if (pending.length) return Math.min(...pending);
    if (base.length) return Math.max(...base);
    throw new Error('no hashing key for tenant');
  }

  versions(tenantId: string) {
    const current = this.currentVersion(tenantId);
    const all = new Set([...this.baseVersions(tenantId), ...(this.extra.get(tenantId)?.keys() ?? [])]);
    all.delete(current);
    return [current, ...[...all].sort((a, b) => b - a)];
  }

  keyed(tenantId: string, purpose: KeyPurpose, value: string, version?: number): string {
    const v = version ?? this.currentVersion(tenantId);
    if (this.isRetired(tenantId, v)) throw new Error('no hashing key of that version for tenant');
    const own = this.extra.get(tenantId)?.get(v);
    if (own) return createHmac('sha256', own.key).update(`${purpose}:${value}`).digest('hex');
    return this.base.keyed(tenantId, purpose, value, v);
  }
}
