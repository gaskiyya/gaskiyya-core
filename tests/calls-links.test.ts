import { describe, expect, it } from 'vitest';
import { checkLink, decideLinkVerdict, MemoryStore } from '../packages/api/src/index.ts';
import { ALICE, BOB, harness } from './helpers.ts';

async function openCall(h: Awaited<ReturnType<typeof harness>>, recipient = ALICE) {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: '/v1/calls',
    headers: { authorization: `Bearer ${h.bankToken}` },
    payload: { recipient, purpose: 'card_activation', agentRef: 'agent-042' },
  });
  return { status: r.statusCode, body: r.json() };
}

async function check(h: Awaited<ReturnType<typeof harness>>, phone: string) {
  const r = await h.sys.app.inject({ method: 'GET', url: '/v1/calls/open', headers: { authorization: `Bearer ${await h.customerToken(phone)}` } });
  return r.json();
}

describe('call sessions', () => {
  it('CALL-1: opening a session returns a four-digit code and pushes a notice to the registered device', async () => {
    const h = await harness();
    const dev = await h.sys.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` },
      payload: { pushToken: 'device-token-alice-0001', platform: 'android' },
    });
    expect(dev.statusCode).toBe(204);
    const r = await openCall(h);
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^\d{4}$/);
    expect(h.push.sent).toHaveLength(1);
    expect(h.push.sent[0]).toMatchObject({ token: 'device-token-alice-0001', notice: { type: 'call.opened', code: r.body.code, bank: 'DemoBank', purpose: 'card_activation' } });
  });

  it('CALL-1: codes are not predictable from one call to the next', async () => {
    const h = await harness();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await openCall(h)).body.code);
    expect(codes.size).toBeGreaterThan(10);
  });

  it('CALL-2: the customer sees their own open session and code; others see none', async () => {
    const h = await harness();
    const { body } = await openCall(h);
    const mine = await check(h, ALICE);
    expect(mine).toMatchObject({ calling: true, bank: 'DemoBank', call: { id: body.id, code: body.code, purpose: 'card_activation' } });
    expect(await check(h, BOB)).toEqual({ verdict: 'not_calling', calling: false, bank: 'DemoBank' });
  });

  it('F10 / CALL-2: with two agents calling one number, every open call and its code is returned, newest first', async () => {
    const h = await harness();
    const first = (await openCall(h)).body;
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    const second = (await openCall(h)).body;
    expect(second.code === first.code && second.id === first.id).toBe(false);
    const r = await check(h, ALICE);
    expect(r).toMatchObject({ verdict: 'calling', calling: true, call: { id: second.id, code: second.code } });
    expect(r.calls.map((c: { id: string; code: string }) => [c.id, c.code])).toEqual([
      [second.id, second.code],
      [first.id, first.code],
    ]);
    await h.sys.app.inject({ method: 'PATCH', url: `/v1/calls/${second.id}`, headers: { authorization: `Bearer ${h.bankToken}` }, payload: { status: 'ended' } });
    const after = await check(h, ALICE);
    expect(after.calls.map((c: { id: string }) => c.id)).toEqual([first.id]);
    expect(after.call.id).toBe(first.id);
    expect((await check(h, BOB)).calls).toBeUndefined();
  });

  it('CALL-2: the live event stream delivers the notice to the open app at once', async () => {
    const h = await harness();
    const got: unknown[] = [];
    const unsub = h.sys.events.subscribe(h.sys.svc.eventChannel('demobank', ALICE), (n) => got.push(n));
    const other: unknown[] = [];
    const unsubBob = h.sys.events.subscribe(h.sys.svc.eventChannel('demobank', BOB), (n) => other.push(n));
    const { body } = await openCall(h);
    unsub();
    unsubBob();
    expect(got).toEqual([expect.objectContaining({ type: 'call.opened', code: body.code })]);
    expect(other).toEqual([]);
  });

  it('CALL-3: an unanswered session expires after three minutes', async () => {
    const h = await harness();
    await openCall(h);
    h.clock.now = new Date(h.clock.now.getTime() + 179_000);
    expect((await check(h, ALICE)).calling).toBe(true);
    h.clock.now = new Date(h.clock.now.getTime() + 2_000);
    expect((await check(h, ALICE)).calling).toBe(false);
  });

  it('CALL-3: an answered session lasts for the call; an ended session closes at once', async () => {
    const h = await harness();
    const { body } = await openCall(h);
    const auth = { authorization: `Bearer ${h.bankToken}` };
    const ans = await h.sys.app.inject({ method: 'PATCH', url: `/v1/calls/${body.id}`, headers: auth, payload: { status: 'answered' } });
    expect(ans.json().status).toBe('answered');
    h.clock.now = new Date(h.clock.now.getTime() + 10 * 60_000);
    expect((await check(h, ALICE)).calling).toBe(true);
    const end = await h.sys.app.inject({ method: 'PATCH', url: `/v1/calls/${body.id}`, headers: auth, payload: { status: 'ended' } });
    expect(end.json().status).toBe('ended');
    expect((await check(h, ALICE)).calling).toBe(false);
    const missing = await h.sys.app.inject({ method: 'PATCH', url: '/v1/calls/call_nope', headers: auth, payload: { status: 'ended' } });
    expect(missing.statusCode).toBe(404);
  });

  it('F17 / CALL-3: repeating "answered" cannot keep a session open past its cap', async () => {
    const h = await harness();
    const opened = h.clock.now.getTime();
    const { body } = await openCall(h);
    const auth = { authorization: `Bearer ${h.bankToken}` };
    const answer = async () => (await h.sys.app.inject({ method: 'PATCH', url: `/v1/calls/${body.id}`, headers: auth, payload: { status: 'answered' } })).json();
    const cap = opened + (180 + 2 * 3600) * 1000;
    h.clock.now = new Date(opened + 60_000);
    expect(Date.parse((await answer()).expiresAt)).toBe(opened + 60_000 + 2 * 3600 * 1000);
    let last = 0;
    for (let i = 1; i <= 10; i++) {
      h.clock.now = new Date(opened + i * 30 * 60_000);
      const r = await answer();
      if (r.status !== 'answered') break;
      last = Date.parse(r.expiresAt);
      expect(last).toBeLessThanOrEqual(cap);
    }
    expect(last).toBe(cap);
    h.clock.now = new Date(cap + 1000);
    expect((await check(h, ALICE)).calling).toBe(false);
    expect((await answer()).status).toBe('expired');
  });

  it('CALL-4: with no open session the answer is that the bank is not calling', async () => {
    const h = await harness();
    expect(await check(h, ALICE)).toEqual({ verdict: 'not_calling', calling: false, bank: 'DemoBank' });
  });

  it('F9 / REG-6: when the store errors, the call check is cannot check, never not calling', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async openCalls(...args: Parameters<MemoryStore['openCalls']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.openCalls(...args);
      }
    }
    const store = new BrokenStore();
    const h = await harness({ store });
    await openCall(h);
    expect((await check(h, ALICE)).verdict).toBe('calling');
    store.broken = true;
    const r = await h.sys.app.inject({ method: 'GET', url: '/v1/calls/open', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ verdict: 'cannot_check', bank: 'DemoBank' });
    expect(r.json()).not.toHaveProperty('calling');
    expect(await h.sys.svc.openCallFor(h.sys.svc.tenant('demobank')!, ALICE, 'ussd')).toEqual({ verdict: 'cannot_check', bank: 'DemoBank' });
  });
});

describe('links', () => {
  const domains = ['demobank.ng', 'demobank.com'];
  const belongs = (u: string) => checkLink(u, domains, 'DemoBank').verdict;

  it('LINK-1: a registered domain or its subdomain belongs to the bank', () => {
    for (const u of ['https://demobank.ng', 'https://www.demobank.ng/app', 'demobank.com/login', 'http://secure.online.demobank.ng/x?y=1', 'https://WWW.DEMOBANK.NG/']) {
      expect(belongs(u), u).toBe('belongs');
    }
  });

  it('F14 / LINK-1: the link decision is made in verdict.ts, and it is "belongs", never "confirmed"', async () => {
    expect(decideLinkVerdict({ matchedDomain: 'demobank.ng', reasons: [] })).toBe('belongs');
    expect(decideLinkVerdict({ matchedDomain: null, reasons: [] })).toBe('not_confirmed');
    for (const reason of ['shortened', 'punycode', 'not_http', 'ip_address', 'anything-new']) {
      expect(decideLinkVerdict({ matchedDomain: 'demobank.ng', reasons: [reason] }), reason).toBe('not_confirmed');
    }
    const src = (await import('node:fs')).readFileSync(new URL('../packages/api/src/domain/link.ts', import.meta.url), 'utf8');
    expect(src).toContain('decideLinkVerdict(');
    expect(src).not.toMatch(/if \(matched && reasons\.length === 0\)/);
    const h = await harness();
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` }, payload: { url: 'https://www.demobank.ng/app' } });
    expect(r.json().verdict).toBe('belongs');
    expect(JSON.stringify(r.json())).not.toContain('confirmed"');
  });

  it('LINK-2: substitutions, punycode, the name inside other domains and shortened links are not confirmed', () => {
    const cases: [string, string][] = [
      ['https://dem0bank.ng/login', 'lookalike'],
      ['https://demobank-ng.com/verify', 'lookalike'],
      ['https://demobank.ng.secure-login.com', 'lookalike'],
      ['https://www.demo-bank.ng/app', 'lookalike'],
      ['https://dernobank.ng', 'lookalike'],
      ['https://demobank.ng@evil.example/login', 'not_registered'],
      ['https://xn--demobnk-6za.ng/login', 'punycode'],
      ['https://dem\u043Ebank.ng/login', 'punycode'],
      ['https://bit.ly/3xYz', 'shortened'],
      ['https://tinyurl.com/demobank', 'shortened'],
      ['https://evil.example', 'not_registered'],
      ['javascript:alert(1)', 'not_http'],
      ['not a url', 'invalid'],
    ];
    for (const [u, reason] of cases) {
      const r = checkLink(u, domains, 'DemoBank');
      expect(r.verdict, u).toBe('not_confirmed');
      expect(r.reasons, u).toContain(reason);
    }
  });

  it('LINK-1/2 over the API', async () => {
    const h = await harness();
    const auth = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
    const ok = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: auth, payload: { url: 'https://www.demobank.ng/app' } });
    expect(ok.json()).toMatchObject({ verdict: 'belongs', matchedDomain: 'demobank.ng' });
    const bad = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: auth, payload: { url: 'https://bit.ly/x' } });
    expect(bad.json()).toMatchObject({ verdict: 'not_confirmed' });
  });
});
