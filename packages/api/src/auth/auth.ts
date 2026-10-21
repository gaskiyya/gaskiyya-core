import { createHash, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Tenant } from '../store/types.ts';

export interface BankClient {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export interface ClientDirectory {
  authenticate(clientId: string, clientSecret: string): Promise<{ tenantId: string } | null>;
  generation(clientId: string): number;
  refuses(clientId: string, generation: number | undefined): boolean;
  used(clientId: string): void;
}

const BANK_AUDIENCE = 'gaskiya-registry';
const CUSTOMER_AUDIENCE = 'gaskiya';
const BANK_TOKEN_TTL_S = 600;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export class BankAuth {
  private secret: Uint8Array;

  directory: ClientDirectory | null = null;

  constructor(
    tokenSecret: string,
    private clients: BankClient[],
  ) {
    if (tokenSecret.length < 32) throw new Error('GASKIYA_TOKEN_SECRET must be at least 32 characters');
    this.secret = new TextEncoder().encode(tokenSecret);
  }

  configuredClients(): { clientId: string; tenantId: string }[] {
    return this.clients.map((c) => ({ clientId: c.clientId, tenantId: c.tenantId }));
  }

  async authenticate(clientId: string, clientSecret: string): Promise<{ clientId: string; tenantId: string } | null> {
    const client = this.clients.find((c) => safeEqual(c.clientId, clientId));
    if (client) {
      if (!safeEqual(client.clientSecret, clientSecret)) return null;
      if (this.directory?.refuses(client.clientId, undefined)) return null;
      return { clientId: client.clientId, tenantId: client.tenantId };
    }
    const found = await this.directory?.authenticate(clientId, clientSecret);
    return found ? { clientId, tenantId: found.tenantId } : null;
  }

  async issue(clientId: string, clientSecret: string): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number } | null> {
    const client = await this.authenticate(clientId, clientSecret);
    return client ? this.sign(client) : null;
  }

  async sign(client: { clientId: string; tenantId: string }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    this.directory?.used(client.clientId);
    const gen = this.directory?.generation(client.clientId) ?? 0;
    const token = await new SignJWT({ tid: client.tenantId, scope: 'registry', ...(gen ? { gen } : {}) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(client.clientId)
      .setAudience(BANK_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${BANK_TOKEN_TTL_S}s`)
      .sign(this.secret);
    return { access_token: token, token_type: 'Bearer', expires_in: BANK_TOKEN_TTL_S };
  }

  async verify(bearer: string | undefined): Promise<{ tenantId: string; clientId: string } | null> {
    if (!bearer?.startsWith('Bearer ')) return null;
    try {
      const { payload } = await jwtVerify(bearer.slice(7), this.secret, { audience: BANK_AUDIENCE, algorithms: ['HS256'] });
      if (payload.scope !== 'registry' || typeof payload.tid !== 'string' || typeof payload.sub !== 'string') return null;
      if (this.directory?.refuses(payload.sub, typeof payload.gen === 'number' ? payload.gen : 0)) return null;
      return { tenantId: payload.tid, clientId: payload.sub };
    } catch {
      return null;
    }
  }
}

export class CustomerAuth {
  private keySets = new Map<string, JWTVerifyGetKey>();

  constructor(private tenants: Map<string, Tenant>) {}

  forget(tenantId: string) {
    this.keySets.delete(tenantId);
  }

  private keySet(tenant: Tenant): JWTVerifyGetKey | null {
    let ks = this.keySets.get(tenant.id);
    if (ks) return ks;
    if (tenant.tokenKeys) ks = createLocalJWKSet(tenant.tokenKeys as Parameters<typeof createLocalJWKSet>[0]);
    else if (tenant.tokenKeysUrl) ks = createRemoteJWKSet(new URL(tenant.tokenKeysUrl), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
    else return null;
    this.keySets.set(tenant.id, ks);
    return ks;
  }

  async verify(bearer: string | undefined): Promise<{ tenant: Tenant; phone: string; accounts: string[] } | null> {
    if (!bearer?.startsWith('Bearer ')) return null;
    const token = bearer.slice(7);
    try {
      const [, body] = token.split('.');
      const unverified = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8')) as { iss?: unknown };
      const tenant = typeof unverified.iss === 'string' ? this.tenants.get(unverified.iss) : undefined;
      if (!tenant) return null;
      const ks = this.keySet(tenant);
      if (!ks) return null;
      const { payload } = await jwtVerify(token, ks, {
        issuer: tenant.id,
        audience: CUSTOMER_AUDIENCE,
        algorithms: ['ES256', 'RS256', 'EdDSA'],
        maxTokenAge: '15m',
      });
      if (typeof payload.sub !== 'string' || !/^\+[1-9]\d{6,14}$/.test(payload.sub)) return null;
      return { tenant, phone: payload.sub, accounts: accountsClaim(payload.accts) };
    } catch {
      return null;
    }
  }
}

function accountsClaim(claim: unknown): string[] {
  if (!Array.isArray(claim)) return [];
  return [...new Set(claim.filter((a): a is string => typeof a === 'string' && /^[0-9]{10}$/.test(a)))].slice(0, 20);
}
