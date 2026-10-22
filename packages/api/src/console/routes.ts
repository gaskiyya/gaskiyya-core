import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApproveAdvisory, WithdrawAdvisory } from '@gaskiya/schemas';
import { orgChecklist, orgSummary, utcDays } from '../admin/routes.ts';
import { AdminError, type AdminRegistry } from '../admin/registry.ts';
import { ConsoleEditOrg } from '../admin/schemas.ts';
import { coverage } from '../domain/coverage.ts';
import type { RateLimiter } from '../ratelimit/ratelimit.ts';
import type { GaskiyaService } from '../service.ts';
import { ORG_FEATURES, featureOn, isSuspended, type Campaign, type Tenant } from '../store/types.ts';
import type { ConsoleAccess, ConsoleIdentity } from './access.ts';

export interface ConsoleDeps {
  access: ConsoleAccess;
  registry: AdminRegistry;
  svc: GaskiyaService;
  loginLimiter: RateLimiter;
  // Caps failed sign-ins across all addresses, since a six-character code is short.
  failLimiter: RateLimiter;
  limiter: RateLimiter;
  demoTenantId?: string | null;
  runAgent: (only: Tenant[]) => Promise<{ results: unknown[] }>;
  onApproved?: (tenant: Tenant, campaign: Campaign) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    console?: ConsoleIdentity;
  }
}

const Login = z.strictObject({ code: z.string().min(1).max(32) });

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message });
}

// What a bank sees of its own profile; key material and token settings stay with Gaskiyya.
export function consoleProfile(t: Tenant) {
  return {
    id: t.id,
    name: t.name,
    legalName: t.legalName ?? null,
    kind: t.kind ?? 'bank',
    status: t.status ?? 'active',
    mode: t.mode ?? 'live',
    bankCode: t.bankCode ?? null,
    domains: t.domains,
    senderIds: t.senderIds,
    officialContacts: t.officialContacts ?? { phones: [], whatsapp: [], emails: [], social: [] },
    officialApps: t.officialApps ?? { android: [], ios: [] },
    alertEmails: t.alertEmails ?? [],
    technicalContact: t.technicalContact ?? null,
    features: Object.fromEntries(ORG_FEATURES.map((f) => [f, featureOn(t, f)])),
  };
}

export function registerConsoleRoutes(app: FastifyInstance, d: ConsoleDeps) {
  const { access, registry, svc } = d;
  const now = () => svc.now().getTime();
  const actor = (req: FastifyRequest) => ({ username: `console:${req.console!.label}`, ip: req.ip ?? null });

  const requireConsole = async (req: FastifyRequest, reply: FastifyReply) => {
    let id: ConsoleIdentity | null;
    try {
      id = await access.check(req.headers.authorization);
    } catch (err) {
      req.log.warn({ err: { message: (err as Error).message } }, 'console session check: store unreachable');
      return fail(reply, 503, 'unavailable', 'The registry store is unreachable');
    }
    if (!id) return fail(reply, 401, 'unauthorized', 'Sign in with your bank console code');
    const tenant = svc.tenant(id.tenantId);
    if (!tenant) return fail(reply, 401, 'unauthorized', 'Sign in with your bank console code');
    if (isSuspended(tenant)) return fail(reply, 403, 'org_suspended', 'This organisation is suspended on Gaskiyya. Contact Gaskiyya support.');
    if (!(await d.limiter.take(id.idHash, now()))) return fail(reply, 429, 'rate_limited', 'Too many requests. Try again in a minute.');
    req.console = id;
  };
  const signedIn = { preHandler: requireConsole };
  const tenantOf = (req: FastifyRequest) => svc.tenant(req.console!.tenantId)!;

  let lockedUntil = 0;
  app.post('/v1/console/session', async (req, reply) => {
    if (now() < lockedUntil || !(await d.loginLimiter.take(req.ip, now()))) return fail(reply, 429, 'rate_limited', 'Too many sign-in attempts. Try again in a minute.');
    const body = Login.safeParse(req.body ?? {});
    if (!body.success) return fail(reply, 400, 'invalid_request', 'Enter your access code');
    const r = await access.login(body.data.code);
    if ('error' in r) {
      if (r.error === 'invalid' && !(await d.failLimiter.take('all', now()))) lockedUntil = now() + 60_000;
      await registry.audit({ username: 'console', ip: req.ip }, 'console.login_failed', null, null).catch(() => {});
      return r.error === 'suspended'
        ? fail(reply, 403, 'org_suspended', 'This organisation is suspended on Gaskiyya. Contact Gaskiyya support.')
        : fail(reply, 401, 'invalid_code', 'That code is not recognised. Check it, or ask Gaskiyya for your organisation\u2019s code.');
    }
    await registry.audit({ username: `console:${r.identity.label}`, ip: req.ip }, 'console.login', r.tenant.id, r.identity.codeId).catch(() => {});
    return { token: r.token, expiresAt: r.identity.expiresAt, access: { label: r.identity.label }, org: consoleProfile(r.tenant) };
  });

  // Only while the simulator serves demo login: the demo organisation's code, shown on the sign-in page.
  app.get('/v1/console/demo', async (_req, reply) => {
    const t = d.demoTenantId ? svc.tenant(d.demoTenantId) : undefined;
    const c = t ? await access.current(t.id).catch(() => null) : null;
    if (!t || !c) return fail(reply, 404, 'not_found', 'No demo organisation on this server');
    return { org: { id: t.id, name: t.name }, code: c.code };
  });

  app.get('/v1/console/session', signedIn, async (req) => ({
    expiresAt: req.console!.expiresAt,
    access: { label: req.console!.label },
    org: consoleProfile(tenantOf(req)),
  }));

  app.post('/v1/console/session/logout', signedIn, async (req) => {
    await access.logout(req.console!.idHash);
    return { ok: true };
  });

  app.get('/v1/console/metrics', signedIn, async (req) => svc.metrics(req.console!.tenantId));

  app.get('/v1/console/overview', signedIn, async (req) => {
    const t = tenantOf(req);
    const [metrics, usage, campaigns, alerts] = await Promise.all([
      svc.store.metrics(t.id),
      svc.store.apiUsage(t.id, utcDays(svc.now(), 14)).catch(() => []),
      svc.store.listCampaigns(t.id).catch(() => []),
      svc.alerts(t.id, 5).catch(() => []),
    ]);
    const t0 = now();
    return {
      coverage: coverage(metrics),
      usage,
      campaigns: {
        total: campaigns.length,
        new: campaigns.filter((c) => c.status === 'new').length,
        liveAdvisories: campaigns.filter((c) => c.advisory.status === 'approved' && (!c.advisory.expiresAt || Date.parse(c.advisory.expiresAt) > t0)).length,
        drafts: campaigns.filter((c) => c.status !== 'dismissed' && c.advisory.status === 'draft').length,
      },
      alerts,
    };
  });

  app.get('/v1/console/campaigns', signedIn, async (req) => ({ campaigns: await svc.store.listCampaigns(req.console!.tenantId) }));

  app.post<{ Params: { id: string } }>('/v1/console/campaigns/:id/approve', signedIn, async (req, reply) => {
    const t = tenantOf(req);
    if (!featureOn(t, 'advisories')) return fail(reply, 403, 'feature_off', 'Customer advisories are not switched on for this organisation');
    const body = ApproveAdvisory.safeParse(req.body ?? {});
    if (!body.success) return fail(reply, 400, 'invalid_request', 'Enter the analyst who approves this advisory');
    const c = await svc.approveAdvisory(t.id, req.params.id, body.data.analyst, null);
    if (!c) return fail(reply, 404, 'not_found', 'No such campaign');
    await registry.audit(actor(req), 'console.advisory_approve', t.id, c.id, { analyst: body.data.analyst }).catch(() => {});
    await d.onApproved?.(t, c).catch((err) => req.log.warn({ err: (err as Error).message, campaignId: c.id }, 'approval email failed'));
    return c;
  });

  app.post<{ Params: { id: string } }>('/v1/console/campaigns/:id/withdraw', signedIn, async (req, reply) => {
    const t = tenantOf(req);
    const body = WithdrawAdvisory.safeParse(req.body ?? {});
    if (!body.success) return fail(reply, 400, 'invalid_request', 'Enter the analyst who withdraws this advisory');
    const c = await svc.withdrawAdvisory(t.id, req.params.id, body.data.analyst);
    if (!c) return fail(reply, 404, 'not_found', 'No such campaign');
    await registry.audit(actor(req), 'console.advisory_withdraw', t.id, c.id, { analyst: body.data.analyst }).catch(() => {});
    return c;
  });

  app.post<{ Params: { id: string } }>('/v1/console/campaigns/:id/dismiss', signedIn, async (req, reply) => {
    const t = tenantOf(req);
    const c = await svc.dismissCampaign(t.id, req.params.id);
    if (!c) return fail(reply, 404, 'not_found', 'No such campaign');
    await registry.audit(actor(req), 'console.campaign_dismiss', t.id, c.id).catch(() => {});
    return c;
  });

  app.post('/v1/console/agent/run', signedIn, async (req) => {
    const { results } = await d.runAgent([tenantOf(req)]);
    return results[0] ?? {};
  });

  app.get('/v1/console/alerts', signedIn, async (req) => ({ alerts: await svc.alerts(req.console!.tenantId) }));

  app.get('/v1/console/integration', signedIn, async (req) => {
    const t = tenantOf(req);
    const [summary, usage, errors] = await Promise.all([
      orgSummary(registry, svc, t),
      svc.store.apiUsage(t.id, utcDays(svc.now(), 14)).catch(() => []),
      svc.store.apiErrors(t.id, 15).catch(() => []),
    ]);
    const webhook = registry.record(t.id)?.webhook;
    return {
      clients: registry.clientsFor(t.id),
      keys: registry.keysFor(t.id),
      webhook: webhook ? { url: webhook.url, createdAt: webhook.createdAt } : t.webhookUrl ? { url: t.webhookUrl, createdAt: null } : null,
      usage,
      errors,
      checklist: orgChecklist(t, summary),
    };
  });

  app.patch('/v1/console/organisation', signedIn, async (req, reply) => {
    const body = ConsoleEditOrg.safeParse(req.body ?? {});
    if (!body.success) return fail(reply, 400, 'invalid_request', body.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '));
    try {
      return { org: consoleProfile(await registry.updateOrg(req.console!.tenantId, body.data, actor(req))) };
    } catch (err) {
      if (err instanceof AdminError) return fail(reply, err.statusCode, err.code, err.message);
      throw err;
    }
  });

  app.get('/v1/console/activity', signedIn, async (req) => ({
    entries: (await svc.store.listAudit({ tenantId: req.console!.tenantId, limit: 100 })).map(({ ip: _ip, ...e }) => e),
  }));
}
