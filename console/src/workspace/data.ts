import { sim, type Campaign, type Coverage, type Metrics, type RegistrationAlert, type SimConfig } from '../api.ts';

export interface OrgProfile {
  id: string;
  name: string;
  legalName: string | null;
  kind: 'bank' | 'agency' | 'company';
  status: 'active' | 'suspended';
  mode: 'live' | 'sandbox';
  bankCode: string | null;
  domains: string[];
  senderIds: string[];
  officialContacts: { phones: string[]; whatsapp: string[]; emails: string[]; social: { platform: string; handle: string }[] };
  officialApps: { android: string[]; ios: string[] };
  alertEmails: string[];
  technicalContact: { name: string; email: string; phone?: string } | null;
  features: Record<string, boolean>;
}

export interface UsageDay {
  day: string;
  calls: number;
  errors: number;
}

export interface ApiErrorEvent {
  at: string;
  clientId: string | null;
  method: string;
  route: string;
  status: number;
  code: string | null;
}

export interface ClientView {
  clientId: string;
  label: string;
  source: 'admin' | 'env';
  status: 'active' | 'revoked';
  secretHint: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface KeyView {
  version: number;
  state: 'current' | 'previous' | 'pending' | 'retired';
  activatesAt: string | null;
  createdAt: string | null;
}

export interface Integration {
  clients: ClientView[];
  keys: KeyView[];
  webhook: { url: string; createdAt: string | null } | null;
  usage: UsageDay[];
  errors: ApiErrorEvent[];
  checklist: { id: string; label: string; done: boolean }[];
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
}

export interface Overview {
  coverage: Coverage;
  usage: UsageDay[];
  campaigns: { total: number; new: number; liveAdvisories: number; drafts: number };
  alerts: RegistrationAlert[];
}

export type CampaignAction = 'approve' | 'dismiss' | 'withdraw';

export interface Workspace {
  kind: 'live' | 'demo';
  profile: OrgProfile;
  accessLabel: string | null;
  metrics(): Promise<Metrics>;
  overview(): Promise<Overview>;
  campaigns(): Promise<Campaign[]>;
  campaignAction(id: string, action: CampaignAction, analyst: string): Promise<void>;
  runAgent(): Promise<number>;
  alerts(): Promise<RegistrationAlert[]>;
  integration(): Promise<Integration>;
  activity(): Promise<ActivityEntry[]>;
  // Demo only: these act as DemoBank's own systems and its customers.
  sendAdvisory?(id: string): Promise<number>;
  seedReports?(): Promise<number>;
  reset?(): Promise<void>;
}

export class SignedOut extends Error {}

export const NO_CODE = '';

export const CODE_LENGTH = 6;

// Keeps only the characters a code can hold, upper-cased, so pasting "ab 12-cd" gives "AB12CD".
export function formatCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
}

// A demo server shows its demo organisation's code on the sign-in page; other servers answer 404.
export async function demoCode(): Promise<{ name: string; code: string } | null> {
  try {
    const r = await request<{ org: { name: string }; code: string }>('GET', '/v1/console/demo', null);
    return { name: r.org.name, code: r.code };
  } catch {
    return null;
  }
}


const SESSION_KEY = 'gaskiyya.console.session';

export interface StoredSession {
  token: string;
  expiresAt: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as StoredSession) : null;
    return s && typeof s.token === 'string' && Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage the bank signs in again on the next visit.
  }
}

async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (res.status === 401 && token) throw new SignedOut(data.message ?? 'Signed out');
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data as T;
}

export async function signIn(code: string): Promise<{ session: StoredSession; profile: OrgProfile; accessLabel: string }> {
  const r = await request<{ token: string; expiresAt: string; org: OrgProfile; access: { label: string } }>('POST', '/v1/console/session', null, { code });
  return { session: { token: r.token, expiresAt: r.expiresAt }, profile: r.org, accessLabel: r.access.label };
}

export async function resume(s: StoredSession): Promise<{ profile: OrgProfile; accessLabel: string }> {
  const r = await request<{ org: OrgProfile; access: { label: string } }>('GET', '/v1/console/session', s.token);
  return { profile: r.org, accessLabel: r.access.label };
}

export async function signOut(s: StoredSession) {
  await request('POST', '/v1/console/session/logout', s.token).catch(() => {});
  saveSession(null);
}

export function liveWorkspace(token: string, profile: OrgProfile, accessLabel: string): Workspace {
  const get = <T,>(path: string) => request<T>('GET', path, token);
  const post = <T,>(path: string, body: unknown = {}) => request<T>('POST', path, token, body);
  return {
    kind: 'live',
    profile,
    accessLabel,
    metrics: () => get<Metrics>('/v1/console/metrics'),
    overview: () => get<Overview>('/v1/console/overview'),
    campaigns: async () => (await get<{ campaigns: Campaign[] }>('/v1/console/campaigns')).campaigns,
    campaignAction: async (id, action, analyst) => {
      await post(`/v1/console/campaigns/${encodeURIComponent(id)}/${action}`, action === 'dismiss' ? {} : { analyst });
    },
    runAgent: async () => ((await post<{ campaignsTouched?: string[] }>('/v1/console/agent/run')).campaignsTouched ?? []).length,
    alerts: async () => (await get<{ alerts: RegistrationAlert[] }>('/v1/console/alerts')).alerts,
    integration: () => get<Integration>('/v1/console/integration'),
    activity: async () => (await get<{ entries: ActivityEntry[] }>('/v1/console/activity')).entries,
  };
}

// DemoBank runs on the simulator routes, which act as the bank's own systems against the registry.
export async function demoWorkspace(config: SimConfig): Promise<Workspace> {
  const orgs = await sim.organisations().catch(() => ({ organisations: [] }));
  const org = orgs.organisations.find((o) => o.id === config.bank.id);
  const profile: OrgProfile = {
    id: config.bank.id,
    name: config.bank.name,
    legalName: `${config.bank.name} Plc (demo)`,
    kind: 'bank',
    status: 'active',
    mode: 'sandbox',
    bankCode: config.bank.bankCode ?? null,
    domains: org?.domains ?? (config.bank.domain ? [config.bank.domain] : []),
    senderIds: org?.senderIds ?? [config.bank.name],
    officialContacts: org?.officialContacts ?? { phones: [], whatsapp: [], emails: [], social: [] },
    officialApps: org?.officialApps ?? { android: [], ios: [] },
    alertEmails: [],
    technicalContact: null,
    features: { messages: true, calls: true, receipts: true, simSwap: Boolean(config.simSwap), advisories: true, ussd: true, whatsapp: true },
  };
  const log: ActivityEntry[] = [];
  const record = (action: string, target: string | null, details: Record<string, unknown> = {}) =>
    log.unshift({ id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), actor: 'You (demo)', action, target, details });

  const coverageOf = (m: Metrics) => m.coverage;
  return {
    kind: 'demo',
    profile,
    accessLabel: null,
    metrics: () => sim.metrics(),
    overview: async () => {
      const [m, c, a] = await Promise.all([sim.metrics(), sim.campaigns(), sim.alerts()]);
      return {
        coverage: coverageOf(m),
        usage: [],
        campaigns: {
          total: c.campaigns.length,
          new: c.campaigns.filter((x) => x.status === 'new').length,
          liveAdvisories: c.campaigns.filter((x) => x.advisory.status === 'approved' && (!x.advisory.expiresAt || Date.parse(x.advisory.expiresAt) > Date.now())).length,
          drafts: c.campaigns.filter((x) => x.status !== 'dismissed' && x.advisory.status === 'draft').length,
        },
        alerts: a.alerts.slice(0, 5),
      };
    },
    campaigns: async () => (await sim.campaigns()).campaigns,
    campaignAction: async (id, action, analyst) => {
      await sim.campaignAction(id, action, analyst);
      record(`console.${action === 'dismiss' ? 'campaign_dismiss' : `advisory_${action}`}`, id, action === 'dismiss' ? {} : { analyst });
    },
    runAgent: async () => {
      const r = await sim.runAgent();
      record('console.agent_run', null, { campaigns: r.campaignsTouched.length });
      return r.campaignsTouched.length;
    },
    alerts: async () => (await sim.alerts()).alerts,
    integration: async () => {
      const m = await sim.metrics();
      return {
        clients: [{ clientId: `${config.bank.id}-sim`, label: `${config.bank.name} notification service (simulator)`, source: 'env', status: 'active', secretHint: null, createdAt: null, lastUsedAt: m.registrations > 0 ? new Date().toISOString() : null }],
        keys: [{ version: 1, state: 'current', activatesAt: null, createdAt: null }],
        webhook: null,
        usage: [],
        errors: [],
        checklist: [
          { id: 'profile', label: 'Domains and sender IDs listed', done: profile.domains.length > 0 && profile.senderIds.length > 0 },
          { id: 'tokenKeys', label: 'Customer token keys (JWKS) set', done: true },
          { id: 'hashingKey', label: 'Hashing key in place', done: true },
          { id: 'client', label: 'An active API client', done: true },
          { id: 'firstCall', label: 'First registry call made', done: m.registrations > 0 },
          { id: 'contacts', label: 'Official contacts published', done: profile.officialContacts.phones.length > 0 },
          { id: 'alerts', label: 'Alert email or webhook set', done: false },
          { id: 'bankCode', label: 'NIBSS bank code set (transfer receipts)', done: Boolean(profile.bankCode) },
          { id: 'live', label: 'Switched to live', done: false },
        ],
      };
    },
    activity: async () => [...log],
    sendAdvisory: async (id) => {
      const r = await sim.sendAdvisory(id);
      record('console.advisory_send', id, { customers: r.sent });
      return r.sent;
    },
    seedReports: async () => (await sim.seedReports()).reported,
    reset: async () => {
      await sim.reset();
      log.length = 0;
    },
  };
}
