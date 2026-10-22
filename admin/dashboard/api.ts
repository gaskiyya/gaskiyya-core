// Calls the registry's /v1/admin routes on the same origin (decision 0020).
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SIGN_IN = '/admin/login';

// The session is an HttpOnly cookie set at sign-in; the header marks requests as coming from this page.
async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), 'x-gaskiya-admin': '1' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'The registry cannot be reached');
  }
  const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (res.status === 401) window.location.replace(SIGN_IN);
  // A failed test send answers 502 with { ok: false, error }: shown, not thrown.
  if (!res.ok && !(res.status === 502 && /\/(test|test-email)$/.test(path))) {
    throw new ApiError(res.status, data.code ?? 'error', data.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export type OrgKind = 'bank' | 'agency' | 'company';
export type Feature = 'messages' | 'calls' | 'receipts' | 'simSwap' | 'advisories' | 'ussd' | 'whatsapp';
export const FEATURES: { id: Feature; label: string; help: string }[] = [
  { id: 'messages', label: 'Message registration', help: 'POST /v1/messages and /v1/messages/batch' },
  { id: 'calls', label: 'Call announcements', help: 'POST /v1/calls and PATCH /v1/calls/{id}' },
  { id: 'receipts', label: 'Transfer receipts', help: 'POST /v1/receipts (needs a bank code)' },
  { id: 'simSwap', label: 'SIM swap checks', help: 'POST /v1/sim-swap/check' },
  { id: 'advisories', label: 'Fraud desk advisories', help: 'Approving campaign warnings for customers' },
  { id: 'ussd', label: 'USSD channel', help: 'Only for the organisation named in USSD_TENANT_ID' },
  { id: 'whatsapp', label: 'WhatsApp channel', help: 'Only for the organisation named in WHATSAPP_TENANT_ID' },
];

export interface Social {
  platform: 'x' | 'facebook' | 'instagram' | 'tiktok' | 'telegram';
  handle: string;
}

export interface OrgProfile {
  id: string;
  name: string;
  legalName?: string;
  kind: OrgKind;
  bankCode?: string;
  domains: string[];
  senderIds: string[];
  officialContacts?: { phones?: string[]; whatsapp?: string[]; emails?: string[]; social?: Social[] };
  officialApps?: { android?: string[]; ios?: string[] };
  alertEmails?: string[];
  tokenKeysUrl?: string;
  tokenKeys?: { keys: Record<string, unknown>[] };
  customerTokenUrl?: string;
  logoUrl?: string;
  recordTtlDays?: number;
  technicalContact?: { name: string; email: string; phone?: string };
  status: 'active' | 'suspended';
  mode: 'live' | 'sandbox';
  features: Record<Feature, boolean>;
  limits: { bankApiPerMinute?: number | null; customerChecksPerMinute?: number | null };
  webhookUrl?: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  kind: OrgKind;
  source: 'admin' | 'env' | null;
  status: 'active' | 'suspended';
  mode: 'live' | 'sandbox';
  bankCode: string | null;
  domains: string[];
  features: Record<Feature, boolean>;
  clients: { active: number; total: number };
  lastUsedAt: string | null;
  keyVersion: number | null;
  hasKey: boolean;
  webhook: boolean;
  alertEmails: number;
  usage: { registrations: number; receiptsRegistered: number; checks: number; confirmed: number; notConfirmed: number; cannotCheck: number; reports: number; openCalls: number } | null;
  api: { today: number; last7Days: number; errors7Days: number } | null;
}

export interface ClientView {
  clientId: string;
  tenantId: string;
  label: string;
  source: 'admin' | 'env';
  status: 'active' | 'revoked';
  secretHint: string | null;
  createdAt: string | null;
  createdBy: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
  previousSecretExpiresAt: string | null;
}

export interface KeyView {
  version: number;
  source: 'env' | 'admin';
  state: 'current' | 'previous' | 'pending' | 'retired';
  activatesAt: string | null;
  createdAt: string | null;
  createdBy: string | null;
  retiredAt: string | null;
  retiredBy: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  tenantId: string | null;
  target: string | null;
  details: Record<string, string | number | boolean | null | string[]>;
  ip: string | null;
}

export interface UsageDay {
  day: string;
  calls: number;
  errors: number;
  byRoute: Record<string, number>;
  byStatus: Record<string, number>;
  byClient: Record<string, number>;
}

export interface ApiErrorEvent {
  tenantId: string;
  clientId: string;
  method: string;
  route: string;
  status: number;
  code: string | null;
  at: string;
}

export interface OrgDetail {
  org: OrgProfile;
  summary: OrgSummary;
  meta: {
    source: 'admin' | 'env' | null;
    profileOverridden: boolean;
    notes: string;
    createdAt: string | null;
    createdBy: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
    suspendedReason: string | null;
    suspendedAt: string | null;
    suspendedBy: string | null;
    webhook: { url: string; createdAt: string } | null;
  };
  clients: ClientView[];
  keys: KeyView[];
  metrics: (Record<string, unknown> & { coverage?: { registered: number; checked: number; confirmed: number; notConfirmed: number; cannotCheck: number; notConfirmedRate: number | null; cannotCheckRate: number | null } }) | null;
  usage: UsageDay[];
  errors: ApiErrorEvent[];
  alerts: { id: string; kind: string; domain: string | null; count: number; expected: number | null; firstSeen: string; lastSeen: string }[];
  campaigns: { total: number; new: number; confirmed: number; dismissed: number; liveAdvisories: number };
  audit: AuditEntry[];
  consoleCodes: ConsoleCodeView[];
  consoleCode: string | null;
  checklist: { id: string; label: string; done: boolean }[];
}

export interface ConsoleCodeView {
  id: string;
  tenantId: string;
  hint: string;
  generation: number;
  status: 'active' | 'revoked';
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
}

export interface Overview {
  totals: Record<string, number> & { byKind: Record<string, number> };
  apiByDay: { day: string; calls: number; errors: number }[];
  orgs: OrgSummary[];
  recentAudit: AuditEntry[];
  masterKeySet: boolean;
}

export const admin = {
  async signOut() {
    await call('POST', '/v1/admin/session/logout').catch(() => {});
    window.location.replace(SIGN_IN);
  },
  session: () => call<{ username: string; expiresAt: string }>('GET', '/v1/admin/session'),
  overview: () => call<Overview>('GET', '/v1/admin/overview'),
  settings: () => call<Record<string, unknown>>('GET', '/v1/admin/settings'),
  audit: (q: { org?: string; action?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.org) p.set('org', q.org);
    if (q.action) p.set('action', q.action);
    p.set('limit', String(q.limit ?? 200));
    return call<{ entries: AuditEntry[] }>('GET', `/v1/admin/audit?${p}`);
  },
  orgs: () => call<{ orgs: OrgSummary[] }>('GET', '/v1/admin/orgs'),
  org: (id: string) => call<OrgDetail>('GET', `/v1/admin/orgs/${encodeURIComponent(id)}`),
  validate: (input: unknown) => call<{ ok: boolean; errors: string[] }>('POST', '/v1/admin/orgs/validate', input),
  create: (input: unknown) => call<OrgDetail>('POST', '/v1/admin/orgs', input),
  update: (id: string, patch: unknown) => call<OrgDetail>('PATCH', `/v1/admin/orgs/${encodeURIComponent(id)}`, patch),
  resetProfile: (id: string) => call<OrgDetail>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/reset-profile`, {}),
  suspend: (id: string, reason: string) => call<OrgDetail>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/suspend`, { reason }),
  reactivate: (id: string) => call<OrgDetail>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/reactivate`, {}),
  createClient: (id: string, label: string) => call<{ client: ClientView; clientSecret: string }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/clients`, { label }),
  rotateClient: (id: string, clientId: string, graceMinutes: number) =>
    call<{ client: ClientView; clientSecret: string }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/clients/${encodeURIComponent(clientId)}/rotate`, { graceMinutes }),
  revokeClient: (id: string, clientId: string) => call<{ client: ClientView }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/clients/${encodeURIComponent(clientId)}/revoke`, {}),
  restoreClient: (id: string, clientId: string) => call<{ client: ClientView }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/clients/${encodeURIComponent(clientId)}/restore`, {}),
  rotateKey: (id: string) => call<{ keys: KeyView[] }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/keys/rotate`, {}),
  retireKey: (id: string, version: number) => call<{ keys: KeyView[] }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/keys/${version}/retire`, {}),
  setWebhook: (id: string, url: string) => call<{ url: string; signingSecret: string }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/webhook`, { url }),
  removeWebhook: (id: string) => call('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/webhook/remove`, {}),
  testWebhook: (id: string) => call<{ ok: boolean; status?: number; error?: string }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/webhook/test`, {}),
  testEmail: (id: string) => call<{ ok: boolean; error?: string; to?: string[] }>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/test-email`, {}),
  regenerateConsoleCode: (id: string) => call<OrgDetail>('POST', `/v1/admin/orgs/${encodeURIComponent(id)}/console-code/regenerate`, {}),
  refresh: () => call<{ ok: boolean; loadedAt: string }>('POST', '/v1/admin/refresh', {}),
};
