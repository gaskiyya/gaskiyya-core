import { lagosDate, receiptDigest } from '@gaskiya/canonical';
import { ApproveAdvisory, CALL_PURPOSES, CATEGORIES, Explain, OpenCall, RegisterMessage, SimSwapCheck, SimSwapDemo, SubmitReport, UpdateCall, VerifyContact, VerifyLicence, VerifyLink, VerifyMessage, VerifyReceipt, WithdrawAdvisory, type Category } from '@gaskiya/schemas';
import { BUNDLED_LICENCES } from '@gaskiya/licences/bundled';
import type { z } from 'zod';
import { NoModelProvider } from '../../../packages/api/src/ai/provider.ts';
import { runAgentForAll } from '../../../packages/api/src/campaigns.ts';
import { EventHub, MemoryPush } from '../../../packages/api/src/channels/channels.ts';
import { StaticKeyService } from '../../../packages/api/src/keys/keys.ts';
import { deriveConsoleCode } from '../../../packages/api/src/console/code.ts';
import { RegistrationGuard } from '../../../packages/api/src/guard.ts';
import { AdvisoryError, CallInProgressError, GaskiyaService } from '../../../packages/api/src/service.ts';
import { DEFAULT_SIM_SWAP, SimSwapMonitor } from '../../../packages/api/src/simswap/monitor.ts';
import { SimulatedMno } from '../../../packages/api/src/simswap/simswap.ts';
import { MemoryStore } from '../../../packages/api/src/store/memory.ts';
import type { Tenant } from '../../../packages/api/src/store/types.ts';
import { handleUssd } from '../../../packages/api/src/ussd.ts';
import { MemoryLicenceRegistry } from '../../../packages/api/src/licences/registry.ts';
import {
  advisoryToSend,
  APP_USERS_LISTED,
  appUserView,
  DEMO_BANK_CODE,
  DEMO_CUSTOMERS,
  demoAccount,
  FAKE_CREDIT_ALERT,
  FAKE_TEMPLATES,
  fakeCustomerCareMessage,
  fakeReceipt,
  forgedReceipt,
  genuineTemplate,
  listFraudCalls,
  newFraudCall,
  sessionId,
  tamper,
  type FraudCall,
  type Transfer,
} from '../../../packages/api/src/simulator/demo-data.ts';
import { DEMO_BANKS, demoTenant } from '../../../packages/api/src/simulator/demo-banks.ts';

const USSD_CODE = '*347*123#';
import { contentDigest } from '../device/digest.ts';

export interface Reply {
  status: number;
  body?: unknown;
}

interface InboxItem {
  id: string;
  from: string;
  text: string;
  at: string;
  kind: 'genuine' | 'tampered' | 'fake';
  category?: Category;
  channel: 'sms' | 'whatsapp';
  tenantId?: string;
}

const BANK: Tenant = { ...demoTenant(DEMO_BANKS.demobank!), bankCode: DEMO_BANK_CODE };
const FAKE_CARE = DEMO_BANKS.demobank!.fakeCustomerCare!;
const phoneOk = (p: unknown): p is string => typeof p === 'string' && /^\+[1-9]\d{6,14}$/.test(p);
const fail = (status: number, code: string, message: string): Reply => ({ status, body: { code, message } });

function parse<T extends z.ZodType>(schema: T, body: unknown): { ok: true; value: z.infer<T> } | { ok: false; reply: Reply } {
  const r = schema.safeParse(body ?? {});
  if (r.success) return { ok: true, value: r.data };
  const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || 'body'))].join(', ');
  return { ok: false, reply: fail(400, 'invalid_request', `Invalid fields: ${fields}`) };
}

export function createSandbox() {
  const store = new MemoryStore();
  const keys = StaticKeyService.random([BANK.id]);
  const tenants = new Map([[BANK.id, BANK]]);
  const model = new NoModelProvider();
  const svc = new GaskiyaService(tenants, store, keys, model, new MemoryPush(), new EventHub(), { recordTtlDays: 30, callRingSeconds: 180, callMaxSeconds: 7200, aiTimeoutMs: 4000, registerMaxFutureSeconds: 300 }, { warn: () => {}, error: () => {} });

  svc.guard = new RegistrationGuard(store);
  svc.licences = { registry: new MemoryLicenceRegistry(BUNDLED_LICENCES), maxAgeDays: 120 };

  const at = new Date().toISOString();
  for (const c of DEMO_CUSTOMERS.slice(0, 2).reverse()) void store.recordAppUser(BANK.id, c.phone, at);

  const mno = new SimulatedMno();
  svc.simSwap = new SimSwapMonitor(mno, DEFAULT_SIM_SWAP, { clock: () => new Date(), log: { warn: () => {} }, count: (t, k) => void store.countSimSwap(t, k) });

  const inbox = new Map<string, InboxItem[]>();
  const calls = new Map<string, { id: string; phone: string; purpose: string; code: string; status: string; agentRef: string; openedAt: string; expiresAt: string }>();
  const tokens = new Map<string, { phone: string; tenantId: string; exp: number }>();
  const fraudCalls = new Map<string, FraudCall>();
  const checks: number[] = [];
  const transfers: Transfer[] = [];
  const receiptOf = (t: Transfer) =>
    receiptDigest({ beneficiaryAccount: t.account, beneficiaryBank: DEMO_BANK_CODE, amountKobo: t.amountKobo, reference: t.reference, valueDate: t.valueDate });

  const pushInbox = (phone: string, item: Omit<InboxItem, 'id' | 'at'>) => {
    const list = inbox.get(phone) ?? [];
    const full = { ...item, id: crypto.randomUUID(), at: new Date().toISOString() };
    list.unshift(full);
    inbox.set(phone, list.slice(0, 50));
    return full;
  };
  const session = (auth: string | null) => {
    const t = auth?.startsWith('Bearer ') ? tokens.get(auth.slice(7)) : undefined;
    return t && t.exp > Date.now() ? t : null;
  };
  const customer = (auth: string | null) => session(auth)?.phone ?? null;
  const limited = () => {
    const now = Date.now();
    while (checks.length && checks[0]! < now - 60_000) checks.shift();
    checks.push(now);
    return checks.length > 30;
  };

  async function register(phone: string, category: Category, text: string, channel: 'sms' | 'whatsapp' = 'sms', org: Tenant = BANK) {
    const tpl = genuineTemplate(category, org.name, phone);
    const domains = [...text.matchAll(/https?:\/\/(?:www\.)?([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase());
    const input = parse(RegisterMessage, {
      recipient: phone,
      channel,
      contentDigest: await contentDigest(text),
      category,
      hasLink: domains.length > 0,
      linkDomains: [...new Set(domains)],
      asksCallback: tpl.asksCallback,
      sentAt: new Date().toISOString(),
    });
    if (!input.ok) throw new Error('registration rejected');
    return svc.registerMessage(org.id, input.value);
  }

  async function handle(method: string, url: URL, body: unknown, auth: string | null): Promise<Reply> {
    const path = url.pathname;
    const b = (body ?? {}) as Record<string, unknown>;

    if (path.startsWith('/sim/registry/v1/')) {
      const phone = customer(auth);
      if (!phone) return fail(401, 'unauthorized', 'Valid customer token required');
      const route = `${method} ${path.slice('/sim/registry'.length)}`;
      const rated = ['POST /v1/verify/message', 'POST /v1/verify/link', 'POST /v1/verify/contact', 'POST /v1/verify/receipt', 'POST /v1/verify/licence', 'POST /v1/explain'].includes(route);
      if (rated && limited()) return fail(429, 'rate_limited', 'Too many checks. Try again in a minute.');
      switch (route) {
        case 'POST /v1/verify/message': {
          const v = parse(VerifyMessage, body);
          return v.ok ? { status: 200, body: await svc.verifyDigest(BANK.id, phone, v.value.contentDigest, 'app') } : v.reply;
        }
        case 'POST /v1/verify/link': {
          const v = parse(VerifyLink, body);
          return v.ok ? { status: 200, body: { ...svc.verifyLink(BANK, phone, v.value.url, 'app'), bank: BANK.name } } : v.reply;
        }
        case 'POST /v1/verify/licence': {
          const v = parse(VerifyLicence, body);
          return v.ok ? { status: 200, body: await svc.checkLicence(BANK, phone, v.value.query, 'app') } : v.reply;
        }
        case 'POST /v1/verify/contact': {
          const v = parse(VerifyContact, body);
          if (!v.ok) return v.reply;
          const only = v.value.tenantId ? tenants.get(v.value.tenantId) : undefined;
          if (v.value.tenantId && !only) return fail(404, 'not_found', 'No such organisation');
          const r = await svc.verifyContact({ tenant: BANK, phone }, v.value.contact, 'app', only);
          return r ? { status: 200, body: r } : fail(422, 'not_a_contact', 'Not a phone number, email address, @handle or profile link');
        }
        case 'POST /v1/verify/receipt': {
          const v = parse(VerifyReceipt, body);
          if (!v.ok) return v.reply;
          const accounts = [demoAccount(phone)];
          if (!accounts.includes(v.value.beneficiaryAccount)) return fail(403, 'account_not_linked', 'That account is not linked to this customer at this bank');
          const digest =
            'receiptDigest' in v.value
              ? v.value.receiptDigest
              : receiptDigest({ ...v.value, beneficiaryBank: DEMO_BANK_CODE });
          return { status: 200, body: await svc.verifyReceipt(BANK, phone, accounts, v.value.beneficiaryAccount, digest, 'app') };
        }
        case 'POST /v1/explain': {
          const v = parse(Explain, body);
          return v.ok ? { status: 200, body: await svc.explain(BANK, v.value.maskedText, v.value.language) } : v.reply;
        }
        case 'POST /v1/reports': {
          const v = parse(SubmitReport, body);
          return v.ok ? { status: 201, body: await svc.submitReport(BANK, v.value) } : v.reply;
        }
        case 'GET /v1/calls/open':
          return { status: 200, body: await svc.openCallFor(BANK, phone, 'app') };
        case 'GET /v1/advisories':
          return { status: 200, body: { bank: BANK.name, advisories: await svc.activeAdvisories(BANK) } };
        case 'GET /v1/activity': {
          const { items, text } = await svc.activity(BANK, svc.recipientKeys(BANK.id, phone));
          return { status: 200, body: { recentActivity: items, activityText: text, bank: BANK.name } };
        }
        default:
          return fail(404, 'not_found', 'Not found');
      }
    }

    const callId = /^\/sim\/calls\/([^/]+)$/.exec(path)?.[1];
    const campaign = /^\/sim\/campaigns\/([^/]+)\/(approve|dismiss|withdraw|send)$/.exec(path);
    switch (true) {
      case method === 'GET' && path === '/sim/config':
        return {
          status: 200,
          body: {
            bank: { id: BANK.id, name: BANK.name, bankCode: DEMO_BANK_CODE },
            apiUrl: '(in this browser)',
            categories: CATEGORIES,
            purposes: CALL_PURPOSES,
            ussdCode: USSD_CODE,
            orgs: [{ id: BANK.id, name: BANK.name, kind: BANK.kind ?? 'bank' }],
            fakeCustomerCare: FAKE_CARE,
            simSwap: true,
            consoleCode: deriveConsoleCode(keys, BANK.id, 1),
          },
        };

      case method === 'GET' && path === '/sim/organisations':
        return {
          status: 200,
          body: {
            organisations: [...tenants.values()].map((t) => ({
              id: t.id,
              name: t.name,
              kind: t.kind ?? 'bank',
              domains: t.domains,
              senderIds: t.senderIds,
              officialContacts: { phones: t.officialContacts?.phones ?? [], whatsapp: t.officialContacts?.whatsapp ?? [], emails: t.officialContacts?.emails ?? [], social: t.officialContacts?.social ?? [] },
              officialApps: { android: t.officialApps?.android ?? [], ios: t.officialApps?.ios ?? [] },
              customerTokenUrl: null,
            })),
          },
        };

      case method === 'POST' && path === '/sim/customer-token': {
        if (!phoneOk(b.phone)) return fail(400, 'invalid_request', 'phone must be E.164');
        const token = crypto.randomUUID();
        tokens.set(token, { phone: b.phone, tenantId: BANK.id, exp: Date.now() + 600_000 });
        await store.recordAppUser(BANK.id, b.phone, new Date().toISOString());
        return { status: 200, body: { token, expiresIn: 600, bank: { id: BANK.id, name: BANK.name }, apiUrl: '' } };
      }

      case method === 'GET' && path === '/sim/customers/recent':
        return { status: 200, body: { customers: (await store.listAppUsers(BANK.id, APP_USERS_LISTED)).map(appUserView) } };

      case method === 'GET' && path === '/sim/inbox': {
        const who = session(auth);
        return who ? { status: 200, body: { items: (inbox.get(who.phone) ?? []).filter((i) => (i.tenantId ?? BANK.id) === who.tenantId) } } : fail(401, 'unauthorized', 'Customer token required');
      }
      case method === 'GET' && path === '/sim/inbox/admin':
        return { status: 200, body: { items: inbox.get(url.searchParams.get('phone') ?? '') ?? [] } };

      case method === 'POST' && path === '/sim/send': {
        const phone = b.phone;
        const category = (b.category as Category | undefined) ?? 'transaction_alert';
        if (!phoneOk(phone)) return fail(400, 'invalid_request', 'phone must be E.164');
        if (!CATEGORIES.includes(category)) return fail(400, 'invalid_request', 'unknown category');
        const org = tenants.get(typeof b.org === 'string' ? b.org : BANK.id);
        if (!org) return fail(400, 'invalid_request', 'unknown organisation');
        const text = (typeof b.text === 'string' && b.text.trim()) || genuineTemplate(category, org.name, phone).text;
        const t0 = performance.now();
        const reg = await register(phone, category, text, 'sms', org);
        const item = pushInbox(phone, { from: org.name, text, kind: 'genuine', category, channel: 'sms', ...(org !== BANK ? { tenantId: org.id } : {}) });
        return { status: 200, body: { item, recordId: reg.recordId, registrationMs: Math.max(1, Math.round(performance.now() - t0)), ...(reg.simSwap ? { simSwapWarning: reg.simSwap.warning, simSwapStatus: reg.simSwap.status } : {}) } };
      }

      case method === 'POST' && path === '/sim/send-tampered': {
        const phone = b.phone;
        if (!phoneOk(phone)) return fail(400, 'invalid_request', 'phone must be E.164');
        const list = inbox.get(phone) ?? [];
        const source = (typeof b.itemId === 'string' ? list.find((i) => i.id === b.itemId) : list.find((i) => i.kind === 'genuine')) ?? null;
        const text = source ? tamper(source.text) : tamper(genuineTemplate('service_update', BANK.name, phone).text);
        return { status: 200, body: { item: pushInbox(phone, { from: BANK.name, text, kind: 'tampered', category: source?.category, channel: source?.channel ?? 'sms' }) } };
      }

      case method === 'POST' && path === '/sim/send-fake': {
        const phone = b.phone;
        if (!phoneOk(phone)) return fail(400, 'invalid_request', 'phone must be E.164');
        if (b.template === 'credit_alert') return { status: 200, body: { item: pushInbox(phone, { from: BANK.name, text: FAKE_CREDIT_ALERT(BANK.name, phone), kind: 'fake', category: 'transaction_alert', channel: 'sms' }) } };
        const n = Number(b.template ?? 0);
        const tpl = FAKE_TEMPLATES[(Number.isInteger(n) && n >= 0 ? n : 0) % FAKE_TEMPLATES.length]!;
        return { status: 200, body: { item: pushInbox(phone, { from: BANK.name, text: tpl(BANK.name), kind: 'fake', channel: 'sms' }) } };
      }

      case method === 'POST' && path === '/sim/send-fake-care': {
        const phone = b.phone;
        if (!phoneOk(phone)) return fail(400, 'invalid_request', 'phone must be E.164');
        return { status: 200, body: { item: pushInbox(phone, { from: BANK.name, text: fakeCustomerCareMessage(BANK.name, FAKE_CARE.whatsapp), kind: 'fake', channel: 'sms' }), contact: FAKE_CARE } };
      }

      case method === 'POST' && path === '/sim/calls': {
        const v = parse(OpenCall, { recipient: b.phone, purpose: b.purpose ?? 'card_activation', agentRef: b.agentRef ?? 'agent-017' });
        if (!v.ok) return v.reply;
        let d: Awaited<ReturnType<typeof svc.openCall>>;
        try {
          d = await svc.openCall(BANK.id, v.value);
        } catch (err) {
          if (err instanceof CallInProgressError) return { status: 409, body: { code: err.code, message: err.message, call: err.call } };
          throw err;
        }
        const call = { ...d, phone: v.value.recipient, purpose: v.value.purpose, agentRef: v.value.agentRef, openedAt: new Date().toISOString() };
        calls.set(d.id, call);
        return { status: 200, body: call };
      }
      case method === 'PATCH' && Boolean(callId): {
        const v = parse(UpdateCall, body);
        if (!v.ok) return v.reply;
        const r = await svc.updateCall(BANK.id, callId!, v.value.status);
        if (!r) return fail(404, 'not_found', 'No such call session');
        const c = calls.get(callId!);
        if (c) Object.assign(c, r);
        return { status: 200, body: r };
      }
      case method === 'GET' && path === '/sim/calls':
        return { status: 200, body: { calls: [...calls.values()].sort((x, y) => y.openedAt.localeCompare(x.openedAt)).slice(0, 20) } };

      case method === 'POST' && path === '/sim/fraud-calls': {
        const r = newFraudCall(b, crypto.randomUUID());
        if (!r.ok) return fail(400, 'invalid_request', r.message);
        fraudCalls.set(r.call.id, r.call);
        return { status: 200, body: r.call };
      }
      case method === 'GET' && path === '/sim/fraud-calls':
        return { status: 200, body: { calls: listFraudCalls(fraudCalls) } };
      case method === 'PATCH' && /^\/sim\/fraud-calls\/[^/]+$/.test(path): {
        const c = fraudCalls.get(path.split('/')[3]!);
        if (!c) return fail(404, 'not_found', 'No such call');
        if (b.status !== 'answered' && b.status !== 'ended') return fail(400, 'invalid_request', 'status must be answered or ended');
        c.status = b.status;
        return { status: 200, body: c };
      }

      case method === 'POST' && path === '/sim/transfers': {
        const { from, to } = b;
        const amountKobo = Number(b.amountKobo);
        if (!phoneOk(from) || !phoneOk(to) || from === to) return fail(400, 'invalid_request', 'from and to must be two different E.164 numbers');
        if (!Number.isSafeInteger(amountKobo) || amountKobo < 100 || amountKobo > 100_000_000_000) return fail(400, 'invalid_request', 'amountKobo must be between 100 and 100,000,000,000');
        const now = new Date();
        const t: Transfer = {
          id: crypto.randomUUID(),
          kind: 'genuine',
          payer: from,
          merchant: to,
          account: demoAccount(to),
          amountKobo,
          reference: sessionId(DEMO_BANK_CODE, now),
          valueDate: lagosDate(now),
          at: now.toISOString(),
          registered: false,
          check: null,
        };
        const [r] = await svc.registerReceipts(BANK.id, [{ receiptDigest: receiptOf(t), beneficiaryAccount: t.account, beneficiaryBank: DEMO_BANK_CODE }], undefined, 'sandbox', true);
        t.registered = r!.receiptId !== null;
        transfers.unshift(t);
        transfers.splice(30);
        return { status: 200, body: { transfer: t } };
      }
      case method === 'POST' && path === '/sim/transfers/fake': {
        const kind = b.kind;
        if (kind !== 'fake_amount' && kind !== 'fake_reference') return fail(400, 'invalid_request', 'kind must be fake_amount or fake_reference');
        if (kind === 'fake_reference' && typeof b.id !== 'string' && b.from !== undefined) {
          const amountKobo = Number(b.amountKobo);
          if (!phoneOk(b.from) || !phoneOk(b.to) || b.from === b.to) return fail(400, 'invalid_request', 'from and to must be two different E.164 numbers');
          if (!Number.isSafeInteger(amountKobo) || amountKobo < 100 || amountKobo > 100_000_000_000) return fail(400, 'invalid_request', 'amountKobo must be between 100 and 100,000,000,000');
          const t = forgedReceipt(b.from, b.to, amountKobo, DEMO_BANK_CODE, crypto.randomUUID());
          transfers.unshift(t);
          transfers.splice(30);
          return { status: 200, body: { transfer: t } };
        }
        const source = typeof b.id === 'string' ? transfers.find((t) => t.id === b.id) : transfers.find((t) => t.kind === 'genuine');
        if (!source) return fail(404, 'not_found', 'Make a genuine transfer first');
        const t = fakeReceipt(source, kind, DEMO_BANK_CODE, crypto.randomUUID());
        transfers.unshift(t);
        transfers.splice(30);
        return { status: 200, body: { transfer: t } };
      }
      case method === 'POST' && /^\/sim\/transfers\/[^/]+\/check$/.test(path): {
        const t = transfers.find((x) => x.id === path.split('/')[3]);
        if (!t) return fail(404, 'not_found', 'No such transfer');
        t.check = await svc.verifyReceipt(BANK, t.merchant, [demoAccount(t.merchant)], t.account, receiptOf(t), 'app');
        return { status: 200, body: { transfer: t } };
      }
      case method === 'GET' && path === '/sim/transfers':
        return { status: 200, body: { transfers } };

      case method === 'GET' && path === '/sim/campaigns':
        return { status: 200, body: { campaigns: await store.listCampaigns(BANK.id) } };
      case method === 'POST' && path === '/sim/agent/run': {
        const [r] = await runAgentForAll(store, model, [BANK]);
        return { status: 200, body: { ...r, alertEmails: [] } };
      }
      case method === 'POST' && Boolean(campaign): {
        const [, id, action] = campaign!;
        if (action === 'send') {
          const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'sms';
          const ready = advisoryToSend((await store.getCampaign(BANK.id, id!)) ?? undefined);
          if (!ready.ok) return fail(ready.status, ready.code, ready.message);
          const messages = [];
          for (const cu of DEMO_CUSTOMERS) {
            const reg = await register(cu.phone, 'security_notice', ready.text, channel);
            messages.push({ phone: cu.phone, recordId: reg.recordId, item: pushInbox(cu.phone, { from: BANK.name, text: ready.text, kind: 'genuine', category: 'security_notice', channel }) });
          }
          return { status: 200, body: { sent: messages.length, channel, text: ready.text, messages } };
        }
        let c;
        try {
          if (action === 'approve' || action === 'withdraw') {
            const v = parse(action === 'approve' ? ApproveAdvisory : WithdrawAdvisory, body);
            if (!v.ok) return v.reply;
            c = action === 'approve' ? await svc.approveAdvisory(BANK.id, id!, v.value.analyst, 'sandbox') : await svc.withdrawAdvisory(BANK.id, id!, v.value.analyst);
          } else {
            c = await svc.dismissCampaign(BANK.id, id!);
          }
        } catch (err) {
          if (err instanceof AdvisoryError) return fail(err.statusCode, err.code, err.message);
          throw err;
        }
        return c ? { status: 200, body: c } : fail(404, 'not_found', 'No such campaign');
      }
      case method === 'GET' && path === '/sim/alerts':
        return { status: 200, body: { alerts: await svc.alerts(BANK.id) } };
      case method === 'GET' && path === '/sim/metrics':
        return { status: 200, body: await svc.metrics(BANK.id) };

      case method === 'POST' && path === '/sim/seed-reports': {
        let reported = 0;
        for (let i = 0; i < 3; i++) {
          const text = FAKE_TEMPLATES[i]!(BANK.name);
          const r = parse(SubmitReport, { maskedText: text.replace(/\d{4,}/g, (m) => '#'.repeat(m.length)), consent: true, indicators: ['non_bank_link', 'urgency_or_threat'] });
          if (r.ok) {
            await svc.submitReport(BANK, r.value);
            reported++;
          }
        }
        return { status: 200, body: { reported } };
      }

      case method === 'POST' && path === '/sim/ussd': {
        if (!phoneOk(b.phone)) return fail(400, 'invalid_request', 'phone must be E.164');
        const text = typeof b.text === 'string' ? b.text : '';
        return { status: 200, body: { screen: await handleUssd(svc, BANK, { take: async () => !limited() }, { phoneNumber: b.phone, text }) } };
      }

      case method === 'POST' && path === '/sim/sim-swap': {
        const v = parse(SimSwapDemo, body);
        if (!v.ok) return v.reply;
        svc.simSwap?.clear();
        if (v.value.action === 'restore') {
          mno.restore(v.value.phone);
          return { status: 200, body: { ok: true, latestSimChange: null } };
        }
        return { status: 200, body: { ok: true, latestSimChange: mno.swap(v.value.phone) } };
      }
      case method === 'POST' && path === '/sim/sim-swap/check': {
        const v = parse(SimSwapCheck, body);
        return v.ok ? { status: 200, body: await svc.checkSimSwap(BANK.id, v.value.phone, v.value.maxAgeHours) } : v.reply;
      }

      case method === 'POST' && path === '/sim/reset':
        inbox.clear();
        calls.clear();
        fraudCalls.clear();
        transfers.length = 0;
        mno.reset();
        svc.simSwap?.clear();
        await store.reset();
        return { status: 200, body: { ok: true } };

      default:
        return fail(404, 'not_found', 'Not found');
    }
  }

  return { handle };
}
