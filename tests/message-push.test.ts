import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CATEGORIES } from '@gaskiya/schemas';
import { createSystem, StaticKeyService } from '../packages/api/src/index.ts';
import { MemoryPush, type MessageNotice, type Notice, type TransferNotice } from '../packages/api/src/channels/channels.ts';
import { FcmPush } from '../packages/api/src/channels/fcm.ts';
import { buildSimulator, DEMO_CUSTOMERS, demoAccount } from '../packages/api/src/simulator/index.ts';
import { demoCustomerPusher, preview, PREVIEW_MAX } from '../packages/api/src/simulator/message-push.ts';
import { BANK_CLIENT, clientFor, TENANT, testStore, TOKEN_SECRET } from './helpers.ts';

const AMINA = DEMO_CUSTOMERS[0]!.phone;
const TUNDE = DEMO_CUSTOMERS[1]!.phone;
const CHIDINMA = DEMO_CUSTOMERS[2]!.phone;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe('everything the bank console sends a customer arrives on their phone as a push notification', () => {
  const store = testStore();
  const push = new MemoryPush();
  const agency = { id: 'roadsafety', name: 'Road Safety (demo)', kind: 'agency' as const, domains: ['roadsafety.example'], senderIds: ['RSAFETY'] };
  let api: ReturnType<typeof createSystem>;
  let apiUrl = '';
  let sim: Awaited<ReturnType<typeof buildSimulator>>;

  beforeAll(async () => {
    const simPort = await freePort();
    const jwks = `http://127.0.0.1:${simPort}/sim/.well-known/jwks.json`;
    api = createSystem({
      tenants: [{ ...TENANT, tokenKeysUrl: jwks }, { ...agency, tokenKeysUrl: jwks }],
      keys: StaticKeyService.random([TENANT.id, agency.id]),
      bankClients: [BANK_CLIENT, clientFor(agency.id)],
      tokenSecret: TOKEN_SECRET,
      store,
      push,
      logger: false,
    });
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    apiUrl = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    const c = clientFor(agency.id);
    sim = await buildSimulator({
      apiUrl,
      clientId: BANK_CLIENT.clientId,
      clientSecret: BANK_CLIENT.clientSecret,
      tenantId: TENANT.id,
      bankName: TENANT.name,
      demoLogin: true,
      logger: false,
      orgs: [{ tenantId: agency.id, name: agency.name, kind: 'agency', clientId: c.clientId, clientSecret: c.clientSecret, sampleMessage: 'Road Safety: your vehicle licence expires soon.' }],
      notifyCustomer: demoCustomerPusher(api.svc, push),
      fakeCustomerCare: { whatsapp: '+2349011112222', handle: '@demobank_care_help' },
    });
    await sim.app.listen({ port: simPort, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await sim.app.close();
    await api.app.close();
  });

  beforeEach(() => {
    push.sent.length = 0;
  });

  const post = (url: string, payload: object) => sim.app.inject({ method: 'POST', url, payload });
  const registerDevice = async (phone: string, pushToken: string, tenant?: string) => {
    const t = await post(`/sim/customer-token${tenant ? `?tenant=${tenant}` : ''}`, { phone });
    expect(t.statusCode).toBe(200);
    const r = await fetch(`${apiUrl}/v1/devices`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.json().token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pushToken, platform: 'android' }),
    });
    expect(r.status).toBe(204);
  };

  it('a message the bank sends pushes one alert to each of the recipient\'s phones, and none to other numbers', async () => {
    await registerDevice(AMINA, 'amina-phone-token-0001');
    await registerDevice(AMINA, 'amina-tablet-token-0002');
    await registerDevice(TUNDE, 'tunde-phone-token-0003');
    const r = await post('/sim/send', { phone: AMINA, category: 'service_update' });
    expect(r.statusCode).toBe(200);
    const item = r.json().item;
    expect(push.sent.map((s) => s.token).sort()).toEqual(['amina-phone-token-0001', 'amina-tablet-token-0002']);
    for (const { notice } of push.sent) {
      expect(notice).toEqual({ type: 'message.received', itemId: item.id, orgId: TENANT.id, from: TENANT.name, preview: preview(item.text), channel: 'sms' });
    }
  });

  it('a fake message placed "from" the bank alerts the phone too, so the customer can check it', async () => {
    const r = await post('/sim/send-fake', { phone: AMINA, template: 0 });
    expect(r.statusCode).toBe(200);
    expect(push.sent).toHaveLength(2);
    expect(push.sent[0]!.notice).toMatchObject({ type: 'message.received', itemId: r.json().item.id, from: TENANT.name });
  });

  it('no push when the recipient has no registered phone', async () => {
    const r = await post('/sim/send', { phone: CHIDINMA, category: 'transaction_alert' });
    expect(r.statusCode).toBe(200);
    expect(push.sent).toEqual([]);
  });

  it('a message from an agency goes to the phones linked to that agency only', async () => {
    const before = await post('/sim/send', { phone: TUNDE, org: agency.id });
    expect(before.statusCode).toBe(200);
    expect(push.sent).toEqual([]);
    await registerDevice(TUNDE, 'tunde-phone-token-0003', agency.id);
    const r = await post('/sim/send', { phone: TUNDE, org: agency.id, channel: 'whatsapp' });
    expect(push.sent).toEqual([
      { token: 'tunde-phone-token-0003', notice: expect.objectContaining({ itemId: r.json().item.id, orgId: agency.id, from: agency.name, channel: 'whatsapp' }) },
    ]);
  });

  const toAmina = () => push.sent.filter((s) => s.token.startsWith('amina-'));
  const others = () => push.sent.filter((s) => !s.token.startsWith('amina-'));
  const expectMessage = (n: Notice, item: { id: string; text: string; channel: string }, from = TENANT.name) =>
    expect(n).toEqual({ type: 'message.received', itemId: item.id, orgId: TENANT.id, from, preview: preview(item.text), channel: item.channel });

  it('every genuine message category alerts the phone', async () => {
    for (const category of CATEGORIES) {
      push.sent.length = 0;
      const r = await post('/sim/send', { phone: AMINA, category });
      expect(r.statusCode, category).toBe(200);
      expect(toAmina(), category).toHaveLength(2);
      expectMessage(toAmina()[0]!.notice, r.json().item);
      expect(others(), category).toEqual([]);
    }
  });

  it('every fake the console sends alerts the phone too, so the customer can check it, and none says it is verified', async () => {
    const sends: [string, object][] = [
      ['/sim/send-fake', { phone: AMINA, template: 0 }],
      ['/sim/send-fake', { phone: AMINA, template: 2 }],
      ['/sim/send-fake', { phone: AMINA, template: 'credit_alert' }],
      ['/sim/send-tampered', { phone: AMINA }],
      ['/sim/send-fake-care', { phone: AMINA }],
    ];
    for (const [url, body] of sends) {
      push.sent.length = 0;
      const r = await post(url, body);
      expect(r.statusCode, url).toBe(200);
      expect(toAmina().map((s) => s.token).sort(), url).toEqual(['amina-phone-token-0001', 'amina-tablet-token-0002']);
      expectMessage(toAmina()[0]!.notice, r.json().item);
      expect(JSON.stringify(FcmPush.message('t', toAmina()[0]!.notice)), url).not.toMatch(/verified|confirmed|genuine/i);
      expect(others(), url).toEqual([]);
    }
  });

  it('a transfer alerts the payee with the receipt to check, and the payer with a sent alert', async () => {
    const r = await post('/sim/transfers', { from: TUNDE, to: AMINA, amountKobo: 1_250_000 });
    expect(r.statusCode).toBe(200);
    const t = r.json().transfer;
    const received: TransferNotice = {
      type: 'transfer.received',
      transferId: t.id,
      orgId: TENANT.id,
      from: TENANT.name,
      amountKobo: 1_250_000,
      accountLast4: demoAccount(AMINA).slice(-4),
      reference: t.reference,
      valueDate: t.valueDate,
    };
    expect(toAmina().map((s) => s.notice)).toEqual([received, received]);
    expect(others()).toEqual([{ token: 'tunde-phone-token-0003', notice: { ...received, type: 'transfer.sent' } }]);
    const m = FcmPush.message('t', received) as ReturnType<typeof FcmPush.transferMessage>;
    expect(m.notification.body).toBe(`NGN12,500.00 paid into your account ****${received.accountLast4}. Tap to check the receipt.`);
    expect(m.notification.body).not.toContain(demoAccount(AMINA));
    expect(m.data).toMatchObject({ type: 'transfer.received', transferId: t.id, amountKobo: '1250000', reference: t.reference, valueDate: t.valueDate });
  });

  it('a fake receipt reaches the payee the same way, and the payer gets nothing', async () => {
    const fakes: object[] = [{ kind: 'fake_amount' }, { kind: 'fake_reference' }, { kind: 'fake_reference', from: TUNDE, to: AMINA, amountKobo: 900_000 }];
    for (const body of fakes) {
      push.sent.length = 0;
      const r = await post('/sim/transfers/fake', body);
      expect(r.statusCode).toBe(200);
      const t = r.json().transfer;
      expect(toAmina()).toHaveLength(2);
      expect(toAmina()[0]!.notice).toMatchObject({ type: 'transfer.received', transferId: t.id, amountKobo: t.amountKobo, reference: t.reference });
      expect(JSON.stringify(FcmPush.message('t', toAmina()[0]!.notice))).not.toMatch(/fake|verified|confirmed|genuine/i);
      expect(others()).toEqual([]);
    }
  });

  it("the fraud desk's warning sent to customers alerts each customer's phone", async () => {
    expect((await post('/sim/seed-reports', {})).json().reported).toBe(3);
    await post('/sim/agent/run', {});
    const { campaigns } = (await sim.app.inject({ method: 'GET', url: '/sim/campaigns' })).json();
    const id = campaigns[0].id as string;
    expect((await post(`/sim/campaigns/${id}/approve`, { analyst: 'Aisha Bello' })).statusCode).toBe(200);
    // Approval already pushes the in-app warning to the bank's app devices (decision 0018).
    expect(push.sent.filter((s) => s.notice.type === 'advisory.published').length).toBeGreaterThan(0);
    push.sent.length = 0;
    const r = await post(`/sim/campaigns/${id}/send`, { channel: 'whatsapp' });
    expect(r.statusCode).toBe(200);
    const items = new Map<string, { id: string }>((r.json().messages as { phone: string; item: { id: string } }[]).map((m) => [m.phone, m.item]));
    expect(toAmina().map((s) => s.notice)).toEqual([0, 1].map(() => expect.objectContaining({ type: 'message.received', itemId: items.get(AMINA)!.id, channel: 'whatsapp' })));
    expect(others()).toEqual([{ token: 'tunde-phone-token-0003', notice: expect.objectContaining({ type: 'message.received', itemId: items.get(TUNDE)!.id }) }]);
  });

  it('a dead token is dropped and the message is still delivered to the inbox', async () => {
    push.dead.add('amina-tablet-token-0002');
    const r = await post('/sim/send', { phone: AMINA, category: 'service_update' });
    expect(r.statusCode).toBe(200);
    expect(push.sent.map((s) => s.token)).toEqual(['amina-phone-token-0001']);
    const keys = api.svc.recipientKeys(TENANT.id, AMINA);
    const left = (await Promise.all(keys.map((k) => store.devices(TENANT.id, k)))).flat().map((d) => d.pushToken);
    expect(left).toEqual(['amina-phone-token-0001']);
    expect(sim.inbox.get(AMINA)![0]!.id).toBe(r.json().item.id);
    push.dead.clear();
  });
});

describe('the message alert format', () => {
  const notice: MessageNotice = { type: 'message.received', itemId: 'item-1', orgId: 'demobank', from: 'DemoBank', preview: 'DemoBank: Acct ***5678 debited NGN5,000.00', channel: 'sms' };

  it('is a visible alert: sender as title, preview as body, opens the message by id', () => {
    const m = FcmPush.message('tok', notice) as ReturnType<typeof FcmPush.demoMessage>;
    expect(m.notification).toEqual({ title: 'DemoBank', body: notice.preview.replace(/^DemoBank:\s*/, '') });
    expect((FcmPush.message('tok', { ...notice, preview: 'DemoBank: Your code is 1234.', channel: 'whatsapp' }) as ReturnType<typeof FcmPush.demoMessage>).notification).toEqual({ title: 'DemoBank \u00b7 WhatsApp', body: 'Your code is 1234.' });
    expect(m.data).toEqual({ type: 'message.received', itemId: 'item-1', orgId: 'demobank', bank: 'DemoBank', channel: 'sms' });
    expect(m.apns.headers).toMatchObject({ 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': 'item-1' });
    expect(m.apns.payload.aps.sound).toBe('default');
    expect(m.android).toMatchObject({ priority: 'HIGH', notification: { channel_id: 'messages', tag: 'item-1' } });
    for (const v of Object.values(m.data)) expect(typeof v).toBe('string');
  });

  it('keeps call notices unchanged', () => {
    const call = FcmPush.message('tok', { type: 'call.opened', callId: 'c1', bank: 'DemoBank', purpose: 'card_activation', code: '1234', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(call.notification?.title).toBe('DemoBank is calling you');
    expect(call.android).toMatchObject({ notification: { channel_id: 'calls' } });
  });

  it('shortens a long message to a one-line preview', () => {
    const long = `DemoBank:\n${'x'.repeat(300)}`;
    const p = preview(long);
    expect(p.length).toBe(PREVIEW_MAX);
    expect(p.endsWith('…')).toBe(true);
    expect(p).not.toContain('\n');
    expect(preview('short')).toBe('short');
  });
});
