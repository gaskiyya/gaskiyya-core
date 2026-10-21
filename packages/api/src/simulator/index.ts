import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey, type JWK } from 'jose';
import { contentDigest, lagosDate, receiptDigest } from '@gaskiya/canonical';
import { CALL_PURPOSES, CATEGORIES, type Category } from '@gaskiya/schemas';
import {
  advisoryToSend,
  DEMO_BANK_CODE,
  DEMO_CUSTOMERS,
  demoAccount,
  FAKE_CREDIT_ALERT,
  FAKE_TEMPLATES,
  fakeCustomerCareMessage,
  fakeReceipt,
  genuineTemplate,
  listFraudCalls,
  newFraudCall,
  recentSignIns,
  rememberSignIn,
  sessionId,
  tamper,
  type FraudCall,
  type Transfer,
} from './demo-data.ts';

export { advisoryToSend, DEMO_BANK_CODE, DEMO_CUSTOMERS, demoAccount, FAKE_CREDIT_ALERT, FAKE_TEMPLATES, fakeCustomerCareMessage, genuineTemplate, tamper, type FraudCall, type Transfer };
export { DEMO_BANKS, DEMO_ORGS, demoBank, demoTenant, type DemoBank } from './demo-banks.ts';

export interface SimOptions {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  bankName: string;
  domain?: string;
  lookalikeDomain?: string;
  demoLogin: boolean;
  logger?: boolean;
  ussdToken?: string;
  bankCode?: string;
  orgs?: SimOrg[];
  fakeCustomerCare?: { whatsapp: string; handle: string };
}

export interface SimOrg {
  tenantId: string;
  name: string;
  kind: 'bank' | 'agency' | 'company';
  domain?: string;
  clientId: string;
  clientSecret: string;
  sampleMessage?: string;
}

export interface InboxItem {
  id: string;
  from: string;
  text: string;
  at: string;
  kind: 'genuine' | 'tampered' | 'fake';
  category?: Category;
  channel: 'sms' | 'whatsapp';
  tenantId?: string;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function demoLoginFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIM_DEMO_LOGIN === 'true';
}

export function simOrgsFromEnv(env: Record<string, string | undefined> = process.env): Pick<SimOptions, 'orgs' | 'fakeCustomerCare'> {
  const json = <T>(name: string): T | undefined => {
    const v = env[name];
    if (!v) return undefined;
    try {
      return JSON.parse(v) as T;
    } catch {
      throw new Error(`${name} must be valid JSON (see .env.example)`);
    }
  };
  return { orgs: json<SimOrg[]>('SIM_ORGS'), fakeCustomerCare: json<{ whatsapp: string; handle: string }>('SIM_FAKE_CUSTOMER_CARE') };
}

const OPEN_ROUTES = new Set(['/sim/.well-known/jwks.json', '/sim/config', '/sim/organisations', '/sim/customer-token', '/sim/inbox', '/sim/registry/*']);

export const USSD_CODE = '*347*123#';

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message });
}

export async function buildSimulator(o: SimOptions) {
  const app = Fastify({
    logger: o.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info', serializers: { req: (r: { method: string; url: string }) => ({ method: r.method, path: r.url.split('?')[0] }) } },
  });
  return { app, ...(await registerSimulator(app, o)) };
}

export async function registerSimulator(app: FastifyInstance, o: SimOptions) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = randomUUID().slice(0, 8);
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

  const inbox = new Map<string, InboxItem[]>();
  const calls = new Map<string, { id: string; phone: string; purpose: string; code: string; status: string; agentRef: string; openedAt: string; expiresAt: string }>();
  const transfers: Transfer[] = [];
  const signedIn = new Map<string, string>();
  const fraudCalls = new Map<string, FraudCall>();
  const bankCode = o.bankCode ?? DEMO_BANK_CODE;
  const pushInbox = (phone: string, item: Omit<InboxItem, 'id' | 'at'>) => {
    const list = inbox.get(phone) ?? [];
    const full = { ...item, id: randomUUID(), at: new Date().toISOString() };
    list.unshift(full);
    inbox.set(phone, list.slice(0, 50));
    return full;
  };

  const orgs = new Map<string, SimOrg>([
    [o.tenantId, { tenantId: o.tenantId, name: o.bankName, kind: 'bank', domain: o.domain, clientId: o.clientId, clientSecret: o.clientSecret }],
    ...(o.orgs ?? []).filter((x) => x.tenantId !== o.tenantId).map((x): [string, SimOrg] => [x.tenantId, x]),
  ]);
  const bankTokens = new Map<string, { token: string; exp: number }>();
  async function bank(method: string, path: string, body?: unknown, tenantId: string = o.tenantId) {
    const org = orgs.get(tenantId)!;
    let bankToken = bankTokens.get(org.clientId);
    if (!bankToken || bankToken.exp < Date.now() + 30_000) {
      const r = await fetch(`${o.apiUrl}/v1/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: org.clientId, client_secret: org.clientSecret }),
      });
      if (!r.ok) throw Object.assign(new Error('Registry rejected the simulator credentials'), { statusCode: 502 });
      const t = (await r.json()) as { access_token: string; expires_in: number };
      bankToken = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
      bankTokens.set(org.clientId, bankToken);
    }
    const r = await fetch(`${o.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bankToken.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json', 'idempotency-key': randomUUID() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = r.status === 204 ? null : await r.json();
    return { status: r.status, data };
  }

  async function signCustomer(phone: string, key: CryptoKey = privateKey, tenantId: string = o.tenantId) {
    return new SignJWT({ accts: [demoAccount(phone)] })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(tenantId)
      .setSubject(phone)
      .setAudience('gaskiya')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  }

  async function customerFrom(auth: string | undefined): Promise<{ phone: string; tenantId: string } | null> {
    if (!auth?.startsWith('Bearer ')) return null;
    try {
      const { payload } = await jwtVerify(auth.slice(7), publicKey, { issuer: [...orgs.keys()], audience: 'gaskiya' });
      return typeof payload.sub === 'string' && typeof payload.iss === 'string' ? { phone: payload.sub, tenantId: payload.iss } : null;
    } catch {
      return null;
    }
  }

  const phoneOk = (p: unknown): p is string => typeof p === 'string' && /^\+[1-9]\d{6,14}$/.test(p);

  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/sim/')) {
      reply.header('access-control-allow-origin', '*');
      reply.header('access-control-allow-headers', 'authorization, content-type');
      reply.header('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
    }
  });
  app.options('/sim/*', async (_req, reply) => reply.code(204).send());

  app.addHook('onRequest', async (req, reply) => {
    if (o.demoLogin || req.method === 'OPTIONS') return;
    const route = req.routeOptions.url;
    if (!route?.startsWith('/sim/') || OPEN_ROUTES.has(route)) return;
    if (LOOPBACK.has(req.socket.remoteAddress ?? '')) return;
    return fail(reply, 403, 'forbidden', 'The bank sandbox is available only on this machine while demo login is off');
  });

  app.get('/sim/.well-known/jwks.json', async () => ({ keys: [jwk] }));

  app.get('/sim/config', async () => ({
    bank: { id: o.tenantId, name: o.bankName, domain: o.domain, bankCode },
    apiUrl: o.apiUrl,
    customers: DEMO_CUSTOMERS,
    categories: CATEGORIES,
    purposes: CALL_PURPOSES,
    ussdCode: USSD_CODE,
    orgs: [...orgs.values()].map((x) => ({ id: x.tenantId, name: x.name, kind: x.kind })),
    fakeCustomerCare: o.fakeCustomerCare ?? null,
    simSwap: true,
  }));

  app.get('/sim/organisations', async (_req, reply) => {
    const r = await fetch(`${o.apiUrl}/v1/organisations`);
    return reply.code(r.status).send(await r.json());
  });

  app.post<{ Body: { phone?: string; tenantId?: string }; Querystring: { tenant?: string } }>('/sim/customer-token', async (req, reply) => {
    if (!o.demoLogin) return fail(reply, 404, 'not_found', 'Demo login is off');
    const phone = req.body?.phone;
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    const org = orgs.get(req.query.tenant ?? req.body?.tenantId ?? o.tenantId);
    if (!org) return fail(reply, 404, 'not_found', 'Unknown organisation');
    rememberSignIn(signedIn, phone);
    return { token: await signCustomer(phone, privateKey, org.tenantId), expiresIn: 600, bank: { id: org.tenantId, name: org.name }, apiUrl: o.apiUrl };
  });

  app.get('/sim/customers/recent', async () => ({ customers: recentSignIns(signedIn) }));

  app.get('/sim/inbox', async (req, reply) => {
    const who = await customerFrom(req.headers.authorization);
    if (!who) return fail(reply, 401, 'unauthorized', 'Customer token required');
    return { items: (inbox.get(who.phone) ?? []).filter((i) => (i.tenantId ?? o.tenantId) === who.tenantId) };
  });

  app.get<{ Querystring: { phone?: string } }>('/sim/inbox/admin', async (req) => {
    return { items: inbox.get(req.query.phone ?? '') ?? [] };
  });

  app.post<{ Body: { phone?: string; category?: Category; text?: string; channel?: 'sms' | 'whatsapp'; org?: string } }>('/sim/send', async (req, reply) => {
    const { phone, category = 'transaction_alert', channel = 'sms' } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    if (!CATEGORIES.includes(category)) return fail(reply, 400, 'invalid_request', 'unknown category');
    const org = orgs.get(req.body?.org ?? o.tenantId);
    if (!org) return fail(reply, 400, 'invalid_request', 'unknown organisation');
    const tpl = genuineTemplate(category, org.name, phone, new Date(), org.domain);
    const text = req.body?.text?.trim() || (org.tenantId !== o.tenantId && org.sampleMessage) || tpl.text;
    const domains = [...text.matchAll(/https?:\/\/(?:www\.)?([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase());
    const t0 = performance.now();
    const reg = await bank(
      'POST',
      '/v1/messages',
      {
        recipient: phone,
        channel,
        contentDigest: contentDigest(text),
        category,
        hasLink: domains.length > 0,
        linkDomains: [...new Set(domains)],
        asksCallback: tpl.asksCallback,
        sentAt: new Date().toISOString(),
      },
      org.tenantId,
    );
    if (reg.status >= 300) return reply.code(502).send(reg.data);
    const item = pushInbox(phone, { from: org.name, text, kind: 'genuine', category, channel, ...(org.tenantId !== o.tenantId ? { tenantId: org.tenantId } : {}) });
    const d = reg.data as { recordId: string; simSwapWarning?: boolean; simSwapStatus?: string };
    return {
      item,
      recordId: d.recordId,
      registrationMs: Math.round(performance.now() - t0),
      ...(d.simSwapWarning !== undefined ? { simSwapWarning: d.simSwapWarning, simSwapStatus: d.simSwapStatus } : {}),
    };
  });

  app.post<{ Body: { phone?: string; itemId?: string } }>('/sim/send-tampered', async (req, reply) => {
    const { phone, itemId } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    const list = inbox.get(phone) ?? [];
    const source = (itemId ? list.find((i) => i.id === itemId) : list.find((i) => i.kind === 'genuine')) ?? null;
    const text = source ? tamper(source.text) : tamper(genuineTemplate('service_update', o.bankName, phone, new Date(), o.domain).text);
    return { item: pushInbox(phone, { from: o.bankName, text, kind: 'tampered', category: source?.category, channel: source?.channel ?? 'sms' }) };
  });

  app.post<{ Body: { phone?: string; template?: number | 'credit_alert' } }>('/sim/send-fake', async (req, reply) => {
    const { phone, template = 0 } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    if (template === 'credit_alert') return { item: pushInbox(phone, { from: o.bankName, text: FAKE_CREDIT_ALERT(o.bankName, phone), kind: 'fake', category: 'transaction_alert', channel: 'sms' }) };
    const n = Number(template);
    const tpl = FAKE_TEMPLATES[(Number.isInteger(n) && n >= 0 ? n : 0) % FAKE_TEMPLATES.length]!;
    return { item: pushInbox(phone, { from: o.bankName, text: tpl(o.bankName, o.lookalikeDomain), kind: 'fake', channel: 'sms' }) };
  });

  app.post<{ Body: { phone?: string } }>('/sim/send-fake-care', async (req, reply) => {
    const { phone } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    if (!o.fakeCustomerCare) return fail(reply, 404, 'not_found', 'This demo bank has no fake customer care number');
    const text = fakeCustomerCareMessage(o.bankName, o.fakeCustomerCare.whatsapp);
    return { item: pushInbox(phone, { from: o.bankName, text, kind: 'fake', channel: 'sms' }), contact: o.fakeCustomerCare };
  });

  app.post<{ Body: { phone?: string; purpose?: string; agentRef?: string } }>('/sim/calls', async (req, reply) => {
    const { phone, purpose = 'card_activation', agentRef = 'agent-017' } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    const r = await bank('POST', '/v1/calls', { recipient: phone, purpose, agentRef });
    if (r.status >= 300) return reply.code(502).send(r.data);
    const d = r.data as { id: string; code: string; status: string; expiresAt: string };
    const call = { ...d, phone, purpose, agentRef, openedAt: new Date().toISOString() };
    calls.set(d.id, call);
    return call;
  });

  app.patch<{ Params: { id: string }; Body: { status?: 'answered' | 'ended' } }>('/sim/calls/:id', async (req, reply) => {
    const status = req.body?.status;
    if (status !== 'answered' && status !== 'ended') return fail(reply, 400, 'invalid_request', 'status must be answered or ended');
    const r = await bank('PATCH', `/v1/calls/${encodeURIComponent(req.params.id)}`, { status });
    if (r.status >= 300) return reply.code(r.status).send(r.data);
    const c = calls.get(req.params.id);
    if (c) Object.assign(c, r.data);
    return r.data;
  });

  app.get('/sim/calls', async () => ({ calls: [...calls.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 20) }));

  app.post<{ Body: { phone?: string; from?: string } }>('/sim/fraud-calls', async (req, reply) => {
    const r = newFraudCall(req.body ?? {}, randomUUID());
    if (!r.ok) return fail(reply, 400, 'invalid_request', r.message);
    fraudCalls.set(r.call.id, r.call);
    return r.call;
  });
  app.get('/sim/fraud-calls', async () => ({ calls: listFraudCalls(fraudCalls) }));
  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/sim/fraud-calls/:id', async (req, reply) => {
    const c = fraudCalls.get(req.params.id);
    if (!c) return fail(reply, 404, 'not_found', 'No such call');
    const status = req.body?.status;
    if (status !== 'answered' && status !== 'ended') return fail(reply, 400, 'invalid_request', 'status must be answered or ended');
    c.status = status;
    return c;
  });

  const customerName = (phone: string) => DEMO_CUSTOMERS.find((c) => c.phone === phone)?.name ?? phone;
  app.post<{ Body: { from?: string; to?: string; amountKobo?: number } }>('/sim/transfers', async (req, reply) => {
    const { from, to, amountKobo } = req.body ?? {};
    if (!phoneOk(from) || !phoneOk(to) || from === to) return fail(reply, 400, 'invalid_request', 'from and to must be two different E.164 numbers');
    if (!Number.isSafeInteger(amountKobo) || amountKobo! < 100 || amountKobo! > 100_000_000_000) return fail(reply, 400, 'invalid_request', 'amountKobo must be between 100 and 100,000,000,000');
    const now = new Date();
    const t: Transfer = {
      id: randomUUID(),
      kind: 'genuine',
      payer: customerName(from),
      merchant: to,
      account: demoAccount(to),
      amountKobo: amountKobo!,
      reference: sessionId(bankCode, now),
      valueDate: lagosDate(now),
      at: now.toISOString(),
      registered: false,
      check: null,
    };
    const r = await bank('POST', '/v1/receipts', {
      receiptDigest: receiptDigest({ beneficiaryAccount: t.account, beneficiaryBank: bankCode, amountKobo: t.amountKobo, reference: t.reference, valueDate: t.valueDate }),
      beneficiaryAccount: t.account,
      beneficiaryBank: bankCode,
    });
    if (r.status >= 300) return reply.code(502).send(r.data);
    t.registered = (r.data as { stored?: boolean }).stored === true;
    transfers.unshift(t);
    transfers.splice(30);
    return { transfer: t };
  });

  app.post<{ Body: { id?: string; kind?: 'fake_amount' | 'fake_reference' } }>('/sim/transfers/fake', async (req, reply) => {
    const { id, kind } = req.body ?? {};
    if (kind !== 'fake_amount' && kind !== 'fake_reference') return fail(reply, 400, 'invalid_request', 'kind must be fake_amount or fake_reference');
    const source = id ? transfers.find((t) => t.id === id) : transfers.find((t) => t.kind === 'genuine');
    if (!source) return fail(reply, 404, 'not_found', 'Make a genuine transfer first');
    const t = fakeReceipt(source, kind, bankCode, randomUUID());
    transfers.unshift(t);
    transfers.splice(30);
    return { transfer: t };
  });

  app.post<{ Params: { id: string } }>('/sim/transfers/:id/check', async (req, reply) => {
    const t = transfers.find((x) => x.id === req.params.id);
    if (!t) return fail(reply, 404, 'not_found', 'No such transfer');
    const token = await signCustomer(t.merchant);
    const r = await fetch(`${o.apiUrl}/v1/verify/receipt`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        beneficiaryAccount: t.account,
        receiptDigest: receiptDigest({ beneficiaryAccount: t.account, beneficiaryBank: bankCode, amountKobo: t.amountKobo, reference: t.reference, valueDate: t.valueDate }),
      }),
    });
    const body = (await r.json().catch(() => ({}))) as Transfer['check'] & object;
    t.check = r.ok && body && ['received', 'not_confirmed', 'cannot_check'].includes(body.verdict) ? body : { verdict: 'cannot_check' };
    return { transfer: t };
  });

  app.get('/sim/transfers', async () => ({ transfers }));

  app.get('/sim/campaigns', async (_req, reply) => {
    const r = await bank('GET', '/v1/campaigns');
    return reply.code(r.status).send(r.data);
  });
  app.post('/sim/agent/run', async (_req, reply) => {
    const r = await bank('POST', '/v1/agent/run', {});
    return reply.code(r.status).send(r.data);
  });
  app.post<{ Params: { id: string }; Body: { channel?: 'sms' | 'whatsapp' } }>('/sim/campaigns/:id/send', async (req, reply) => {
    const channel = req.body?.channel ?? 'sms';
    if (channel !== 'sms' && channel !== 'whatsapp') return fail(reply, 400, 'invalid_request', 'channel must be sms or whatsapp');
    const list = await bank('GET', '/v1/campaigns');
    if (list.status >= 300) return reply.code(502).send(list.data);
    const campaign = (list.data as { campaigns: { id: string; advisory: { status: string; text: string; expiresAt?: string | null } }[] }).campaigns.find((c) => c.id === req.params.id);
    const ready = advisoryToSend(campaign);
    if (!ready.ok) return fail(reply, ready.status, ready.code, ready.message);
    const sentAt = new Date().toISOString();
    const reg = await bank('POST', '/v1/messages/batch', {
      messages: DEMO_CUSTOMERS.map((c) => ({
        recipient: c.phone,
        channel,
        contentDigest: contentDigest(ready.text),
        category: 'security_notice',
        hasLink: false,
        linkDomains: [],
        asksCallback: false,
        sentAt,
      })),
    });
    if (reg.status >= 300) return reply.code(502).send(reg.data);
    const records = (reg.data as { records: { recordId: string }[] }).records;
    const sent = DEMO_CUSTOMERS.map((c, i) => ({
      phone: c.phone,
      recordId: records[i]!.recordId,
      item: pushInbox(c.phone, { from: o.bankName, text: ready.text, kind: 'genuine', category: 'security_notice', channel }),
    }));
    return { sent: sent.length, channel, text: ready.text, messages: sent };
  });

  app.post<{ Params: { id: string; action: string } }>('/sim/campaigns/:id/:action', async (req, reply) => {
    if (!['approve', 'dismiss', 'withdraw'].includes(req.params.action)) return fail(reply, 404, 'not_found', 'Unknown action');
    const analyst = (req.body as { analyst?: unknown } | undefined)?.analyst;
    const body = req.params.action === 'dismiss' ? {} : { analyst: typeof analyst === 'string' ? analyst : '' };
    const r = await bank('POST', `/v1/campaigns/${encodeURIComponent(req.params.id)}/${req.params.action}`, body);
    return reply.code(r.status).send(r.data);
  });
  app.get('/sim/alerts', async (_req, reply) => {
    const r = await bank('GET', '/v1/registration-alerts');
    return reply.code(r.status).send(r.data);
  });
  app.get('/sim/metrics', async (_req, reply) => {
    const r = await bank('GET', '/v1/metrics');
    return reply.code(r.status).send(r.data);
  });

  app.post('/sim/seed-reports', async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const c = DEMO_CUSTOMERS[i]!;
      const text = FAKE_TEMPLATES[i]!(o.bankName, o.lookalikeDomain);
      const token = await signCustomer(c.phone);
      const r = await fetch(`${o.apiUrl}/v1/reports`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ maskedText: text.replace(/\d{4,}/g, (m) => '#'.repeat(m.length)), consent: true, indicators: ['non_bank_link', 'urgency_or_threat'] }),
      });
      results.push(r.status);
    }
    return { reported: results.filter((s) => s === 201).length };
  });

  const DEVICE_ROUTES = new Set(['GET /v1/calls/open', 'GET /v1/activity', 'GET /v1/advisories', 'POST /v1/verify/message', 'POST /v1/verify/link', 'POST /v1/verify/contact', 'POST /v1/verify/receipt', 'POST /v1/verify/licence', 'POST /v1/explain', 'POST /v1/reports']);
  app.route<{ Params: { '*': string } }>({
    method: ['GET', 'POST'],
    url: '/sim/registry/*',
    handler: async (req, reply) => {
      const path = `/${req.params['*']}`;
      if (!DEVICE_ROUTES.has(`${req.method} ${path}`)) return fail(reply, 404, 'not_found', 'Not found');
      const r = await fetch(`${o.apiUrl}${path}`, {
        method: req.method,
        headers: { authorization: req.headers.authorization ?? '', ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
      });
      return reply.code(r.status).send(await r.json().catch(() => ({})));
    },
  });

  app.post<{ Body: { phone?: string; text?: string; sessionId?: string } }>('/sim/ussd', async (req, reply) => {
    const { phone, text = '', sessionId = randomUUID() } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    if (typeof text !== 'string' || text.length > 160 || typeof sessionId !== 'string') return fail(reply, 400, 'invalid_request', 'text and sessionId must be short strings');
    if (!o.ussdToken) return fail(reply, 503, 'ussd_off', 'USSD is off: set USSD_WEBHOOK_TOKEN for the registry and the console');
    const r = await fetch(`${o.apiUrl}/webhooks/ussd?token=${encodeURIComponent(o.ussdToken)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId: sessionId.slice(0, 64), serviceCode: USSD_CODE, phoneNumber: phone, networkCode: '62130', text }).toString(),
    });
    if (!r.ok) return fail(reply, 502, 'ussd_rejected', `The registry refused the USSD callback (${r.status})`);
    return { screen: await r.text() };
  });

  app.post<{ Body: { phone?: string; action?: 'swap' | 'restore' } }>('/sim/sim-swap', async (req, reply) => {
    const { phone, action = 'swap' } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    const r = await bank('POST', '/v1/admin/sim-swap', { phone, action });
    return reply.code(r.status).send(r.data);
  });

  app.post<{ Body: { phone?: string; maxAgeHours?: number } }>('/sim/sim-swap/check', async (req, reply) => {
    const { phone, maxAgeHours } = req.body ?? {};
    if (!phoneOk(phone)) return fail(reply, 400, 'invalid_request', 'phone must be E.164');
    const r = await bank('POST', '/v1/sim-swap/check', { phone, ...(maxAgeHours !== undefined ? { maxAgeHours } : {}) });
    return reply.code(r.status).send(r.data);
  });

  app.post('/sim/reset', async (_req, reply) => {
    inbox.clear();
    calls.clear();
    fraudCalls.clear();
    transfers.length = 0;
    const r = await bank('POST', '/v1/admin/reset', {});
    return reply.code(r.status).send(r.data);
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode ?? 502;
    void fail(reply, status, 'simulator_error', status >= 500 ? `Registry unavailable: ${err.message}` : err.message);
  });

  return { signCustomer, inbox };
}
