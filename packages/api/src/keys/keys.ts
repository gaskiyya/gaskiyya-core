import { createHmac, randomBytes } from 'node:crypto';

export type KeyPurpose = 'recipient' | 'content' | 'callback' | 'account' | 'receipt' | 'console' | 'call';

export interface KeyService {
  keyed(tenantId: string, purpose: KeyPurpose, value: string, version?: number): string;
  currentVersion(tenantId: string): number;
  versions(tenantId: string): number[];
  has(tenantId: string): boolean;
}

export type TenantKeyConfig = string | Buffer | { current: number | string; keys: Record<string, string | Buffer> };

interface TenantKeys {
  current: number;
  byVersion: Map<number, Buffer>;
}

const toBuffer = (k: string | Buffer) => (typeof k === 'string' ? Buffer.from(k, 'base64') : k);

export function parseTenantKeys(tenantId: string, cfg: TenantKeyConfig): TenantKeys {
  const byVersion = new Map<number, Buffer>();
  let current: number;
  if (typeof cfg === 'string' || Buffer.isBuffer(cfg)) {
    current = 1;
    byVersion.set(1, toBuffer(cfg));
  } else {
    if (!cfg || typeof cfg !== 'object' || !cfg.keys || typeof cfg.keys !== 'object') {
      throw new Error(`hashing keys for tenant ${tenantId} must be a base64 key or { current, keys }`);
    }
    current = Number(cfg.current);
    for (const [v, k] of Object.entries(cfg.keys)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new Error(`hashing key version "${v}" for tenant ${tenantId} must be a whole number from 1`);
      byVersion.set(n, toBuffer(k));
    }
    if (!byVersion.has(current)) throw new Error(`tenant ${tenantId}: current key version ${String(cfg.current)} is not in keys`);
  }
  for (const [v, k] of byVersion) {
    if (k.length < 32) throw new Error(`hashing key for tenant ${tenantId} (version ${v}) must be at least 32 bytes`);
  }
  return { current, byVersion };
}

export class StaticKeyService implements KeyService {
  private keys: Map<string, TenantKeys>;

  constructor(keys: Record<string, TenantKeyConfig>) {
    this.keys = new Map(Object.entries(keys).map(([t, k]) => [t, parseTenantKeys(t, k)]));
  }

  static random(tenantIds: string[]): StaticKeyService {
    return new StaticKeyService(Object.fromEntries(tenantIds.map((t) => [t, randomBytes(32)])));
  }

  has(tenantId: string) {
    return this.keys.has(tenantId);
  }

  private tenant(tenantId: string) {
    const t = this.keys.get(tenantId);
    if (!t) throw new Error('no hashing key for tenant');
    return t;
  }

  currentVersion(tenantId: string) {
    return this.tenant(tenantId).current;
  }

  versions(tenantId: string) {
    const t = this.tenant(tenantId);
    return [t.current, ...[...t.byVersion.keys()].filter((v) => v !== t.current).sort((a, b) => b - a)];
  }

  keyed(tenantId: string, purpose: KeyPurpose, value: string, version?: number): string {
    const t = this.tenant(tenantId);
    const key = t.byVersion.get(version ?? t.current);
    if (!key) throw new Error('no hashing key of that version for tenant');
    return createHmac('sha256', key).update(`${purpose}:${value}`).digest('hex');
  }
}
