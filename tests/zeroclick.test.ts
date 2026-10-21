import { describe, expect, it } from 'vitest';
import { VerifyIndicators } from '@gaskiya/schemas';
import { callbackDigest, maskDigits, MemoryStore, type Tenant } from '../packages/api/src/index.ts';
import { ALICE, BOB, harness, OTHER_TENANT, type Harness } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const SCAM_DOMAIN = 'demobank-restore.com';
const SCAM_NUMBER = '08095550101';
const SCAM_E164 = '+2348095550101';

const LINK_REPORTS = [
  'Your DemoBank account is restricted. Restore access at https://demobank-restore.com today.',
  'Dear customer, BVN update required. Visit https://demobank-restore.com/bvn to avoid suspension.',
  'Final notice from DemoBank: verify your details at demobank-restore.com/secure',
];
const CALL_REPORTS = ['Call 0809 555 0101 now to claim your refund', 'Your refund is ready, dial 0809-555-0101', 'Agent waiting: 08095550101'];

const PUBLISHES: Partial<Tenant> = {
  kind: 'bank',
  officialContacts: { phones: ['+2342019000000', '0201 900 0001'], whatsapp: ['+2349060000000'], emails: ['care@demobank.ng'] },
};

const bank = (h: Harness, token = h.bankToken) => ({ authorization: `Bearer ${token}` });

async function report(h: Harness, text: string, extra: Record<string, unknown> = {}, phone = ALICE, iss?: string) {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: '/v1/reports',
    headers: { authorization: `Bearer ${await h.customerToken(phone, iss ? { iss } : {})}` },
    payload: { maskedText: text, consent: true, ...extra },
  });
  expect(r.statusCode).toBe(201);
}

async function runAgent(h: Harness, token = h.bankToken) {
  await h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: bank(h, token) });
  return (await h.sys.app.inject({ method: 'GET', url: '/v1/campaigns', headers: bank(h, token) })).json().campaigns as { id: string; linkDomains: string[]; callbackKeyCount: number }[];
}

async function linkCampaign(h: Harness) {
  for (const t of LINK_REPORTS) await report(h, t, { indicators: ['non_bank_link'] });
  const campaigns = await runAgent(h);
  expect(campaigns).toHaveLength(1);
  return campaigns[0]!;
}

async function callbackCampaign(h: Harness) {
  for (const t of CALL_REPORTS) await report(h, maskDigits(t), { callbackDigests: [callbackDigest(SCAM_NUMBER)] });
  const campaigns = await runAgent(h);
  const c = campaigns.find((x) => x.callbackKeyCount === 1);
  expect(c).toBeDefined();
  return c!;
}

async function indicators(h: Harness, payload: unknown, opts: { phone?: string; iss?: string; auth?: string | null } = {}) {
  const headers: Record<string, string> =
    opts.auth === null ? {} : { authorization: opts.auth ?? `Bearer ${await h.customerToken(opts.phone ?? ALICE, opts.iss ? { iss: opts.iss } : {})}` };
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/indicators', headers, payload: payload as object });
  return { status: r.statusCode, body: r.json() };
}

async function officialContacts(h: Harness, auth?: string | null) {
  const headers: Record<string, string> = auth === null ? {} : { authorization: auth ?? `Bearer ${await h.customerToken(ALICE)}` };
  const r = await h.sys.app.inject({ method: 'GET', url: '/v1/official-contacts', headers });
  return { status: r.statusCode, body: r.json() };
}

describe('zero-click protection: official identity (ZC-6)', () => {
  it("ZC-6: official contacts lists the bank's phones, sender IDs and domains", async () => {
    const h = await harness({ tenant: PUBLISHES });
    const r = await officialContacts(h);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      bankId: 'demobank',
      name: 'DemoBank',
      kind: 'bank',
      phones: ['+2342019000000', '+2342019000001', '+2349060000000'],
      senderIds: ['DemoBank'],
      domains: ['demobank.ng', 'demobank.com'],
      updatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(r.body.updatedAt))).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/care@|secret|tokenKeys|alertEmails/i);
  });

  it("ZC-6: official contacts is the caller's own bank, and needs a customer token", async () => {
    const h = await harness({ tenant: PUBLISHES, otherBank: true });
    expect((await officialContacts(h, null)).status).toBe(401);
    expect((await officialContacts(h, `Bearer ${h.bankToken}`)).status).toBe(401);
    const other = await officialContacts(h, `Bearer ${await h.customerToken(BOB, { iss: OTHER_TENANT.id })}`);
    expect(other.status).toBe(200);
    expect(other.body).toMatchObject({ bankId: 'otherbank', name: 'OtherBank', phones: [], senderIds: ['OtherBank'], domains: ['otherbank.ng'] });
  });

  it('ZC-6: official contacts fails closed', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async ping() {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.ping();
      }
    }
    const store = new BrokenStore();
    const h = await harness({ tenant: PUBLISHES, store });
    store.broken = true;
    const r = await officialContacts(h);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ code: 'cannot_check', message: expect.any(String) });
  });
});

describe('zero-click protection: scam campaign match (ZC-8)', () => {
  it('ZC-8: a domain from an active campaign matches', async () => {
    const h = await harness();
    const c = await linkCampaign(h);
    expect(c.linkDomains).toEqual([SCAM_DOMAIN]);
    const r = await indicators(h, { domains: [SCAM_DOMAIN, 'www.demobank-restore.com', 'login.demobank-restore.com', 'example.org'] });
    expect(r.status).toBe(200);
    expect(r.body.matches).toHaveLength(3);
    for (const m of r.body.matches) {
      expect(m).toEqual({ kind: 'domain', value: expect.any(String), campaignId: c.id, reports: 3, lastSeen: h.clock.now.toISOString() });
    }
    expect(r.body.matches.map((m: { value: string }) => m.value).sort()).toEqual([SCAM_DOMAIN, 'login.demobank-restore.com', 'www.demobank-restore.com']);
    expect(JSON.stringify(r.body)).not.toMatch(/confirmed|genuine|official|belongs/);
  });

  it("ZC-8: the bank's own domains and official numbers never match, even if a scam mentioned them", async () => {
    const h = await harness({ tenant: PUBLISHES });
    const texts = [
      'DemoBank alert: your account is locked. Unlock at https://demobank-restore.com or see demobank.ng. Call +234 201 900 0000',
      'Restore access at https://demobank-restore.com/x (real site: demobank.ng). Call +234 201 900 0000',
      'Last chance: demobank-restore.com/y, not demobank.ng. Call +234 201 900 0000',
    ];
    for (const t of texts) await report(h, t);
    await runAgent(h);
    const r = await indicators(h, { domains: ['demobank.ng', 'www.demobank.ng', SCAM_DOMAIN], phones: ['+2342019000000'] });
    expect(r.status).toBe(200);
    expect(r.body.matches.map((m: { kind: string; value: string }) => `${m.kind}:${m.value}`)).toEqual([`domain:${SCAM_DOMAIN}`]);
  });

  it('ZC-8: a phone number from a reported scam matches by keyed hash, and no plain number is stored', async () => {
    const h = await harness();
    const c = await callbackCampaign(h);
    for (const phone of [SCAM_E164, SCAM_NUMBER, '+234 809 555 0101']) {
      const r = await indicators(h, { phones: [phone, '+2348011112222'] });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ matches: [{ kind: 'phone', value: phone, campaignId: c.id, reports: 3, lastSeen: h.clock.now.toISOString() }] });
    }
    const dump = JSON.stringify(await h.sys.store.dump());
    for (const s of [SCAM_NUMBER, SCAM_E164, '8095550101', '809 555 0101', '0809-555-0101', callbackDigest(SCAM_NUMBER), '8011112222']) expect(dump).not.toContain(s);
    expect(h.logs.join('\n')).not.toMatch(/8095550101|8011112222|demobank-restore/);
  });

  it('ZC-8: a callback number in an unmasked report is hashed before masking, so it still matches', async () => {
    const h = await harness();
    for (const t of CALL_REPORTS) await report(h, t);
    const campaigns = await runAgent(h);
    const c = campaigns.find((x) => x.callbackKeyCount === 1)!;
    expect(c).toBeDefined();
    const r = await indicators(h, { phones: [SCAM_E164] });
    expect(r.body.matches).toEqual([{ kind: 'phone', value: SCAM_E164, campaignId: c.id, reports: 3, lastSeen: h.clock.now.toISOString() }]);
    const dump = JSON.stringify(await h.sys.store.dump());
    expect(dump).not.toContain('8095550101');
    expect(dump).not.toContain('0809 555 0101');
    expect(dump).not.toContain(callbackDigest(SCAM_NUMBER));
  });

  it('ZC-8: a phone match still works after the hashing key is rotated', async () => {
    const { StaticKeyService } = await import('../packages/api/src/index.ts');
    const k1 = Buffer.alloc(32, 7).toString('base64');
    const k2 = Buffer.alloc(32, 9).toString('base64');
    const store = new MemoryStore();
    const before = await harness({ store, keys: new StaticKeyService({ demobank: { current: 1, keys: { 1: k1 } } }) });
    const c = await callbackCampaign(before);
    const after = await harness({ store, keys: new StaticKeyService({ demobank: { current: 2, keys: { 1: k1, 2: k2 } } }) });
    expect((await indicators(after, { phones: [SCAM_E164] })).body.matches.map((m: { campaignId: string }) => m.campaignId)).toEqual([c.id]);
  });

  it('ZC-8: dismissed or withdrawn campaigns do not match', async () => {
    const h = await harness();
    const c = await linkCampaign(h);
    expect((await indicators(h, { domains: [SCAM_DOMAIN] })).body.matches).toHaveLength(1);
    expect((await h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c.id}/dismiss`, headers: bank(h) })).statusCode).toBe(200);
    expect((await indicators(h, { domains: [SCAM_DOMAIN] })).body).toEqual({ matches: [] });

    const h2 = await harness();
    const c2 = await linkCampaign(h2);
    expect((await h2.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c2.id}/approve`, headers: bank(h2), payload: { analyst: 'Aisha Bello' } })).statusCode).toBe(200);
    expect((await indicators(h2, { domains: [SCAM_DOMAIN] })).body.matches).toHaveLength(1);
    expect((await h2.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c2.id}/withdraw`, headers: bank(h2), payload: { analyst: 'Aisha Bello' } })).statusCode).toBe(200);
    expect((await indicators(h2, { domains: [SCAM_DOMAIN] })).body).toEqual({ matches: [] });
  });

  it('ZC-8: only reports from the last 7 days count', async () => {
    const h = await harness();
    const c = await linkCampaign(h);
    const first = h.clock.now.toISOString();
    h.clock.now = new Date(h.clock.now.getTime() + 6 * DAY);
    await report(h, 'DemoBank: restore your account at https://demobank-restore.com/now');
    await runAgent(h);
    let r = await indicators(h, { domains: [SCAM_DOMAIN] });
    expect(r.body.matches).toEqual([{ kind: 'domain', value: SCAM_DOMAIN, campaignId: c.id, reports: 4, lastSeen: h.clock.now.toISOString() }]);
    h.clock.now = new Date(h.clock.now.getTime() + 2 * DAY);
    r = await indicators(h, { domains: [SCAM_DOMAIN] });
    expect(r.body.matches).toEqual([{ kind: 'domain', value: SCAM_DOMAIN, campaignId: c.id, reports: 1, lastSeen: new Date(Date.parse(first) + 6 * DAY).toISOString() }]);
    h.clock.now = new Date(h.clock.now.getTime() + 6 * DAY);
    expect((await indicators(h, { domains: [SCAM_DOMAIN] })).body).toEqual({ matches: [] });
  });

  it("ZC-8: another bank's campaign does not match", async () => {
    const h = await harness({ otherBank: true });
    await linkCampaign(h);
    await callbackCampaign(h);
    const r = await indicators(h, { domains: [SCAM_DOMAIN], phones: [SCAM_E164] }, { phone: BOB, iss: OTHER_TENANT.id });
    expect(r).toEqual({ status: 200, body: { matches: [] } });
    const h2 = await harness({ otherBank: true });
    for (const t of LINK_REPORTS) await report(h2, t, {}, BOB, OTHER_TENANT.id);
    expect(await runAgent(h2, h2.otherBankToken!)).toHaveLength(1);
    expect((await indicators(h2, { domains: [SCAM_DOMAIN] })).body).toEqual({ matches: [] });
  });

  it('ZC-8: store error fails closed (503)', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async listReports(...args: Parameters<MemoryStore['listReports']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.listReports(...args);
      }
    }
    const store = new BrokenStore();
    const h = await harness({ store });
    await linkCampaign(h);
    store.broken = true;
    const r = await indicators(h, { domains: [SCAM_DOMAIN] });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ code: 'cannot_check', message: expect.any(String) });
    expect(r.body).not.toHaveProperty('matches');
  });

  it('ZC-8: needs a customer token', async () => {
    const h = await harness();
    expect((await indicators(h, { domains: [SCAM_DOMAIN] }, { auth: null })).status).toBe(401);
    expect((await indicators(h, { domains: [SCAM_DOMAIN] }, { auth: `Bearer ${h.bankToken}` })).status).toBe(401);
  });

  it('ZC-8: the request is validated (at least one value, at most 10 of each, hostnames and phone numbers only)', async () => {
    const h = await harness();
    for (const bad of [{}, { domains: [] }, { domains: [], phones: [] }, { domains: ['not a domain'] }, { domains: ['https://x.com/a'] }, { phones: ['call me'] }, { domains: Array.from({ length: 11 }, (_, i) => `d${i}.com`) }, { phones: Array.from({ length: 11 }, () => SCAM_E164) }, { domains: ['a.com'], extra: 1 }]) {
      const r = await indicators(h, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.code).toBe('invalid_request');
    }
    expect(VerifyIndicators.parse({ domains: ['Demobank-Restore.COM'] })).toEqual({ domains: ['demobank-restore.com'] });
    expect((await indicators(h, { phones: [SCAM_E164] })).status).toBe(200);
  });

  it('ZC-8: is rate limited with the other checks', async () => {
    const h = await harness({ rateLimit: 2 });
    expect((await indicators(h, { domains: [SCAM_DOMAIN] })).status).toBe(200);
    expect((await indicators(h, { domains: [SCAM_DOMAIN] })).status).toBe(200);
    expect((await indicators(h, { domains: [SCAM_DOMAIN] })).status).toBe(429);
  });
});
