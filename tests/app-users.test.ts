import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { createSystem, StaticKeyService } from '../packages/api/src/index.ts';
import { MemoryVoipPush } from '../packages/api/src/channels/voip.ts';
import { MemoryPush } from '../packages/api/src/channels/channels.ts';
import { MemoryStore } from '../packages/api/src/store/memory.ts';
import { buildSimulator, DEMO_CUSTOMERS, knowsNumber } from '../packages/api/src/simulator/index.ts';
import { BANK_CLIENT, clientFor, TENANT, TOKEN_SECRET } from './helpers.ts';

const NEWCOMER = '+2348161234567';
const CONSOLE = { authorization: 'Bearer console-session' };

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe('app users: anyone who signs in by number is a demo bank customer the console can reach', () => {
  const store = new MemoryStore();
  const push = new MemoryPush();
  const voip = new MemoryVoipPush();
  const agency = { id: 'acme', name: 'Acme Bank (demo)', kind: 'bank' as const, domains: ['acme.example'], senderIds: ['ACME-DEMO'] };
  let api: ReturnType<typeof createSystem>;
  let apiUrl = '';
  let simPort = 0;
  let sim: Awaited<ReturnType<typeof buildSimulator>>;

  const start = async () => {
    const c = clientFor(agency.id);
    const s = await buildSimulator({
      apiUrl,
      clientId: BANK_CLIENT.clientId,
      clientSecret: BANK_CLIENT.clientSecret,
      tenantId: TENANT.id,
      bankName: TENANT.name,
      demoLogin: true,
      logger: false,
      orgs: [{ tenantId: agency.id, name: agency.name, kind: 'bank', domain: agency.domains[0], clientId: c.clientId, clientSecret: c.clientSecret }],
      appUsers: store,
      consoleCheck: async (auth) => (auth === CONSOLE.authorization ? { tenantId: TENANT.id } : null),
    });
    await s.app.listen({ port: simPort, host: '127.0.0.1' });
    return s;
  };

  beforeAll(async () => {
    simPort = await freePort();
    const jwks = `http://127.0.0.1:${simPort}/sim/.well-known/jwks.json`;
    api = createSystem({
      tenants: [{ ...TENANT, tokenKeysUrl: jwks }, { ...agency, tokenKeysUrl: jwks }],
      keys: StaticKeyService.random([TENANT.id, agency.id]),
      bankClients: [BANK_CLIENT, clientFor(agency.id)],
      tokenSecret: TOKEN_SECRET,
      store,
      push,
      voip,
      logger: false,
    });
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    apiUrl = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    sim = await start();
  });

  afterAll(async () => {
    await sim.app.close();
    await api.app.close();
  });

  const signIn = (phone: string, tenant?: string) => sim.app.inject({ method: 'POST', url: `/sim/customer-token${tenant ? `?tenant=${tenant}` : ''}`, payload: { phone } });
  const asConsole = (method: 'GET' | 'POST', url: string, payload?: object) => sim.app.inject({ method, url, payload, headers: CONSOLE });
  const registry = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };

  it('a new number gets a token from the demo bank only; the other organisations answer 404', async () => {
    expect(knowsNumber(TENANT.id, TENANT.id, NEWCOMER)).toBe(true);
    expect(knowsNumber(TENANT.id, agency.id, NEWCOMER)).toBe(false);
    const bank = await signIn(NEWCOMER);
    expect(bank.statusCode).toBe(200);
    expect(bank.json().bank).toEqual({ id: TENANT.id, name: TENANT.name });
    const other = await signIn(NEWCOMER, agency.id);
    expect(other.statusCode).toBe(404);
    expect(other.json()).toMatchObject({ code: 'not_found' });
    expect(other.json().token).toBeUndefined();
  });

  it('the agencies still know the demo customers', async () => {
    for (const c of DEMO_CUSTOMERS) {
      const r = await signIn(c.phone, agency.id);
      expect(r.statusCode, c.phone).toBe(200);
      expect(r.json().bank.id).toBe(agency.id);
    }
  });

  it('sign-ins are kept in the store per organisation, with first and last sign-in, and survive a restart', async () => {
    const [first] = await store.listAppUsers(TENANT.id, 200).then((l) => l.filter((u) => u.phone === NEWCOMER));
    expect(first).toBeDefined();
    await new Promise((r) => setTimeout(r, 5));
    expect((await signIn(NEWCOMER)).statusCode).toBe(200);
    const [again] = (await store.listAppUsers(TENANT.id, 200)).filter((u) => u.phone === NEWCOMER);
    expect(again!.firstSeenAt).toBe(first!.firstSeenAt);
    expect(again!.lastSeenAt > first!.lastSeenAt).toBe(true);
    expect((await store.listAppUsers(agency.id, 200)).map((u) => u.phone)).not.toContain(NEWCOMER);
    expect((await store.listAppUsers(agency.id, 200)).map((u) => u.phone)).toContain(DEMO_CUSTOMERS[0]!.phone);

    await sim.app.close();
    sim = await start();
    const listed = (await asConsole('GET', '/sim/customers/recent')).json().customers;
    expect(listed[0]).toMatchObject({ phone: NEWCOMER, firstSeenAt: first!.firstSeenAt, lastSeenAt: again!.lastSeenAt, at: again!.lastSeenAt });
    expect((await sim.app.inject({ method: 'GET', url: '/sim/customers/recent' })).statusCode).toBe(401);
  });

  it('the console calls a registered user: the call reaches the device registered for that number', async () => {
    const { token } = (await signIn(NEWCOMER)).json();
    const voipToken = 'ab'.repeat(32);
    expect((await registry(token, 'POST', '/v1/devices', { pushToken: 'fcm-token-newcomer', platform: 'ios', voipToken })).status).toBe(204);
    expect((await registry(token, 'POST', '/v1/devices', { pushToken: 'fcm-token-newcomer-android', platform: 'android' })).status).toBe(204);

    expect((await sim.app.inject({ method: 'POST', url: '/sim/calls', payload: { phone: NEWCOMER } })).statusCode).toBe(401);
    const placed = await asConsole('POST', '/sim/calls', { phone: NEWCOMER, purpose: 'fraud_check' });
    expect(placed.statusCode).toBe(200);
    const call = placed.json();
    expect(voip.sent).toContainEqual({ voipToken, call: expect.objectContaining({ callId: call.id, orgId: TENANT.id, code: call.code }) });
    expect(push.sent).toContainEqual({ token: 'fcm-token-newcomer-android', notice: expect.objectContaining({ type: 'call.opened', callId: call.id, code: call.code }) });
    expect(push.sent.some((p) => p.token === 'fcm-token-newcomer')).toBe(false);
    expect((await registry(token, 'GET', '/v1/calls/open')).body).toMatchObject({ calling: true, call: { code: call.code } });

    expect((await sim.app.inject({ method: 'PATCH', url: `/sim/calls/${call.id}`, payload: { status: 'ended' }, headers: CONSOLE })).statusCode).toBe(200);
    expect(push.sent).toContainEqual({ token: 'fcm-token-newcomer-android', notice: expect.objectContaining({ type: 'call.closed', callId: call.id }) });
  });

  it('the console texts a registered user: the message lands in their inbox and checks as sent by the bank', async () => {
    const { token } = (await signIn(NEWCOMER)).json();
    const sent = await asConsole('POST', '/sim/send', { phone: NEWCOMER, category: 'security_notice', text: 'DemoBank: we will call you today about your card. We will never ask for your PIN.' });
    expect(sent.statusCode).toBe(200);
    const inbox = (await sim.app.inject({ method: 'GET', url: '/sim/inbox', headers: { authorization: `Bearer ${token}` } })).json();
    expect(inbox.items[0]).toMatchObject({ id: sent.json().item.id, from: TENANT.name, kind: 'genuine' });
    expect((await registry(token, 'POST', '/v1/verify/message', { contentDigest: contentDigest(sent.json().item.text) })).body.verdict).toBe('confirmed');

    const fake = await asConsole('POST', '/sim/send-fake', { phone: NEWCOMER, template: 0 });
    expect(fake.statusCode).toBe(200);
    expect((await registry(token, 'POST', '/v1/verify/message', { contentDigest: contentDigest(fake.json().item.text) })).body.verdict).toBe('not_confirmed');
  });
});
