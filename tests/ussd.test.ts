import { describe, expect, it } from 'vitest';
import { copy, fill } from '@gaskiya/schemas';
import { MemoryStore } from '../packages/api/src/index.ts';
import { paginate, startOfDay, USSD_MAX } from '../packages/api/src/ussd.ts';
import { ALERT, ALICE, BOB, harness, LINK_MSG, USSD, type Harness } from './helpers.ts';

const NOON = new Date('2026-10-20T11:00:00Z');

async function dial(h: Harness, phone: string, text = '', token: string | null = USSD.token) {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: token === null ? '/webhooks/ussd' : `/webhooks/ussd?token=${encodeURIComponent(token)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ sessionId: 'ATUid_test', serviceCode: '*347*123#', phoneNumber: phone, networkCode: '62130', text }).toString(),
  });
  return { status: r.statusCode, type: String(r.headers['content-type'] ?? ''), body: r.body };
}

function expectScreen(body: string) {
  expect(body).toMatch(/^(CON|END) /);
  expect(body.length).toBeLessThanOrEqual(USSD_MAX);
  expect(body).toMatch(/^[\n\x20-\x7e]*$/);
}

async function openCall(h: Harness, phone: string, purpose = 'fraud_check') {
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: phone, purpose, agentRef: 'a1' } });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string; code: string };
}

describe('USSD channel', () => {
  it('USSD-1: dialling the code shows the two-option menu as a CON screen', async () => {
    const h = await harness();
    const r = await dial(h, ALICE);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/^text\/plain/);
    expectScreen(r.body);
    expect(r.body.startsWith('CON ')).toBe(true);
    expect(r.body).toContain(fill(copy.ussd.menu, { bank: 'DemoBank' }));
    expect(r.body).toContain('1. ');
    expect(r.body).toContain('2. ');
    expect((await dial(h, ALICE, '2*0')).body).toBe(r.body);
  });

  it('USSD-2: option 1 shows an active call to this number with its code and purpose, and to no other number', async () => {
    const h = await harness();
    const call = await openCall(h, ALICE, 'card_activation');
    const r = await dial(h, ALICE, '1');
    expectScreen(r.body);
    expect(r.body.startsWith('END ')).toBe(true);
    expect(r.body).toContain(fill(copy.ussd.calling, { bank: 'DemoBank', code: call.code, purpose: copy.purposes.card_activation }));
    const other = await dial(h, BOB, '1');
    expect(other.body).toContain(copy.call.not_calling.title);
    expect(other.body).not.toContain(call.code);
    await h.sys.app.inject({ method: 'PATCH', url: `/v1/calls/${call.id}`, headers: { authorization: `Bearer ${h.bankToken}` }, payload: { status: 'ended' } });
    expect((await dial(h, ALICE, '1')).body).toContain(copy.call.not_calling.title);
  });

  it('USSD-2 / F10: with two agents calling at once, option 1 shows both codes', async () => {
    const h = await harness();
    const first = await openCall(h, ALICE, 'card_activation');
    const second = await openCall(h, ALICE, 'fraud_check');
    const r = await dial(h, ALICE, '1');
    expectScreen(r.body);
    expect(r.body.startsWith('END ')).toBe(true);
    expect(r.body).toContain(first.code);
    expect(r.body).toContain(second.code);
    expect(r.body).toContain(copy.call.mismatchMany);
    expect(r.body).not.toContain(copy.call.mismatch);
  });

  it('USSD-3: with no call open, option 1 says the bank is not calling and to hang up', async () => {
    const h = await harness();
    const r = await dial(h, ALICE, '1');
    expectScreen(r.body);
    expect(r.body).toBe(`END ${copy.call.not_calling.title}\n${fill(copy.call.not_calling.body, { bank: 'DemoBank' })}`);
  });

  it("USSD-4: option 2 lists today's messages for the dialling number only, as category, channel and time", async () => {
    const h = await harness();
    h.clock.now = NOON;
    await h.register(ALICE, ALERT, { sentAt: '2026-10-20T08:05:00Z' });
    await h.register(ALICE, LINK_MSG, { sentAt: '2026-10-20T10:30:00Z', channel: 'whatsapp', category: 'security_notice' });
    await h.register(ALICE, 'yesterday', { sentAt: '2026-10-19T20:00:00Z' });
    await h.register(BOB, 'for bob only', { sentAt: '2026-10-20T09:00:00Z', category: 'marketing' });

    const r = await dial(h, ALICE, '2');
    expectScreen(r.body);
    expect(r.body).toBe(
      [
        `END ${fill(copy.ussd.todayHeading, { bank: 'DemoBank' })}`,
        fill(copy.ussd.todayItem, { time: '11:30', category: copy.categories.security_notice, channel: copy.channels.whatsapp }),
        fill(copy.ussd.todayItem, { time: '09:05', category: copy.categories.transaction_alert, channel: copy.channels.sms }),
        copy.ussd.todayNote,
      ].join('\n'),
    );
    for (const s of ['Debit', 'NGN', 'https', 'demobank.ng', copy.categories.marketing, '10:00']) expect(r.body).not.toContain(s);

    const bob = await dial(h, BOB, '2');
    expect(bob.body).toContain(copy.categories.marketing);
    expect(bob.body).not.toContain(copy.categories.security_notice);
    expect(bob.body).not.toContain(copy.categories.transaction_alert);

    const nobody = await dial(h, '+2348011112222', '2');
    expect(nobody.body).toBe(`END ${fill(copy.ussd.todayNone, { bank: 'DemoBank' })}\n${copy.ussd.todayNote}`);

    expect((await dial(h, ALICE.slice(1), '2')).body).toBe(r.body);
  });

  it('USSD-4: a long list pages with 98 and every page fits one screen', async () => {
    const h = await harness();
    h.clock.now = NOON;
    for (let i = 0; i < 12; i++) await h.register(ALICE, `alert ${i}`, { sentAt: new Date(Date.parse('2026-10-20T00:00:00Z') + i * 60_000).toISOString() });
    const items: string[] = [];
    let text = '2';
    for (let page = 0; page < 12; page++) {
      const r = await dial(h, ALICE, text);
      expectScreen(r.body);
      items.push(...r.body.split('\n').filter((l) => / transaction alert by SMS$/.test(l)));
      if (r.body.startsWith('END ')) {
        expect(r.body).toContain(copy.ussd.todayNote);
        break;
      }
      expect(r.body).toContain(copy.ussd.more);
      text += '*98';
    }
    expect(items).toHaveLength(12);
    expect(new Set(items).size).toBeGreaterThan(1);
    expect(paginate('H', Array.from({ length: 40 }, () => 'x'.repeat(40)), 'N').every((p) => p.body.length <= USSD_MAX - 4)).toBe(true);
  });

  it('USSD-5: when the store fails, both options end with cannot check and never confirm anything', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async openCalls(...args: Parameters<MemoryStore['openCalls']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.openCalls(...args);
      }
      override async recentMessages(...args: Parameters<MemoryStore['recentMessages']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.recentMessages(...args);
      }
    }
    const store = new BrokenStore();
    const h = await harness({ store });
    await h.register(ALICE, ALERT);
    await openCall(h, ALICE);
    store.broken = true;
    const cannot = `END ${copy.verdict.cannot_check.title}\n${copy.verdict.cannot_check.body}`;
    for (const text of ['1', '2', '2*98']) {
      const r = await dial(h, ALICE, text);
      expect(r.status).toBe(200);
      expect(r.body).toBe(cannot);
    }
    const h2 = await harness({ ussd: { token: USSD.token, tenantId: 'nobank' } });
    expect((await dial(h2, ALICE, '1')).body).toBe(cannot);
  });

  it('USSD-6: a missing or wrong token is rejected, and with no token configured the route is off', async () => {
    const h = await harness();
    await openCall(h, ALICE);
    for (const token of [null, '', 'wrong', `${USSD.token}x`, USSD.token.slice(0, -1)]) {
      const r = await dial(h, ALICE, '1', token);
      expect(r.status).toBe(403);
      expect(r.body).not.toMatch(/^(CON|END)/);
    }
    const off = await harness({ ussd: null });
    expect((await dial(off, ALICE, '', USSD.token)).status).toBe(404);
    const logs = h.logs.join('\n');
    expect(logs).toContain('/webhooks/ussd');
    for (const s of [USSD.token, ALICE, ALICE.slice(1), encodeURIComponent(ALICE)]) expect(logs).not.toContain(s);
  });

  it('USSD-7: every reply is CON or END in plain ASCII within one screen; bad input and floods end the session', async () => {
    const h = await harness();
    await openCall(h, BOB);
    const screens: string[] = [];
    for (const t of ['', '1', '2', '2*98', '2*0', '2*0*1', '5', '1*1', 'abc', '2*5']) screens.push((await dial(h, BOB, t)).body);
    expect(screens[1]).toContain(copy.ussd.calling.split('\n')[1]!.split('{')[0]!);
    for (const s of screens) expectScreen(s);
    expect(screens.filter((s) => s === `END ${copy.ussd.invalid}`)).toHaveLength(3);
    expect(screens.slice(-4).every((s) => s.startsWith('END '))).toBe(true);
    const limited = await harness({ rateLimit: 3 });
    const bob = [];
    for (let i = 0; i < 5; i++) bob.push((await dial(limited, BOB, '')).body);
    expect(bob.slice(0, 3).every((s) => s.startsWith('CON '))).toBe(true);
    expect(bob.slice(3)).toEqual([`END ${copy.ussd.tooMany}`, `END ${copy.ussd.tooMany}`]);
    expect((await dial(limited, ALICE, '')).body.startsWith('CON ')).toBe(true);
    expect((await dial(h, 'not-a-number', '1')).body.startsWith('END ')).toBe(true);
    expect(startOfDay(new Date('2026-10-20T23:30:00Z')).toISOString()).toBe('2026-10-20T23:00:00.000Z');
  });
});
