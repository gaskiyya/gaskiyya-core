import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Mailer } from '../channels/email.ts';
import { coverage } from '../domain/coverage.ts';
import { testEmail, type EmailOptions } from '../emails/templates.ts';
import type { RateLimiter } from '../ratelimit/ratelimit.ts';
import type { GaskiyaService } from '../service.ts';
import { ORG_FEATURES, featureOn, isSuspended, type Tenant } from '../store/types.ts';
import { AdminError, type Actor, type AdminRegistry } from './registry.ts';
import { AdminLogin, CreateClient, CreateOrg, RotateClient, SetWebhook, SuspendOrg, UpdateOrg } from './schemas.ts';
import { ADMIN_CSRF_HEADER, adminCookie, adminToken, type AdminAuth } from './session.ts';

export interface AdminDeps {
  registry: AdminRegistry;
  auth: AdminAuth;
  svc: GaskiyaService;
  mailer: Mailer | null;
  emailOptions?: EmailOptions;
  loginLimiter: RateLimiter;
  adminLimiter: RateLimiter;
  platform: () => Promise<Record<string, unknown>>;
  secureCookies?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: { username: string; idHash: string; expiresAt: string };
  }
}

const DAY_MS = 24 * 3600_000;

interface Gen {
  Params: { id: string; clientId: string; version: string };
  Querystring: Record<string, string | undefined>;
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message });
}

function parse<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const fields = [...new Set(r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`))].join('; ');
  void fail(reply, 400, 'invalid_request', `Invalid fields: ${fields}`);
  return undefined;
}

export function utcDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => new Date(now.getTime() - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

export function registerAdminRoutes(app: FastifyInstance, d: AdminDeps) {
  const { registry, auth, svc } = d;
  const actor = (req: FastifyRequest<Gen>): Actor => ({ username: req.admin?.username ?? 'unknown', ip: req.ip ?? null });

  type Handler = (req: FastifyRequest<Gen>, reply: FastifyReply) => Promise<unknown>;
  const run =
    (fn: Handler): Handler =>
    async (req, reply) => {
      try {
        return await fn(req, reply);
      } catch (err) {
        if (err instanceof AdminError) return fail(reply, err.statusCode, err.code, err.message);
        throw err;
      }
    };

  const secure = (req: FastifyRequest) => Boolean(d.secureCookies) || req.protocol === 'https';
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const t = adminToken(req.headers);
    let s: Awaited<ReturnType<AdminAuth['check']>>;
    try {
      s = t ? await auth.checkToken(t.token) : null;
    } catch (err) {
      req.log.warn({ err: { message: (err as Error).message } }, 'admin session check: store unreachable');
      return fail(reply, 503, 'unavailable', 'The registry store is unreachable');
    }
    if (!s) {
      if (t?.via === 'cookie') reply.header('set-cookie', adminCookie(null, 0, secure(req)));
      return fail(reply, 401, 'unauthorized', 'Admin sign-in required');
    }
    if (t?.via === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[ADMIN_CSRF_HEADER] !== '1') {
      return fail(reply, 403, 'csrf', `Cookie-authenticated changes need the ${ADMIN_CSRF_HEADER} header`);
    }
    if (!(await d.adminLimiter.take(s.idHash, svc.now().getTime()))) return fail(reply, 429, 'rate_limited', 'Too many admin requests. Try again in a minute.');
    req.admin = s;
  };
  const admin = { preHandler: requireAdmin };

  const orgSummary = async (t: Tenant) => {
    const days = utcDays(svc.now(), 7);
    const [m, usage] = await Promise.all([svc.store.metrics(t.id).catch(() => null), svc.store.apiUsage(t.id, days).catch(() => null)]);
    const clients = registry.clientsFor(t.id);
    const keys = registry.keysFor(t.id);
    const cov = m ? coverage(m) : null;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind ?? 'bank',
      source: registry.source(t.id),
      status: t.status ?? 'active',
      mode: t.mode ?? 'live',
      bankCode: t.bankCode ?? null,
      domains: t.domains,
      features: Object.fromEntries(ORG_FEATURES.map((f) => [f, featureOn(t, f)])),
      clients: { active: clients.filter((c) => c.status === 'active').length, total: clients.length },
      lastUsedAt: clients.map((c) => c.lastUsedAt).filter((x): x is string => Boolean(x)).sort().pop() ?? null,
      keyVersion: keys.find((k) => k.state === 'current')?.version ?? null,
      hasKey: keys.some((k) => k.state === 'current'),
      webhook: Boolean(t.webhookUrl),
      alertEmails: t.alertEmails?.length ?? 0,
      usage: m && cov
        ? {
            registrations: m.registrations,
            receiptsRegistered: m.receiptsRegistered,
            checks: cov.checked + sum(m.callChecks) + sum(m.links) + sum(m.receiptChecks) + sum(m.contactChecks),
            confirmed: cov.confirmed,
            notConfirmed: cov.notConfirmed,
            cannotCheck: cov.cannotCheck,
            reports: m.reports,
            openCalls: m.openCalls,
          }
        : null,
      api: usage
        ? { today: usage.at(-1)?.calls ?? 0, last7Days: usage.reduce((a, u) => a + u.calls, 0), errors7Days: usage.reduce((a, u) => a + u.errors, 0) }
        : null,
    };
  };

  const checklist = (t: Tenant, s: Awaited<ReturnType<typeof orgSummary>>) => [
    { id: 'profile', label: 'Domains and sender IDs listed', done: t.domains.length > 0 && t.senderIds.length > 0 },
    { id: 'tokenKeys', label: 'Customer token keys (JWKS) set', done: Boolean(t.tokenKeysUrl || t.tokenKeys) },
    { id: 'hashingKey', label: 'Hashing key in place', done: s.hasKey },
    { id: 'client', label: 'An active API client', done: s.clients.active > 0 },
    { id: 'firstCall', label: 'First registry call made', done: Boolean(s.lastUsedAt) || (s.api?.last7Days ?? 0) > 0 || (s.usage?.registrations ?? 0) > 0 },
    { id: 'contacts', label: 'Official contacts published', done: Boolean(t.officialContacts?.phones?.length || t.officialContacts?.emails?.length || t.officialContacts?.whatsapp?.length) },
    { id: 'alerts', label: 'Alert email or webhook set', done: Boolean(t.alertEmails?.length || t.webhookUrl) },
    ...((t.kind ?? 'bank') === 'bank' ? [{ id: 'bankCode', label: 'NIBSS bank code set (transfer receipts)', done: Boolean(t.bankCode) }] : []),
    { id: 'live', label: 'Switched to live', done: (t.mode ?? 'live') === 'live' && !isSuspended(t) },
  ];

  const orgDetail = async (id: string) => {
    const t = registry.tenant(id);
    const rec = registry.record(id);
    const summary = await orgSummary(t);
    const days = utcDays(svc.now(), 14);
    const [metrics, usage, errors, alerts, campaigns, audit] = await Promise.all([
      svc.metrics(id).catch(() => null),
      svc.store.apiUsage(id, days).catch(() => []),
      svc.store.apiErrors(id, 25).catch(() => []),
      svc.store.listAlerts(id, 10).catch(() => []),
      svc.store.listCampaigns(id).catch(() => []),
      svc.store.listAudit({ tenantId: id, limit: 40 }).catch(() => []),
    ]);
    const now = svc.now().getTime();
    return {
      org: { ...t, kind: t.kind ?? 'bank', status: t.status ?? 'active', mode: t.mode ?? 'live', features: summary.features, limits: t.limits ?? {} },
      summary,
      meta: {
        source: registry.source(id),
        profileOverridden: Boolean(rec?.profile) && rec?.source === 'env',
        notes: rec?.notes ?? '',
        createdAt: rec?.createdAt ?? null,
        createdBy: rec?.createdBy ?? null,
        updatedAt: rec?.updatedAt ?? null,
        updatedBy: rec?.updatedBy ?? null,
        suspendedReason: rec?.suspendedReason ?? null,
        suspendedAt: rec?.suspendedAt ?? null,
        suspendedBy: rec?.suspendedBy ?? null,
        webhook: rec?.webhook ? { url: rec.webhook.url, createdAt: rec.webhook.createdAt } : null,
      },
      clients: registry.clientsFor(id),
      keys: registry.keysFor(id),
      metrics,
      usage,
      errors,
      alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, domain: a.domain, count: a.count, expected: a.expected, firstSeen: a.firstSeen, lastSeen: a.lastSeen })),
      campaigns: {
        total: campaigns.length,
        new: campaigns.filter((c) => c.status === 'new').length,
        confirmed: campaigns.filter((c) => c.status === 'confirmed').length,
        dismissed: campaigns.filter((c) => c.status === 'dismissed').length,
        liveAdvisories: campaigns.filter((c) => c.advisory.status === 'approved' && (!c.advisory.expiresAt || Date.parse(c.advisory.expiresAt) > now)).length,
      },
      audit,
      checklist: checklist(t, summary),
    };
  };

  app.post<Gen>('/v1/admin/session', async (req, reply) => {
    if (!(await d.loginLimiter.take(req.ip, svc.now().getTime()))) return fail(reply, 429, 'rate_limited', 'Too many sign-in attempts. Try again in a minute.');
    const body = parse(AdminLogin, req.body, reply);
    if (!body) return;
    const s = await auth.login(body.username, body.password);
    if (!s) {
      await registry.audit({ username: body.username, ip: req.ip }, 'admin.login_failed', null, null).catch(() => {});
      return fail(reply, 401, 'invalid_login', 'Wrong username or password');
    }
    await registry.audit({ username: s.username, ip: req.ip }, 'admin.login', null, null);
    reply.header('set-cookie', adminCookie(s.token, (Date.parse(s.expiresAt) - svc.now().getTime()) / 1000, secure(req)));
    return { token: s.token, username: s.username, expiresAt: s.expiresAt };
  });

  app.get<Gen>('/v1/admin/session', admin, async (req) => ({ username: req.admin!.username, expiresAt: req.admin!.expiresAt }));

  app.post<Gen>('/v1/admin/session/logout', admin, async (req, reply) => {
    await auth.logout(req.admin!.idHash);
    reply.header('set-cookie', adminCookie(null, 0, secure(req)));
    await registry.audit(actor(req), 'admin.logout', null, null);
    return { ok: true };
  });

  app.get<Gen>('/v1/admin/overview', admin, run(async () => {
    const tenants = registry.orgIds().map((id) => registry.tenant(id));
    const orgs = await Promise.all(tenants.map(orgSummary));
    const days = utcDays(svc.now(), 14);
    const daily = await Promise.all(tenants.map((t) => svc.store.apiUsage(t.id, days).catch(() => [])));
    const apiByDay = days.map((day, i) => ({ day, calls: daily.reduce((a, u) => a + (u[i]?.calls ?? 0), 0), errors: daily.reduce((a, u) => a + (u[i]?.errors ?? 0), 0) }));
    const total = (f: (o: (typeof orgs)[number]) => number) => orgs.reduce((a, o) => a + f(o), 0);
    return {
      totals: {
        organisations: orgs.length,
        active: orgs.filter((o) => o.status === 'active').length,
        suspended: orgs.filter((o) => o.status === 'suspended').length,
        sandbox: orgs.filter((o) => o.mode === 'sandbox').length,
        byKind: Object.fromEntries(['bank', 'agency', 'company'].map((k) => [k, orgs.filter((o) => o.kind === k).length])),
        activeClients: total((o) => o.clients.active),
        registrations: total((o) => o.usage?.registrations ?? 0),
        checks: total((o) => o.usage?.checks ?? 0),
        confirmed: total((o) => o.usage?.confirmed ?? 0),
        cannotCheck: total((o) => o.usage?.cannotCheck ?? 0),
        reports: total((o) => o.usage?.reports ?? 0),
        apiCallsToday: total((o) => o.api?.today ?? 0),
        apiCalls7Days: total((o) => o.api?.last7Days ?? 0),
        apiErrors7Days: total((o) => o.api?.errors7Days ?? 0),
      },
      apiByDay,
      orgs,
      recentAudit: await svc.store.listAudit({ limit: 12 }).catch(() => []),
      masterKeySet: registry.masterKeySet,
    };
  }));

  app.get<Gen>('/v1/admin/settings', admin, run(async () => d.platform()));

  app.get<Gen>('/v1/admin/audit', admin, run(async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const tenantId = req.query.org || undefined;
    const action = req.query.action || undefined;
    const entries = await svc.store.listAudit({ tenantId, limit: action ? 500 : limit });
    return { entries: (action ? entries.filter((e) => e.action.startsWith(action)) : entries).slice(0, limit) };
  }));

  app.get<Gen>('/v1/admin/orgs', admin, run(async () => ({ orgs: await Promise.all(registry.orgIds().map((id) => orgSummary(registry.tenant(id)))) })));

  app.post<Gen>('/v1/admin/orgs', admin, run(async (req, reply) => {
    const body = parse(CreateOrg, req.body, reply);
    if (!body) return;
    const t = await registry.createOrg(body, actor(req));
    return reply.code(201).send(await orgDetail(t.id));
  }));

  app.post<Gen>('/v1/admin/orgs/validate', admin, run(async (req) => {
    const r = CreateOrg.safeParse(req.body);
    if (!r.success) return { ok: false, errors: [...new Set(r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`))] };
    const errors = registry.validateOrg(r.data);
    return { ok: errors.length === 0, errors };
  }));

  app.get<Gen>('/v1/admin/orgs/:id', admin, run(async (req) => orgDetail(req.params.id)));

  app.patch<Gen>('/v1/admin/orgs/:id', admin, run(async (req, reply) => {
    const body = parse(UpdateOrg, req.body, reply);
    if (!body) return;
    await registry.updateOrg(req.params.id, body, actor(req));
    return orgDetail(req.params.id);
  }));

  app.post<Gen>('/v1/admin/orgs/:id/reset-profile', admin, run(async (req) => {
    await registry.resetProfile(req.params.id, actor(req));
    return orgDetail(req.params.id);
  }));

  app.post<Gen>('/v1/admin/orgs/:id/suspend', admin, run(async (req, reply) => {
    const body = parse(SuspendOrg, req.body ?? {}, reply);
    if (!body) return;
    await registry.setStatus(req.params.id, 'suspended', body.reason, actor(req));
    return orgDetail(req.params.id);
  }));

  app.post<Gen>('/v1/admin/orgs/:id/reactivate', admin, run(async (req) => {
    await registry.setStatus(req.params.id, 'active', null, actor(req));
    return orgDetail(req.params.id);
  }));

  app.post<Gen>('/v1/admin/orgs/:id/clients', admin, run(async (req, reply) => {
    const body = parse(CreateClient, req.body ?? {}, reply);
    if (!body) return;
    const r = await registry.createClient(req.params.id, body.label, actor(req));
    return reply.code(201).send({ client: r.client, clientSecret: r.clientSecret, shownOnce: true });
  }));

  app.post<Gen>('/v1/admin/orgs/:id/clients/:clientId/rotate', admin, run(async (req, reply) => {
    const body = parse(RotateClient, req.body ?? {}, reply);
    if (!body) return;
    const r = await registry.rotateClient(req.params.id, req.params.clientId, body.graceMinutes, actor(req));
    return { client: r.client, clientSecret: r.clientSecret, shownOnce: true };
  }));

  app.post<Gen>('/v1/admin/orgs/:id/clients/:clientId/revoke', admin, run(async (req) => ({
    client: await registry.setClientStatus(req.params.id, req.params.clientId, 'revoked', actor(req)),
  })));

  app.post<Gen>('/v1/admin/orgs/:id/clients/:clientId/restore', admin, run(async (req) => ({
    client: await registry.setClientStatus(req.params.id, req.params.clientId, 'active', actor(req)),
  })));

  app.post<Gen>('/v1/admin/orgs/:id/keys/rotate', admin, run(async (req) => ({ keys: await registry.rotateKey(req.params.id, actor(req)) })));

  app.post<Gen>('/v1/admin/orgs/:id/keys/:version/retire', admin, run(async (req, reply) => {
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) return fail(reply, 400, 'invalid_request', 'version must be a whole number from 1');
    return { keys: await registry.retireKey(req.params.id, version, actor(req)) };
  }));

  app.post<Gen>('/v1/admin/orgs/:id/webhook', admin, run(async (req, reply) => {
    const body = parse(SetWebhook, req.body ?? {}, reply);
    if (!body) return;
    const r = await registry.setWebhook(req.params.id, body.url, actor(req));
    return reply.code(201).send({ ...r, shownOnce: true });
  }));

  app.post<Gen>('/v1/admin/orgs/:id/webhook/remove', admin, run(async (req) => {
    await registry.removeWebhook(req.params.id, actor(req));
    return { ok: true };
  }));

  app.post<Gen>('/v1/admin/orgs/:id/webhook/test', admin, run(async (req, reply) => {
    registry.tenant(req.params.id);
    const r = await registry.sendWebhook(req.params.id, 'test', { message: 'Test event from the Gaskiyya admin dashboard' });
    await registry.audit(actor(req), 'webhook.test', req.params.id, null, { ok: r.ok, status: r.status ?? null });
    return reply.code(r.ok ? 200 : 502).send(r);
  }));

  app.post<Gen>('/v1/admin/orgs/:id/test-email', admin, run(async (req, reply) => {
    const t = registry.tenant(req.params.id);
    const to = t.alertEmails ?? [];
    let r: { ok: boolean; error?: string; to?: string[] };
    if (!d.mailer) r = { ok: false, error: 'Email is off: set RESEND_API_KEY and EMAIL_FROM' };
    else if (to.length === 0) r = { ok: false, error: 'This organisation has no alert emails' };
    else {
      try {
        const mail = testEmail(t, { ...d.emailOptions, now: svc.now() });
        await d.mailer.send({ to, subject: mail.subject, html: mail.html, text: mail.text, tags: [{ name: 'type', value: mail.template }] });
        r = { ok: true, to };
      } catch (err) {
        r = { ok: false, error: (err as Error).message };
      }
    }
    await registry.audit(actor(req), 'email.test', t.id, null, { ok: r.ok, recipients: to.length });
    return reply.code(r.ok ? 200 : 502).send(r);
  }));

  app.post<Gen>('/v1/admin/refresh', admin, run(async (req) => {
    await registry.refresh();
    await registry.audit(actor(req), 'admin.refresh', null, null);
    return { ok: true, loadedAt: registry.loadedAt };
  }));
}
