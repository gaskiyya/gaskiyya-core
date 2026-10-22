import type { ActivityItem, ContactResult, Explanation, LicenceResult, VerifyResult } from '@gaskiya/schemas';
import { contentDigest, maskDigits } from './digest.ts';

export interface LinkResult {
  verdict: 'belongs' | 'official_app' | 'not_confirmed';
  host: string | null;
  matchedDomain: string | null;
  reasons: string[];
  app?: { store: 'play' | 'app_store' | 'apk'; id: string | null; official: boolean };
  bank: string;
}

export type ContactCheck = ContactResult | { verdict: 'not_a_contact' };

export interface CallView {
  id: string;
  purpose: string;
  code: string;
  status: string;
  openedAt: string;
  expiresAt: string;
}

export interface OpenCall {
  verdict?: 'calling' | 'not_calling' | 'cannot_check';
  calling?: boolean;
  bank?: string;
  call?: CallView;
  calls?: CallView[];
}

export type CallState = { kind: 'calling'; calls: CallView[] } | { kind: 'not_calling' } | { kind: 'cannot_check' };

export function callState(r: OpenCall | null | undefined): CallState {
  if (!r || r.verdict === 'cannot_check') return { kind: 'cannot_check' };
  if (r.calling === true) {
    const calls = r.calls ?? (r.call ? [r.call] : []);
    if (calls.length > 0 && calls.every((c) => typeof c?.code === 'string' && c.code.length > 0)) return { kind: 'calling', calls };
    return { kind: 'cannot_check' };
  }
  if (r.calling === false && (r.verdict === undefined || r.verdict === 'not_calling')) return { kind: 'not_calling' };
  return { kind: 'cannot_check' };
}

export type Explained = Explanation & { source: 'model' | 'fallback' };

const tokens = new Map<string, { token: string; exp: number }>();
const tenants = new Map<string, string>();

async function token(phone: string): Promise<string> {
  const t = tokens.get(phone);
  if (t && t.exp > Date.now()) return t.token;
  const tenantId = tenants.get(phone);
  const r = await fetch('/sim/customer-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, ...(tenantId ? { tenantId } : {}) }) });
  if (!r.ok) throw new Error('Could not link to the bank');
  const j = (await r.json()) as { token: string; expiresIn: number };
  tokens.set(phone, { token: j.token, exp: Date.now() + (j.expiresIn - 60) * 1000 });
  return j.token;
}

async function registry<T>(phone: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/sim/registry${path}`, {
    method,
    headers: { authorization: `Bearer ${await token(phone)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Object.assign(new Error(`Registry answered ${r.status}`), { status: r.status });
  return (await r.json()) as T;
}

export interface Advisory {
  id: string;
  bank: string;
  title: string;
  text: string;
  approvedAt: string;
  expiresAt: string;
  linkDomains: string[];
  asksCallback: boolean;
}

export const device = {
  async signIn(phone: string, tenantId?: string): Promise<void> {
    if (tenantId) tenants.set(phone, tenantId);
    else tenants.delete(phone);
    tokens.delete(phone);
    await token(phone);
  },
  signOut(phone: string): void {
    tokens.delete(phone);
    tenants.delete(phone);
  },
  advisories: (phone: string) => registry<{ advisories: Advisory[] }>(phone, 'GET', '/v1/advisories').then((r) => (Array.isArray(r?.advisories) ? r.advisories : null), () => null),
  async verify(phone: string, text: string): Promise<VerifyResult> {
    try {
      return await registry<VerifyResult>(phone, 'POST', '/v1/verify/message', { contentDigest: await contentDigest(text) });
    } catch {
      return { verdict: 'cannot_check' };
    }
  },
  verifyLink: (phone: string, url: string) => registry<LinkResult>(phone, 'POST', '/v1/verify/link', { url }).catch(() => null),
  checkLicence: (phone: string, query: string): Promise<LicenceResult> =>
    registry<LicenceResult>(phone, 'POST', '/v1/verify/licence', { query }).catch(() => ({ verdict: 'cannot_check' as const, regulators: [] })),
  async verifyContact(phone: string, contact: string): Promise<ContactCheck> {
    try {
      const r = await registry<ContactResult>(phone, 'POST', '/v1/verify/contact', { contact });
      return r.verdict === 'official' || r.verdict === 'not_official' ? r : { verdict: 'cannot_check' };
    } catch (e) {
      return (e as { status?: number }).status === 422 ? { verdict: 'not_a_contact' } : { verdict: 'cannot_check' };
    }
  },
  explain: (phone: string, text: string) => registry<Explained>(phone, 'POST', '/v1/explain', { maskedText: maskDigits(text), language: 'en' }).catch(() => null),
  checkCall: (phone: string): Promise<CallState> =>
    registry<OpenCall>(phone, 'GET', '/v1/calls/open').then(callState, () => callState(null)),
  // The customer answering or hanging up on this phone: the agent's call ends with it.
  answerCall: (phone: string, id: string) => registry<{ status: string }>(phone, 'POST', `/v1/calls/${encodeURIComponent(id)}/answer`, {}),
  endCall: (phone: string, id: string) => registry<{ status: string }>(phone, 'POST', `/v1/calls/${encodeURIComponent(id)}/end`, {}),
  report: (phone: string, text: string, indicators: string[]) =>
    registry<{ id: string }>(phone, 'POST', '/v1/reports', { maskedText: maskDigits(text), consent: true, indicators }),
  activity: (phone: string) => registry<{ recentActivity: ActivityItem[]; activityText: string; bank: string }>(phone, 'GET', '/v1/activity'),
};

export const firstLink = (text: string) => text.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i)?.[0]?.replace(/[.,)]+$/, '') ?? null;

export const looksLikeLink = (text: string) => {
  const t = text.trim();
  return !/\s/.test(t) && /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(t);
};

export function normalisePhone(input: string): string | null {
  const d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return /^\+[1-9]\d{6,14}$/.test(d) ? d : null;
  if (d.startsWith('234') && d.length === 13) return `+${d}`;
  if (d.startsWith('0') && d.length === 11) return `+234${d.slice(1)}`;
  if (d.length === 10) return `+234${d}`;
  return null;
}
