import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { InvalidPushTokenError } from '../packages/api/src/channels/channels.ts';
import { FcmPush, serviceAccountFromEnv } from '../packages/api/src/channels/fcm.ts';
import { MemoryMailer, ResendMailer } from '../packages/api/src/channels/email.ts';
import { alertKind } from '../packages/api/src/alerts.ts';
import { configFromEnv, maskDigits } from '../packages/api/src/index.ts';
import { ALICE, BOB, harness } from './helpers.ts';

interface Hit {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  raw: string;
  body: any;
}
let server: Server;
let base = '';
let hits: Hit[] = [];
let fcmReply: (body: any) => { status: number; json: unknown } = () => ({ status: 200, json: { name: 'projects/p/messages/1' } });
let resendReply: () => { status: number; json: unknown } = () => ({ status: 200, json: { id: 'email_123' } });

const read = (req: IncomingMessage) => new Promise<string>((r) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => r(s));
});

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await read(req);
    const path = (req.url ?? '').split('?')[0]!;
    let body: any;
    try {
      body = req.headers['content-type']?.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    } catch {
      body = raw;
    }
    hits.push({ method: req.method!, path, headers: req.headers, raw, body });
    let status = 200;
    let json: unknown = {};
    if (path === '/token') json = { access_token: 'ya29.test-access-token', expires_in: 3600, token_type: 'Bearer' };
    else if (path.endsWith('/messages:send')) ({ status, json } = fcmReply(body));
    else if (path === '/emails') ({ status, json } = resendReply());
    else status = 404;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  hits = [];
  fcmReply = () => ({ status: 200, json: { name: 'projects/p/messages/1' } });
  resendReply = () => ({ status: 200, json: { id: 'email_123' } });
});

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = () => ({
  type: 'service_account',
  project_id: 'gaskiya-test',
  client_email: 'fcm@gaskiya-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: `${base}/token`,
});
const fcm = () => new FcmPush(serviceAccount(), { fcmBaseUrl: base });
const notice = (type: 'call.opened' | 'call.closed' = 'call.opened') => ({
  type,
  callId: 'call_abc',
  bank: 'DemoBank',
  purpose: 'card_activation',
  code: type === 'call.opened' ? '4821' : null,
  expiresAt: new Date(Date.now() + 180_000).toISOString(),
});

describe('push: Firebase Cloud Messaging', () => {
  it('authenticates with a signed service-account JWT and caches the access token', async () => {
    const p = fcm();
    await p.send('device-token-1', notice());
    await p.send('device-token-2', notice());
    const tokenHits = hits.filter((h) => h.path === '/token');
    expect(tokenHits).toHaveLength(1);
    expect(tokenHits[0]!.body.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload, protectedHeader } = await jwtVerify(tokenHits[0]!.body.assertion, publicKey, { audience: `${base}/token` });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.iss).toBe('fcm@gaskiya-test.iam.gserviceaccount.com');
    expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    const sends = hits.filter((h) => h.path.endsWith('/messages:send'));
    expect(sends).toHaveLength(2);
    expect(sends[0]!.path).toBe('/v1/projects/gaskiya-test/messages:send');
    expect(sends[0]!.headers.authorization).toBe('Bearer ya29.test-access-token');
  });

  it('a call notice is a visible, high-priority notification that expires with the session', async () => {
    await fcm().send('device-token-1', notice());
    const m = hits.find((h) => h.path.endsWith('/messages:send'))!.body.message;
    expect(m.token).toBe('device-token-1');
    expect(m.notification.title).toBe('DemoBank is calling you');
    expect(m.notification.body).toContain('4821');
    expect(m.data).toMatchObject({ type: 'call.opened', callId: 'call_abc', code: '4821', purpose: 'card_activation' });
    for (const v of Object.values(m.data)) expect(typeof v).toBe('string');
    expect(m.android.priority).toBe('HIGH');
    expect(Number(m.android.ttl.replace('s', ''))).toBeGreaterThan(170);
    expect(m.android.notification.channel_id).toBe('calls');
    expect(m.apns.headers['apns-priority']).toBe('10');
    expect(m.apns.payload.aps['interruption-level']).toBe('time-sensitive');
  });

  it('a call-ended notice is silent and data-only', async () => {
    await fcm().send('device-token-1', notice('call.closed'));
    const m = hits.find((h) => h.path.endsWith('/messages:send'))!.body.message;
    expect(m.notification).toBeUndefined();
    expect(m.data.type).toBe('call.closed');
    expect(m.apns.headers['apns-push-type']).toBe('background');
  });

  it('an unregistered token raises InvalidPushTokenError; other failures do not', async () => {
    fcmReply = () => ({ status: 404, json: { error: { code: 404, status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } });
    await expect(fcm().send('gone', notice())).rejects.toBeInstanceOf(InvalidPushTokenError);
    fcmReply = () => ({ status: 400, json: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } } });
    await expect(fcm().send('garbage', notice())).rejects.toBeInstanceOf(InvalidPushTokenError);
    fcmReply = () => ({ status: 400, json: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid value at message.android.ttl' } } });
    await expect(fcm().send('fine', notice())).rejects.not.toBeInstanceOf(InvalidPushTokenError);
    fcmReply = () => ({ status: 503, json: { error: { code: 503, status: 'UNAVAILABLE' } } });
    await expect(fcm().send('fine', notice())).rejects.not.toBeInstanceOf(InvalidPushTokenError);
  });

  it('CALL-1 end to end: opening a call pushes to the registered device; dead tokens are forgotten', async () => {
    const h = await harness({ push: fcm() });
    const auth = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
    for (const t of ['alice-phone-token', 'alice-old-token']) {
      await h.sys.app.inject({ method: 'POST', url: '/v1/devices', headers: auth, payload: { pushToken: t, platform: 'android' } });
    }
    fcmReply = (b) =>
      b.message.token === 'alice-old-token'
        ? { status: 404, json: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }
        : { status: 200, json: { name: 'projects/gaskiya-test/messages/9' } };
    const call = await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a7' } });
    const sent = hits.filter((x) => x.path.endsWith('/messages:send')).map((x) => x.body.message);
    expect(sent.map((m) => m.token).sort()).toEqual(['alice-old-token', 'alice-phone-token']);
    expect(sent.find((m) => m.token === 'alice-phone-token').data.code).toBe(call.json().code);
    const devices = await h.sys.store.devices('demobank', h.sys.svc.recipientKey('demobank', ALICE));
    expect(devices.map((d) => d.pushToken)).toEqual(['alice-phone-token']);
  });

  it('reads the service account from raw JSON or base64', () => {
    const json = JSON.stringify(serviceAccount());
    expect(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT_JSON: json })?.project_id).toBe('gaskiya-test');
    expect(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString('base64') })?.client_email).toContain('@');
    expect(serviceAccountFromEnv({})).toBeNull();
    expect(() => serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' })).toThrow(/client_email/);
  });

  it('a service account written into prod.env the way the deploy job does it switches push on', () => {
    // The deploy job turns the multi-line JSON secret into one base64 line, then base64-encodes that again for the SSM command.
    const line = Buffer.from(JSON.stringify(serviceAccount(), null, 2)).toString('base64');
    const envFile = join(mkdtempSync(join(tmpdir(), 'gaskiya-env-')), 'prod.env');
    writeFileSync(envFile, 'FCM_SERVICE_ACCOUNT_JSON=old\nSTORE=mongo\n');
    execFileSync('bash', ['scripts/server-env.sh', 'FCM_SERVICE_ACCOUNT_JSON', Buffer.from(line).toString('base64')], { env: { ...process.env, GASKIYA_ENV_FILE: envFile } });
    const env = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    expect(env.STORE).toBe('mongo');
    expect(serviceAccountFromEnv(env)?.project_id).toBe('gaskiya-test');
  });
});

describe('email: Resend', () => {
  const mailer = () => new ResendMailer({ apiKey: 're_test_not_real', from: 'Gaskiya <alerts@gaskiya.test>', replyTo: 'fraud@demobank.test', baseUrl: base });

  it('sends through the Resend API with an idempotency key', async () => {
    const r = await mailer().send({ to: ['fraud@demobank.test'], subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', idempotencyKey: 'k-1', tags: [{ name: 'type', value: 'test' }] });
    expect(r.id).toBe('email_123');
    const hit = hits.find((h) => h.path === '/emails')!;
    expect(hit.method).toBe('POST');
    expect(hit.headers.authorization).toBe('Bearer re_test_not_real');
    expect(hit.headers['idempotency-key']).toBe('k-1');
    expect(hit.body).toMatchObject({ from: 'Gaskiya <alerts@gaskiya.test>', to: ['fraud@demobank.test'], subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' });
    expect(JSON.stringify(hit.body)).toContain('fraud@demobank.test');
  });

  it('throws when Resend rejects the email', async () => {
    resendReply = () => ({ status: 403, json: { statusCode: 403, name: 'validation_error', message: 'The gaskiya.test domain is not verified.' } });
    await expect(mailer().send({ to: ['x@y.test'], subject: 's', html: 'h', text: 't' })).rejects.toThrow(/validation_error/);
  });
});

describe('fraud-desk campaign alerts', () => {
  async function setup(opts: { alertEmails?: string[]; mailer?: MemoryMailer } = {}) {
    const mailer = opts.mailer ?? new MemoryMailer();
    const h = await harness({ mailer, alertEmails: opts.alertEmails ?? ["fraud@demobank.test"] });
    const auth = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
    const report = (t: string) => h.sys.app.inject({ method: 'POST', url: '/v1/reports', headers: auth, payload: { maskedText: maskDigits(t), consent: true } });
    const run = () => h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: { authorization: `Bearer ${h.bankToken}` } });
    return { h, mailer, report, run };
  }
  const fake = (i: number) => `DemoBank: account ${1000000 + i} restricted. Restore at https://demobank-restore.com/${i} or call 0809 555 010${i}.`;

  it('emails the fraud desk once when a campaign appears, with no customer data', async () => {
    const { h, mailer, report, run } = await setup();
    for (let i = 0; i < 3; i++) await report(fake(i));
    const r = (await run()).json();
    expect(r.alertEmails).toEqual({ sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0]!;
    expect(m.to).toEqual(['fraud@demobank.test']);
    expect(m.subject).toBe('New scam campaign: 3 customer reports');
    expect(m.text).toContain('demobank-restore.com');
    expect(m.text).toContain('Nothing has been sent to customers');
    expect(m.html).toContain('Review in the fraud desk');
    expect(m.idempotencyKey).toMatch(/^campaign-alert\/demobank\/cmp_.+\/3$/);
    for (const s of [ALICE, ALICE.slice(1), '1000000', '08095550100']) expect(m.text + m.html).not.toContain(s);
    expect((await run()).json().alertEmails).toEqual({ sent: 0, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    void h;
  });

  it('emails again only when the campaign grows sharply, after a quiet period', async () => {
    const { h, mailer, report, run } = await setup();
    for (let i = 0; i < 3; i++) await report(fake(i));
    await run();
    for (let i = 3; i < 6; i++) await report(fake(i));
    await run();
    expect(mailer.sent).toHaveLength(1);
    h.clock.now = new Date(h.clock.now.getTime() + 31 * 60_000);
    await report(fake(7));
    await run();
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]!.subject).toBe('Scam campaign growing: now 7 customer reports');
  });

  it('retries a failed send on the next run; sends nothing without alertEmails', async () => {
    const failing = new MemoryMailer();
    failing.failing = true;
    const a = await setup({ mailer: failing });
    for (let i = 0; i < 3; i++) await a.report(fake(i));
    expect((await a.run()).json().alertEmails).toEqual({ sent: 0, failed: 1 });
    failing.failing = false;
    await a.report(fake(5));
    expect((await a.run()).json().alertEmails).toEqual({ sent: 1, failed: 0 });

    const b = await setup({ alertEmails: [] });
    for (let i = 0; i < 3; i++) await b.report(fake(i));
    await b.run();
    expect(b.mailer.sent).toHaveLength(0);
  });

  it('dismissed campaigns never alert', () => {
    const c = { status: 'dismissed', reportCount: 9, alert: null } as never;
    expect(alertKind(c, new Date())).toBeNull();
  });

  it('the test endpoint sends a real push and email with the configured providers', async () => {
    const h = await harness({ push: fcm(), mailer: new ResendMailer({ apiKey: 're_test_not_real', from: 'Gaskiya <alerts@gaskiya.test>', baseUrl: base }), alertEmails: ["fraud@demobank.test"] });
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/test', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { pushToken: 'my-phone-token', email: true } });
    expect(r.json()).toEqual({ push: { ok: true }, email: { ok: true, id: 'email_123', to: ['fraud@demobank.test'] } });
    expect(hits.some((x) => x.path.endsWith('/messages:send'))).toBe(true);
    expect(hits.some((x) => x.path === '/emails')).toBe(true);
    const off = await harness();
    const offRes = await off.sys.app.inject({ method: 'POST', url: '/v1/notifications/test', headers: { authorization: `Bearer ${off.bankToken}` }, payload: { pushToken: 'my-phone-token', email: true } });
    expect(offRes.json().push).toMatchObject({ ok: false, error: expect.stringContaining('Push is off') });
    const noAuth = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/test', payload: { email: true } });
    expect(noAuth.statusCode).toBe(401);
  });
});

describe('server configuration', () => {
  const valid = () => ({
    GASKIYA_TOKEN_SECRET: 'x'.repeat(40),
    GASKIYA_TENANTS: JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], senderIds: [], tokenKeysUrl: 'https://bank.example/jwks.json', alertEmails: ['fraud@demobank.test'] }]),
    GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: Buffer.alloc(32, 1).toString('base64') }),
    GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'notify', clientSecret: 's'.repeat(32), tenantId: 'demobank' }]),
  });

  it('the demo bank is linkable from the app in each simulator mode, and only then', () => {
    const tokenUrl = (env: Record<string, string>) => configFromEnv({ ...valid(), AI_PROVIDER: 'none', ...env }).tenants[0]!.customerTokenUrl;
    expect(tokenUrl({})).toBeUndefined();
    expect(tokenUrl({ SIM_ENABLED: 'true', SIM_DEMO_LOGIN: 'true' })).toBe('/sim/customer-token');
    expect(tokenUrl({ SIM_PUBLIC_URL: 'http://192.168.1.20:5170/', SIM_DEMO_LOGIN: 'true' })).toBe('http://192.168.1.20:5170/sim/customer-token');
    expect(tokenUrl({ SIM_ENABLED: 'true', SIM_DEMO_LOGIN: 'false' })).toBeUndefined();
    expect(tokenUrl({ SIM_ENABLED: 'true' })).toBeUndefined();
    expect(tokenUrl({ SIM_PUBLIC_URL: 'http://192.168.1.20:5170/' })).toBeUndefined();
    expect(configFromEnv({ ...valid(), AI_PROVIDER: 'none', SIM_ENABLED: 'true', SIM_DEMO_LOGIN: 'true' }).tenants[0]!.demoInboxUrl).toBe('/sim/inbox');
    const bad = JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], senderIds: [], tokenKeysUrl: 'https://bank.example/jwks.json', customerTokenUrl: 'ftp://bank' }]);
    expect(() => configFromEnv({ ...valid(), AI_PROVIDER: 'none', GASKIYA_TENANTS: bad })).toThrow(/customerTokenUrl must be an http\(s\) URL/);
  });

  it('a minimal valid config starts with optional integrations off', () => {
    const c = configFromEnv({ ...valid(), AI_PROVIDER: 'none' });
    expect(c.integrations).toEqual({
      store: 'memory: not persisted, demo only',
      ai: 'off: fixed fallback explanations',
      agentAi: 'Ollama at http://127.0.0.1:11434 (qwen3:4b-instruct), briefings time out after 60000 ms',
      push: 'off: live in-app events only',
      iosCalls: 'off: iPhones get the call banner only',
      email: 'off',
      whatsapp: 'off',
      ussd: 'off',
      simSwap: 'off',
      tenants: ['demobank'],
    });
  });

  it('full config reports every integration as on', () => {
    const c = configFromEnv({
      ...valid(),
      GEMINI_API_KEY: 'g',
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount()),
      RESEND_API_KEY: 're_x',
      EMAIL_FROM: 'Gaskiya <alerts@gaskiya.test>',
      WHATSAPP_VERIFY_TOKEN: 'v',
      WHATSAPP_APP_SECRET: 's',
      WHATSAPP_ACCESS_TOKEN: 'a',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      USSD_WEBHOOK_TOKEN: 'ussd-token-not-real-0123456789',
    });
    expect(c.integrations.ussd).toBe('on for demobank');
    expect(c.ussd).toEqual({ token: 'ussd-token-not-real-0123456789', tenantId: 'demobank' });
    expect(c.integrations.ai).toBe('Gemini (gemini-3.8-flash)');
    expect(c.integrations.push).toBe('Firebase Cloud Messaging (project gaskiya-test)');
    expect(c.integrations.email).toBe('Resend, campaign alerts for demobank');
    expect(c.integrations.whatsapp).toBe('on for demobank');
  });

  it('reports every problem at once', () => {
    let msg = '';
    try {
      configFromEnv({
        GASKIYA_TOKEN_SECRET: 'short',
        GASKIYA_TENANTS: JSON.stringify([{ id: 'b', name: 'B', domains: [], alertEmails: ['not-an-email'] }]),
        GASKIYA_TENANT_KEYS: '{}',
        GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'c', clientSecret: 'x', tenantId: 'zzz' }]),
        RESEND_API_KEY: 're_x',
        WHATSAPP_VERIFY_TOKEN: 'v',
        USSD_WEBHOOK_TOKEN: 'short',
        USSD_TENANT_ID: 'nobank',
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const s of ['GASKIYA_TOKEN_SECRET', 'domains', 'tokenKeysUrl', 'no hashing key', 'not an email address', 'clientSecret', 'not a configured tenant', 'EMAIL_FROM', 'WhatsApp needs', 'USSD_WEBHOOK_TOKEN must be at least 24', 'USSD_TENANT_ID nobank']) {
      expect(msg).toContain(s);
    }
  });

  it('uses Firestore when a project is set, and refuses the memory store in production', () => {
    const fs = configFromEnv({ ...valid(), AI_PROVIDER: 'none', FIRESTORE_PROJECT_ID: 'gaskiyya-io', FIRESTORE_COLLECTION_PREFIX: 'gaskiya' });
    expect(fs.integrations.store).toBe('Firestore (project gaskiyya-io, prefix gaskiya)');
    expect(() => configFromEnv({ ...valid(), AI_PROVIDER: 'none', NODE_ENV: 'production' })).toThrow(/STORE=memory loses every record/);
    expect(() => configFromEnv({ ...valid(), AI_PROVIDER: 'none', STORE: 'firestore' })).toThrow(/FIRESTORE_PROJECT_ID/);
  });

  it('the registry still verifies with every integration off', async () => {
    const h = await harness();
    await h.register(BOB, 'hello');
    expect((await h.verify(BOB, 'hello')).body.verdict).toBe('confirmed');
    expect(contentDigest('hello')).toHaveLength(64);
  });
});
