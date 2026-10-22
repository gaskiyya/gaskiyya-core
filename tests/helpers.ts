import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { randomUUID } from 'node:crypto';
import {
  createSystem,
  FirestoreStore,
  firestoreRateLimiters,
  MemoryMessaging,
  MemoryPush,
  memoryRateLimiters,
  MemoryStore,
  StaticKeyService,
  type KeyService,
  type ModelProvider,
  type RateLimiterFactory,
  type Store,
  type Tenant,
} from '../packages/api/src/index.ts';
import type { PushProvider } from '../packages/api/src/channels/channels.ts';
import type { Mailer } from '../packages/api/src/channels/email.ts';
import type { GuardConfig } from '../packages/api/src/guard.ts';
import type { LicenceRegistry } from '../packages/api/src/licences/registry.ts';
import type { SimSwapSettings } from '../packages/api/src/simswap/monitor.ts';
import type { SimSwapProvider } from '../packages/api/src/simswap/simswap.ts';
import type { WebhookSender } from '../packages/api/src/channels/webhook.ts';
import { contentDigest } from '@gaskiya/canonical';

export const TENANT: Omit<Tenant, 'tokenKeys'> = {
  id: 'demobank',
  name: 'DemoBank',
  domains: ['demobank.ng', 'demobank.com'],
  senderIds: ['DemoBank'],
  bankCode: '999001',
};
export const ALICE = '+2348012345678';
export const BOB = '+2348098765432';
export const BANK_CLIENT = { clientId: 'demobank-notify', clientSecret: 'test-client-secret-not-real-0001', tenantId: 'demobank' };
export const OTHER_TENANT: Omit<Tenant, 'tokenKeys'> = { id: 'otherbank', name: 'OtherBank', domains: ['otherbank.ng'], senderIds: ['OtherBank'] };
export const OTHER_CLIENT = { clientId: 'otherbank-notify', clientSecret: 'test-client-secret-not-real-0002', tenantId: 'otherbank' };
export const TOKEN_SECRET = 'test-token-secret-not-real-0123456789abcdef';
export const WA = { verifyToken: 'wa-verify-test', appSecret: 'wa-app-secret-test', tenantId: 'demobank' };
export const USSD = { token: 'ussd-test-token-not-real-000001', tenantId: 'demobank' };

export function testStore(): Store {
  if (process.env.GASKIYA_TEST_STORE === 'firestore') {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('GASKIYA_TEST_STORE=firestore needs FIRESTORE_EMULATOR_HOST');
    return new FirestoreStore({ projectId: 'demo-gaskiya', prefix: `t${randomUUID().slice(0, 8)}` });
  }
  return new MemoryStore();
}

export function testRateLimiters(store: Store): RateLimiterFactory {
  return store instanceof FirestoreStore ? firestoreRateLimiters(store.db, store.prefix) : memoryRateLimiters;
}

export interface Harness {
  sys: ReturnType<typeof createSystem>;
  push: MemoryPush;
  messaging: MemoryMessaging;
  logs: string[];
  bankToken: string;
  otherBankToken: string | null;
  customerToken(phone: string, opts?: { iss?: string; key?: CryptoKey; expSeconds?: number }): Promise<string>;
  register(phone: string, text: string, extra?: Record<string, unknown>): Promise<{ status: number; body: any }>;
  verify(phone: string, text: string): Promise<{ status: number; body: any }>;
  clock: { now: Date };
  bankTokenFor(tenantId: string): Promise<string>;
}

export const clientFor = (tenantId: string) => ({ clientId: `${tenantId}-client`, clientSecret: `test-client-secret-not-real-${tenantId}`.padEnd(32, '0'), tenantId });

export async function harness(
  opts: {
    store?: Store;
    model?: ModelProvider;
    aiTimeoutMs?: number;
    rateLimit?: number;
    reportRateLimit?: number;
    tokenRateLimit?: number;
    corsOrigins?: string[] | boolean;
    push?: PushProvider;
    mailer?: Mailer | null;
    alertEmails?: string[];
    agentJobToken?: string;
    keys?: KeyService;
    guard?: Partial<GuardConfig>;
    ussd?: { token: string; tenantId: string } | null;
    licences?: LicenceRegistry;
    licenceMaxAgeDays?: number;
    tenant?: Partial<Tenant>;
    extraTenants?: Omit<Tenant, 'tokenKeys'>[];
    whatsappTenantId?: string;
    otherBank?: boolean;
    advisoryTtlDays?: number;
    simSwap?: SimSwapProvider | null;
    simSwapSettings?: Partial<SimSwapSettings>;
    simSwapRateLimit?: number;
    beforeReady?: (sys: ReturnType<typeof createSystem>) => Promise<unknown>;
    consoleDemoTenantId?: string | null;
    admin?: { password: string; masterKey?: Buffer | null; keyActivationSeconds?: number; webhooks?: WebhookSender; production?: boolean; loginRateLimit?: number };
  } = {},
): Promise<Harness> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const push = (opts.push ?? new MemoryPush()) as MemoryPush;
  const messaging = new MemoryMessaging();
  const logs: string[] = [];
  const clock = { now: new Date() };
  const store = opts.store ?? testStore();
  const extra = opts.extraTenants ?? [];
  const sys = createSystem({
    tenants: [
      { ...TENANT, ...opts.tenant, tokenKeys: { keys: [jwk] }, alertEmails: opts.alertEmails },
      ...(opts.otherBank ? [{ ...OTHER_TENANT, tokenKeys: { keys: [jwk] } }] : []),
      ...extra.map((t) => ({ ...t, tokenKeys: { keys: [jwk] } })),
    ],
    keys: opts.keys ?? StaticKeyService.random([TENANT.id, ...(opts.otherBank ? [OTHER_TENANT.id] : []), ...extra.map((t) => t.id)]),
    bankClients: [BANK_CLIENT, ...(opts.otherBank ? [OTHER_CLIENT] : []), ...extra.map((t) => clientFor(t.id))],
    advisoryTtlDays: opts.advisoryTtlDays,
    tokenSecret: TOKEN_SECRET,
    store,
    rateLimiters: testRateLimiters(store),
    model: opts.model,
    push,
    messaging,
    whatsapp: opts.whatsappTenantId ? { ...WA, tenantId: opts.whatsappTenantId } : WA,
    ussd: opts.ussd === undefined ? USSD : opts.ussd,
    aiTimeoutMs: opts.aiTimeoutMs ?? 300,
    verifyRateLimitPerMinute: opts.rateLimit ?? 1000,
    reportRateLimitPerMinute: opts.reportRateLimit ?? 1000,
    tokenRateLimitPerMinute: opts.tokenRateLimit ?? 1000,
    corsOrigins: opts.corsOrigins,
    allowDemoReset: true,
    logStream: { write: (l: string) => void logs.push(l) },
    clock: () => clock.now,
    mailer: opts.mailer,
    consoleUrl: 'https://console.gaskiya.test',
    agentJobToken: opts.agentJobToken,
    guard: opts.guard,
    licences: opts.licences,
    licenceMaxAgeDays: opts.licenceMaxAgeDays,
    simSwap: opts.simSwap,
    simSwapSettings: opts.simSwapSettings,
    simSwapRateLimitPerMinute: opts.simSwapRateLimit,
    adminPassword: opts.admin ? { username: 'admin', password: opts.admin.password } : null,
    masterKey: opts.admin?.masterKey,
    keyActivationSeconds: opts.admin?.keyActivationSeconds,
    webhooks: opts.admin?.webhooks,
    production: opts.admin?.production,
    adminLoginRateLimitPerMinute: opts.admin?.loginRateLimit,
    consoleDemoTenantId: opts.consoleDemoTenantId,
  });
  await opts.beforeReady?.(sys);
  const tok = await sys.app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    payload: { grant_type: 'client_credentials', client_id: BANK_CLIENT.clientId, client_secret: BANK_CLIENT.clientSecret },
  });
  const bankToken = tok.json().access_token as string;
  const otherBankToken = opts.otherBank
    ? ((
        await sys.app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          payload: { grant_type: 'client_credentials', client_id: OTHER_CLIENT.clientId, client_secret: OTHER_CLIENT.clientSecret },
        })
      ).json().access_token as string)
    : null;

  const customerToken = async (phone: string, o: { iss?: string; key?: CryptoKey; expSeconds?: number } = {}) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(o.iss ?? TENANT.id)
      .setSubject(phone)
      .setAudience('gaskiya')
      .setIssuedAt()
      .setExpirationTime(`${o.expSeconds ?? 300}s`)
      .sign(o.key ?? privateKey);

  const register = async (phone: string, text: string, extra: Record<string, unknown> = {}) => {
    const r = await sys.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${bankToken}`, ...(extra.idem ? { 'idempotency-key': String(extra.idem) } : {}) },
      payload: {
        recipient: phone,
        channel: 'sms',
        contentDigest: contentDigest(text),
        category: 'transaction_alert',
        hasLink: /https?:\/\//.test(text),
        linkDomains: [],
        asksCallback: false,
        sentAt: (extra.sentAt as string) ?? clock.now.toISOString(),
        ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'idem' && k !== 'sentAt')),
      },
    });
    return { status: r.statusCode, body: r.json() };
  };

  const verify = async (phone: string, text: string) => {
    const r = await sys.app.inject({
      method: 'POST',
      url: '/v1/verify/message',
      headers: { authorization: `Bearer ${await customerToken(phone)}` },
      payload: { contentDigest: contentDigest(text) },
    });
    return { status: r.statusCode, body: r.json() };
  };

  const bankTokenFor = async (tenantId: string) => {
    if (tenantId === TENANT.id) return bankToken;
    const c = clientFor(tenantId);
    const r = await sys.app.inject({ method: 'POST', url: '/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret } });
    return r.json().access_token as string;
  };

  return { sys, push, messaging, logs, bankToken, otherBankToken, customerToken, register, verify, clock, bankTokenFor };
}

export const ALERT = 'Acct:***5678 Debit:NGN5,000.00 Desc:POS PURCHASE 20-Oct-2026 13:02 Bal:NGN12,450.10';
export const LINK_MSG = 'DemoBank: update your app for new features at https://www.demobank.ng/app';
export const TAMPERED_LINK_MSG = 'DemoBank: update your app for new features at https://www.demo-bank.ng/app';

export function demoEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GASKIYA_TOKEN_SECRET: 'x'.repeat(40),
    GASKIYA_TENANTS: JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], tokenKeysUrl: 'http://127.0.0.1:5170/sim/.well-known/jwks.json' }]),
    GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: Buffer.alloc(32, 1).toString('base64') }),
    GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'demobank-sim', clientSecret: 'y'.repeat(30), tenantId: 'demobank' }]),
    ...extra,
  };
}

/**
 * A second session to the same number, written straight to the store. The API refuses it while the first
 * is open, but sessions opened before that rule can still be open together, and every channel must show both.
 */
export async function seedSecondCall(h: Harness, firstId: string, purpose: string, code: string, laterMs = 1000) {
  const first = (await h.sys.store.getCall('demobank', firstId))!;
  const second = { ...first, id: `${firstId}_2`, purpose: purpose as typeof first.purpose, code, openedAt: new Date(Date.parse(first.openedAt) + laterMs).toISOString() };
  await h.sys.store.putCall(second);
  return second;
}
