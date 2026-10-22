import { GeminiProvider } from './ai/gemini.ts';
import { OllamaProvider } from './ai/ollama.ts';
import { OpenAIProvider } from './ai/openai.ts';
import { NoModelProvider, type ModelProvider } from './ai/provider.ts';
import { buildApp } from './app.ts';
import { BankAuth, CustomerAuth, type BankClient } from './auth/auth.ts';
import { runAgentForAll } from './campaigns.ts';
import { CampaignAlerts } from './alerts.ts';
import { registrationAlertEmail, simSwapAlertEmail } from './emails/templates.ts';
import { DEFAULT_SIM_SWAP, SimSwapMonitor, type SimSwapSettings } from './simswap/monitor.ts';
import { CamaraSimSwap, MemorySimSwap, SimulatedMno, SimSwapError, type SimSwapProvider } from './simswap/simswap.ts';
import { DEFAULT_GUARD, RegistrationGuard, type GuardConfig } from './guard.ts';
import { MemoryMailer, ResendMailer, type Mailer } from './channels/email.ts';
import { FcmPush, serviceAccountFromEnv } from './channels/fcm.ts';
import { ApnsVoipPush, apnsConfigFromEnv, type VoipPush } from './channels/voip.ts';
import {
  EventHub,
  MemoryMessaging,
  MemoryPush,
  WhatsAppCloud,
  type Messaging,
  type PushProvider,
} from './channels/channels.ts';
import { parseTenantKeys, StaticKeyService, type KeyService, type TenantKeyConfig } from './keys/keys.ts';
import { firestoreRateLimiters, memoryRateLimiters, mongoRateLimiters, type RateLimiterFactory } from './ratelimit/ratelimit.ts';
import { GaskiyaService, type Logger } from './service.ts';
import { FirestoreStore } from './store/firestore.ts';
import { MongoStore } from './store/mongo.ts';
import { MemoryStore } from './store/memory.ts';
import { BUNDLED_LICENCES } from '@gaskiya/licences/bundled';
import { DirectoryLicenceRegistry } from './licences/directory.ts';
import { MemoryLicenceRegistry, type LicenceRegistry } from './licences/registry.ts';
import type { Store, Tenant } from './store/types.ts';
import { EMAIL_RE, orgErrors } from './orgs.ts';
import { ManagedKeyService } from './keys/managed.ts';
import { AdminRegistry } from './admin/registry.ts';
import { AdminAuth, adminUsersFromEnv, type AdminUser } from './admin/session.ts';
import { ConsoleAccess } from './console/access.ts';
import { parseMasterKey } from './admin/crypto.ts';
import { HttpWebhookSender, MemoryWebhookSender, type WebhookSender } from './channels/webhook.ts';

export interface SystemOptions {
  tenants: Tenant[];
  keys: KeyService;
  bankClients: BankClient[];
  tokenSecret: string;
  store?: Store;
  model?: ModelProvider;
  push?: PushProvider;
  voip?: VoipPush | null;
  messaging?: Messaging;
  whatsapp?: { verifyToken: string; appSecret: string; tenantId: string } | null;
  ussd?: { token: string; tenantId: string } | null;
  recordTtlDays?: number;
  receiptTtlDays?: number;
  callRingSeconds?: number;
  callMaxSeconds?: number;
  registerMaxFutureSeconds?: number;
  advisoryTtlDays?: number;
  aiTimeoutMs?: number;
  verifyRateLimitPerMinute?: number;
  reportRateLimitPerMinute?: number;
  tokenRateLimitPerMinute?: number;
  rateLimiters?: RateLimiterFactory;
  allowDemoReset?: boolean;
  corsOrigins?: string[] | boolean;
  trustProxy?: boolean;
  logger?: boolean;
  logStream?: { write(line: string): void };
  clock?: () => Date;
  mailer?: Mailer | null;
  consoleUrl?: string;
  emailLogoUrl?: string;
  agentJobToken?: string | null;
  guard?: Partial<GuardConfig>;
  licences?: LicenceRegistry;
  licenceMaxAgeDays?: number;
  simSwap?: SimSwapProvider | null;
  simSwapSettings?: Partial<SimSwapSettings>;
  simSwapRateLimitPerMinute?: number;
  masterKey?: Buffer | null;
  adminUsers?: AdminUser[];
  adminPassword?: { username: string; password: string } | null;
  adminSessionHours?: number;
  consoleSessionHours?: number;
  // The demo organisation whose console code is shown on the sign-in page (only while the simulator serves demo login).
  consoleDemoTenantId?: string | null;
  adminLoginRateLimitPerMinute?: number;
  keyActivationSeconds?: number;
  webhooks?: WebhookSender;
  integrations?: Integrations;
  production?: boolean;
  agentModel?: ModelProvider;
  agentTimeoutMs?: number;
}

export const DEFAULT_LICENCE_MAX_AGE_DAYS = 120;

export function createSystem(o: SystemOptions) {
  const tenants = new Map(o.tenants.map((t) => [t.id, t]));
  const store = o.store ?? new MemoryStore();
  const clock = o.clock ?? (() => new Date());
  const keys = o.keys instanceof ManagedKeyService ? o.keys : new ManagedKeyService(o.keys, clock);
  const webhooks = o.webhooks ?? new MemoryWebhookSender();
  const keyActivationSeconds = o.keyActivationSeconds ?? (store instanceof MemoryStore ? 0 : 60);
  const model = o.model ?? new NoModelProvider();
  const push = o.push ?? new MemoryPush();
  const messaging = o.messaging ?? new MemoryMessaging();
  const mailer = o.mailer === undefined ? new MemoryMailer() : o.mailer;
  const events = new EventHub();
  const limiters = o.rateLimiters ?? memoryRateLimiters;
  const logger: Logger = {
    warn: () => {},
    error: () => {},
  };
  const svc = new GaskiyaService(
    tenants,
    store,
    keys,
    model,
    push,
    events,
    {
      recordTtlDays: o.recordTtlDays ?? 30,
      callRingSeconds: o.callRingSeconds ?? 180,
      callMaxSeconds: o.callMaxSeconds ?? 2 * 60 * 60,
      aiTimeoutMs: o.aiTimeoutMs ?? 4000,
      registerMaxFutureSeconds: o.registerMaxFutureSeconds ?? 300,
      receiptTtlDays: o.receiptTtlDays ?? 30,
      advisoryTtlDays: o.advisoryTtlDays ?? 14,
    },
    logger,
    o.clock,
  );
  svc.voip = o.voip ?? null;
  const emailOptions = { consoleUrl: o.consoleUrl, logoUrl: o.emailLogoUrl };
  const customerAuth = new CustomerAuth(tenants);
  const bankAuth = new BankAuth(o.tokenSecret, o.bankClients);
  const registry = new AdminRegistry({
    store,
    tenants,
    envTenants: o.tenants,
    envClients: o.bankClients,
    keys,
    masterKey: o.masterKey ?? null,
    customerAuth,
    webhooks,
    clock,
    keyActivationSeconds,
    log: logger,
    production: o.production ?? false,
  });
  bankAuth.directory = registry;
  const adminAuth =
    (o.adminUsers?.length ?? 0) > 0 || o.adminPassword
      ? new AdminAuth({ store, users: o.adminUsers ?? [], plain: o.adminPassword ?? null, sessionHours: o.adminSessionHours ?? 8, clock })
      : null;
  const consoleAccess = new ConsoleAccess({ store, keys, tenant: (id) => tenants.get(id), clock, sessionHours: o.consoleSessionHours ?? 12, pepper: o.tokenSecret });
  const alerts = new CampaignAlerts(store, mailer, tenants, logger, emailOptions, o.clock, async (tenant, c, kind) =>
    (await registry.sendWebhook(tenant.id, 'campaign_alert', { campaignId: c.id, kind, reportCount: c.reportCount, linkDomains: c.linkDomains, status: c.status, firstSeen: c.firstSeen, lastSeen: c.lastSeen })).ok,
  );
  const guard = new RegistrationGuard(
    store,
    { ...DEFAULT_GUARD, ...o.guard },
    o.clock,
    async (tenant, alert) => {
      if (tenant.webhookUrl) void registry.sendWebhook(tenant.id, 'registration_alert', { ...alert });
      const to = tenant.alertEmails?.filter(Boolean) ?? [];
      if (!mailer || to.length === 0) return;
      const mail = registrationAlertEmail(tenant, alert, { ...emailOptions, now: svc.now() });
      await mailer.send({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: `registration-alert/${tenant.id}/${alert.id}`,
        tags: [{ name: 'type', value: mail.template }],
      });
    },
    logger,
  );
  svc.guard = guard;
  svc.licences = { registry: o.licences ?? new MemoryLicenceRegistry(BUNDLED_LICENCES), maxAgeDays: o.licenceMaxAgeDays ?? DEFAULT_LICENCE_MAX_AGE_DAYS };
  if (o.simSwap) {
    svc.simSwap = new SimSwapMonitor(o.simSwap, { ...DEFAULT_SIM_SWAP, ...o.simSwapSettings }, {
      clock: () => svc.now(),
      log: { warn: (obj, msg) => logger.warn(obj, msg) },
      count: (tenantId, key) => void store.countSimSwap(tenantId, key).catch(() => {}),
      onSwap: async (tenantId, recipientKey, latestSimChange) => {
        const tenant = tenants.get(tenantId);
        if (tenant?.webhookUrl) void registry.sendWebhook(tenantId, 'sim_swap', { reference: recipientKey.slice(0, 16), latestSimChange });
        const to = tenant?.alertEmails?.filter(Boolean) ?? [];
        if (!tenant || !mailer || to.length === 0) return;
        const reference = recipientKey.slice(0, 16);
        const mail = simSwapAlertEmail(tenant, { reference, latestSimChange }, { ...emailOptions, now: svc.now() });
        await mailer.send({
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          idempotencyKey: `sim-swap/${tenant.id}/${reference}/${latestSimChange ?? 'unknown'}`,
          tags: [{ name: 'type', value: mail.template }],
        });
      },
    });
  }
  const runAgent = async (only?: Tenant[]) => {
    const results = await runAgentForAll(store, o.agentModel ?? model, only ?? tenants.values(), { now: o.clock, briefingTimeoutMs: o.agentTimeoutMs });
    const emails = await alerts.afterRun(results);
    return { results, emails };
  };
  const app = buildApp({
    svc,
    runAgent,
    agentJobToken: o.agentJobToken ?? null,
    push,
    mailer,
    emailOptions,
    bankAuth,
    customerAuth,
    limiterFactory: limiters,
    usage: (e) => void store.recordApiCall(e).catch(() => {}),
    console: {
      access: consoleAccess,
      registry,
      svc,
      loginLimiter: limiters('console-login', o.adminLoginRateLimitPerMinute ?? 10),
      failLimiter: limiters('console-login-failures', 300),
      limiter: limiters('console', 600),
      demoTenantId: o.consoleDemoTenantId ?? null,
    },
    admin: adminAuth
      ? {
          registry,
          auth: adminAuth,
          consoleAccess,
          svc,
          mailer,
          emailOptions,
          loginLimiter: limiters('admin-login', o.adminLoginRateLimitPerMinute ?? 10),
          adminLimiter: limiters('admin', 600),
          secureCookies: o.production ?? false,
          platform: async () => ({
            integrations: o.integrations ?? null,
            masterKeySet: registry.masterKeySet,
            registryLoadedAt: registry.loadedAt,
            keyActivationSeconds,
            webhooks: webhooks instanceof MemoryWebhookSender ? 'kept in memory (tests and demos)' : 'sent over HTTP(S)',
            limits: {
              verifyPerMinute: o.verifyRateLimitPerMinute ?? 30,
              reportsPerMinute: o.reportRateLimitPerMinute ?? 10,
              tokenPerMinute: o.tokenRateLimitPerMinute ?? 20,
              simSwapPerMinute: o.simSwapRateLimitPerMinute ?? 600,
              adminLoginPerMinute: o.adminLoginRateLimitPerMinute ?? 10,
            },
            retention: { recordTtlDays: o.recordTtlDays ?? 30, receiptTtlDays: o.receiptTtlDays ?? 30, advisoryTtlDays: o.advisoryTtlDays ?? 14 },
            guard: { ...DEFAULT_GUARD, ...o.guard },
            licences: await svc.licenceStatus().catch(() => ({ status: 'unavailable', maxAgeDays: 0, sources: [] })),
            adminSessionHours: o.adminSessionHours ?? 8,
          }),
        }
      : null,
    events,
    verifyLimiter: limiters('verify', o.verifyRateLimitPerMinute ?? 30),
    reportLimiter: limiters('reports', o.reportRateLimitPerMinute ?? 10),
    tokenLimiter: limiters('token', o.tokenRateLimitPerMinute ?? 20),
    simSwapLimiter: limiters('simswap', o.simSwapRateLimitPerMinute ?? 600),
    simulatedMno: o.simSwap instanceof SimulatedMno ? o.simSwap : null,
    messaging,
    whatsapp: o.whatsapp ?? null,
    ussd: o.ussd ?? null,
    allowDemoReset: o.allowDemoReset ?? false,
    corsOrigins: o.corsOrigins ?? false,
    trustProxy: o.trustProxy ?? false,
    logger: o.logger ?? true,
    logStream: o.logStream,
  });
  logger.warn = (obj, msg) => app.log.warn(obj, msg);
  logger.error = (obj, msg) => app.log.error(obj, msg);
  app.addHook('onReady', async () => {
    try {
      await registry.refresh();
    } catch (err) {
      app.log.error({ err: { message: (err as Error).message } }, 'admin registry: could not load organisations from the store');
    }
    try {
      const seeded = await registry.seedEnvOrgs();
      if (seeded.length) app.log.info({ organisations: seeded }, 'organisations from GASKIYA_TENANTS stored in the registry');
    } catch (err) {
      app.log.error({ err: { message: (err as Error).message } }, 'organisations from GASKIYA_TENANTS could not be stored');
    }
    try {
      const issued = await consoleAccess.ensureAll(tenants.keys());
      if (issued.length) app.log.info({ organisations: issued }, 'bank console codes issued');
    } catch (err) {
      app.log.error({ err: { message: (err as Error).message } }, 'bank console codes could not be issued');
    }
  });
  return { app, svc, store, model, agentModel: o.agentModel ?? model, push, messaging, mailer, events, tenants, alerts, guard, runAgent, registry, adminAuth, keys, webhooks, bankAuth, consoleAccess };
}

export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'none') return new NoModelProvider();
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) return warnNoKey('OPENAI_API_KEY');
    return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, embeddingModel: env.OPENAI_EMBEDDING_MODEL, baseUrl: env.OPENAI_BASE_URL });
  }
  if (provider === 'ollama') {
    return new OllamaProvider({ url: env.OLLAMA_URL, model: env.OLLAMA_MODEL, visionModel: env.OLLAMA_VISION_MODEL, embeddingModel: env.OLLAMA_EMBEDDING_MODEL });
  }
  if (provider !== 'gemini') throw new Error('AI_PROVIDER must be gemini, openai, ollama or none');
  if (!env.GEMINI_API_KEY) return warnNoKey('GEMINI_API_KEY');
  return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, embeddingModel: env.GEMINI_EMBEDDING_MODEL, baseUrl: env.GEMINI_BASE_URL });
}

export const AGENT_OLLAMA_DEFAULT_MODEL = 'qwen3:4b-instruct';

export function agentModelFromEnv(env: NodeJS.ProcessEnv, main: ModelProvider): ModelProvider {
  const provider = (env.AGENT_AI_PROVIDER || 'ollama').toLowerCase();
  if (provider === 'same') return main;
  if (provider === 'none') return new NoModelProvider();
  if (provider !== 'ollama') throw new Error('AGENT_AI_PROVIDER must be ollama, same or none');
  const model = env.AGENT_OLLAMA_MODEL || AGENT_OLLAMA_DEFAULT_MODEL;
  return new OllamaProvider({ url: env.OLLAMA_URL, model, visionModel: model, embeddingModel: env.OLLAMA_EMBEDDING_MODEL });
}

function warnNoKey(name: string): ModelProvider {
  console.warn(`${name} is not set: explanations will use the fixed fallback text.`);
  return new NoModelProvider();
}

export interface Integrations {
  store: string;
  ai: string;
  agentAi: string;
  push: string;
  iosCalls: string;
  email: string;
  whatsapp: string;
  ussd: string;
  simSwap: string;
  tenants: string[];
}

export function simSwapFromEnv(env: NodeJS.ProcessEnv, errors: string[]): SimSwapProvider | null {
  const kind = (env.SIM_SWAP_PROVIDER || 'none').toLowerCase();
  if (kind === 'none') return null;
  if (kind === 'simulated') {
    if (env.NODE_ENV === 'production') errors.push('SIM_SWAP_PROVIDER=simulated must not be used in production');
    return new SimulatedMno();
  }
  if (kind !== 'camara') {
    errors.push('SIM_SWAP_PROVIDER must be camara, simulated or none');
    return null;
  }
  const missing = ['SIM_SWAP_API_URL', 'SIM_SWAP_TOKEN_URL', 'SIM_SWAP_CLIENT_ID', 'SIM_SWAP_CLIENT_SECRET'].filter((k) => !env[k]);
  if (missing.length) {
    errors.push(`SIM_SWAP_PROVIDER=camara needs ${missing.join(', ')}`);
    return null;
  }
  for (const k of ['SIM_SWAP_API_URL', 'SIM_SWAP_TOKEN_URL']) {
    const u = env[k]!;
    if (!/^https?:\/\//.test(u)) errors.push(`${k} must be an http(s) URL`);
    else if (env.NODE_ENV === 'production' && !u.startsWith('https://')) errors.push(`${k} must use https in production`);
  }
  const timeoutMs = Number(env.SIM_SWAP_TIMEOUT_MS || 3000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) errors.push('SIM_SWAP_TIMEOUT_MS must be a number of at least 100');
  try {
    return new CamaraSimSwap({
      baseUrl: env.SIM_SWAP_API_URL!,
      tokenUrl: env.SIM_SWAP_TOKEN_URL!,
      clientId: env.SIM_SWAP_CLIENT_ID!,
      clientSecret: env.SIM_SWAP_CLIENT_SECRET!,
      scope: env.SIM_SWAP_SCOPE || undefined,
      timeoutMs,
    });
  } catch {
    return null;
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const errors: string[] = [];
  const parse = <T>(name: string): T | undefined => {
    const raw = env[name];
    if (!raw) {
      errors.push(`${name} is required`);
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      errors.push(`${name} must be valid JSON`);
      return undefined;
    }
  };

  const tenants = parse<Tenant[]>('GASKIYA_TENANTS') ?? [];
  const demoLogin = env.SIM_DEMO_LOGIN === 'true';
  const simBase = !demoLogin ? '' : env.SIM_ENABLED === 'true' ? '/sim' : env.SIM_PUBLIC_URL ? `${env.SIM_PUBLIC_URL.replace(/\/+$/, '')}/sim` : '';
  if (simBase && Array.isArray(tenants)) {
    const demo = tenants.find((t) => t.id === (env.SIM_TENANT_ID || 'demobank'));
    if (demo) {
      demo.customerTokenUrl ??= `${simBase}/customer-token`;
      demo.demoInboxUrl ??= `${simBase}/inbox`;
    }
    let simOrgs: { tenantId?: unknown }[] = [];
    try {
      simOrgs = env.SIM_ORGS ? (JSON.parse(env.SIM_ORGS) as { tenantId?: unknown }[]) : [];
    } catch {
      errors.push('SIM_ORGS must be valid JSON');
    }
    for (const org of Array.isArray(simOrgs) ? simOrgs : []) {
      const t = tenants.find((x) => x.id === org.tenantId);
      if (!t) continue;
      t.customerTokenUrl ??= `${simBase}/customer-token?tenant=${encodeURIComponent(t.id)}`;
      t.demoInboxUrl ??= `${simBase}/inbox`;
    }
  }
  const keys = parse<Record<string, TenantKeyConfig>>('GASKIYA_TENANT_KEYS') ?? {};
  const bankClients = parse<BankClient[]>('GASKIYA_BANK_CLIENTS') ?? [];
  const tokenSecret = env.GASKIYA_TOKEN_SECRET ?? '';
  if (tokenSecret.length < 32) errors.push('GASKIYA_TOKEN_SECRET must be at least 32 characters');

  const admin = adminUsersFromEnv(env, errors);
  const adminOn = admin.users.length > 0 || admin.plain !== null;
  if (Array.isArray(tenants) && tenants.length === 0 && env.GASKIYA_TENANTS && !adminOn) errors.push('GASKIYA_TENANTS must list at least one bank (or switch on the admin dashboard to add them there)');
  let masterKey: Buffer | null = null;
  try {
    masterKey = parseMasterKey(env.GASKIYA_MASTER_KEY);
  } catch (e) {
    errors.push((e as Error).message);
  }
  for (const t of Array.isArray(tenants) ? tenants : []) {
    if (!t.id || !t.name) errors.push('every tenant needs an id and a name');
    if (!t.domains?.length) errors.push(`tenant ${t.id}: domains must list the bank's own domains`);
    if (!t.tokenKeysUrl && !t.tokenKeys) errors.push(`tenant ${t.id}: tokenKeysUrl is required (the bank's JWKS for customer tokens)`);
    const key = keys[t.id];
    if (!key) errors.push(`GASKIYA_TENANT_KEYS has no hashing key for tenant ${t.id}`);
    else {
      try {
        parseTenantKeys(t.id, key);
      } catch (e) {
        errors.push(`${(e as Error).message} (base64)`);
      }
    }
    for (const a of t.alertEmails ?? []) if (!EMAIL_RE.test(a)) errors.push(`tenant ${t.id}: alert email "${a}" is not an email address`);
    errors.push(...orgErrors(t));
    if (t.bankCode !== undefined && !/^[0-9]{6}$/.test(String(t.bankCode))) errors.push(`tenant ${t.id}: bankCode must be the bank's 6-digit NIBSS institution code`);
    if (t.bankCode && tenants.some((o) => o !== t && o.bankCode === t.bankCode)) errors.push(`tenant ${t.id}: bankCode ${t.bankCode} is used by another tenant`);
    for (const [k, u] of [['customerTokenUrl', t.customerTokenUrl], ['demoInboxUrl', t.demoInboxUrl]] as const) {
      if (u && !u.startsWith('/') && !/^https?:\/\//.test(u)) errors.push(`tenant ${t.id}: ${k} must be an http(s) URL or a path on this server`);
    }
  }
  for (const c of Array.isArray(bankClients) ? bankClients : []) {
    if (!c.clientId || !c.clientSecret || c.clientSecret.length < 24) errors.push(`bank client ${c.clientId ?? '?'}: clientId and a clientSecret of 24+ characters are required`);
    if (!tenants.some((t) => t.id === c.tenantId)) errors.push(`bank client ${c.clientId}: tenantId ${c.tenantId} is not a configured tenant`);
  }

  const storeKind = (env.STORE || (env.MONGODB_URI ? 'mongo' : env.FIRESTORE_PROJECT_ID || env.FIRESTORE_EMULATOR_HOST ? 'firestore' : 'memory')).toLowerCase();
  let store: Store = new MemoryStore();
  if (storeKind === 'firestore') {
    try {
      let credentials: { client_email: string; private_key: string } | undefined;
      let raw = env.FIRESTORE_SERVICE_ACCOUNT_JSON?.trim();
      if (raw) {
        if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
        const sa = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string };
        if (!sa.client_email || !sa.private_key) throw new Error('FIRESTORE_SERVICE_ACCOUNT_JSON needs client_email and private_key');
        credentials = { client_email: sa.client_email, private_key: sa.private_key };
        env = { ...env, FIRESTORE_PROJECT_ID: env.FIRESTORE_PROJECT_ID || sa.project_id };
      }
      const projectId = env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
      if (!projectId) throw new Error('set FIRESTORE_PROJECT_ID');
      const shards = env.FIRESTORE_STATS_SHARDS ? Number(env.FIRESTORE_STATS_SHARDS) : undefined;
      if (shards !== undefined && (!Number.isInteger(shards) || shards < 1 || shards > 100)) throw new Error('FIRESTORE_STATS_SHARDS must be a whole number from 1 to 100');
      store = new FirestoreStore({
        projectId,
        databaseId: env.FIRESTORE_DATABASE_ID || undefined,
        prefix: env.FIRESTORE_COLLECTION_PREFIX || 'gaskiya',
        credentials,
        statsShards: shards,
      });
    } catch (e) {
      errors.push(`Firestore: ${(e as Error).message}`);
    }
  } else if (storeKind === 'mongo') {
    if (!env.MONGODB_URI) errors.push('STORE=mongo needs MONGODB_URI');
    else if (!/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
    else store = new MongoStore({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB || 'gaskiyya', prefix: env.MONGODB_COLLECTION_PREFIX || 'gaskiya' });
  } else if (storeKind !== 'memory') {
    errors.push('STORE must be mongo, firestore or memory');
  } else if (env.NODE_ENV === 'production') {
    errors.push('STORE=memory loses every record on restart; set MONGODB_URI in production');
  }

  let model: ModelProvider = new NoModelProvider();
  try {
    model = modelFromEnv(env);
  } catch (e) {
    errors.push((e as Error).message);
  }
  let agentModel: ModelProvider = model;
  try {
    agentModel = agentModelFromEnv(env, model);
  } catch (e) {
    errors.push((e as Error).message);
  }
  const agentTimeoutMs = Number(env.AGENT_AI_TIMEOUT_MS || 60_000);
  if (!Number.isFinite(agentTimeoutMs) || agentTimeoutMs < 1000) errors.push('AGENT_AI_TIMEOUT_MS must be at least 1000');

  let push: PushProvider = new MemoryPush();
  try {
    const sa = serviceAccountFromEnv(env);
    if (sa) push = new FcmPush(sa);
  } catch (e) {
    errors.push(`Firebase: ${(e as Error).message}`);
  }

  let voip: ApnsVoipPush | null = null;
  try {
    const apns = apnsConfigFromEnv(env);
    if (apns) voip = new ApnsVoipPush(apns);
  } catch (e) {
    errors.push(`APNs: ${(e as Error).message}`);
  }

  let mailer: Mailer | null = null;
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) errors.push('EMAIL_FROM is required when RESEND_API_KEY is set, e.g. "Gaskiya <alerts@yourdomain.com>"');
    else mailer = new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO || undefined });
  }
  const alertTenants = tenants.filter((t) => t.alertEmails?.length).map((t) => t.id);

  const whatsapp =
    env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET
      ? { verifyToken: env.WHATSAPP_VERIFY_TOKEN, appSecret: env.WHATSAPP_APP_SECRET, tenantId: env.WHATSAPP_TENANT_ID || tenants[0]?.id || '' }
      : null;
  if ((env.WHATSAPP_VERIFY_TOKEN || env.WHATSAPP_APP_SECRET || env.WHATSAPP_ACCESS_TOKEN) && !(whatsapp && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID)) {
    errors.push('WhatsApp needs all of WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
  }
  const messaging: Messaging =
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? new WhatsAppCloud(env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_ACCESS_TOKEN) : new MemoryMessaging();

  const ussdToken = env.USSD_WEBHOOK_TOKEN || '';
  const ussd = ussdToken ? { token: ussdToken, tenantId: env.USSD_TENANT_ID || tenants[0]?.id || '' } : null;
  if (ussd && ussdToken.length < 24) errors.push('USSD_WEBHOOK_TOKEN must be at least 24 characters');
  if (ussd && Array.isArray(tenants) && !tenants.some((t) => t.id === ussd.tenantId)) errors.push(`USSD_TENANT_ID ${ussd.tenantId || '(empty)'} is not a configured tenant`);

  const num = (name: string, def: number, min: number) => {
    const v = Number(env[name] || def);
    if (!Number.isFinite(v) || v < min) errors.push(`${name} must be a number of at least ${min}`);
    return v;
  };
  const settings = {
    recordTtlDays: num('RECORD_TTL_DAYS', 30, 1),
    receiptTtlDays: num('RECEIPT_TTL_DAYS', 30, 1),
    callRingSeconds: num('CALL_RING_SECONDS', 180, 30),
    registerMaxFutureSeconds: num('REGISTER_MAX_FUTURE_SECONDS', 300, 0),
    advisoryTtlDays: num('ADVISORY_TTL_DAYS', 14, 1),
    aiTimeoutMs: num('AI_TIMEOUT_MS', (env.AI_PROVIDER || '').toLowerCase() === 'ollama' ? 10_000 : 4000, 500),
    verifyRateLimitPerMinute: num('VERIFY_RATE_LIMIT_PER_MINUTE', 30, 1),
    reportRateLimitPerMinute: num('REPORT_RATE_LIMIT_PER_MINUTE', 10, 1),
    tokenRateLimitPerMinute: num('TOKEN_RATE_LIMIT_PER_MINUTE', 20, 1),
    agentIntervalSeconds: num('AGENT_INTERVAL_SECONDS', 60, 10),
    agentInProcess: env.AGENT_IN_PROCESS !== 'false',
    guard: {
      spikeWindowMinutes: num('REG_SPIKE_WINDOW_MINUTES', DEFAULT_GUARD.spikeWindowMinutes, 1),
      spikeBaselineMinutes: num('REG_SPIKE_BASELINE_MINUTES', DEFAULT_GUARD.spikeBaselineMinutes, 1),
      spikeFactor: num('REG_SPIKE_FACTOR', DEFAULT_GUARD.spikeFactor, 1),
      spikeMinCount: num('REG_SPIKE_MIN_COUNT', DEFAULT_GUARD.spikeMinCount, 1),
    },
  };
  if (env.AGENT_IN_PROCESS && !['true', 'false'].includes(env.AGENT_IN_PROCESS)) errors.push('AGENT_IN_PROCESS must be true or false');
  const agentJobToken = env.AGENT_JOB_TOKEN || null;
  if (agentJobToken && agentJobToken.length < 32) errors.push('AGENT_JOB_TOKEN must be at least 32 characters (e.g. openssl rand -hex 32)');
  // Limits are shared through the store when it is a database, so every replica counts the same requests.
  const shared = store instanceof MongoStore || store instanceof FirestoreStore;
  const limitKind = (env.RATE_LIMIT_STORE || (shared ? 'store' : 'memory')).toLowerCase();
  let rateLimiters: RateLimiterFactory = memoryRateLimiters;
  if (['store', 'mongo', 'firestore'].includes(limitKind)) {
    if (store instanceof MongoStore) rateLimiters = mongoRateLimiters(store.db, store.prefix);
    else if (store instanceof FirestoreStore) rateLimiters = firestoreRateLimiters(store.db, store.prefix);
    else errors.push(`RATE_LIMIT_STORE=${limitKind} needs a database store (set MONGODB_URI)`);
  } else if (limitKind !== 'memory') {
    errors.push('RATE_LIMIT_STORE must be store or memory');
  }

  const corsList = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const corsOrigins: string[] | boolean = corsList.includes('*') ? true : corsList.length ? corsList : false;
  if (corsOrigins === true && env.NODE_ENV === 'production') errors.push('CORS_ORIGINS=* must not be used in production; list the allowed origins');

  const simSwap = simSwapFromEnv(env, errors);
  const simSwapSettings: SimSwapSettings = {
    warnHours: num('SIM_SWAP_WARN_HOURS', DEFAULT_SIM_SWAP.warnHours, 1),
    waitMs: num('SIM_SWAP_WAIT_MS', DEFAULT_SIM_SWAP.waitMs, 50),
    cacheSeconds: num('SIM_SWAP_CACHE_SECONDS', DEFAULT_SIM_SWAP.cacheSeconds, 0),
  };
  if (simSwapSettings.warnHours > 2400) errors.push('SIM_SWAP_WARN_HOURS must be at most 2400 (the CAMARA maxAge limit)');
  const simSwapRateLimitPerMinute = num('SIM_SWAP_RATE_LIMIT_PER_MINUTE', 600, 1);
  const refreshSeconds = num('ADMIN_REFRESH_SECONDS', 30, 5);
  const adminSettings = {
    sessionHours: num('ADMIN_SESSION_HOURS', 8, 1),
    refreshSeconds,
    loginRateLimitPerMinute: num('ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE', 10, 1),
    keyActivationSeconds: num('KEY_ACTIVATION_SECONDS', shared ? refreshSeconds * 2 : 0, 0),
  };
  if (adminSettings.sessionHours > 72) errors.push('ADMIN_SESSION_HOURS must be at most 72');

  const allowDemoReset = env.ALLOW_DEMO_RESET === 'true';
  if (allowDemoReset && env.NODE_ENV === 'production') errors.push('ALLOW_DEMO_RESET must not be true in production');

  const licenceDir = env.LICENCE_DATA_DIR || '';
  const licences: LicenceRegistry = licenceDir ? new DirectoryLicenceRegistry(licenceDir) : new MemoryLicenceRegistry(BUNDLED_LICENCES);
  const licenceMaxAgeDays = num('LICENCE_MAX_AGE_DAYS', DEFAULT_LICENCE_MAX_AGE_DAYS, 1);

  if (errors.length) {
    throw new Error(`Configuration problems:\n  - ${errors.join('\n  - ')}\nSee .env.example.`);
  }

  const integrations: Integrations = {
    store:
      store instanceof MongoStore
        ? `MongoDB (database ${store.db.databaseName}, prefix ${store.prefix})`
        : store instanceof FirestoreStore
        ? `Firestore (project ${env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT}${env.FIRESTORE_EMULATOR_HOST ? `, emulator ${env.FIRESTORE_EMULATOR_HOST}` : ''}, prefix ${env.FIRESTORE_COLLECTION_PREFIX || 'gaskiya'})`
        : 'memory: not persisted, demo only',
    ai:
      model instanceof GeminiProvider
        ? `Gemini (${model.model})`
        : model instanceof OpenAIProvider
          ? `OpenAI (${model.model})`
          : model instanceof OllamaProvider
            ? `Ollama at ${model.url} (${model.model}, vision ${model.visionModel}, embeddings ${model.embeddingModel})`
            : 'off: fixed fallback explanations',
    agentAi:
      agentModel === model
        ? 'same as explanations'
        : agentModel instanceof OllamaProvider
          ? `Ollama at ${agentModel.url} (${agentModel.model}), briefings time out after ${agentTimeoutMs} ms`
          : 'off: template briefings',
    push: push instanceof FcmPush ? `Firebase Cloud Messaging (project ${push.projectId})` : 'off: live in-app events only',
    iosCalls: voip ? `CallKit ringing through APNs VoIP (${voip.topic}, ${voip.host.includes('sandbox') ? 'sandbox' : 'production'})` : 'off: iPhones get the call banner only',
    email: mailer ? (alertTenants.length ? `Resend, campaign alerts for ${alertTenants.join(', ')}` : 'Resend, but no tenant lists alertEmails') : 'off',
    whatsapp: whatsapp ? `on for ${whatsapp.tenantId}` : 'off',
    ussd: ussd ? `on for ${ussd.tenantId}` : 'off',
    simSwap: simSwap ? `${simSwap.name}, customer warnings within ${simSwapSettings.warnHours} hours` : 'off',
    tenants: tenants.map((t) => t.id),
  };
  const adminSummary = adminOn ? `on at /admin/ for ${[...admin.users.map((u) => u.username), ...(admin.plain ? [admin.plain.username] : [])].join(', ')}${masterKey ? '' : ' (GASKIYA_MASTER_KEY not set: cannot add organisations)'}` : 'off';
  const licenceSummary = `${licenceDir ? `directory ${licenceDir}` : `bundled (${BUNDLED_LICENCES.map((f) => `${f.source.id}${f.source.sample ? ' SAMPLE' : ''}`).join(', ')})`}, stale after ${licenceMaxAgeDays} days`;
  return { tenants, keys, bankClients, tokenSecret, store, model, agentModel, agentTimeoutMs, push, voip, mailer, whatsapp, ussd, messaging, settings, allowDemoReset, agentJobToken, rateLimiters, corsOrigins, trustProxy: env.TRUST_PROXY === 'true', licences, licenceMaxAgeDays, licenceSummary, integrations, simSwap, simSwapSettings, simSwapRateLimitPerMinute, admin, adminSummary, masterKey, adminSettings, production: env.NODE_ENV === 'production' };
}

export function buildSystemFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const cfg = configFromEnv(env);
  const sys = createSystem({
    tenants: cfg.tenants,
    keys: new StaticKeyService(cfg.keys),
    bankClients: cfg.bankClients,
    tokenSecret: cfg.tokenSecret,
    store: cfg.store,
    model: cfg.model,
    agentModel: cfg.agentModel,
    agentTimeoutMs: cfg.agentTimeoutMs,
    push: cfg.push,
    voip: cfg.voip,
    mailer: cfg.mailer,
    consoleUrl: env.CONSOLE_URL || undefined,
    emailLogoUrl: env.EMAIL_LOGO_URL || undefined,
    messaging: cfg.messaging,
    whatsapp: cfg.whatsapp,
    ussd: cfg.ussd,
    recordTtlDays: cfg.settings.recordTtlDays,
    receiptTtlDays: cfg.settings.receiptTtlDays,
    callRingSeconds: cfg.settings.callRingSeconds,
    registerMaxFutureSeconds: cfg.settings.registerMaxFutureSeconds,
    advisoryTtlDays: cfg.settings.advisoryTtlDays,
    aiTimeoutMs: cfg.settings.aiTimeoutMs,
    verifyRateLimitPerMinute: cfg.settings.verifyRateLimitPerMinute,
    reportRateLimitPerMinute: cfg.settings.reportRateLimitPerMinute,
    tokenRateLimitPerMinute: cfg.settings.tokenRateLimitPerMinute,
    rateLimiters: cfg.rateLimiters,
    guard: cfg.settings.guard,
    allowDemoReset: cfg.allowDemoReset,
    agentJobToken: cfg.agentJobToken,
    corsOrigins: cfg.corsOrigins,
    trustProxy: cfg.trustProxy,
    licences: cfg.licences,
    licenceMaxAgeDays: cfg.licenceMaxAgeDays,
    simSwap: cfg.simSwap,
    simSwapSettings: cfg.simSwapSettings,
    simSwapRateLimitPerMinute: cfg.simSwapRateLimitPerMinute,
    masterKey: cfg.masterKey,
    adminUsers: cfg.admin.users,
    adminPassword: cfg.admin.plain,
    adminSessionHours: cfg.adminSettings.sessionHours,
    consoleDemoTenantId: env.SIM_ENABLED === 'true' && env.SIM_DEMO_LOGIN === 'true' ? env.SIM_TENANT_ID || 'demobank' : null,
    adminLoginRateLimitPerMinute: cfg.adminSettings.loginRateLimitPerMinute,
    keyActivationSeconds: cfg.adminSettings.keyActivationSeconds,
    webhooks: new HttpWebhookSender(),
    integrations: cfg.integrations,
    production: cfg.production,
  });
  return { ...sys, adminSettings: cfg.adminSettings, adminSummary: cfg.adminSummary, settings: cfg.settings, integrations: cfg.integrations, licenceSummary: cfg.licenceSummary };
}

export function systemFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const sys = buildSystemFromEnv(env);
  const store = sys.store;
  const sweep = setInterval(() => (store instanceof MemoryStore ? store.sweep() : undefined), 60_000);
  sweep.unref();
  const reload = setInterval(() => {
    sys.registry
      .refresh()
      .then(() => sys.consoleAccess.ensureAll(sys.tenants.keys()))
      .catch((err: Error) => sys.app.log.error({ err: { message: err.message } }, 'admin registry refresh failed'));
  }, sys.adminSettings.refreshSeconds * 1000);
  reload.unref();
  if (sys.settings.agentInProcess) {
    const agent = setInterval(() => {
      sys.runAgent().catch((err: Error) => sys.app.log.error({ err: { message: err.message } }, 'campaign agent failed'));
    }, sys.settings.agentIntervalSeconds * 1000);
    agent.unref();
  }
  return sys;
}

export { orgErrors } from './orgs.ts';
export { FirestoreStore } from './store/firestore.ts';
export { MongoStore } from './store/mongo.ts';
export { MemoryRateLimiter, FirestoreRateLimiter, MongoRateLimiter, memoryRateLimiters, firestoreRateLimiters, mongoRateLimiters, type RateLimiter, type RateLimiterFactory } from './ratelimit/ratelimit.ts';
export { RegistrationGuard, DEFAULT_GUARD } from './guard.ts';
export { MemoryStore, StaticKeyService, MemoryPush, MemoryMessaging, NoModelProvider, GeminiProvider, OpenAIProvider, OllamaProvider, FcmPush, ResendMailer, MemoryMailer };
export type { Store, Tenant, ModelProvider, KeyService, BankClient };
export { ManagedKeyService } from './keys/managed.ts';
export { AdminRegistry, AdminError } from './admin/registry.ts';
export { AdminAuth } from './admin/session.ts';
export { hashSecret, verifySecret } from './admin/crypto.ts';
export { MemoryWebhookSender, HttpWebhookSender, signWebhook, type WebhookSender } from './channels/webhook.ts';
export { ApnsVoipPush, MemoryVoipPush, apnsConfigFromEnv, type VoipPush, type VoipCall } from './channels/voip.ts';
export { localEmbed } from './ai/provider.ts';
export { claimsGenuine } from './ai/explain.ts';
export { senderWarnings } from './domain/sender.ts';
export { maskDigits, callbackDigest, extractPhoneNumbers } from './domain/text.ts';
export { checkLink } from './domain/link.ts';

export { MemoryLicenceRegistry, UnavailableLicenceRegistry, type LicenceRegistry } from './licences/registry.ts';
export { DirectoryLicenceRegistry } from './licences/directory.ts';
export { contactFacts, parseContact, contactPhone } from './domain/contact.ts';
export { decideContactVerdict, decideLicenceVerdict, decideLinkVerdict, decideReceiptVerdict, decideVerdict, decideSimSwapWarnings, decideSimSwapStatus, decideOtpHold } from './domain/verdict.ts';
export { CamaraSimSwap, MemorySimSwap, SimulatedMno, SimSwapError, SimSwapMonitor, DEFAULT_SIM_SWAP, type SimSwapProvider, type SimSwapSettings };
