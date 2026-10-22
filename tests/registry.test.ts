import { describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { configFromEnv, FirestoreStore, MemoryStore, MongoStore } from '../packages/api/src/index.ts';
import { decideVerdict } from '../packages/api/src/domain/verdict.ts';
import { ALERT, ALICE, BOB, harness, LINK_MSG } from './helpers.ts';

describe('registry and verification', () => {
  it('REG-1: a registered message checked by its recipient is confirmed with channel, category and time', async () => {
    const h = await harness();
    const reg = await h.register(ALICE, ALERT);
    expect(reg.status).toBe(202);
    expect(reg.body.recordId).toMatch(/^rec_/);
    const r = await h.verify(ALICE, ALERT);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdict: 'confirmed', channel: 'sms', category: 'transaction_alert', bank: 'DemoBank' });
    expect(Date.parse(r.body.sentAt)).toBe(Date.parse(h.clock.now.toISOString()));
  });

  it('REG-1: canonical-equivalent text from the customer still confirms', async () => {
    const h = await harness();
    await h.register(ALICE, ALERT);
    const r = await h.verify(ALICE, `  ${ALERT.replace(/ /g, '  ')}\n`);
    expect(r.body.verdict).toBe('confirmed');
  });

  it('REG-2: the same digest checked by another recipient is not confirmed', async () => {
    const h = await harness();
    await h.register(ALICE, ALERT);
    const r = await h.verify(BOB, ALERT);
    expect(r.body.verdict).toBe('not_confirmed');
  });

  it('REG-3: an unregistered digest is not confirmed, with the recent activity summary', async () => {
    const h = await harness();
    await h.register(ALICE, ALERT);
    await h.register(ALICE, `${ALERT} (2)`);
    await h.register(ALICE, LINK_MSG, { category: 'service_update', hasLink: true, linkDomains: ['demobank.ng'] });
    const r = await h.verify(ALICE, 'Your account will be blocked. Verify now at http://demobank-secure.co');
    expect(r.body.verdict).toBe('not_confirmed');
    expect(r.body.recentActivity).toEqual(
      expect.arrayContaining([
        { category: 'transaction_alert', channel: 'sms', count: 2, anyWithLink: false },
        { category: 'service_update', channel: 'sms', count: 1, anyWithLink: true },
      ]),
    );
    expect(r.body.activityText).toContain('In the last 24 hours DemoBank sent you two transaction alerts by SMS and one service update by SMS.');
    const bob = await h.verify(BOB, 'anything');
    expect(bob.body.activityText).toBe('In the last 24 hours DemoBank sent you no messages.');
  });

  it('REG-3: activity uses descriptive fields only, with the two-alert wording from the design', async () => {
    const h = await harness();
    await h.register(ALICE, ALERT);
    await h.register(ALICE, `${ALERT}!`);
    const r = await h.verify(ALICE, 'fake');
    expect(r.body.activityText).toBe('In the last 24 hours DemoBank sent you two transaction alerts by SMS. Neither contained a link.');
  });

  it('REG-4: a record past its expiry no longer matches', async () => {
    const h = await harness();
    const sent = new Date(h.clock.now.getTime() - 31 * 24 * 3600 * 1000);
    await h.register(ALICE, ALERT, { sentAt: sent.toISOString() });
    const r = await h.verify(ALICE, ALERT);
    expect(r.body.verdict).toBe('not_confirmed');

    await h.register(ALICE, LINK_MSG);
    expect((await h.verify(ALICE, LINK_MSG)).body.verdict).toBe('confirmed');
    h.clock.now = new Date(h.clock.now.getTime() + 30 * 24 * 3600 * 1000 + 1000);
    expect((await h.verify(ALICE, LINK_MSG)).body.verdict).toBe('not_confirmed');
  });

  it('F8 / REG-4: a sentAt far in the future or already past the TTL is refused, so expiry cannot be dodged', async () => {
    const h = await harness();
    const at = (ms: number) => new Date(h.clock.now.getTime() + ms).toISOString();
    const year3000 = await h.register(ALICE, ALERT, { sentAt: '3000-01-01T00:00:00Z' });
    expect(year3000.status).toBe(400);
    expect(year3000.body).toMatchObject({ code: 'sent_at_in_future' });
    expect(year3000.body.message).not.toContain('3000');
    expect((await h.register(ALICE, ALERT, { sentAt: at(301_000) })).body.code).toBe('sent_at_in_future');
    const old = await h.register(ALICE, ALERT, { sentAt: at(-30 * 24 * 3600 * 1000) });
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('sent_at_expired');
    expect(((await h.sys.store.dump()) as { messages: unknown[] }).messages).toHaveLength(0);

    const skew = await h.register(ALICE, ALERT, { sentAt: at(299_000) });
    expect(skew.status).toBe(202);
    expect(Date.parse(skew.body.expiresAt)).toBeLessThanOrEqual(h.clock.now.getTime() + 30 * 24 * 3600 * 1000 + 300_000);
    expect((await h.register(ALICE, LINK_MSG, { sentAt: at(-29 * 24 * 3600 * 1000) })).status).toBe(202);

    const msg = (sentAt: string) => ({ recipient: ALICE, channel: 'sms', contentDigest: contentDigest(`m ${sentAt}`), category: 'otp', hasLink: false, sentAt });
    const batch = await h.sys.app.inject({
      method: 'POST',
      url: '/v1/messages/batch',
      headers: { authorization: `Bearer ${h.bankToken}` },
      payload: { messages: [msg(at(0)), msg('3000-01-01T00:00:00Z')] },
    });
    expect(batch.statusCode).toBe(400);
    expect(batch.json()).toMatchObject({ code: 'sent_at_in_future', message: expect.stringContaining('messages.1') });
    expect(((await h.sys.store.dump()) as { messages: unknown[] }).messages).toHaveLength(2);
  });

  it('F8: the future window is configurable with REGISTER_MAX_FUTURE_SECONDS', () => {
    const base = {
      AI_PROVIDER: 'none',
      GASKIYA_TOKEN_SECRET: 'x'.repeat(40),
      GASKIYA_TENANTS: JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], senderIds: [], tokenKeysUrl: 'https://bank.example/jwks.json' }]),
      GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: Buffer.alloc(32, 1).toString('base64') }),
      GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'notify', clientSecret: 's'.repeat(32), tenantId: 'demobank' }]),
    };
    expect(configFromEnv({ ...base, REGISTER_MAX_FUTURE_SECONDS: '60' }).settings.registerMaxFutureSeconds).toBe(60);
    expect(configFromEnv(base).settings.registerMaxFutureSeconds).toBe(300);
    expect(() => configFromEnv({ ...base, REGISTER_MAX_FUTURE_SECONDS: '-1' })).toThrow(/REGISTER_MAX_FUTURE_SECONDS/);
  });

  it('REG-5: one idempotency key sent twice creates one record', async () => {
    const h = await harness();
    const a = await h.register(ALICE, ALERT, { idem: 'idem-123' });
    const b = await h.register(ALICE, ALERT, { idem: 'idem-123' });
    expect(a.body.recordId).toBe(b.body.recordId);
    const dump = (await h.sys.store.dump()) as { messages: unknown[] };
    expect(dump.messages).toHaveLength(1);
  });

  it('REG-6: when the store is unavailable, verification returns cannot check and never confirmed', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async findMessage(...args: Parameters<MemoryStore['findMessage']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.findMessage(...args);
      }
    }
    const store = new BrokenStore();
    const h = await harness({ store });
    await h.register(ALICE, ALERT);
    expect((await h.verify(ALICE, ALERT)).body.verdict).toBe('confirmed');
    store.broken = true;
    const r = await h.verify(ALICE, ALERT);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ verdict: 'cannot_check' });
  });

  it('REG-6: /health answers 503 while the store is unreachable, and 200 once it is back', async () => {
    class UnreachableStore extends MemoryStore {
      down = false;
      override async ping() {
        if (this.down) throw new Error('ECONNREFUSED');
      }
    }
    const store = new UnreachableStore();
    const h = await harness({ store });
    expect((await h.sys.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    store.down = true;
    const down = await h.sys.app.inject({ method: 'GET', url: '/health' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ ok: false, code: 'store_unavailable' });
    store.down = false;
    expect((await h.sys.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });

  it('REG-6: /health is healthy against the store under test', async () => {
    const h = await harness();
    const r = await h.sys.app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it('REG-6: the pure verdict function fails closed', () => {
    const base = { enrolled: true, recipientKey: 'r', contentKey: 'c', now: new Date('2026-10-20T00:00:00Z') };
    const rec = { recipientKey: 'r', contentKey: 'c', expiresAt: '2026-11-01T00:00:00Z' };
    expect(decideVerdict({ ...base, lookup: { ok: true, record: rec } })).toBe('confirmed');
    expect(decideVerdict({ ...base, lookup: { ok: false } })).toBe('cannot_check');
    expect(decideVerdict({ ...base, enrolled: false, lookup: { ok: true, record: rec } })).toBe('cannot_check');
    expect(decideVerdict({ ...base, lookup: { ok: true, record: null } })).toBe('not_confirmed');
    expect(decideVerdict({ ...base, lookup: { ok: true, record: { ...rec, recipientKey: 'x' } } })).toBe('not_confirmed');
    expect(decideVerdict({ ...base, lookup: { ok: true, record: { ...rec, contentKey: 'x' } } })).toBe('not_confirmed');
    expect(decideVerdict({ ...base, lookup: { ok: true, record: { ...rec, expiresAt: '2026-10-19T00:00:00Z' } } })).toBe('not_confirmed');
    expect(decideVerdict({ ...base, lookup: { ok: true, record: { ...rec, expiresAt: 'garbage' } } })).toBe('not_confirmed');
  });

  it('REG-7: a record is searchable within two seconds of its registration call', async () => {
    const h = await harness();
    const t0 = performance.now();
    await h.register(ALICE, ALERT);
    const r = await h.verify(ALICE, ALERT);
    expect(r.body.verdict).toBe('confirmed');
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('REG-8: bank endpoints reject missing or invalid bank credentials', async () => {
    const h = await harness();
    const payload = { recipient: ALICE, channel: 'sms', contentDigest: contentDigest(ALERT), category: 'otp', hasLink: false, sentAt: new Date().toISOString() };
    for (const authorization of [undefined, 'Bearer nope', `Bearer ${await h.customerToken(ALICE)}`]) {
      const r = await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: authorization ? { authorization } : {}, payload });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ code: 'unauthorized' });
    }
    for (const [method, url] of [['POST', '/v1/calls'], ['GET', '/v1/campaigns'], ['GET', '/v1/metrics'], ['PATCH', '/v1/calls/x']] as const) {
      expect((await h.sys.app.inject({ method, url, payload: method === 'GET' ? undefined : {} })).statusCode).toBe(401);
    }
    const bad = await h.sys.app.inject({ method: 'POST', url: '/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: 'demobank-notify', client_secret: 'wrong' } });
    expect(bad.statusCode).toBe(401);
  });

  it('REG-8: customer endpoints reject missing, forged, expired or bank tokens', async () => {
    const h = await harness();
    const { generateKeyPair } = await import('jose');
    const other = await generateKeyPair('ES256');
    const tokens = [
      undefined,
      'Bearer x.y.z',
      `Bearer ${await h.customerToken(ALICE, { key: other.privateKey })}`,
      `Bearer ${await h.customerToken(ALICE, { iss: 'otherbank' })}`,
      `Bearer ${await h.customerToken(ALICE, { expSeconds: -10 })}`,
      `Bearer ${h.bankToken}`,
    ];
    for (const authorization of tokens) {
      for (const [method, url] of [['POST', '/v1/verify/message'], ['POST', '/v1/verify/link'], ['GET', '/v1/calls/open'], ['GET', '/v1/activity'], ['POST', '/v1/explain'], ['POST', '/v1/reports'], ['POST', '/v1/devices']] as const) {
        const r = await h.sys.app.inject({ method, url, headers: authorization ? { authorization } : {}, payload: method === 'GET' ? undefined : { contentDigest: contentDigest('x') } });
        expect(r.statusCode, `${url} ${authorization?.slice(0, 20)}`).toBe(401);
      }
    }
  });

  it('REG-9: a body that fails schema validation is rejected before any logic runs', async () => {
    const h = await harness();
    let touched = 0;
    const orig = h.sys.store.putMessage.bind(h.sys.store);
    h.sys.store.putMessage = async (...a) => (touched++, orig(...a));
    const auth = { authorization: `Bearer ${h.bankToken}` };
    const bad = [
      { recipient: '08012345678', channel: 'sms', contentDigest: contentDigest('x'), category: 'otp', hasLink: false, sentAt: new Date().toISOString() },
      { recipient: ALICE, channel: 'fax', contentDigest: contentDigest('x'), category: 'otp', hasLink: false, sentAt: new Date().toISOString() },
      { recipient: ALICE, channel: 'sms', contentDigest: 'abc', category: 'otp', hasLink: false, sentAt: new Date().toISOString() },
      { recipient: ALICE, channel: 'sms', contentDigest: contentDigest('x'), category: 'otp', hasLink: false, sentAt: 'yesterday' },
      { recipient: ALICE, channel: 'sms', contentDigest: contentDigest('x'), category: 'otp', hasLink: false, sentAt: new Date().toISOString(), text: 'plain text' },
    ];
    for (const payload of bad) {
      const r = await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: auth, payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('invalid_request');
    }
    const notJson = await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: { ...auth, 'content-type': 'application/json' }, payload: '{nope' });
    expect(notJson.statusCode).toBe(400);
    expect(touched).toBe(0);
  });

  it('batch registration registers many messages', async () => {
    const h = await harness();
    const now = new Date().toISOString();
    const r = await h.sys.app.inject({
      method: 'POST',
      url: '/v1/messages/batch',
      headers: { authorization: `Bearer ${h.bankToken}` },
      payload: { messages: [ALERT, LINK_MSG].map((t) => ({ recipient: ALICE, channel: 'sms', contentDigest: contentDigest(t), category: 'transaction_alert', hasLink: false, sentAt: now })) },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().records).toHaveLength(2);
    expect((await h.verify(ALICE, LINK_MSG)).body.verdict).toBe('confirmed');
  });

  const batchOf = (n: number, sentAt: string) =>
    Array.from({ length: n }, (_, i) => ({
      recipient: i % 2 ? ALICE : BOB,
      channel: 'sms',
      contentDigest: contentDigest(`${ALERT} #${i}`),
      category: i % 3 ? 'transaction_alert' : 'otp',
      hasLink: false,
      sentAt,
    }));

  it('batch registration: a replay with the same Idempotency-Key returns the same records and counts once', async () => {
    const h = await harness();
    const messages = batchOf(5, new Date().toISOString());
    const send = () =>
      h.sys.app.inject({ method: 'POST', url: '/v1/messages/batch', headers: { authorization: `Bearer ${h.bankToken}`, 'idempotency-key': 'batch-1' }, payload: { messages } });
    const first = await send();
    const again = await send();
    expect(first.statusCode).toBe(202);
    expect(again.statusCode).toBe(202);
    expect(again.json().records).toEqual(first.json().records);
    expect(new Set(first.json().records.map((r: { recordId: string }) => r.recordId)).size).toBe(5);
    const m = await h.sys.store.metrics('demobank');
    expect(m.registrations).toBe(5);
    expect(m.registrationsByCategory).toEqual({ otp: 2, transaction_alert: 3 });
  });

  it('batch registration of the maximum size (500) returns one record per message, in order', async () => {
    const h = await harness();
    const messages = batchOf(500, new Date().toISOString());
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/messages/batch', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { messages } });
    expect(r.statusCode).toBe(202);
    const records = r.json().records as { recordId: string; expiresAt: string }[];
    expect(records).toHaveLength(500);
    expect(new Set(records.map((x) => x.recordId)).size).toBe(500);
    expect((await h.verify(BOB, `${ALERT} #0`)).body.verdict).toBe('confirmed');
    expect((await h.verify(ALICE, `${ALERT} #499`)).body.verdict).toBe('confirmed');
    expect((await h.verify(BOB, `${ALERT} #499`)).body.verdict).toBe('not_confirmed');
    expect((await h.sys.store.metrics('demobank')).registrations).toBe(500);
  }, 60_000);

  it('batch registration: identical content to the same person twice leaves one matching record', async () => {
    const h = await harness();
    const one = { recipient: ALICE, channel: 'sms', contentDigest: contentDigest(ALERT), category: 'transaction_alert', hasLink: false, sentAt: new Date().toISOString() };
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/messages/batch', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { messages: [one, one] } });
    expect(r.statusCode).toBe(202);
    expect(r.json().records).toHaveLength(2);
    expect((await h.verify(ALICE, ALERT)).body.verdict).toBe('confirmed');
  });

  it('registration stats add up after many concurrent registrations', async () => {
    const h = await harness();
    const n = 40;
    const results = await Promise.all(Array.from({ length: n }, (_, i) => h.register(i % 2 ? ALICE : BOB, `${ALERT} #${i}`, { idem: `k${i}` })));
    expect(results.every((r) => r.status === 202)).toBe(true);
    await Promise.all(Array.from({ length: 10 }, (_, i) => h.register(i % 2 ? ALICE : BOB, `${ALERT} #${i}`, { idem: `k${i}` })));
    const m = await h.sys.store.metrics('demobank');
    expect(m.registrations).toBe(n);
    expect(m.registrationsByCategory).toEqual({ transaction_alert: n });
    if (h.sys.store instanceof FirestoreStore) {
      const stats = ((await h.sys.store.dump()) as unknown as { stats: { _id: string }[] }).stats.map((d) => d._id);
      expect(stats.length).toBeGreaterThan(1);
      expect(stats.every((id) => /^demobank_\d+$/.test(id))).toBe(true);
    }
    if (h.sys.store instanceof MongoStore) {
      expect(((await h.sys.store.dump()) as unknown as { stats: { _id: string }[] }).stats.map((d) => d._id)).toEqual(['demobank']);
    }
  });
});
