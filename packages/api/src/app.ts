import { createHash, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { contentDigest, receiptDigest, ReceiptFieldError } from '@gaskiya/canonical';
import {
  ApproveAdvisory,
  Explain,
  OpenCall,
  RegisterBatch,
  RegisterDevice,
  RegisterMessage,
  RegisterReceipt,
  RegisterReceiptBatch,
  SimSwapCheck,
  SimSwapDemo,
  SubmitReport,
  TestNotifications,
  WelcomeEmails,
  TokenRequest,
  UpdateCall,
  VerifyContact,
  VerifyIndicators,
  VerifyLicence,
  VerifyLink,
  VerifyMessage,
  VerifyReceipt,
  VerifyScreenshot,
  WithdrawAdvisory,
} from '@gaskiya/schemas';
import type { z } from 'zod';
import type { BankAuth, CustomerAuth } from './auth/auth.ts';
import { InvalidPushTokenError, MemoryPush, type EventHub, type Messaging, type Notice, type PushProvider } from './channels/channels.ts';
import type { Mailer } from './channels/email.ts';
import { senderWarnings } from './domain/sender.ts';
import { activitySummaryEmail, advisoryApprovedEmail, testEmail, welcomeEmail, type BuiltEmail, type EmailOptions } from './emails/templates.ts';
import type { RateLimiter, RateLimiterFactory } from './ratelimit/ratelimit.ts';
import { registerAdminRoutes, type AdminDeps } from './admin/routes.ts';
import type { GaskiyaService, Registered } from './service.ts';
import type { SimulatedMno } from './simswap/simswap.ts';
import { featureOn, isSuspended, type ApiCallEvent, type OrgFeature, type Tenant } from './store/types.ts';
import { cannotCheck, handleUssd } from './ussd.ts';
import { handleWhatsApp, validSignature } from './whatsapp.ts';

export interface AppDeps {
  svc: GaskiyaService;
  runAgent: (only?: Tenant[]) => Promise<{ results: { tenantId: string; campaignsTouched: string[]; reportsAssigned: number }[]; emails: { sent: number; failed: number } }>;
  agentJobToken?: string | null;
  push: PushProvider;
  mailer: Mailer | null;
  emailOptions?: EmailOptions;
  bankAuth: BankAuth;
  customerAuth: CustomerAuth;
  events: EventHub;
  verifyLimiter: RateLimiter;
  reportLimiter: RateLimiter;
  tokenLimiter: RateLimiter;
  simSwapLimiter: RateLimiter;
  simulatedMno?: SimulatedMno | null;
  messaging: Messaging;
  whatsapp: { verifyToken: string; appSecret: string; tenantId: string } | null;
  ussd: { token: string; tenantId: string } | null;
  allowDemoReset: boolean;
  corsOrigins: string[] | boolean;
  trustProxy?: boolean;
  logger?: boolean | object;
  logStream?: { write(line: string): void };
  admin?: AdminDeps | null;
  limiterFactory?: RateLimiterFactory;
  usage?: ((event: ApiCallEvent) => void) | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    bank?: { tenantId: string; clientId: string };
    errorCode?: string;
    customer?: { tenant: Tenant; phone: string; accounts: string[] };
  }
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(token).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

function validUssdToken(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || !given || !expected) return false;
  const h = (v: string) => createHash('sha256').update(v, 'utf8').digest();
  return timingSafeEqual(h(given), h(expected));
}
const BASE_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message });
}

function parse<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(body)'))].join(', ');
  void fail(reply, 400, 'invalid_request', `Invalid fields: ${fields}`);
  return undefined;
}

export function buildApp(deps: AppDeps) {
  const { svc, bankAuth, customerAuth, events, verifyLimiter, reportLimiter, tokenLimiter, simSwapLimiter } = deps;

  const configLoadedAt = svc.now().toISOString();

  const app = Fastify({
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: 12 * 1024 * 1024,
    logger:
      deps.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            ...(deps.logStream ? { stream: deps.logStream } : {}),
            serializers: {
              req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url.split('?')[0] }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            redact: { paths: ['req.headers', 'body', 'request.body'], remove: true },
          },
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error('Body is not valid JSON') as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'invalid_json';
      done(err, undefined);
    }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err: { message: err.message, code: err.code } }, 'request failed');
    void fail(reply, status, status === 413 ? 'too_large' : (err.code ?? 'error').toString().toLowerCase(), status >= 500 ? 'Internal error' : err.message);
  });
  app.setNotFoundHandler((_req, reply) => fail(reply, 404, 'not_found', 'Not found'));

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.bank && reply.statusCode >= 400 && typeof payload === 'string' && payload.length < 2000) {
      try {
        const code = (JSON.parse(payload) as { code?: unknown }).code;
        if (typeof code === 'string') req.errorCode = code.slice(0, 64);
      } catch {
      }
    }
    for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) reply.header(k, v);
    if (req.protocol === 'https') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('application/json') || type.startsWith('text/plain')) {
      reply.header('content-security-policy', API_CSP);
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  if (deps.usage) {
    const usage = deps.usage;
    app.addHook('onResponse', async (req, reply) => {
      if (!req.bank) return;
      usage({
        tenantId: req.bank.tenantId,
        clientId: req.bank.clientId,
        method: req.method,
        route: req.routeOptions.url ?? 'unknown',
        status: reply.statusCode,
        code: req.errorCode ?? null,
        at: svc.now().toISOString(),
      });
    });
  }

  void app.register(cors, { origin: deps.corsOrigins, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] });
  const corsHeader = (origin: string | undefined): Record<string, string> => {
    const o = deps.corsOrigins;
    if (o === true) return { 'access-control-allow-origin': origin ?? '*' };
    if (origin && Array.isArray(o) && o.includes(origin)) return { 'access-control-allow-origin': origin, vary: 'Origin' };
    return {};
  };

  const orgLimiters = new Map<string, RateLimiter>();
  const orgLimiter = (name: string, limit: number) => {
    const k = `${name}:${limit}`;
    let l = orgLimiters.get(k);
    if (!l) orgLimiters.set(k, (l = (deps.limiterFactory ?? (() => ({ take: async () => true })))(`${name}-${limit}`, limit)));
    return l;
  };

  const requireBank = async (req: FastifyRequest, reply: FastifyReply) => {
    const bank = await bankAuth.verify(req.headers.authorization);
    const tenant = bank ? svc.tenant(bank.tenantId) : undefined;
    if (!bank || !tenant) return fail(reply, 401, 'unauthorized', 'Valid bank credentials required');
    req.bank = bank;
    if (isSuspended(tenant)) return fail(reply, 403, 'org_suspended', 'This organisation is suspended on Gaskiyya. Contact Gaskiyya support.');
    const limit = tenant.limits?.bankApiPerMinute;
    if (limit && !(await orgLimiter('bank-api', limit).take(tenant.id, svc.now().getTime()))) {
      return fail(reply, 429, 'rate_limited', 'Too many requests for this organisation. Try again in a minute.');
    }
  };
  const needs = (feature: OrgFeature) => async (req: FastifyRequest, reply: FastifyReply) => {
    const tenant = svc.tenant(req.bank!.tenantId);
    if (!tenant || !featureOn(tenant, feature)) return fail(reply, 403, 'feature_disabled', `The ${feature} feature is not switched on for this organisation`);
  };
  const customerActive = async (req: FastifyRequest, reply: FastifyReply) => {
    if (isSuspended(svc.tenant(req.customer!.tenant.id) ?? req.customer!.tenant)) return fail(reply, 503, 'cannot_check', 'This cannot be checked right now');
  };
  const requireCustomer = async (req: FastifyRequest, reply: FastifyReply) => {
    const customer = await customerAuth.verify(req.headers.authorization);
    if (!customer) return fail(reply, 401, 'unauthorized', 'Valid customer token required');
    req.customer = customer;
  };
  const limitKey = (tenantId: string, phone: string) => `${tenantId}:${svc.hasKey(tenantId) ? svc.recipientKey(tenantId, phone) : 'no-key'}`;
  const rateLimited = async (req: FastifyRequest, reply: FastifyReply) => {
    const c = req.customer!;
    const own = c.tenant.limits?.customerChecksPerMinute;
    if (!(await (own ? orgLimiter('verify', own) : verifyLimiter).take(limitKey(c.tenant.id, c.phone), svc.now().getTime()))) {
      return fail(reply, 429, 'rate_limited', 'Too many checks. Try again in a minute.');
    }
  };
  const reportLimited = async (req: FastifyRequest, reply: FastifyReply) => {
    const c = req.customer!;
    if (!(await reportLimiter.take(limitKey(c.tenant.id, c.phone), svc.now().getTime()))) {
      return fail(reply, 429, 'rate_limited', 'Too many reports. Try again in a minute.');
    }
  };
  const tokenLimited = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await tokenLimiter.take(req.ip, svc.now().getTime()))) {
      return fail(reply, 429, 'rate_limited', 'Too many token requests. Try again in a minute.');
    }
  };
  const simSwapLimited = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await simSwapLimiter.take(`${req.bank!.tenantId}:${req.bank!.clientId}`, svc.now().getTime()))) {
      return fail(reply, 429, 'rate_limited', 'Too many SIM swap checks. Try again in a minute.');
    }
  };
  const registered = (r: Registered) => ({
    recordId: r.recordId,
    expiresAt: r.expiresAt,
    ...(r.simSwap ? { simSwapWarning: r.simSwap.warning, simSwapStatus: r.simSwap.status } : {}),
  });
  const idem = (req: FastifyRequest) => {
    const h = req.headers['idempotency-key'];
    return typeof h === 'string' && h.length > 0 && h.length <= 128 ? h : undefined;
  };

  const sendEmail = async (tenant: Tenant, mail: BuiltEmail, to: string[], idempotencyKey?: string) => {
    if (!deps.mailer) return { ok: false, error: 'Email is off: set RESEND_API_KEY and EMAIL_FROM' };
    if (to.length === 0) return { ok: false, error: `Tenant ${tenant.id} has no alertEmails` };
    try {
      const r = await deps.mailer.send({ to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey, tags: [{ name: 'type', value: mail.template }] });
      return { ok: true, id: r.id, to };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };
  const emailOpts = () => ({ ...deps.emailOptions, now: svc.now() });

  app.get('/health', async (req, reply) => {
    try {
      await svc.store.ping();
      return { ok: true };
    } catch (err) {
      req.log.warn({ err: { message: (err as Error).message } }, 'health check: store unreachable');
      return reply.code(503).send({ ok: false, code: 'store_unavailable', message: 'Store unreachable' });
    }
  });

  app.get('/v1/banks', async () => ({
    banks: [...svc.tenants.values()]
      .filter((t) => t.customerTokenUrl && !isSuspended(t))
      .map((t) => ({ id: t.id, name: t.name, kind: t.kind ?? 'bank', domains: t.domains, customerTokenUrl: t.customerTokenUrl, demoInboxUrl: t.demoInboxUrl ?? null, ...(t.mode === 'sandbox' ? { sandbox: true } : {}) })),
  }));

  app.get('/v1/organisations', async () => ({
    organisations: [...svc.tenants.values()].filter((t) => !isSuspended(t) && t.mode !== 'sandbox').map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind ?? 'bank',
      domains: t.domains,
      senderIds: t.senderIds ?? [],
      officialContacts: {
        phones: t.officialContacts?.phones ?? [],
        whatsapp: t.officialContacts?.whatsapp ?? [],
        emails: t.officialContacts?.emails ?? [],
        social: t.officialContacts?.social ?? [],
      },
      officialApps: { android: t.officialApps?.android ?? [], ios: t.officialApps?.ios ?? [] },
      customerTokenUrl: t.customerTokenUrl ?? null,
    })),
  }));

  app.post('/v1/oauth/token', { preHandler: tokenLimited }, async (req, reply) => {
    const body = parse(TokenRequest, req.body, reply);
    if (!body) return;
    const client = await bankAuth.authenticate(body.client_id, body.client_secret);
    const tenant = client ? svc.tenant(client.tenantId) : undefined;
    if (!client || !tenant) return fail(reply, 401, 'invalid_client', 'Unknown client or wrong secret');
    req.bank = client;
    if (isSuspended(tenant)) return fail(reply, 403, 'org_suspended', 'This organisation is suspended on Gaskiyya. Contact Gaskiyya support.');
    return bankAuth.sign(client);
  });

  app.post('/v1/messages', { preHandler: [requireBank, needs('messages')] }, async (req, reply) => {
    const body = parse(RegisterMessage, req.body, reply);
    if (!body) return;
    const r = await svc.registerMessage(req.bank!.tenantId, body, idem(req), req.bank!.clientId);
    return reply.code(r.created ? 202 : 200).send(registered(r));
  });

  app.post('/v1/messages/batch', { preHandler: [requireBank, needs('messages')] }, async (req, reply) => {
    const body = parse(RegisterBatch, req.body, reply);
    if (!body) return;
    const results = await svc.registerMessages(req.bank!.tenantId, body.messages, idem(req), req.bank!.clientId);
    return reply.code(202).send({ records: results.map(registered) });
  });

  app.post('/v1/sim-swap/check', { preHandler: [requireBank, needs('simSwap'), simSwapLimited] }, async (req, reply) => {
    const body = parse(SimSwapCheck, req.body ?? {}, reply);
    if (!body) return;
    return svc.checkSimSwap(req.bank!.tenantId, body.phone, body.maxAgeHours);
  });

  app.post('/v1/receipts', { preHandler: [requireBank, needs('receipts')] }, async (req, reply) => {
    const body = parse(RegisterReceipt, req.body, reply);
    if (!body) return;
    const [r] = await svc.registerReceipts(req.bank!.tenantId, [body], idem(req), req.bank!.clientId, true);
    if (r!.receiptId === null) return reply.code(200).send({ receiptId: null, expiresAt: null, stored: false, reason: r!.reason });
    return reply.code(r!.created ? 202 : 200).send({ receiptId: r!.receiptId, expiresAt: r!.expiresAt, stored: true });
  });

  app.post('/v1/receipts/batch', { preHandler: [requireBank, needs('receipts')] }, async (req, reply) => {
    const body = parse(RegisterReceiptBatch, req.body, reply);
    if (!body) return;
    const results = await svc.registerReceipts(req.bank!.tenantId, body.receipts, idem(req), req.bank!.clientId);
    return reply.code(202).send({
      receipts: results.map((r) =>
        r.receiptId === null ? { receiptId: null, expiresAt: null, stored: false, reason: r.reason } : { receiptId: r.receiptId, expiresAt: r.expiresAt, stored: true },
      ),
    });
  });

  app.post('/v1/calls', { preHandler: [requireBank, needs('calls')] }, async (req, reply) => {
    const body = parse(OpenCall, req.body, reply);
    if (!body) return;
    return reply.code(201).send(await svc.openCall(req.bank!.tenantId, body));
  });

  app.patch<{ Params: { id: string } }>('/v1/calls/:id', { preHandler: [requireBank, needs('calls')] }, async (req, reply) => {
    const body = parse(UpdateCall, req.body, reply);
    if (!body) return;
    const r = await svc.updateCall(req.bank!.tenantId, req.params.id, body.status);
    if (!r) return fail(reply, 404, 'not_found', 'No such call session');
    return r;
  });

  app.get('/v1/campaigns', { preHandler: requireBank }, async (req) => ({
    campaigns: await svc.store.listCampaigns(req.bank!.tenantId),
  }));

  app.post<{ Params: { id: string } }>('/v1/campaigns/:id/approve', { preHandler: [requireBank, needs('advisories')] }, async (req, reply) => {
    const body = parse(ApproveAdvisory, req.body ?? {}, reply);
    if (!body) return;
    const c = await svc.approveAdvisory(req.bank!.tenantId, req.params.id, body.analyst, req.bank!.clientId);
    if (!c) return fail(reply, 404, 'not_found', 'No such campaign');
    const tenant = svc.tenant(c.tenantId)!;
    if (deps.mailer && tenant.alertEmails?.length) {
      const r = await sendEmail(tenant, advisoryApprovedEmail(tenant, c, emailOpts()), tenant.alertEmails, `advisory-approved/${tenant.id}/${c.id}`);
      if (!r.ok) req.log.warn({ err: r.error, campaignId: c.id }, 'approval email failed');
    }
    return c;
  });

  app.post<{ Params: { id: string } }>('/v1/campaigns/:id/withdraw', { preHandler: requireBank }, async (req, reply) => {
    const body = parse(WithdrawAdvisory, req.body ?? {}, reply);
    if (!body) return;
    const c = await svc.withdrawAdvisory(req.bank!.tenantId, req.params.id, body.analyst);
    if (!c) return fail(reply, 404, 'not_found', 'No such campaign');
    return c;
  });

  app.post<{ Params: { id: string } }>('/v1/campaigns/:id/dismiss', { preHandler: requireBank }, async (req, reply) => {
    const c = await svc.dismissCampaign(req.bank!.tenantId, req.params.id);
    if (!c) return fail(reply, 404, 'not_found', 'No such campaign');
    return c;
  });

  app.post('/v1/agent/run', { preHandler: requireBank }, async (req) => {
    const tenant = svc.tenant(req.bank!.tenantId)!;
    const { results, emails } = await deps.runAgent([tenant]);
    return { ...results[0], alertEmails: emails };
  });

  app.post('/internal/agent/run', async (req, reply) => {
    if (!deps.agentJobToken) return fail(reply, 404, 'not_found', 'Not found');
    if (!bearerMatches(req.headers.authorization, deps.agentJobToken)) return fail(reply, 401, 'unauthorized', 'Valid job token required');
    const { results, emails } = await deps.runAgent();
    return { results, alertEmails: emails };
  });

  app.post('/v1/notifications/test', { preHandler: requireBank }, async (req, reply) => {
    const body = parse(TestNotifications, req.body ?? {}, reply);
    if (!body) return;
    const tenant = svc.tenant(req.bank!.tenantId)!;
    const out: Record<string, unknown> = {};
    if (body.pushToken && deps.push instanceof MemoryPush) {
      out.push = { ok: false, error: 'Push is off: set FCM_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS' };
    } else if (body.pushToken) {
      try {
        await deps.push.send(body.pushToken, {
          type: 'call.opened',
          callId: 'call_test',
          bank: tenant.name,
          purpose: 'service_follow_up',
          code: '0000',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        out.push = { ok: true };
      } catch (err) {
        out.push = { ok: false, invalidToken: err instanceof InvalidPushTokenError, error: (err as Error).message };
      }
    }
    if (body.email) out.email = await sendEmail(tenant, testEmail(tenant, emailOpts()), tenant.alertEmails ?? []);
    if (!body.pushToken && !body.email) return fail(reply, 400, 'invalid_request', 'Give pushToken and/or email: true');
    return out;
  });

  app.post('/v1/notifications/welcome', { preHandler: requireBank }, async (req, reply) => {
    const body = parse(WelcomeEmails, req.body ?? {}, reply);
    if (!body) return;
    const tenant = svc.tenant(req.bank!.tenantId)!;
    const r = await sendEmail(tenant, welcomeEmail(tenant, emailOpts()), body.emails ?? tenant.alertEmails ?? []);
    return reply.code(r.ok ? 200 : 502).send(r);
  });

  app.post('/v1/notifications/summary', { preHandler: requireBank }, async (req, reply) => {
    const tenant = svc.tenant(req.bank!.tenantId)!;
    const [metrics, campaigns] = await Promise.all([svc.store.metrics(tenant.id), svc.store.listCampaigns(tenant.id)]);
    const r = await sendEmail(tenant, activitySummaryEmail(tenant, metrics, campaigns, emailOpts()), tenant.alertEmails ?? []);
    return reply.code(r.ok ? 200 : 502).send(r);
  });

  app.get('/v1/metrics', { preHandler: requireBank }, async (req) => svc.metrics(req.bank!.tenantId));

  app.get('/v1/registration-alerts', { preHandler: requireBank }, async (req) => ({ alerts: await svc.alerts(req.bank!.tenantId) }));

  if (deps.allowDemoReset) {
    app.post('/v1/admin/reset', { preHandler: requireBank }, async (req) => {
      await svc.store.resetTenant(req.bank!.tenantId);
      deps.simulatedMno?.reset();
      svc.simSwap?.clear();
      return { ok: true };
    });
    app.post('/v1/admin/sim-swap', { preHandler: requireBank }, async (req, reply) => {
      const mno = deps.simulatedMno;
      if (!mno) return fail(reply, 404, 'not_found', 'The simulated mobile network is off: set SIM_SWAP_PROVIDER=simulated');
      const body = parse(SimSwapDemo, req.body ?? {}, reply);
      if (!body) return;
      svc.simSwap?.clear();
      if (body.action === 'restore') {
        mno.restore(body.phone);
        return { ok: true, latestSimChange: null };
      }
      return { ok: true, latestSimChange: mno.swap(body.phone) };
    });
  }

  app.get('/v1/me', { preHandler: requireCustomer }, async (req) => {
    const { tenant, phone, accounts } = req.customer!;
    return { bank: { id: tenant.id, name: tenant.name, kind: tenant.kind ?? 'bank', domains: tenant.domains, bankCode: tenant.bankCode ?? null }, phoneLast4: phone.slice(-4), accounts };
  });

  app.post('/v1/verify/message', { preHandler: [requireCustomer, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyMessage, req.body, reply);
    if (!body) return;
    const { tenant, phone } = req.customer!;
    return svc.verifyDigest(tenant.id, phone, body.contentDigest, 'app');
  });

  app.post('/v1/verify/receipt', { preHandler: [requireCustomer, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyReceipt, req.body, reply);
    if (!body) return;
    const { tenant, phone, accounts } = req.customer!;
    const wrongBank = 'beneficiaryBank' in body && body.beneficiaryBank !== undefined && body.beneficiaryBank !== tenant.bankCode;
    if (!accounts.includes(body.beneficiaryAccount) || wrongBank) {
      return fail(reply, 403, 'account_not_linked', 'That account is not linked to this customer at this bank');
    }
    if (!tenant.bankCode) return { verdict: 'cannot_check' };
    let digest: string;
    if ('receiptDigest' in body) {
      digest = body.receiptDigest;
    } else {
      try {
        digest = receiptDigest({ ...body, beneficiaryBank: tenant.bankCode });
      } catch (err) {
        if (err instanceof ReceiptFieldError) return fail(reply, 400, 'invalid_request', `Invalid fields: ${err.field}`);
        throw err;
      }
    }
    return svc.verifyReceipt(tenant, phone, accounts, body.beneficiaryAccount, digest, 'app');
  });

  app.post('/v1/verify/link', { preHandler: [requireCustomer, customerActive, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyLink, req.body, reply);
    if (!body) return;
    const { tenant, phone } = req.customer!;
    const r = svc.verifyLink(tenant, phone, body.url, 'app');
    return { ...r, bank: tenant.name };
  });

  app.post('/v1/verify/licence', { preHandler: [requireCustomer, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyLicence, req.body, reply);
    if (!body) return;
    const { tenant, phone } = req.customer!;
    return svc.checkLicence(tenant, phone, body.query, 'app');
  });

  app.post('/v1/verify/contact', { preHandler: [requireCustomer, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyContact, req.body, reply);
    if (!body) return;
    const only = body.tenantId ? svc.tenant(body.tenantId) : undefined;
    if (body.tenantId && !only) return fail(reply, 404, 'not_found', 'No such organisation');
    const r = await svc.verifyContact(req.customer!, body.contact, 'app', only);
    if (!r) return fail(reply, 422, 'not_a_contact', 'Not a phone number, email address, @handle or profile link');
    return r;
  });

  app.get('/v1/official-contacts', { preHandler: [requireCustomer, customerActive, rateLimited] }, async (req, reply) => {
    try {
      return await svc.officialIdentity(req.customer!.tenant, configLoadedAt);
    } catch (err) {
      req.log.warn({ err: { message: (err as Error).message } }, 'official contacts: store unreachable');
      return fail(reply, 503, 'cannot_check', 'Official contacts cannot be read right now');
    }
  });

  app.post('/v1/verify/indicators', { preHandler: [requireCustomer, customerActive, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyIndicators, req.body, reply);
    if (!body) return;
    try {
      return { matches: await svc.matchIndicators(req.customer!.tenant, body) };
    } catch (err) {
      req.log.warn({ err: { message: (err as Error).message } }, 'indicator match failed');
      return fail(reply, 503, 'cannot_check', 'Scam campaigns cannot be checked right now');
    }
  });

  app.post('/v1/verify/screenshot', { preHandler: [requireCustomer, rateLimited] }, async (req, reply) => {
    const body = parse(VerifyScreenshot, req.body, reply);
    if (!body) return;
    const { tenant, phone } = req.customer!;
    const extracted = await svc.extractText(body.imageBase64, body.mediaType);
    if (!extracted) return fail(reply, 422, 'unreadable', 'No message text could be read from the image');
    const result = await svc.verifyDigest(tenant.id, phone, contentDigest(extracted.text), 'app');
    const warnings = [...(result.warnings ?? []), ...(result.verdict === 'confirmed' ? [] : senderWarnings(extracted.sender, tenant.senderIds))];
    return { ...result, extractedText: extracted.text, sender: extracted.sender, warnings };
  });

  app.get('/v1/calls/open', { preHandler: requireCustomer }, async (req) => {
    const { tenant, phone } = req.customer!;
    return svc.openCallFor(tenant, phone, 'app');
  });

  app.get('/v1/activity', { preHandler: requireCustomer }, async (req) => {
    const { tenant, phone } = req.customer!;
    const { items, text } = await svc.activity(tenant, svc.recipientKeys(tenant.id, phone));
    return { recentActivity: items, activityText: text, bank: tenant.name };
  });

  app.get('/v1/advisories', { preHandler: [requireCustomer, customerActive] }, async (req, reply) => {
    const { tenant } = req.customer!;
    try {
      return { bank: tenant.name, advisories: await svc.activeAdvisories(tenant) };
    } catch (err) {
      req.log.warn({ err: { message: (err as Error).message } }, 'advisory lookup failed');
      return fail(reply, 503, 'cannot_check', 'Advisories cannot be read right now');
    }
  });

  app.post('/v1/explain', { preHandler: [requireCustomer, rateLimited] }, async (req, reply) => {
    const body = parse(Explain, req.body, reply);
    if (!body) return;
    return svc.explain(req.customer!.tenant, body.maskedText, body.language);
  });

  app.post('/v1/reports', { preHandler: [requireCustomer, reportLimited] }, async (req, reply) => {
    const body = parse(SubmitReport, req.body, reply);
    if (!body) return;
    return reply.code(201).send(await svc.submitReport(req.customer!.tenant, body));
  });

  app.post('/v1/devices', { preHandler: requireCustomer }, async (req, reply) => {
    const body = parse(RegisterDevice, req.body, reply);
    if (!body) return;
    const { tenant, phone } = req.customer!;
    await svc.store.putDevice({
      tenantId: tenant.id,
      recipientKey: svc.recipientKey(tenant.id, phone),
      pushToken: body.pushToken,
      platform: body.platform,
      updatedAt: svc.now().toISOString(),
    });
    return reply.code(204).send();
  });

  app.get('/v1/events', { preHandler: requireCustomer }, (req, reply) => {
    const { tenant, phone } = req.customer!;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...BASE_SECURITY_HEADERS,
      'content-security-policy': API_CSP,
      ...corsHeader(req.headers.origin),
    });
    res.write(': connected\n\n');
    const send = (n: Notice) => res.write(`event: ${n.type}\ndata: ${JSON.stringify(n)}\n\n`);
    const unsubscribers = [events.subscribe(svc.eventChannel(tenant.id, phone), send), events.subscribe(svc.advisoryChannel(tenant.id), send)];
    const unsubscribe = () => unsubscribers.forEach((u) => u());
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get<{ Querystring: Record<string, string> }>('/webhooks/whatsapp', async (req, reply) => {
    const q = req.query;
    if (deps.whatsapp && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === deps.whatsapp.verifyToken) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return fail(reply, 403, 'forbidden', 'Verification failed');
  });

  app.post('/webhooks/whatsapp', async (req, reply) => {
    const wa = deps.whatsapp;
    if (!wa) return fail(reply, 404, 'not_found', 'WhatsApp route is switched off');
    if (!validSignature(wa.appSecret, req.rawBody ?? '', req.headers['x-hub-signature-256'] as string | undefined)) {
      return fail(reply, 401, 'invalid_signature', 'Signature check failed');
    }
    const tenant = svc.tenant(wa.tenantId);
    if (!tenant || !featureOn(tenant, 'whatsapp')) return fail(reply, 503, 'not_enrolled', 'Bank not enrolled');
    const body = req.body as { entry?: { changes?: { value?: { messages?: unknown[] } }[] }[] };
    const messages = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
    await Promise.all(
      messages.map((m) =>
        handleWhatsApp(svc, tenant, deps.messaging, verifyLimiter, m as Parameters<typeof handleWhatsApp>[4]).catch((err: Error) =>
          req.log.error({ err: { message: err.message } }, 'whatsapp handling failed'),
        ),
      ),
    );
    return { ok: true };
  });

  app.post<{ Querystring: Record<string, string | undefined> }>('/webhooks/ussd', async (req, reply) => {
    const u = deps.ussd;
    if (!u) return fail(reply, 404, 'not_found', 'USSD route is switched off');
    if (!validUssdToken(u.token, req.query.token)) return fail(reply, 403, 'forbidden', 'Token check failed');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ussdTenant = svc.tenant(u.tenantId);
    const screen = await handleUssd(svc, ussdTenant && featureOn(ussdTenant, 'ussd') ? ussdTenant : undefined, verifyLimiter, { phoneNumber: body.phoneNumber, text: body.text }).catch(() => cannotCheck());
    return reply.type('text/plain; charset=utf-8').send(screen);
  });

  if (deps.admin) registerAdminRoutes(app, deps.admin);

  return app;
}
