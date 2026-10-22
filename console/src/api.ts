export interface AppUser {
  phone: string;
  at: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface InboxItem {
  id: string;
  from: string;
  text: string;
  at: string;
  kind: 'genuine' | 'tampered' | 'fake';
  category?: string;
  channel?: 'sms' | 'whatsapp';
  tenantId?: string;
}

export interface FraudCall {
  id: string;
  phone: string;
  from: string;
  status: 'ringing' | 'answered' | 'ended';
  at: string;
  expiresAt: string;
}

export interface Campaign {
  id: string;
  summary: string;
  indicators: string[];
  linkDomains: string[];
  callbackKeyCount: number;
  firstSeen: string;
  lastSeen: string;
  reportCount: number;
  status: 'new' | 'confirmed' | 'dismissed';
  advisory: {
    text: string;
    status: 'draft' | 'approved' | 'withdrawn';
    approvedBy: string | null;
    approvedAt: string | null;
    approvedByClient?: string | null;
    expiresAt?: string | null;
    withdrawnBy?: string | null;
    withdrawnAt?: string | null;
  };
  briefing?: { pattern: string; channel: 'sms' | 'whatsapp' | 'call' | 'email' | 'social' | 'unknown'; source: 'model' | 'template'; generatedAt: string } | null;
}

export interface Coverage {
  registered: number;
  checked: number;
  confirmed: number;
  notConfirmed: number;
  cannotCheck: number;
  notConfirmedRate: number | null;
  cannotCheckRate: number | null;
  checksByChannel: Record<string, number>;
  registeredByChannel: Record<string, number>;
}

export interface Metrics {
  registrations: number;
  registrationsByCategory: Record<string, number>;
  registrationsByChannel: Record<string, number>;
  verifications: Record<string, number>;
  verificationsByChannel: Record<string, number>;
  messageChecksByChannel: Record<string, number>;
  coverage: Coverage;
  registrationAlerts: Record<string, number>;
  links: Record<string, number>;
  callChecks: Record<string, number>;
  openCalls: number;
  reports: number;
}

export interface RegistrationAlert {
  id: string;
  kind: 'unknown_link_domain' | 'volume_spike';
  domain: string | null;
  category: string | null;
  channel: string | null;
  clientId: string | null;
  count: number;
  expected: number | null;
  windowMinutes: number | null;
  firstSeen: string;
  lastSeen: string;
}

export interface Call {
  id: string;
  phone: string;
  purpose: string;
  code: string;
  status: string;
  agentRef: string;
  openedAt: string;
  expiresAt: string;
}

export interface Transfer {
  id: string;
  kind: 'genuine' | 'fake_amount' | 'fake_reference';
  payer: string;
  merchant: string;
  account: string;
  amountKobo: number;
  reference: string;
  valueDate: string;
  at: string;
  registered: boolean;
  check: { verdict: 'received' | 'not_confirmed' | 'cannot_check'; paidFrom?: string; registeredAt?: string } | null;
}

export interface OrgSummary {
  id: string;
  name: string;
  kind: 'bank' | 'agency' | 'company';
}

export interface Organisation extends OrgSummary {
  domains: string[];
  senderIds: string[];
  officialContacts: { phones: string[]; whatsapp: string[]; emails: string[]; social: { platform: string; handle: string }[] };
  officialApps: { android: string[]; ios: string[] };
}

export interface SimConfig {
  bank: { id: string; name: string; domain?: string; bankCode?: string };
  orgs?: OrgSummary[];
  fakeCustomerCare?: { whatsapp: string; handle: string } | null;
  apiUrl: string;
  categories: string[];
  purposes: string[];
  ussdCode: string;
  simSwap?: boolean;
  // In-browser sandbox only: DemoBank's console sign-in code.
  consoleCode?: string;
}

export type SimSwapAnswer =
  | { status: 'swapped' | 'not_swapped'; swapped: boolean; latestSimChange: string | null; maxAgeHours: number; checkedAt: string }
  | { status: 'unknown'; reason: string; maxAgeHours: number; checkedAt: string };

// The demo tools act as the demo bank, so they carry its console session.
let consoleToken: string | null = null;
export const setConsoleToken = (token: string | null) => {
  consoleToken = token;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
  if (consoleToken) headers.authorization = `Bearer ${consoleToken}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Request failed (${res.status})`);
  return data as T;
}

export const sim = {
  config: () => call<SimConfig>('GET', '/sim/config'),
  inbox: (phone: string) => call<{ items: InboxItem[] }>('GET', `/sim/inbox/admin?phone=${encodeURIComponent(phone)}`),
  send: (phone: string, category: string, text?: string, org?: string) =>
    call<{ item: InboxItem; recordId: string; registrationMs: number; simSwapWarning?: boolean; simSwapStatus?: string }>('POST', '/sim/send', { phone, category, text, org }),
  organisations: () => call<{ organisations: Organisation[] }>('GET', '/sim/organisations'),
  sendFakeCare: (phone: string) => call<{ item: InboxItem; contact: { whatsapp: string; handle: string } }>('POST', '/sim/send-fake-care', { phone }),
  sendTampered: (phone: string, itemId?: string) => call<{ item: InboxItem }>('POST', '/sim/send-tampered', { phone, itemId }),
  sendFake: (phone: string, template: number | 'credit_alert') => call<{ item: InboxItem }>('POST', '/sim/send-fake', { phone, template }),
  recentCustomers: () => call<{ customers: AppUser[] }>('GET', '/sim/customers/recent'),
  fraudCall: (phone: string, from: string) => call<FraudCall>('POST', '/sim/fraud-calls', { phone, from }),
  fraudCalls: () => call<{ calls: FraudCall[] }>('GET', '/sim/fraud-calls'),
  updateFraudCall: (id: string, status: 'answered' | 'ended') => call<FraudCall>('PATCH', `/sim/fraud-calls/${id}`, { status }),
  openCall: (phone: string, purpose: string) => call<Call>('POST', '/sim/calls', { phone, purpose }),
  updateCall: (id: string, status: 'answered' | 'ended') => call<Call>('PATCH', `/sim/calls/${id}`, { status }),
  calls: () => call<{ calls: Call[] }>('GET', '/sim/calls'),
  campaigns: () => call<{ campaigns: Campaign[] }>('GET', '/sim/campaigns'),
  runAgent: () => call<{ campaignsTouched: string[] }>('POST', '/sim/agent/run', {}),
  campaignAction: (id: string, action: 'approve' | 'dismiss' | 'withdraw', analyst = '') =>
    call<Campaign>('POST', `/sim/campaigns/${id}/${action}`, action === 'dismiss' ? {} : { analyst }),
  sendAdvisory: (id: string, channel: 'sms' | 'whatsapp' = 'sms') =>
    call<{ sent: number; channel: string; text: string; messages: { phone: string; recordId: string }[] }>('POST', `/sim/campaigns/${id}/send`, { channel }),
  seedReports: () => call<{ reported: number }>('POST', '/sim/seed-reports', {}),
  metrics: () => call<Metrics>('GET', '/sim/metrics'),
  alerts: () => call<{ alerts: RegistrationAlert[] }>('GET', '/sim/alerts'),
  ussd: (phone: string, text: string, sessionId: string) => call<{ screen: string }>('POST', '/sim/ussd', { phone, text, sessionId }),
  pay: (from: string, to: string, amountKobo: number) => call<{ transfer: Transfer }>('POST', '/sim/transfers', { from, to, amountKobo }),
  fakeReceipt: (kind: 'fake_amount' | 'fake_reference', id?: string) => call<{ transfer: Transfer }>('POST', '/sim/transfers/fake', { kind, id }),
  forgeReceipt: (from: string, to: string, amountKobo: number) => call<{ transfer: Transfer }>('POST', '/sim/transfers/fake', { kind: 'fake_reference', from, to, amountKobo }),
  checkReceipt: (id: string) => call<{ transfer: Transfer }>('POST', `/sim/transfers/${id}/check`, {}),
  transfers: () => call<{ transfers: Transfer[] }>('GET', '/sim/transfers'),
  simSwap: (phone: string, action: 'swap' | 'restore') => call<{ ok: boolean; latestSimChange: string | null }>('POST', '/sim/sim-swap', { phone, action }),
  simSwapCheck: (phone: string, maxAgeHours: number) => call<SimSwapAnswer>('POST', '/sim/sim-swap/check', { phone, maxAgeHours }),
  reset: () => call<{ ok: boolean }>('POST', '/sim/reset', {}),
};
