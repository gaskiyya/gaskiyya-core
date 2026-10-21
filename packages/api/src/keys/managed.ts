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
    for (const entry of entries) {
      if (entry.retired) {
        if (!retired.has(entry.tenantId)) retired.set(entry.tenantId, new Set());
        retired.get(entry.tenantId)!.add(entry.version);
        continue;
      }
      if (!entry.key) continue;
      if (!extra.has(entry.tenantId)) extra.set(entry.tenantId, new Map());
      extra.get(entry.tenantId)!.set(entry.version, { key: entry.key, activatesAt: entry.activatesAt });
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

  private isRetired(tenantId: string, version: number) {
    return this.retired.get(tenantId)?.has(version) ?? false;
  }

  private baseVersions(tenantId: string): number[] {
    return this.base.has(tenantId) ? this.base.versions(tenantId).filter((version) => !this.isRetired(tenantId, version)) : [];
  }

  describe(tenantId: string): { version: number; source: 'env' | 'admin'; activatesAt: number | null; current: boolean }[] {
    const versions = new Map<number, { source: 'env' | 'admin'; activatesAt: number | null }>();
    for (const version of this.baseVersions(tenantId)) versions.set(version, { source: 'env', activatesAt: null });
    for (const [version, value] of this.extra.get(tenantId) ?? []) versions.set(version, { source: 'admin', activatesAt: value.activatesAt });
    if (versions.size === 0) return [];
    const current = this.currentVersion(tenantId);
    return [...versions.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([version, value]) => ({ version, ...value, current: version === current }));
  }

  retiredVersions(tenantId: string): number[] {
    return [...(this.retired.get(tenantId) ?? [])].sort((a, b) => b - a);
  }

  highestVersion(tenantId: string): number {
    const versions = [
      ...(this.base.has(tenantId) ? this.base.versions(tenantId) : []),
      ...(this.extra.get(tenantId)?.keys() ?? []),
      ...(this.retired.get(tenantId) ?? []),
    ];
    return versions.length ? Math.max(...versions) : 0;
  }

  has(tenantId: string) {
    return this.baseVersions(tenantId).length > 0 || (this.extra.get(tenantId)?.size ?? 0) > 0;
  }

  currentVersion(tenantId: string) {
    const now = this.clock().getTime();
    const active = [...(this.extra.get(tenantId) ?? [])]
      .filter(([, value]) => value.activatesAt <= now)
      .map(([version]) => version);
    const base = this.baseVersions(tenantId);
    const baseCurrent = base.length && this.base.has(tenantId) && !this.isRetired(tenantId, this.base.currentVersion(tenantId))
      ? this.base.currentVersion(tenantId)
      : null;
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
    const selected = version ?? this.currentVersion(tenantId);
    if (this.isRetired(tenantId, selected)) throw new Error('no hashing key of that version for tenant');
    const managed = this.extra.get(tenantId)?.get(selected);
    if (managed) return createHmac('sha256', managed.key).update(`${purpose}:${value}`).digest('hex');
    return this.base.keyed(tenantId, purpose, value, selected);
  }
}
