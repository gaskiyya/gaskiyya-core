import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES } from '@gaskiya/agent';
import { copy, copyFor, fill, LANGUAGES } from '@gaskiya/schemas';
import { configFromEnv, FcmPush, MemoryStore } from '../packages/api/src/index.ts';
import { unsafeBriefingText } from '../packages/api/src/ai/briefing.ts';
import { asksForSecret } from '../packages/api/src/ai/explain.ts';
import { agentTools } from '../packages/api/src/campaigns.ts';
import type { Notice } from '../packages/api/src/channels/channels.ts';
import { alertsReply, defang } from '../packages/api/src/whatsapp.ts';
import { ALICE, BOB, demoEnv, harness, OTHER_TENANT, WA, type Harness } from './helpers.ts';

function signedText(from: string, body: string) {
  const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from, id: `wamid.${Math.random()}`, timestamp: '1', type: 'text', text: { body } }] } }] }] };
  const raw = JSON.stringify(payload);
  return { raw, signature: `sha256=${createHmac('sha256', WA.appSecret).update(raw).digest('hex')}` };
}

const DAY = 24 * 60 * 60 * 1000;
const REPORTS = [
  'Your DemoBank account is restricted. Restore access at https://demobank-restore.com today.',
  'Dear customer, BVN update required. Visit https://demobank-restore.com/bvn to avoid suspension.',
  'Final notice from DemoBank: verify your details at demobank-restore.com/secure',
];

const bank = (h: Harness) => ({ authorization: `Bearer ${h.bankToken}` });

async function campaignFrom(h: Harness) {
  const auth = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
  for (const t of REPORTS) {
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/reports', headers: auth, payload: { maskedText: t, consent: true, indicators: ['non_bank_link', 'urgency_or_threat'] } });
    expect(r.statusCode).toBe(201);
  }
  await h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: bank(h) });
  const { campaigns } = (await h.sys.app.inject({ method: 'GET', url: '/v1/campaigns', headers: bank(h) })).json();
  expect(campaigns).toHaveLength(1);
  return campaigns[0];
}

async function advisories(h: Harness, phone: string, iss?: string) {
  const r = await h.sys.app.inject({ method: 'GET', url: '/v1/advisories', headers: { authorization: `Bearer ${await h.customerToken(phone, iss ? { iss } : {})}` } });
  return { status: r.statusCode, body: r.json() };
}

const approve = (h: Harness, id: string, analyst = 'Aisha Bello') =>
  h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${id}/approve`, headers: bank(h), payload: { analyst } });
const withdraw = (h: Harness, id: string, payload: unknown = { analyst: 'Aisha Bello' }) =>
  h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${id}/withdraw`, headers: bank(h), payload: payload as object });

async function device(h: Harness, phone: string, pushToken: string) {
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/devices', headers: { authorization: `Bearer ${await h.customerToken(phone)}` }, payload: { pushToken, platform: 'android' } });
  expect(r.statusCode).toBe(204);
}

describe('advisory outreach (decision 0018)', () => {
  it('ADV-1: a draft advisory is not visible to customers, and the list needs a customer token', async () => {
    const h = await harness();
    const c = await campaignFrom(h);
    expect(c.advisory.status).toBe('draft');
    expect(await advisories(h, ALICE)).toEqual({ status: 200, body: { bank: 'DemoBank', advisories: [] } });
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/advisories' })).statusCode).toBe(401);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/advisories', headers: bank(h) })).statusCode).toBe(401);
    expect(h.push.sent).toEqual([]);
  });

  it("ADV-2: an approved advisory is shown to that bank's customers only, with no customer data", async () => {
    const h = await harness({ otherBank: true });
    const c = await campaignFrom(h);
    const otherBank = { authorization: `Bearer ${h.otherBankToken}` };
    expect((await h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c.id}/approve`, headers: otherBank, payload: { analyst: 'Eve Mallory' } })).statusCode).toBe(404);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/campaigns', headers: otherBank })).json().campaigns).toEqual([]);

    const ok = await approve(h, c.id);
    expect(ok.statusCode).toBe(200);
    const approvedAt = ok.json().advisory.approvedAt as string;
    expect(ok.json().advisory.expiresAt).toBe(new Date(Date.parse(approvedAt) + 14 * DAY).toISOString());

    for (const phone of [ALICE, BOB]) {
      const r = await advisories(h, phone);
      expect(r.status).toBe(200);
      expect(r.body.advisories).toEqual([
        {
          id: c.id,
          bank: 'DemoBank',
          title: fill(copy.advisory.title, { bank: 'DemoBank' }),
          text: c.advisory.text,
          approvedAt,
          expiresAt: ok.json().advisory.expiresAt,
          indicators: ['non_bank_link', 'urgency_or_threat'],
          linkDomains: ['demobank-restore.com'],
          asksCallback: false,
        },
      ]);
      const raw = JSON.stringify(r.body);
      for (const s of ['reportCount', 'summary', 'Aisha', 'maskedText', 'recipientKey', ALICE, BOB, 'briefing']) expect(raw, s).not.toContain(s);
    }
    expect(await advisories(h, ALICE, OTHER_TENANT.id)).toEqual({ status: 200, body: { bank: 'OtherBank', advisories: [] } });
    expect((await h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c.id}/withdraw`, headers: otherBank, payload: { analyst: 'Eve Mallory' } })).statusCode).toBe(404);
    expect((await advisories(h, ALICE)).body.advisories).toHaveLength(1);
  });

  it('ADV-3: a withdrawn advisory disappears; withdrawal needs bank credentials and a named analyst', async () => {
    const h = await harness();
    const c = await campaignFrom(h);
    expect((await withdraw(h, c.id)).statusCode).toBe(409);
    await approve(h, c.id);
    expect((await advisories(h, ALICE)).body.advisories).toHaveLength(1);

    expect((await h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c.id}/withdraw`, payload: { analyst: 'Aisha Bello' } })).statusCode).toBe(401);
    for (const payload of [{}, { analyst: ' ' }, { analyst: 'Aisha', extra: 1 }]) expect((await withdraw(h, c.id, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    expect((await withdraw(h, 'cmp_missing')).statusCode).toBe(404);

    const events: Notice[] = [];
    h.sys.events.subscribe(h.sys.svc.advisoryChannel('demobank'), (n) => events.push(n));
    const w = await withdraw(h, c.id, { analyst: 'Musa Danjuma' });
    expect(w.statusCode).toBe(200);
    expect(w.json().advisory).toMatchObject({ status: 'withdrawn', withdrawnBy: 'Musa Danjuma', approvedBy: 'Aisha Bello' });
    expect((await advisories(h, ALICE)).body.advisories).toEqual([]);
    expect(events).toEqual([expect.objectContaining({ type: 'advisory.withdrawn', advisoryId: c.id })]);

    await h.sys.app.inject({ method: 'POST', url: '/v1/reports', headers: { authorization: `Bearer ${await h.customerToken(BOB)}` }, payload: { maskedText: 'DemoBank: restore at https://demobank-restore.com/now', consent: true } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: bank(h) });
    const [again] = (await h.sys.app.inject({ method: 'GET', url: '/v1/campaigns', headers: bank(h) })).json().campaigns;
    expect(again.advisory.status).toBe('withdrawn');
    expect((await advisories(h, ALICE)).body.advisories).toEqual([]);
  });

  it('ADV-4: an advisory expires after ADVISORY_TTL_DAYS and disappears', async () => {
    const h = await harness({ advisoryTtlDays: 2 });
    const c = await campaignFrom(h);
    const ok = (await approve(h, c.id)).json();
    expect(Date.parse(ok.advisory.expiresAt) - Date.parse(ok.advisory.approvedAt)).toBe(2 * DAY);
    h.clock.now = new Date(h.clock.now.getTime() + 2 * DAY - 1000);
    expect((await advisories(h, ALICE)).body.advisories).toHaveLength(1);
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    expect((await advisories(h, ALICE)).body.advisories).toEqual([]);

    expect(configFromEnv(demoEnv()).settings.advisoryTtlDays).toBe(14);
    expect(configFromEnv(demoEnv({ ADVISORY_TTL_DAYS: '3' })).settings.advisoryTtlDays).toBe(3);
    expect(() => configFromEnv(demoEnv({ ADVISORY_TTL_DAYS: '0' }))).toThrow(/ADVISORY_TTL_DAYS/);
  });

  it('ADV-5: the campaign agent still has no tool that sends, approves, publishes or withdraws', async () => {
    const tools = agentTools(new MemoryStore(), (await harness()).sys.model, { id: 'demobank', name: 'DemoBank', domains: [], senderIds: [], tokenKeys: { keys: [] } });
    expect(Object.keys(tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(AGENT_TOOL_NAMES).toHaveLength(4);
    for (const name of Object.keys(tools)) expect(name).not.toMatch(/send|approve|publish|notify|push|message|withdraw|broadcast/i);
    for (const f of ['packages/agent/src/index.ts', 'packages/api/src/campaigns.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/approveAdvisory|withdrawAdvisory|activeAdvisories|notifyAdvisory|tenantDevices|EventHub|events\.publish|\/send\b/);
    }

    const h = await harness();
    await device(h, ALICE, 'token-alice-0001');
    const events: Notice[] = [];
    h.sys.events.subscribe(h.sys.svc.advisoryChannel('demobank'), (n) => events.push(n));
    const c = await campaignFrom(h);
    await h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: bank(h) });
    expect(c.advisory.status).toBe('draft');
    expect(h.push.sent).toEqual([]);
    expect(events).toEqual([]);
    expect(h.messaging.sent).toEqual([]);
    expect((await advisories(h, ALICE)).body.advisories).toEqual([]);
  });

  it('ADV-6: advisory text must pass the secret gate, or it is neither approved nor shown', async () => {
    const h = await harness();
    await device(h, ALICE, 'token-alice-0001');
    const c = await campaignFrom(h);
    const bad = { ...(await h.sys.store.getCampaign('demobank', c.id))!, advisory: { ...c.advisory, text: 'To keep your DemoBank account open, reply with your PIN and the OTP we sent you.' } };
    await h.sys.store.putCampaign(bad);
    const r = await approve(h, c.id);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('unsafe_advisory');
    expect((await h.sys.store.getCampaign('demobank', c.id))!.advisory.status).toBe('draft');
    expect((await advisories(h, ALICE)).body.advisories).toEqual([]);
    expect(h.push.sent).toEqual([]);

    await h.sys.store.putCampaign({ ...bad, advisory: { ...bad.advisory, text: '  ' } });
    expect((await approve(h, c.id)).statusCode).toBe(422);

    await h.sys.store.putCampaign({ ...bad, advisory: { ...c.advisory } });
    expect((await approve(h, c.id)).statusCode).toBe(200);
    const [shown] = (await advisories(h, ALICE)).body.advisories;
    expect(unsafeBriefingText(shown.text)).toBe(false);
    const stored = (await h.sys.store.getCampaign('demobank', c.id))!;
    await h.sys.store.putCampaign({ ...stored, advisory: { ...stored.advisory, text: 'Send us your card number and PIN to stay safe.' } });
    expect((await advisories(h, ALICE)).body.advisories).toEqual([]);

    for (const lang of LANGUAGES) {
      for (const [k, v] of Object.entries(copyFor(lang).advisory)) {
        if (k.startsWith('_')) continue;
        expect(asksForSecret(v), `${lang} advisory.${k}`).toBe(false);
      }
    }
  });

  it('ADV-7: approval sends one notice per advisory: one push per device and one live event, never repeated', async () => {
    const h = await harness();
    await device(h, ALICE, 'token-alice-0001');
    await device(h, BOB, 'token-bob-0001');
    await device(h, BOB, 'token-dead-0001');
    h.push.dead.add('token-dead-0001');
    const events: Notice[] = [];
    h.sys.events.subscribe(h.sys.svc.advisoryChannel('demobank'), (n) => events.push(n));
    const c = await campaignFrom(h);

    expect((await approve(h, c.id)).statusCode).toBe(200);
    expect(h.push.sent.map((s) => s.token).sort()).toEqual(['token-alice-0001', 'token-bob-0001']);
    for (const s of h.push.sent) {
      expect(s.notice).toMatchObject({ type: 'advisory.published', advisoryId: c.id, bank: 'DemoBank', title: 'Fraud warning from DemoBank' });
      expect(JSON.stringify(s.notice)).not.toContain('demobank-restore');
    }
    expect(events.filter((e) => e.type === 'advisory.published')).toHaveLength(1);
    expect((await h.sys.store.tenantDevices('demobank')).map((d) => d.pushToken).sort()).toEqual(['token-alice-0001', 'token-bob-0001']);

    for (let i = 0; i < 5; i++) await advisories(h, ALICE);
    expect((await approve(h, c.id, 'Musa Danjuma')).statusCode).toBe(200);
    expect(h.push.sent).toHaveLength(2);
    await withdraw(h, c.id);
    expect(h.push.sent).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['advisory.published', 'advisory.published', 'advisory.withdrawn']);

    const msg = FcmPush.message('tok', h.push.sent[0]!.notice) as { notification: { title: string; body: string }; android: { notification: { channel_id: string } }; data: Record<string, string> };
    expect(msg.notification).toEqual({ title: 'Fraud warning from DemoBank', body: copy.advisory.pushBody });
    expect(msg.android.notification.channel_id).toBe('advisories');
    expect(msg.data).toMatchObject({ type: 'advisory.published', advisoryId: c.id, bank: 'DemoBank' });
  });

  it('ADV-7: the live event stream carries advisory notices to every app of the bank', async () => {
    const h = await harness();
    const c = await campaignFrom(h);
    await h.sys.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { port } = h.sys.app.server.address() as { port: number };
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/v1/events`, { headers: { authorization: `Bearer ${await h.customerToken(BOB)}` }, signal: ctrl.signal });
      const reader = res.body!.getReader();
      await reader.read();
      await approve(h, c.id);
      let text = '';
      while (!text.includes('advisory.published')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain(`"advisoryId":"${c.id}"`);
      ctrl.abort();
    } finally {
      await h.sys.app.close();
    }
  });

  it('ADV-8: a store failure is "cannot check", never an empty list', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async listCampaigns(...args: Parameters<MemoryStore['listCampaigns']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.listCampaigns(...args);
      }
    }
    const store = new BrokenStore();
    const h = await harness({ store });
    store.broken = true;
    const r = await advisories(h, ALICE);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('cannot_check');
    expect(r.body).not.toHaveProperty('advisories');
  });

  it('ADV-9: WhatsApp ALERTS lists the active advisories in the chosen language, with lookalike domains defanged', async () => {
    const h = await harness();
    const ask = async (body: string) => {
      const { raw, signature } = signedText(ALICE.slice(1), body);
      const r = await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
      expect(r.statusCode).toBe(200);
      return h.messaging.sent.at(-1)!.body;
    };
    expect(await ask('ALERTS')).toBe(fill(copy.advisory.botNone, { bank: 'DemoBank' }));
    const c = await campaignFrom(h);
    expect(await ask('alerts')).toBe(fill(copy.advisory.botNone, { bank: 'DemoBank' }));
    await approve(h, c.id);
    const reply = await ask('Alerts');
    expect(reply).toContain(fill(copy.advisory.botHeading, { bank: 'DemoBank' }));
    expect(reply).toContain(`${copy.advisory.lookalikeLabel}: ${defang('demobank-restore.com')}`);
    expect(reply).not.toContain('demobank-restore.com');
    expect(reply).toContain(fill(copy.advisory.botFooter, { bank: 'DemoBank' }));
    expect(asksForSecret(reply.replace(c.advisory.text.split('demobank-restore.com').join(defang('demobank-restore.com')), ''))).toBe(false);

    await ask('LANG HA');
    expect(await ask('ALERTS')).toContain(fill(copyFor('ha').advisory.botHeading, { bank: 'DemoBank' }));

    await withdraw(h, c.id);
    expect(await ask('ALERTS')).toBe(fill(copyFor('ha').advisory.botNone, { bank: 'DemoBank' }));
    expect(alertsReply([], 'DemoBank', 'yo')).toBe(fill(copyFor('yo').advisory.botNone, { bank: 'DemoBank' }));
  });

  it('ADV-9: WhatsApp ALERTS fails closed when the store cannot be read', async () => {
    class BrokenStore extends MemoryStore {
      override async listCampaigns(): Promise<never> {
        throw new Error('ECONNREFUSED');
      }
    }
    const h = await harness({ store: new BrokenStore() });
    const { raw, signature } = signedText(ALICE.slice(1), 'ALERTS');
    await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
    expect(h.messaging.sent.at(-1)!.body).toBe(`${copy.verdict.cannot_check.title}\n${copy.verdict.cannot_check.body}`);
  });
});
