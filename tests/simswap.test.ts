import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { copy, copyFor, COPY_OVERLAYS, LANGUAGES } from '@gaskiya/schemas';
import { asksForSecret } from '../packages/api/src/ai/explain.ts';
import { decideOtpHold, decideSimSwapStatus, decideSimSwapWarnings, type SimSwapProbe } from '../packages/api/src/domain/verdict.ts';
import { ascii, menuScreen, USSD_MAX } from '../packages/api/src/ussd.ts';
import { CamaraSimSwap, configFromEnv, MemoryMailer, MemorySimSwap, MemoryStore, SimSwapError, SimulatedMno } from '../packages/api/src/index.ts';
import { simSwapAlertEmail } from '../packages/api/src/emails/templates.ts';
import { createSandbox } from '../console/src/sandbox/backend.ts';
import { ALERT, ALICE, BOB, demoEnv, harness, USSD, WA } from './helpers.ts';

const waPayload = (from: string, message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from, id: `wamid.${Math.random()}`, timestamp: '1', ...message }] } }] }],
});
const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, signature: `sha256=${createHmac('sha256', WA.appSecret).update(raw).digest('hex')}` };
};

const HOUR = 3600_000;
const OTP = 'DemoBank: your one-time code is 482913. It expires in 5 minutes.';

async function system(opts: Parameters<typeof harness>[0] = {}) {
  const sim = new MemorySimSwap();
  const h = await harness({ simSwap: sim, ...opts });
  const bank = (url: string, payload: unknown) => h.sys.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${h.bankToken}` }, payload: payload as object });
  const check = async (phone: string, maxAgeHours?: number) => bank('/v1/sim-swap/check', { phone, ...(maxAgeHours ? { maxAgeHours } : {}) });
  return { h, sim, bank, check };
}

describe('SIM swap: decision functions (pure)', () => {
  const ok = (swapped: boolean): SimSwapProbe => ({ ok: true, swapped });
  it('SIM-1: a SIM answer yields warnings only, never a verdict', () => {
    for (const verdict of ['confirmed', 'not_confirmed', 'cannot_check', 'calling', 'not_calling', 'none'] as const) {
      expect(decideSimSwapWarnings({ probe: ok(true), verdict })).toEqual(['sim_swapped_recently']);
      expect(decideSimSwapWarnings({ probe: ok(false), verdict })).toEqual([]);
      expect(decideSimSwapWarnings({ probe: null, verdict })).toEqual([]);
    }
    expect(decideSimSwapWarnings({ probe: { ok: false }, verdict: 'confirmed', category: 'otp' })).toEqual(['sim_status_unknown']);
    expect(decideSimSwapWarnings({ probe: { ok: false }, verdict: 'confirmed', category: 'transaction_alert' })).toEqual([]);
    expect(decideSimSwapWarnings({ probe: { ok: false }, verdict: 'not_confirmed', category: 'otp' })).toEqual([]);
  });

  it('SIM-2: a failed or missing probe is unknown, never not_swapped', () => {
    expect(decideSimSwapStatus({ ok: false })).toBe('unknown');
    expect(decideSimSwapStatus(null)).toBe('unknown');
    expect(decideSimSwapStatus(ok(true))).toBe('swapped');
    expect(decideSimSwapStatus(ok(false))).toBe('not_swapped');
    expect(decideOtpHold({ category: 'otp', probe: ok(true) })).toBe(true);
    expect(decideOtpHold({ category: 'otp', probe: { ok: false } })).toBe(false);
    expect(decideOtpHold({ category: 'transaction_alert', probe: ok(true) })).toBe(false);
  });
});

describe('SIM swap: bank check', () => {
  it('SIM-1: answers swapped within the window and not swapped outside it or for another number', async () => {
    const { sim, check, h } = await system();
    const at = sim.swap(ALICE, new Date(Date.now() - 10 * HOUR));
    const swapped = await check(ALICE, 72);
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json()).toMatchObject({ status: 'swapped', swapped: true, latestSimChange: at, maxAgeHours: 72 });
    expect(Date.parse(swapped.json().checkedAt)).toBeGreaterThan(0);
    expect((await check(ALICE, 5)).json()).toMatchObject({ status: 'not_swapped', swapped: false });
    expect((await check(BOB, 72)).json()).toMatchObject({ status: 'not_swapped', swapped: false, latestSimChange: null });
    expect((await check(ALICE)).json()).toMatchObject({ status: 'swapped', maxAgeHours: 240 });
    const m = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } })).json();
    expect(m.simSwap).toMatchObject({ bank_swapped: 2, bank_not_swapped: 2 });
  });

  it('SIM-1: needs bank credentials, a valid body, and is rate limited per bank client', async () => {
    const { h, check } = await system({ simSwapRateLimit: 6 });
    const anon = await h.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', payload: { phone: ALICE } });
    expect(anon.statusCode).toBe(401);
    const customer = await h.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` }, payload: { phone: ALICE } });
    expect(customer.statusCode).toBe(401);
    for (const bad of [{ phone: '08012345678' }, { phone: ALICE, maxAgeHours: 0 }, { phone: ALICE, maxAgeHours: 2401 }, { phone: ALICE, extra: 1 }]) {
      const r = await h.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', headers: { authorization: `Bearer ${h.bankToken}` }, payload: bad });
      expect(r.statusCode).toBe(400);
      expect(r.body).not.toContain('08012345678');
    }
    expect((await check(ALICE)).statusCode).toBe(200);
    expect((await check(ALICE)).statusCode).toBe(200);
    expect((await check(ALICE)).statusCode).toBe(429);
  });

  it('SIM-2: a provider that is down, slow or not configured gives unknown, never not_swapped', async () => {
    const { sim, check, h } = await system();
    sim.failWith = new SimSwapError('unavailable', 'down');
    const r = await check(ALICE, 72);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'unknown', reason: 'provider_unavailable' });
    expect(r.json()).not.toHaveProperty('swapped');
    sim.failWith = new Error('anything at all');
    expect((await check(ALICE)).json().status).toBe('unknown');
    const m = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } })).json();
    expect(m.simSwap.bank_unknown).toBe(2);
    expect(m.simSwap.bank_not_swapped).toBeUndefined();

    const off = await harness();
    const r2 = await off.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', headers: { authorization: `Bearer ${off.bankToken}` }, payload: { phone: ALICE } });
    expect(r2.json()).toMatchObject({ status: 'unknown', reason: 'not_configured' });
  });
});

describe('SIM swap: customer checks', () => {
  it('SIM-3: a recent swap adds a warning and leaves every verdict as it was', async () => {
    const { sim, h } = await system();
    await h.register(ALICE, ALERT);
    expect((await h.verify(ALICE, ALERT)).body).not.toHaveProperty('warnings');
    sim.swap(ALICE, new Date(Date.now() - 2 * HOUR));
    h.sys.svc.simSwap!.clear();
    const confirmed = await h.verify(ALICE, ALERT);
    expect(confirmed.body).toMatchObject({ verdict: 'confirmed', category: 'transaction_alert', warnings: ['sim_swapped_recently'] });
    const notConfirmed = await h.verify(ALICE, `${ALERT}!`);
    expect(notConfirmed.body).toMatchObject({ verdict: 'not_confirmed', warnings: ['sim_swapped_recently'] });
    expect((await h.verify(BOB, ALERT)).body).not.toHaveProperty('warnings');
    const calls = await h.sys.app.inject({ method: 'GET', url: '/v1/calls/open', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` } });
    expect(calls.json()).toMatchObject({ verdict: 'not_calling', warnings: ['sim_swapped_recently'] });
    sim.swap(ALICE, new Date(Date.now() - 100 * HOUR));
    h.sys.svc.simSwap!.clear();
    expect((await h.verify(ALICE, ALERT)).body).not.toHaveProperty('warnings');
  });

  it('SIM-3: with the store down the answer stays cannot_check, with the warning beside it', async () => {
    class BrokenStore extends MemoryStore {
      override async findMessage(): Promise<never> {
        throw new Error('down');
      }
    }
    const { sim, h } = await system({ store: new BrokenStore() });
    sim.swap(ALICE);
    expect((await h.verify(ALICE, ALERT)).body).toEqual({ verdict: 'cannot_check', warnings: ['sim_swapped_recently'] });
  });

  it('SIM-3: a provider failure warns only on a confirmed one-time code, and never says "no swap"', async () => {
    const { sim, h } = await system();
    sim.failWith = new SimSwapError('unavailable', 'down');
    await h.register(ALICE, ALERT);
    await h.register(ALICE, OTP, { category: 'otp' });
    expect((await h.verify(ALICE, ALERT)).body).not.toHaveProperty('warnings');
    expect((await h.verify(ALICE, OTP)).body).toMatchObject({ verdict: 'confirmed', category: 'otp', warnings: ['sim_status_unknown'] });
    expect((await h.verify(ALICE, `${OTP} `)).body.verdict).toBe('confirmed');
    expect((await h.verify(ALICE, 'not registered')).body).not.toHaveProperty('warnings');
  });

  it('SIM-4: a slow provider never delays the verdict past the wait bound', async () => {
    const { sim, h } = await system({ simSwapSettings: { waitMs: 150 } });
    sim.delayMs = 5000;
    await h.register(ALICE, OTP, { category: 'otp' });
    const t0 = performance.now();
    const r = await h.verify(ALICE, OTP);
    const took = performance.now() - t0;
    expect(r.body).toMatchObject({ verdict: 'confirmed', warnings: ['sim_status_unknown'] });
    expect(took).toBeLessThan(1000);
    sim.delayMs = 10;
    sim.swap(ALICE);
    h.sys.svc.simSwap!.clear();
    expect((await h.verify(ALICE, OTP)).body.warnings).toEqual(['sim_swapped_recently']);
  });

  it('SIM-4: answers are cached briefly so repeated checks do not hammer the network', async () => {
    const { sim, h } = await system();
    await h.verify(ALICE, ALERT);
    await h.verify(ALICE, ALERT);
    await h.verify(ALICE, ALERT);
    expect(sim.calls).toBe(1);
  });

  it('SIM-6: on a swap the fraud desk is emailed once, by keyed reference, never by number', async () => {
    const mailer = new MemoryMailer();
    const { sim, h } = await system({ mailer, alertEmails: ['fraud@demobank.test'] });
    sim.swap(ALICE);
    await h.verify(ALICE, ALERT);
    await h.verify(ALICE, ALERT);
    h.sys.svc.simSwap!.clear();
    await h.verify(ALICE, ALERT);
    await new Promise((r) => setTimeout(r, 20));
    const sims = mailer.sent.filter((m) => m.tags?.some((t) => t.value === 'sim_swap_alert'));
    expect(sims).toHaveLength(1);
    const ref = h.sys.svc.recipientKey('demobank', ALICE).slice(0, 16);
    const mail = sims[0]!;
    expect(mail.text).toContain(ref);
    for (const s of [mail.html, mail.text, mail.subject]) {
      expect(s).not.toContain(ALICE);
      expect(s).not.toContain(ALICE.slice(1));
      expect(s).not.toContain(ALICE.slice(-10));
    }
    const m = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } })).json();
    expect(m.simSwap).toMatchObject({ customer_warned: 3, bank_notified: 1 });
  });

  it('SIM-6: no phone number reaches the logs or the store', async () => {
    const { sim, h, check } = await system();
    sim.swap(ALICE);
    await h.register(ALICE, OTP, { category: 'otp' });
    await h.verify(ALICE, OTP);
    await check(ALICE);
    sim.failWith = new SimSwapError('unavailable', 'down');
    await check(BOB);
    const dump = JSON.stringify(await h.sys.store.dump());
    const logs = h.logs.join('\n');
    for (const p of [ALICE, BOB]) {
      for (const form of [p, p.slice(1), p.slice(-10)]) {
        expect(dump).not.toContain(form);
        expect(logs).not.toContain(form);
      }
    }
    expect(logs).toContain('SIM swap check failed');
  });
});

describe('SIM swap: registration', () => {
  it('SIM-5: a one-time code to a recently swapped number registers, with simSwapWarning for the gateway', async () => {
    const { sim, h } = await system();
    sim.swap(ALICE, new Date(Date.now() - HOUR));
    const r = await h.register(ALICE, OTP, { category: 'otp' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ simSwapWarning: true, simSwapStatus: 'swapped' });
    expect(r.body.recordId).toMatch(/^rec_/);
    expect((await h.verify(ALICE, OTP)).body.verdict).toBe('confirmed');
    const bob = await h.register(BOB, OTP, { category: 'otp' });
    expect(bob.body).toMatchObject({ simSwapWarning: false, simSwapStatus: 'not_swapped' });
    const alert = await h.register(ALICE, ALERT);
    expect(alert.body).not.toHaveProperty('simSwapWarning');
    expect(Object.keys(alert.body).sort()).toEqual(['expiresAt', 'recordId']);
  });

  it('SIM-5: with the provider down the code still registers, unknown and not held', async () => {
    const { sim, h } = await system();
    sim.failWith = new SimSwapError('timeout', 'slow');
    const r = await h.register(ALICE, OTP, { category: 'otp' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ simSwapWarning: false, simSwapStatus: 'unknown' });
  });

  it('SIM-5: batches flag each one-time code separately', async () => {
    const { sim, bank } = await system();
    sim.swap(ALICE);
    const msg = (recipient: string, text: string, category: string) => ({ recipient, channel: 'sms', contentDigest: contentDigest(text), category, hasLink: false, linkDomains: [], asksCallback: false, sentAt: new Date().toISOString() });
    const r = await bank('/v1/messages/batch', { messages: [msg(ALICE, OTP, 'otp'), msg(BOB, OTP, 'otp'), msg(ALICE, ALERT, 'transaction_alert')] });
    expect(r.statusCode).toBe(202);
    const [a, b, c] = r.json().records;
    expect(a).toMatchObject({ simSwapWarning: true });
    expect(b).toMatchObject({ simSwapWarning: false });
    expect(c).not.toHaveProperty('simSwapWarning');
  });

  it('SIM-5: without a provider, registration responses are unchanged', async () => {
    const h = await harness();
    const r = await h.register(ALICE, OTP, { category: 'otp' });
    expect(Object.keys(r.body).sort()).toEqual(['expiresAt', 'recordId']);
  });
});

describe('SIM swap: channels and copy', () => {
  it('SIM-8: WhatsApp appends the warning after the verdict, in the customer\'s language', async () => {
    const { sim, h } = await system();
    await h.register(ALICE, ALERT);
    sim.swap(ALICE);
    const send = async (text: string) => {
      const { raw, signature } = signed(waPayload(ALICE.slice(1), { type: 'text', text: { body: text } }));
      await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
      return h.messaging.sent.at(-1)!.body;
    };
    const reply = await send(ALERT);
    expect(reply.startsWith(copy.verdict.confirmed.title)).toBe(true);
    expect(reply).toContain(`${copy.simswap.title}\n${copy.simswap.body}`);
    expect(reply.indexOf(copy.simswap.title)).toBeGreaterThan(reply.indexOf(copy.verdict.confirmed.title));
    expect(await send('CALL')).toContain(copy.simswap.title);
    await send('LANG HA');
    expect(await send(ALERT)).toContain(copyFor('ha').simswap.title);
  });

  it('SIM-8: USSD shows the short warning on the menu, and every screen fits 160 ASCII characters in every language', async () => {
    for (const lang of LANGUAGES) {
      const c = copyFor(lang);
      for (const swapped of [false, true]) {
        const s = menuScreen(c, 'DemoBank', swapped);
        expect(s.length, `${lang} menu`).toBeLessThanOrEqual(USSD_MAX);
        expect(/^[\n\x20-\x7e]*$/.test(s)).toBe(true);
        expect(s.includes(ascii(c.simswap.ussd))).toBe(swapped);
      }
      expect(ascii(`END ${c.simswap.ussd}`).length).toBeLessThanOrEqual(USSD_MAX);
    }
    const { sim, h } = await system();
    const dial = async (text: string, phone = ALICE) =>
      (await h.sys.app.inject({ method: 'POST', url: `/webhooks/ussd?token=${USSD.token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ phoneNumber: phone, text }).toString() })).body;
    expect(await dial('')).not.toContain('SIM');
    sim.swap(ALICE);
    h.sys.svc.simSwap!.clear();
    const menu = await dial('');
    expect(menu).toMatch(/^CON /);
    expect(menu).toContain(copy.simswap.ussd);
    expect(await dial('', BOB)).not.toContain('SIM');
    await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a1' } });
    for (const t of ['1', '2']) {
      const screen = await dial(t);
      expect(screen.length).toBeLessThanOrEqual(USSD_MAX);
      expect(screen).toMatch(/^(CON|END) /);
    }
  });

  it('SIM-8: the new copy is additive, translated, asks for no secret and reassures no one', () => {
    for (const [lang, tree] of Object.entries(COPY_OVERLAYS)) {
      const sw = (tree as { simswap?: Record<string, string> }).simswap;
      expect(sw, `${lang} simswap`).toBeDefined();
      expect(Object.keys(sw!).sort()).toEqual(Object.keys(copy.simswap).sort());
    }
    for (const lang of LANGUAGES) {
      for (const text of Object.values(copyFor(lang).simswap)) expect(asksForSecret(text), `${lang}: ${text}`).toBe(false);
    }
    expect(Object.values(copy.simswap).join(' ')).not.toMatch(/\b(safe|genuine|no swap|not swapped|verified)\b/i);
  });

  it('SIM-8: the alert email names the keyed reference and no number', () => {
    const tenant = { id: 't', name: 'DemoBank', domains: ['demobank.ng'], senderIds: [], alertEmails: ['f@x.test'] };
    const e = simSwapAlertEmail(tenant, { reference: 'abcdef0123456789', latestSimChange: '2026-10-20T09:00:00Z' });
    expect(e.template).toBe('sim_swap_alert');
    expect(e.text).toContain('abcdef0123456789');
    expect(asksForSecret(e.text)).toBe(false);
  });

  it('SIM-9: the sandbox console swaps a demo SIM and the bank check before an OTP sees it', async () => {
    const sb = createSandbox();
    const call = async (method: string, path: string, body?: unknown, token?: string) =>
      sb.handle(method, new URL(path, 'https://gaskiyya.test'), body, token ? `Bearer ${token}` : null) as Promise<{ status: number; body: any }>;
    expect((await call('POST', '/sim/sim-swap/check', { phone: ALICE })).body).toMatchObject({ status: 'not_swapped' });
    expect((await call('POST', '/sim/sim-swap', { phone: ALICE, action: 'swap' })).status).toBe(200);
    expect((await call('POST', '/sim/sim-swap/check', { phone: ALICE, maxAgeHours: 24 })).body).toMatchObject({ status: 'swapped', swapped: true });
    const sent = await call('POST', '/sim/send', { phone: ALICE, category: 'otp' });
    expect(sent.body.simSwapWarning).toBe(true);
    const { token } = (await call('POST', '/sim/customer-token', { phone: ALICE })).body;
    const v = await call('POST', '/sim/registry/v1/verify/message', { contentDigest: contentDigest(sent.body.item.text) }, token);
    expect(v.body).toMatchObject({ verdict: 'confirmed', warnings: ['sim_swapped_recently'] });
    expect((await call('GET', '/sim/config')).body.simSwap).toBe(true);
    await call('POST', '/sim/sim-swap', { phone: ALICE, action: 'restore' });
    expect((await call('POST', '/sim/sim-swap/check', { phone: ALICE })).body.status).toBe('not_swapped');
    await call('POST', '/sim/sim-swap', { phone: ALICE, action: 'swap' });
    await call('POST', '/sim/reset');
    expect((await call('POST', '/sim/sim-swap/check', { phone: ALICE })).body.status).toBe('not_swapped');
  });
});

describe('SIM swap: configuration', () => {
  it('SIM-7: off by default; simulated is refused in production; camara needs its URLs and credentials', () => {
    expect(configFromEnv(demoEnv({ AI_PROVIDER: 'none' })).simSwap).toBeNull();
    expect(configFromEnv(demoEnv({ AI_PROVIDER: 'none', SIM_SWAP_PROVIDER: 'simulated' })).simSwap).toBeInstanceOf(SimulatedMno);
    expect(() => configFromEnv(demoEnv({ AI_PROVIDER: 'none', SIM_SWAP_PROVIDER: 'simulated', NODE_ENV: 'production', FIRESTORE_PROJECT_ID: 'p' }))).toThrow(/SIM_SWAP_PROVIDER=simulated must not be used in production/);
    expect(() => configFromEnv(demoEnv({ AI_PROVIDER: 'none', SIM_SWAP_PROVIDER: 'camara' }))).toThrow(/SIM_SWAP_PROVIDER=camara needs SIM_SWAP_API_URL, SIM_SWAP_TOKEN_URL/);
    expect(() => configFromEnv(demoEnv({ AI_PROVIDER: 'none', SIM_SWAP_PROVIDER: 'carrier-pigeon' }))).toThrow(/SIM_SWAP_PROVIDER must be camara, simulated or none/);
    const c = configFromEnv(
      demoEnv({ AI_PROVIDER: 'none', SIM_SWAP_PROVIDER: 'camara', SIM_SWAP_API_URL: 'https://api.mno.example/sim-swap/v2', SIM_SWAP_TOKEN_URL: 'https://api.mno.example/oauth/token', SIM_SWAP_CLIENT_ID: 'id', SIM_SWAP_CLIENT_SECRET: 'secret', SIM_SWAP_WARN_HOURS: '48' }),
    );
    expect(c.simSwap).toBeInstanceOf(CamaraSimSwap);
    expect(c.simSwapSettings.warnHours).toBe(48);
    expect(c.integrations.simSwap).toBe('CAMARA SIM Swap at api.mno.example, customer warnings within 48 hours');
    expect(c.integrations.simSwap).not.toContain('secret');
  });
});

interface Seen {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}
let server: Server;
let base = '';
let seen: Seen[] = [];
let reply: (path: string, body: string) => { status?: number; json?: unknown; raw?: string; delayMs?: number } = () => ({ json: {} });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      seen.push({ path, headers: req.headers, body: raw });
      const out = reply(path, raw);
      setTimeout(() => {
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
        res.end(out.raw ?? JSON.stringify(out.json ?? {}));
      }, out.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
});

const camara = (o: Partial<ConstructorParameters<typeof CamaraSimSwap>[0]> = {}) =>
  new CamaraSimSwap({ baseUrl: `${base}/sim-swap/v2/`, tokenUrl: `${base}/oauth/token`, clientId: 'gaskiyya-client', clientSecret: 's3cret', timeoutMs: 500, ...o });

const network = (check: { status?: number; json?: unknown; raw?: string; delayMs?: number }, date: { status?: number; json?: unknown } = { json: { latestSimChange: '2026-10-20T08:00:00.000Z', monitoredPeriod: 120 } }) =>
  (reply = (path) => (path === '/oauth/token' ? { json: { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 } } : path.endsWith('/check') ? check : date));

describe('SIM swap: CAMARA adapter', () => {
  it('SIM-7: gets a client-credentials token, then sends the CAMARA request shape', async () => {
    network({ json: { swapped: false } });
    const p = camara();
    expect(await p.check(ALICE, 72)).toEqual({ swapped: false });
    const [tok, chk] = seen;
    expect(tok!.path).toBe('/oauth/token');
    expect(tok!.headers.authorization).toBe(`Basic ${Buffer.from('gaskiyya-client:s3cret').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(tok!.body))).toEqual({ grant_type: 'client_credentials', scope: 'sim-swap:check sim-swap:retrieve-date' });
    expect(chk!.path).toBe('/sim-swap/v2/check');
    expect(chk!.headers.authorization).toBe('Bearer tok-1');
    expect(chk!.headers['x-correlator']).toMatch(/^[a-zA-Z0-9-]{36}$/);
    expect(JSON.parse(chk!.body)).toEqual({ phoneNumber: ALICE, maxAge: 72 });
    await p.check(ALICE, 99999);
    expect(seen.map((s) => s.path)).toEqual(['/oauth/token', '/sim-swap/v2/check', '/sim-swap/v2/check']);
    expect(JSON.parse(seen[2]!.body).maxAge).toBe(2400);
  });

  it('SIM-7: on a swap reads the date, and a failed date read still reports the swap', async () => {
    network({ json: { swapped: true } });
    expect(await camara().check(ALICE, 24)).toEqual({ swapped: true, latestSimChange: '2026-10-20T08:00:00.000Z' });
    expect(JSON.parse(seen.find((s) => s.path.endsWith('/retrieve-date'))!.body)).toEqual({ phoneNumber: ALICE });
    network({ json: { swapped: true } }, { status: 403, json: { status: 403, code: 'PERMISSION_DENIED', message: 'no scope' } });
    expect(await camara().check(ALICE, 24)).toEqual({ swapped: true, latestSimChange: null });
  });

  it('SIM-7: maps every failure to an error, never to "not swapped"', async () => {
    const cases: [{ status?: number; json?: unknown; raw?: string; delayMs?: number }, string][] = [
      [{ status: 400, json: { status: 400, code: 'OUT_OF_RANGE', message: 'maxAge' } }, 'invalid_argument'],
      [{ status: 403, json: { status: 403, code: 'PERMISSION_DENIED', message: 'x' } }, 'unauthorized'],
      [{ status: 404, json: { status: 404, code: 'IDENTIFIER_NOT_FOUND', message: 'x' } }, 'not_found'],
      [{ status: 422, json: { status: 422, code: 'SERVICE_NOT_APPLICABLE', message: 'x' } }, 'not_applicable'],
      [{ status: 429, json: { status: 429, code: 'QUOTA_EXCEEDED', message: 'x' } }, 'rate_limited'],
      [{ status: 503, json: { status: 503, code: 'UNAVAILABLE', message: 'x' } }, 'unavailable'],
      [{ status: 500, raw: '<html>oops</html>' }, 'unavailable'],
      [{ json: { swapped: 'no' } }, 'bad_response'],
      [{ raw: 'not json' }, 'bad_response'],
      [{ json: { swapped: false }, delayMs: 2000 }, 'timeout'],
    ];
    for (const [answer, code] of cases) {
      network(answer);
      const err = (await camara().check(ALICE, 72).catch((e: unknown) => e)) as SimSwapError;
      expect(err, code).toBeInstanceOf(SimSwapError);
      expect(err.code, JSON.stringify(answer)).toBe(code);
      expect(err.message).not.toContain(ALICE.slice(1));
    }
  });

  it('SIM-7: a refused token or an unreachable network is an error; a 401 drops the token and retries once', async () => {
    reply = (path) => (path === '/oauth/token' ? { status: 401, json: { error: 'invalid_client' } } : { json: { swapped: false } });
    expect(((await camara().check(ALICE, 72).catch((e) => e)) as SimSwapError).code).toBe('unauthorized');
    expect(((await camara({ baseUrl: 'http://127.0.0.1:9/x', tokenUrl: 'http://127.0.0.1:9/t' }).check(ALICE, 72).catch((e) => e)) as SimSwapError).code).toMatch(/unavailable|timeout/);
    let n = 0;
    seen = [];
    reply = (path) => {
      if (path === '/oauth/token') return { json: { access_token: `tok-${++n}`, expires_in: 3600 } };
      return seen.filter((s) => s.path.endsWith('/check')).length === 1 ? { status: 401, json: { code: 'UNAUTHENTICATED' } } : { json: { swapped: false } };
    };
    expect(await camara().check(ALICE, 72)).toEqual({ swapped: false });
    expect(seen.filter((s) => s.path === '/oauth/token')).toHaveLength(2);
  });

  it('SIM-7: through the registry, a failing CAMARA network gives the bank "unknown"', async () => {
    network({ status: 503, json: { code: 'UNAVAILABLE' } });
    const h = await harness({ simSwap: camara() });
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { phone: ALICE } });
    expect(r.json()).toMatchObject({ status: 'unknown', reason: 'provider_unavailable' });
    network({ json: { swapped: true } });
    const r2 = await h.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { phone: ALICE, maxAgeHours: 24 } });
    expect(r2.json()).toMatchObject({ status: 'swapped', latestSimChange: '2026-10-20T08:00:00.000Z' });
  });
});
