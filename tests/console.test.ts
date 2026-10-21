import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { vectors } from '@gaskiya/test-vectors';
import * as browser from '../console/src/device/digest.ts';
import { createSystem, StaticKeyService } from '../packages/api/src/index.ts';
import { buildSimulator, DEMO_CUSTOMERS, demoAccount, demoLoginFromEnv, tamper } from '../packages/api/src/simulator/index.ts';
import { copy } from '@gaskiya/schemas';
import { BANK_CLIENT, TENANT, TOKEN_SECRET, USSD } from './helpers.ts';

const PHONE = DEMO_CUSTOMERS[0]!.phone;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe('console and bank simulator', () => {
  let sim: Awaited<ReturnType<typeof buildSimulator>>;
  let api: ReturnType<typeof createSystem>;
  let apiUrl = '';

  beforeAll(async () => {
    const simPort = await freePort();
    api = createSystem({
      tenants: [
        { ...TENANT, tokenKeysUrl: `http://127.0.0.1:${simPort}/sim/.well-known/jwks.json`, customerTokenUrl: `http://127.0.0.1:${simPort}/sim/customer-token`, demoInboxUrl: `http://127.0.0.1:${simPort}/sim/inbox` },
        { id: 'otherbank', name: 'OtherBank', domains: ['otherbank.ng'], senderIds: [], tokenKeys: { keys: [] } },
      ],
      keys: StaticKeyService.random([TENANT.id, 'otherbank']),
      bankClients: [BANK_CLIENT],
      tokenSecret: TOKEN_SECRET,
      allowDemoReset: true,
      ussd: USSD,
      logger: false,
    });
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    apiUrl = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    sim = await buildSimulator({ apiUrl, clientId: BANK_CLIENT.clientId, clientSecret: BANK_CLIENT.clientSecret, tenantId: TENANT.id, bankName: TENANT.name, demoLogin: true, logger: false, ussdToken: USSD.token });
    await sim.app.listen({ port: simPort, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await sim.app.close();
    await api.app.close();
  });

  const post = (url: string, payload: unknown) => sim.app.inject({ method: 'POST', url, payload: payload as object });

  async function appVerify(text: string) {
    const { token } = (await post('/sim/customer-token', { phone: PHONE })).json();
    const r = await fetch(`${apiUrl}/v1/verify/message`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contentDigest: contentDigest(text) }),
    });
    return (await r.json()) as { verdict: string };
  }

  it('CH-3: an operator can send a message, and the customer sees it confirmed', async () => {
    const sent = await post('/sim/send', { phone: PHONE, category: 'service_update' });
    expect(sent.statusCode).toBe(200);
    const { item } = sent.json();
    expect(item.text).toContain('https://www.demobank.ng/app');
    expect(await appVerify(item.text)).toMatchObject({ verdict: 'confirmed' });
  });

  it('F24: an inbox item carries the channel it was sent by, for the app to show', async () => {
    const wa = (await post('/sim/send', { phone: PHONE, category: 'service_update', channel: 'whatsapp' })).json();
    expect(wa.item.channel).toBe('whatsapp');
    expect((await post('/sim/send-tampered', { phone: PHONE, itemId: wa.item.id })).json().item.channel).toBe('whatsapp');
    expect((await post('/sim/send', { phone: PHONE, category: 'service_update' })).json().item.channel).toBe('sms');
  });

  it('CH-3: an operator can send a tampered copy, which is not confirmed', async () => {
    const sent = (await post('/sim/send', { phone: PHONE, category: 'service_update' })).json();
    const t = await post('/sim/send-tampered', { phone: PHONE, itemId: sent.item.id });
    expect(t.statusCode).toBe(200);
    const tampered = t.json().item.text as string;
    expect(tampered).not.toBe(sent.item.text);
    expect(tampered.length).toBe(sent.item.text.length + 1);
    expect(await appVerify(tampered)).toMatchObject({ verdict: 'not_confirmed' });
    expect(tamper('Amt: NGN5,000.00')).toBe('Amt: NGN6,000.00');
  });

  it('CH-3: an operator can open a call; the customer sees the same code', async () => {
    const r = await post('/sim/calls', { phone: PHONE, purpose: 'card_activation' });
    expect(r.statusCode).toBe(200);
    const call = r.json();
    expect(call.code).toMatch(/^\d{4}$/);
    const { token } = (await post('/sim/customer-token', { phone: PHONE })).json();
    const open = await (await fetch(`${apiUrl}/v1/calls/open`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(open).toMatchObject({ calling: true, call: { code: call.code } });
    const ended = await sim.app.inject({ method: 'PATCH', url: `/sim/calls/${call.id}`, payload: { status: 'ended' } });
    expect(ended.json().status).toBe('ended');
  });

  it('CH-3: an operator can view campaigns built from reports', async () => {
    expect((await post('/sim/seed-reports', {})).json()).toEqual({ reported: 3 });
    await post('/sim/agent/run', {});
    const r = await sim.app.inject({ method: 'GET', url: '/sim/campaigns' });
    expect(r.statusCode).toBe(200);
    const { campaigns } = r.json();
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ reportCount: 3, linkDomains: ['demobank-restore.com'], advisory: { status: 'draft' } });
    const approved = await post(`/sim/campaigns/${campaigns[0].id}/approve`, { analyst: 'Aisha Bello' });
    expect(approved.json().advisory).toMatchObject({ status: 'approved', approvedBy: 'Aisha Bello' });
    const metrics = (await sim.app.inject({ method: 'GET', url: '/sim/metrics' })).json();
    expect(metrics.registrations).toBeGreaterThanOrEqual(1);
  });

  it("ADV-10: the console sends an approved warning through the bank's gateway, registering each message so it confirms for its recipient only", async () => {
    let [c] = (await sim.app.inject({ method: 'GET', url: '/sim/campaigns' })).json().campaigns;
    if (c.advisory.status !== 'approved') c = (await post(`/sim/campaigns/${c.id}/approve`, { analyst: 'Aisha Bello' })).json();
    expect(c.advisory.status).toBe('approved');
    expect((await post('/sim/campaigns/cmp_missing/send', {})).statusCode).toBe(404);
    expect((await post(`/sim/campaigns/${c.id}/send`, { channel: 'fax' })).statusCode).toBe(400);

    const before = (await sim.app.inject({ method: 'GET', url: '/sim/metrics' })).json().registrationsByCategory.security_notice ?? 0;
    const r = await post(`/sim/campaigns/${c.id}/send`, {});
    expect(r.statusCode).toBe(200);
    const sent = r.json();
    expect(sent).toMatchObject({ sent: DEMO_CUSTOMERS.length, channel: 'sms', text: c.advisory.text });
    const after = (await sim.app.inject({ method: 'GET', url: '/sim/metrics' })).json().registrationsByCategory.security_notice;
    expect(after - before).toBe(DEMO_CUSTOMERS.length);

    const check = async (phone: string, text: string) => {
      const { token } = (await post('/sim/customer-token', { phone })).json();
      const v = await fetch(`${apiUrl}/v1/verify/message`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ contentDigest: contentDigest(text) }) });
      return (await v.json()) as { verdict: string; category?: string };
    };
    for (const cu of DEMO_CUSTOMERS) {
      const { token } = (await post('/sim/customer-token', { phone: cu.phone })).json();
      const inbox = (await sim.app.inject({ method: 'GET', url: '/sim/inbox', headers: { authorization: `Bearer ${token}` } })).json().items;
      expect(inbox[0]).toMatchObject({ text: c.advisory.text, kind: 'genuine', category: 'security_notice', channel: 'sms' });
      expect(await check(cu.phone, inbox[0].text)).toMatchObject({ verdict: 'confirmed', category: 'security_notice' });
    }
    expect((await check('+2348000000001', c.advisory.text)).verdict).toBe('not_confirmed');
    expect((await check(PHONE, tamper(c.advisory.text))).verdict).toBe('not_confirmed');

    const { token } = (await post('/sim/customer-token', { phone: PHONE })).json();
    const list = (await sim.app.inject({ method: 'GET', url: '/sim/registry/v1/advisories', headers: { authorization: `Bearer ${token}` } })).json();
    expect(list.advisories.map((a: { id: string }) => a.id)).toEqual([c.id]);

    expect((await post(`/sim/campaigns/${c.id}/withdraw`, { analyst: '' })).statusCode).toBe(400);
    expect((await post(`/sim/campaigns/${c.id}/withdraw`, { analyst: 'Aisha Bello' })).json().advisory.status).toBe('withdrawn');
    expect((await post(`/sim/campaigns/${c.id}/send`, {})).statusCode).toBe(409);
    expect((await sim.app.inject({ method: 'GET', url: '/sim/registry/v1/advisories', headers: { authorization: `Bearer ${token}` } })).json().advisories).toEqual([]);
  });

  it('USSD-8: the console feature phone dials the registry through the simulator, which keeps the token', async () => {
    const config = await sim.app.inject({ method: 'GET', url: '/sim/config' });
    expect(config.json().ussdCode).toBe('*347*123#');
    expect(config.body).not.toContain(USSD.token);
    const call = (await post('/sim/calls', { phone: PHONE, purpose: 'fraud_check' })).json();
    const menu = await post('/sim/ussd', { phone: PHONE, text: '', sessionId: 's1' });
    expect(menu.statusCode).toBe(200);
    expect(menu.json().screen).toMatch(/^CON /);
    expect(menu.body).not.toContain(USSD.token);
    const one = (await post('/sim/ussd', { phone: PHONE, text: '1', sessionId: 's1' })).json().screen as string;
    expect(one).toMatch(/^END /);
    expect(one).toContain(call.code);
    await sim.app.inject({ method: 'PATCH', url: `/sim/calls/${call.id}`, payload: { status: 'ended' } });
    expect((await post('/sim/ussd', { phone: 'nope', text: '' })).statusCode).toBe(400);
    const off = await buildSimulator({ apiUrl, clientId: BANK_CLIENT.clientId, clientSecret: BANK_CLIENT.clientSecret, tenantId: TENANT.id, bankName: TENANT.name, demoLogin: true, logger: false });
    expect((await off.app.inject({ method: 'POST', url: '/sim/ussd', payload: { phone: PHONE, text: '' } })).statusCode).toBe(503);
  });

  it('the demo inbox is visible only to its own customer', async () => {
    const { token } = (await post('/sim/customer-token', { phone: PHONE })).json();
    const mine = await sim.app.inject({ method: 'GET', url: '/sim/inbox', headers: { authorization: `Bearer ${token}` } });
    expect(mine.json().items.length).toBeGreaterThan(0);
    expect((await sim.app.inject({ method: 'GET', url: '/sim/inbox' })).statusCode).toBe(401);
  });

  it('the operator inbox is served only where it exposes nothing new: with demo login on, or else to this machine only', async () => {
    const admin = (app: typeof sim.app, remoteAddress: string) => app.inject({ method: 'GET', url: `/sim/inbox/admin?phone=${encodeURIComponent(PHONE)}`, remoteAddress });
    expect((await admin(sim.app, '10.0.0.5')).statusCode).toBe(200);
    const closed = await buildSimulator({ apiUrl, clientId: BANK_CLIENT.clientId, clientSecret: BANK_CLIENT.clientSecret, tenantId: TENANT.id, bankName: TENANT.name, demoLogin: false, logger: false });
    try {
      const away = await admin(closed.app, '10.0.0.5');
      expect(away.statusCode).toBe(403);
      expect(away.json()).toMatchObject({ code: 'forbidden' });
      expect((await admin(closed.app, '127.0.0.1')).statusCode).toBe(200);
      expect((await admin(closed.app, '::1')).statusCode).toBe(200);
      const spoofed = await closed.app.inject({ method: 'GET', url: '/sim/inbox/admin', remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '127.0.0.1' } });
      expect(spoofed.statusCode).toBe(403);
    } finally {
      await closed.app.close();
    }
  });

  it('a number that signs in to Gaskiyya is offered to the console as a recipient, newest first', async () => {
    const presenter = '+2348035550123';
    expect((await post('/sim/customer-token', { phone: PHONE })).statusCode).toBe(200);
    expect((await post('/sim/customer-token', { phone: presenter })).statusCode).toBe(200);
    const { customers } = (await sim.app.inject({ method: 'GET', url: '/sim/customers/recent' })).json();
    expect(customers[0].phone).toBe(presenter);
    expect(customers.map((c: { phone: string }) => c.phone)).toContain(PHONE);
    expect((await post('/sim/customer-token', { phone: '0803' })).statusCode).toBe(400);
    expect(JSON.stringify((await sim.app.inject({ method: 'GET', url: '/sim/customers/recent' })).json())).not.toContain('0803"');
    const sent = await post('/sim/send', { phone: presenter, category: 'security_notice' });
    expect(sent.statusCode).toBe(200);
    const { token } = (await post('/sim/customer-token', { phone: presenter })).json();
    const r = await fetch(`${apiUrl}/v1/verify/message`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contentDigest: contentDigest(sent.json().item.text) }),
    });
    expect((await r.json()).verdict).toBe('confirmed');
  });

  it('principles 1-2: a fraudster ringing from the bank number is never an announced call; the phone hears "not calling"', async () => {
    const victim = DEMO_CUSTOMERS[2]!.phone;
    const rung = await post('/sim/fraud-calls', { phone: victim, from: '0700 336 2265' });
    expect(rung.statusCode).toBe(200);
    expect(rung.json()).toMatchObject({ phone: victim, from: '0700 336 2265', status: 'ringing' });
    expect((await post('/sim/fraud-calls', { phone: 'nope' })).statusCode).toBe(400);
    expect((await post('/sim/fraud-calls', { phone: victim, from: 'call me<script>' })).statusCode).toBe(400);
    const listed = (await sim.app.inject({ method: 'GET', url: '/sim/fraud-calls' })).json().calls;
    expect(listed[0].id).toBe(rung.json().id);
    const { token } = (await post('/sim/customer-token', { phone: victim })).json();
    const open = await (await fetch(`${apiUrl}/v1/calls/open`, { headers: { authorization: `Bearer ${token}` } })).json();
    const { callState } = await import('../console/src/device/api.ts');
    const { callShield } = await import('../console/src/device/shield.ts');
    expect(callShield(callState(open), 'DemoBank').title).toBe(copy.shield.call.notCalling.title.replace('{bank}', 'DemoBank'));
    const ended = await sim.app.inject({ method: 'PATCH', url: `/sim/fraud-calls/${rung.json().id}`, payload: { status: 'ended' } });
    expect(ended.json().status).toBe('ended');
    expect((await sim.app.inject({ method: 'PATCH', url: '/sim/fraud-calls/missing', payload: { status: 'ended' } })).statusCode).toBe(404);
  });

  it('the fake credit alert is in the bank alert style and never registered', async () => {
    const r = await post('/sim/send-fake', { phone: PHONE, template: 'credit_alert' });
    expect(r.statusCode).toBe(200);
    const text = r.json().item.text as string;
    expect(text).toMatch(/Credit\nAmt: NGN/);
    expect((await appVerify(text)).verdict).toBe('not_confirmed');
    expect((await post('/sim/send-fake', { phone: PHONE, template: 'junk' })).statusCode).toBe(200);
  });

  it('F22: demo login is off unless SIM_DEMO_LOGIN=true; pnpm dev and demo:offline turn it on', async () => {
    expect(demoLoginFromEnv({})).toBe(false);
    expect(demoLoginFromEnv({ SIM_DEMO_LOGIN: 'false' })).toBe(false);
    expect(demoLoginFromEnv({ SIM_DEMO_LOGIN: '1' })).toBe(false);
    expect(demoLoginFromEnv({ SIM_DEMO_LOGIN: 'true' })).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('scripts/dev.mjs', 'utf8')).toContain("process.env.SIM_DEMO_LOGIN ||= 'true'");
    const { offlineEnv } = await import('../scripts/offline.mjs');
    expect(offlineEnv(false).SIM_DEMO_LOGIN).toBe('true');
  });

  it('F22: with demo login off, every /sim route that acts as the bank answers only on this machine', async () => {
    const closed = await buildSimulator({ apiUrl, clientId: BANK_CLIENT.clientId, clientSecret: BANK_CLIENT.clientSecret, tenantId: TENANT.id, bankName: TENANT.name, demoLogin: false, logger: false, ussdToken: USSD.token });
    const BANK_ROUTES: Array<[string, string, object?]> = [
      ['POST', '/sim/send', { phone: PHONE, category: 'transaction_alert' }],
      ['POST', '/sim/send-tampered', { phone: PHONE }],
      ['POST', '/sim/send-fake', { phone: PHONE }],
      ['GET', '/sim/calls'],
      ['POST', '/sim/calls', { phone: PHONE }],
      ['PATCH', '/sim/calls/abc', { status: 'ended' }],
      ['GET', '/sim/campaigns'],
      ['POST', '/sim/campaigns/abc/approve', {}],
      ['POST', '/sim/agent/run', {}],
      ['GET', '/sim/alerts'],
      ['GET', '/sim/metrics'],
      ['POST', '/sim/seed-reports', {}],
      ['POST', '/sim/ussd', { phone: PHONE, text: '' }],
      ['POST', '/sim/reset', {}],
      ['GET', `/sim/inbox/admin?phone=${encodeURIComponent(PHONE)}`],
      ['GET', '/sim/customers/recent'],
      ['POST', '/sim/fraud-calls', { phone: PHONE }],
      ['GET', '/sim/fraud-calls'],
      ['PATCH', '/sim/fraud-calls/abc', { status: 'ended' }],
    ];
    try {
      for (const [method, url, payload] of BANK_ROUTES) {
        const away = await closed.app.inject({ method: method as 'GET', url, payload, remoteAddress: '10.0.0.5' });
        expect(away.statusCode, `${method} ${url}`).toBe(403);
        expect(away.json()).toMatchObject({ code: 'forbidden' });
        const spoofed = await closed.app.inject({ method: method as 'GET', url, payload, remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' } });
        expect(spoofed.statusCode, `${method} ${url} spoofed`).toBe(403);
      }
      for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        expect((await closed.app.inject({ method: 'GET', url: '/sim/calls', remoteAddress })).statusCode, remoteAddress).toBe(200);
      }
      const sent = await closed.app.inject({ method: 'POST', url: '/sim/send', payload: { phone: PHONE, category: 'transaction_alert' }, remoteAddress: '127.0.0.1' });
      expect(sent.statusCode).toBeLessThan(300);
      const open = (method: string, url: string, payload?: object) => closed.app.inject({ method: method as 'GET', url, payload, remoteAddress: '10.0.0.5' });
      expect((await open('GET', '/sim/.well-known/jwks.json')).statusCode).toBe(200);
      expect((await open('GET', '/sim/config')).statusCode).toBe(200);
      expect((await open('POST', '/sim/customer-token', { phone: PHONE })).statusCode).toBe(404);
      expect((await open('GET', '/sim/inbox')).statusCode).toBe(401);
      expect((await open('GET', '/sim/registry/v1/activity')).statusCode).toBe(401);
      expect((await open('OPTIONS', '/sim/send')).statusCode).toBe(204);
      expect((await open('GET', '/sim/nothing-here')).statusCode).toBe(404);
    } finally {
      await closed.app.close();
    }
    expect((await sim.app.inject({ method: 'GET', url: '/sim/calls', remoteAddress: '10.0.0.5' })).statusCode).toBe(200);
  });

  it('CAN-1: the console phone fingerprints exactly like the app, for every shared vector', async () => {
    for (const v of vectors.vectors) {
      expect(browser.canonicalise(v.input), v.id).toBe(v.canonical);
      expect(await browser.contentDigest(v.input), v.id).toBe(v.digest);
    }
  });

  it('the console phone reaches the registry only through the app\'s own customer calls', async () => {
    const { token } = (await post('/sim/customer-token', { phone: PHONE })).json();
    const auth = { authorization: `Bearer ${token}` };
    const sent = (await post('/sim/send', { phone: PHONE, category: 'transaction_alert' })).json();
    const ok = await sim.app.inject({ method: 'POST', url: '/sim/registry/v1/verify/message', headers: auth, payload: { contentDigest: await browser.contentDigest(sent.item.text) } });
    expect(ok.json().verdict).toBe('confirmed');
    const fake = await sim.app.inject({ method: 'POST', url: '/sim/registry/v1/verify/message', headers: auth, payload: { contentDigest: await browser.contentDigest(tamper(sent.item.text)) } });
    expect(fake.json().verdict).toBe('not_confirmed');
    expect((await sim.app.inject({ method: 'GET', url: '/sim/registry/v1/calls/open', headers: auth })).json()).toMatchObject({ calling: false });
    expect((await sim.app.inject({ method: 'GET', url: '/sim/registry/v1/metrics', headers: auth })).statusCode).toBe(404);
    expect((await sim.app.inject({ method: 'POST', url: '/sim/registry/v1/messages', headers: auth, payload: {} })).statusCode).toBe(404);
    expect((await sim.app.inject({ method: 'GET', url: '/sim/registry/v1/activity' })).statusCode).toBe(401);
  });

  it('the app needs only the registry: it finds the bank, signs in through it and checks', async () => {
    const list = await fetch(`${apiUrl}/v1/banks`);
    expect(list.status).toBe(200);
    const { banks } = (await list.json()) as { banks: { id: string; name: string; domains: string[]; customerTokenUrl: string; demoInboxUrl: string | null }[] };
    expect(banks.map((b) => b.id)).toEqual(['demobank']);
    const bank = banks[0]!;
    expect(bank).toMatchObject({ name: 'DemoBank', domains: ['demobank.ng', 'demobank.com'] });
    const signIn = await fetch(bank.customerTokenUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) });
    const { token } = (await signIn.json()) as { token: string };
    const sent = (await post('/sim/send', { phone: PHONE, category: 'security_notice' })).json();
    const inbox = (await (await fetch(bank.demoInboxUrl!, { headers: { authorization: `Bearer ${token}` } })).json()) as { items: { text: string }[] };
    expect(inbox.items[0]!.text).toBe(sent.item.text);
    const r = await fetch(`${apiUrl}/v1/verify/message`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contentDigest: contentDigest(sent.item.text) }),
    });
    expect(((await r.json()) as { verdict: string }).verdict).toBe('confirmed');
  });

  it('RCPT-12: the Transfers panel pays a merchant and registers the receipt; fake receipts are not confirmed', async () => {
    const merchant = DEMO_CUSTOMERS[0]!.phone;
    const payer = DEMO_CUSTOMERS[1]!.phone;
    const paid = (await post('/sim/transfers', { from: payer, to: merchant, amountKobo: 2_500_000 })).json().transfer;
    expect(paid).toMatchObject({ kind: 'genuine', registered: true, account: demoAccount(merchant), payer: DEMO_CUSTOMERS[1]!.name });
    expect(paid.account).toBe('8012345678');
    expect(paid.reference).toMatch(/^999001[0-9]{24}$/);
    const check = async (id: string) => (await post(`/sim/transfers/${id}/check`, {})).json().transfer.check;
    expect(await check(paid.id)).toMatchObject({ verdict: 'received', bank: 'DemoBank', paidFrom: 'DemoBank' });

    const amount = (await post('/sim/transfers/fake', { kind: 'fake_amount', id: paid.id })).json().transfer;
    expect(amount).toMatchObject({ kind: 'fake_amount', registered: false, amountKobo: 25_000_000, reference: paid.reference });
    expect(await check(amount.id)).toEqual({ verdict: 'not_confirmed', bank: 'DemoBank' });
    const reference = (await post('/sim/transfers/fake', { kind: 'fake_reference', id: paid.id })).json().transfer;
    expect(reference.reference).not.toBe(paid.reference);
    expect(await check(reference.id)).toEqual({ verdict: 'not_confirmed', bank: 'DemoBank' });

    const { token } = (await post('/sim/customer-token', { phone: merchant })).json();
    const verify = (bearer: string, body: object) =>
      fetch(`${apiUrl}/v1/verify/receipt`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const fields = { beneficiaryAccount: paid.account, amountKobo: paid.amountKobo, reference: paid.reference, valueDate: paid.valueDate };
    expect(((await (await verify(token, fields)).json()) as { verdict: string }).verdict).toBe('received');
    const payerToken = (await post('/sim/customer-token', { phone: payer })).json().token;
    expect((await verify(payerToken, fields)).status).toBe(403);
    const viaSim = await sim.app.inject({ method: 'POST', url: '/sim/registry/v1/verify/receipt', headers: { authorization: `Bearer ${token}` }, payload: fields });
    expect(viaSim.json().verdict).toBe('received');

    expect((await sim.app.inject({ method: 'GET', url: '/sim/transfers' })).json().transfers).toHaveLength(3);
    expect((await post('/sim/transfers', { from: payer, to: payer, amountKobo: 100 })).statusCode).toBe(400);
    expect((await post('/sim/transfers/fake', { kind: 'other' })).statusCode).toBe(400);
  });

  it('DEMO-3 support: reset clears the registry and the simulator', async () => {
    const r = await post('/sim/reset', {});
    expect(r.json()).toEqual({ ok: true });
    const metrics = (await sim.app.inject({ method: 'GET', url: '/sim/metrics' })).json();
    expect(metrics.registrations).toBe(0);
    expect(metrics.receiptsRegistered).toBe(0);
    expect((await sim.app.inject({ method: 'GET', url: '/sim/transfers' })).json().transfers).toEqual([]);
  });
});

describe('console phone: calls fail closed', () => {
  it('F9 / REG-6: errors, cannot_check and malformed answers show cannot check; not calling needs an explicit answer', async () => {
    const { callState } = await import('../console/src/device/api.ts');
    const call = { id: 'call_1', purpose: 'card_activation', code: '1442', status: 'open', openedAt: '2026-10-20T12:00:00Z', expiresAt: '2026-10-20T12:03:00Z' };
    expect(callState(null)).toEqual({ kind: 'cannot_check' });
    expect(callState({ verdict: 'cannot_check', bank: 'DemoBank' })).toEqual({ kind: 'cannot_check' });
    expect(callState({ bank: 'DemoBank' })).toEqual({ kind: 'cannot_check' });
    expect(callState({ calling: true, bank: 'DemoBank' })).toEqual({ kind: 'cannot_check' });
    expect(callState({ verdict: 'not_calling', calling: false, bank: 'DemoBank' })).toEqual({ kind: 'not_calling' });
    expect(callState({ verdict: 'calling', calling: true, bank: 'DemoBank', call })).toEqual({ kind: 'calling', calls: [call] });
    const other = { ...call, id: 'call_2', code: '9031' };
    expect(callState({ verdict: 'calling', calling: true, bank: 'DemoBank', call: other, calls: [other, call] })).toEqual({ kind: 'calling', calls: [other, call] });
    expect(callState({ verdict: 'calling', calling: true, bank: 'DemoBank', call, calls: [call, { ...call, code: '' }] })).toEqual({ kind: 'cannot_check' });
  });
});

describe('console phone: automatic protection (zero-click) follows the registry only', () => {
  it('principle 1: only a registry match says "Sent by your bank"; a credit alert the registry did not confirm is a fake credit alert', async () => {
    const { messageShield, looksLikeCreditAlert } = await import('../console/src/device/shield.ts');
    const confirmed = { verdict: 'confirmed', channel: 'sms', category: 'transaction_alert', sentAt: '2026-10-20T10:32:00Z', bank: 'DemoBank' } as const;
    expect(messageShield(confirmed, 'anything', 'DemoBank')).toMatchObject({ tone: 'confirmed', title: copy.verdict.confirmed.title });
    const notConfirmed = { verdict: 'not_confirmed' as const, recentActivity: [], activityText: '', bank: 'DemoBank' };
    const credit = 'DemoBank: Credit\nAmt: NGN250,000.00\nAcc: ***5678';
    expect(looksLikeCreditAlert(credit)).toBe(true);
    expect(looksLikeCreditAlert('DemoBank: Debit\nAmt: NGN250,000.00')).toBe(false);
    expect(messageShield(notConfirmed, credit, 'DemoBank')).toMatchObject({ tone: 'not_confirmed', title: copy.shield.creditAlert.title });
    expect(messageShield(notConfirmed, 'Verify your BVN at demobank-restore.com', 'DemoBank')).toEqual({ tone: 'not_confirmed', title: copy.verdict.not_confirmed.title, body: copy.shield.message.notConfirmedBody });
    expect(messageShield(null, credit, 'DemoBank').title).not.toBe(copy.verdict.confirmed.title);
  });

  it('principle 2: errors and malformed answers are cannot check, for messages and calls', async () => {
    const { messageShield, callShield } = await import('../console/src/device/shield.ts');
    for (const bad of [null, undefined, { verdict: 'cannot_check' }, { verdict: 'confirmed' }, { verdict: 'weird' }]) {
      expect(messageShield(bad as never, 'text', 'DemoBank')).toMatchObject({ tone: 'cannot_check', title: copy.verdict.cannot_check.title });
    }
    expect(callShield(null, 'DemoBank')).toMatchObject({ tone: 'cannot_check', title: copy.shield.call.cannotCheck.title, codes: [] });
    expect(callShield({ kind: 'cannot_check' }, 'DemoBank').tone).toBe('cannot_check');
    expect(callShield({ kind: 'calling', calls: [] }, 'DemoBank').tone).toBe('cannot_check');
    const call = { id: 'c1', purpose: 'card_activation', code: '4821', status: 'open', openedAt: '', expiresAt: '' };
    expect(callShield({ kind: 'calling', calls: [call] }, 'DemoBank')).toMatchObject({ tone: 'confirmed', title: copy.shield.call.really.title.replace('{bank}', 'DemoBank'), codes: ['4821'] });
  });
});
