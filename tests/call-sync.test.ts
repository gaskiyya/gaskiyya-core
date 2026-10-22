import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSystem, StaticKeyService } from '../packages/api/src/index.ts';
import { MemoryVoipPush } from '../packages/api/src/channels/voip.ts';
import { MemoryPush, type CallNotice } from '../packages/api/src/channels/channels.ts';
import { buildSimulator } from '../packages/api/src/simulator/index.ts';
import { BANK_CLIENT, TENANT, TOKEN_SECRET, testStore } from './helpers.ts';

// Both ends hang up together: the agent ending in the console ends the customer's phone call, and the
// customer ending (or declining) on the phone ends the agent's call. Plus the demo's fraud call, which
// rings the customer's real phone with no code.

const CUSTOMER = '+2348161230001';
const OTHER = '+2348161230002';
const CONSOLE = { authorization: 'Bearer console-session' };

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe('call end sync between the agent and the customer', () => {
  const store = testStore();
  const push = new MemoryPush();
  const voip = new MemoryVoipPush();
  let api: ReturnType<typeof createSystem>;
  let apiUrl = '';
  let sim: Awaited<ReturnType<typeof buildSimulator>>;

  beforeAll(async () => {
    const simPort = await freePort();
    api = createSystem({
      tenants: [{ ...TENANT, tokenKeysUrl: `http://127.0.0.1:${simPort}/sim/.well-known/jwks.json` }],
      keys: StaticKeyService.random([TENANT.id]),
      bankClients: [BANK_CLIENT],
      tokenSecret: TOKEN_SECRET,
      store,
      push,
      voip,
      logger: false,
    });
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    apiUrl = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    sim = await buildSimulator({
      apiUrl,
      clientId: BANK_CLIENT.clientId,
      clientSecret: BANK_CLIENT.clientSecret,
      tenantId: TENANT.id,
      bankName: TENANT.name,
      demoLogin: true,
      logger: false,
      appUsers: store,
      consoleCheck: async (auth) => (auth === CONSOLE.authorization ? { tenantId: TENANT.id } : null),
      demoCalls: api.svc,
    });
    await sim.app.listen({ port: simPort, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await sim.app.close();
    await api.app.close();
  });

  beforeEach(() => {
    push.sent.length = 0;
    voip.sent.length = 0;
  });

  const signIn = async (phone: string) => (await sim.app.inject({ method: 'POST', url: '/sim/customer-token', payload: { phone } })).json().token as string;
  const asConsole = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => sim.app.inject({ method, url, payload, headers: CONSOLE });
  const registry = async (token: string | null, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  const device = async (phone: string, n: number) => {
    const token = await signIn(phone);
    const voipToken = `${n}`.padStart(2, '0').repeat(32);
    expect((await registry(token, 'POST', '/v1/devices', { pushToken: `ios-${phone}`, platform: 'ios', voipToken })).status).toBe(204);
    expect((await registry(token, 'POST', '/v1/devices', { pushToken: `android-${phone}`, platform: 'android' })).status).toBe(204);
    return token;
  };
  const place = async (phone: string) => {
    const r = await asConsole('POST', '/sim/calls', { phone, purpose: 'fraud_check' });
    expect(r.statusCode).toBe(200);
    return r.json() as { id: string; code: string };
  };
  const consoleCall = async (id: string) => ((await asConsole('GET', '/sim/calls')).json().calls as { id: string; status: string; endedBy?: string; declined?: boolean }[]).find((c) => c.id === id);

  it('the ring carries a token for this call only, and the open-call check hands it to the app', async () => {
    const token = await device(CUSTOMER, 1);
    const call = await place(CUSTOMER);
    const rang = voip.sent.find((v) => v.call.callId === call.id)!;
    expect(rang.call).toMatchObject({ code: call.code, kind: 'bank', token: expect.any(String) });
    const opened = push.sent.find((p) => p.token === `android-${CUSTOMER}`)!.notice as CallNotice;
    expect(opened).toMatchObject({ type: 'call.opened', token: rang.call.token });
    const open = await registry(token, 'GET', '/v1/calls/open');
    expect(open.body.call).toMatchObject({ id: call.id, token: rang.call.token });
    await asConsole('PATCH', `/sim/calls/${call.id}`, { status: 'ended' });
  });

  it('the agent ends the call: every device of the customer gets call.closed, and the phone sees it ended', async () => {
    const token = await device(CUSTOMER, 1);
    const call = await place(CUSTOMER);
    expect((await registry(token, 'POST', `/v1/calls/${call.id}/answer`)).body).toMatchObject({ status: 'answered' });
    expect((await asConsole('PATCH', `/sim/calls/${call.id}`, { status: 'ended' })).statusCode).toBe(200);
    const closed = push.sent.filter((p) => p.notice.type === 'call.closed').map((p) => ({ token: p.token, ...(p.notice as CallNotice) }));
    expect(closed.map((c) => c.token).sort()).toEqual([`android-${CUSTOMER}`, `ios-${CUSTOMER}`]);
    expect(closed[0]).toMatchObject({ callId: call.id, endedBy: 'agent', code: null });
    // No VoIP push for an end: Apple wants every VoIP push to ring a new call.
    expect(voip.sent.filter((v) => v.call.callId === call.id)).toHaveLength(1);
    expect((await registry(token, 'POST', `/v1/calls/${call.id}/status`)).body).toMatchObject({ status: 'ended', endedBy: 'agent' });
    // Answering after the agent hung up does not reopen it.
    expect((await registry(token, 'POST', `/v1/calls/${call.id}/answer`)).body).toMatchObject({ status: 'ended' });
  });

  it('the customer declines on the phone: the console sees it ended and declined, and the other devices stop ringing', async () => {
    const token = await device(CUSTOMER, 1);
    const call = await place(CUSTOMER);
    expect(await consoleCall(call.id)).toMatchObject({ status: 'open' });
    const r = await registry(token, 'POST', `/v1/calls/${call.id}/end`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: call.id, status: 'ended', endedBy: 'customer', declined: true });
    expect(await consoleCall(call.id)).toMatchObject({ status: 'ended', endedBy: 'customer', declined: true });
    expect(push.sent).toContainEqual({ token: `android-${CUSTOMER}`, notice: expect.objectContaining({ type: 'call.closed', callId: call.id, endedBy: 'customer' }) });
    expect((await registry(token, 'GET', '/v1/calls/open')).body).toMatchObject({ calling: false });
  });

  it('the phone ends the call with only the call token, as CallKit does with the app closed', async () => {
    await device(CUSTOMER, 1);
    const call = await place(CUSTOMER);
    const callToken = voip.sent.find((v) => v.call.callId === call.id)!.call.token!;
    expect((await registry(null, 'POST', `/v1/calls/${call.id}/answer`, { token: callToken })).body).toMatchObject({ status: 'answered' });
    expect(await consoleCall(call.id)).toMatchObject({ status: 'answered' });
    expect((await registry(null, 'POST', `/v1/calls/${call.id}/end`, { token: callToken })).body).toMatchObject({ status: 'ended', endedBy: 'customer' });
    const ended = await consoleCall(call.id);
    expect(ended).toMatchObject({ status: 'ended', endedBy: 'customer' });
    expect(ended?.declined).toBeUndefined();
  });

  it('a customer can end only calls to their own number, and a call token only its own call', async () => {
    await device(CUSTOMER, 1);
    const otherToken = await device(OTHER, 2);
    const call = await place(CUSTOMER);
    const mine = await place(OTHER);
    const callToken = voip.sent.find((v) => v.call.callId === call.id)!.call.token!;
    expect((await registry(otherToken, 'POST', `/v1/calls/${call.id}/end`)).status).toBe(404);
    expect((await registry(otherToken, 'POST', `/v1/calls/${call.id}/status`)).status).toBe(404);
    expect((await registry(null, 'POST', `/v1/calls/${mine.id}/end`, { token: callToken })).status).toBe(404);
    expect((await registry(null, 'POST', `/v1/calls/${call.id}/end`, { token: `${callToken.slice(0, -4)}0000` })).status).toBe(404);
    expect((await registry(null, 'POST', `/v1/calls/${call.id}/end`)).status).toBe(401);
    expect((await registry('not-a-token', 'POST', `/v1/calls/${call.id}/end`)).status).toBe(401);
    expect(await consoleCall(call.id)).toMatchObject({ status: 'open' });
    await asConsole('PATCH', `/sim/calls/${call.id}`, { status: 'ended' });
    await asConsole('PATCH', `/sim/calls/${mine.id}`, { status: 'ended' });
  });

  it('a fraud call rings only that number\'s devices, flagged unverified, with no code, and the registry still says not calling', async () => {
    const token = await device(CUSTOMER, 1);
    await device(OTHER, 2);
    const placed = await asConsole('POST', '/sim/fraud-calls', { phone: CUSTOMER, from: '+234 1 270 0000' });
    expect(placed.statusCode).toBe(200);
    const fraud = placed.json() as { id: string };
    expect(voip.sent).toHaveLength(1);
    expect(voip.sent[0]).toMatchObject({ voipToken: '01'.repeat(32), call: { callId: fraud.id, orgId: TENANT.id, bank: TENANT.name, code: '', kind: 'unverified', number: '+234 1 270 0000' } });
    expect(push.sent.map((p) => p.token)).toEqual([`android-${CUSTOMER}`]);
    const n = push.sent[0]!.notice as CallNotice;
    expect(n).toMatchObject({ type: 'call.unverified', callId: fraud.id, code: null, caller: TENANT.name });
    expect(JSON.stringify(push.sent)).not.toMatch(/"code":"\d/);
    expect((await registry(token, 'GET', '/v1/calls/open')).body).toMatchObject({ verdict: 'not_calling', calling: false });

    // The customer declines on the phone: the console's fraud call ends.
    expect((await registry(token, 'POST', `/v1/calls/${fraud.id}/end`)).body).toMatchObject({ status: 'ended', endedBy: 'customer', declined: true });
    const listed = (await asConsole('GET', '/sim/fraud-calls')).json().calls.find((c: { id: string }) => c.id === fraud.id);
    expect(listed).toMatchObject({ status: 'ended', endedBy: 'customer' });
  });

  it('the console ends a fraud call: the phone gets call.closed and its status reads ended', async () => {
    const token = await device(CUSTOMER, 1);
    const fraud = (await asConsole('POST', '/sim/fraud-calls', { phone: CUSTOMER, from: '' })).json() as { id: string };
    const callToken = voip.sent[0]!.call.token!;
    expect((await registry(null, 'POST', `/v1/calls/${fraud.id}/answer`, { token: callToken })).body).toMatchObject({ status: 'answered' });
    expect((await asConsole('GET', '/sim/fraud-calls')).json().calls[0]).toMatchObject({ id: fraud.id, status: 'answered' });
    expect((await asConsole('PATCH', `/sim/fraud-calls/${fraud.id}`, { status: 'ended' })).statusCode).toBe(200);
    expect(push.sent).toContainEqual({ token: `android-${CUSTOMER}`, notice: expect.objectContaining({ type: 'call.closed', callId: fraud.id, endedBy: 'agent' }) });
    expect((await registry(token, 'POST', `/v1/calls/${fraud.id}/status`)).body).toMatchObject({ status: 'ended', endedBy: 'agent' });
  });
});
