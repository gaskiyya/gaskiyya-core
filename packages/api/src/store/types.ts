import type { CampaignBriefing } from '../ai/briefing.ts';
import type {
  CallPurpose,
  CallStatus,
  Category,
  Channel,
  Indicator,
  Language,
  OrgKind,
  SocialPlatform,
  Verdict,
  VerifyChannel,
} from '@gaskiya/schemas';

export interface OfficialContacts {
  phones?: string[];
  whatsapp?: string[];
  emails?: string[];
  social?: { platform: SocialPlatform; handle: string }[];
}

export interface OfficialApps {
  android?: string[];
  ios?: string[];
}

export interface Tenant {
  id: string;
  name: string;
  kind?: OrgKind;
  domains: string[];
  senderIds: string[];
  officialContacts?: OfficialContacts;
  officialApps?: OfficialApps;
  tokenKeysUrl?: string;
  tokenKeys?: { keys: Record<string, unknown>[] };
  recordTtlDays?: number;
  alertEmails?: string[];
  customerTokenUrl?: string;
  demoInboxUrl?: string;
  bankCode?: string;
  legalName?: string;
  technicalContact?: { name: string; email: string; phone?: string };
  status?: OrgStatus;
  mode?: OrgMode;
  features?: Partial<Record<OrgFeature, boolean>>;
  limits?: OrgLimits;
  webhookUrl?: string;
}

export const ORG_FEATURES = ['messages', 'calls', 'receipts', 'simSwap', 'advisories', 'ussd', 'whatsapp'] as const;
export type OrgFeature = (typeof ORG_FEATURES)[number];
export type OrgStatus = 'active' | 'suspended';
export type OrgMode = 'live' | 'sandbox';

export interface OrgLimits {
  bankApiPerMinute?: number | null;
  customerChecksPerMinute?: number | null;
}

export const featureOn = (t: Pick<Tenant, 'features'>, f: OrgFeature) => t.features?.[f] !== false;
export const isSuspended = (t: Pick<Tenant, 'status'> | undefined) => t?.status === 'suspended';

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

export interface OrgRecord {
  id: string;
  source: 'admin' | 'env';
  profile: Omit<Tenant, 'status' | 'mode' | 'features' | 'limits' | 'webhookUrl'> | null;
  status: OrgStatus;
  mode: OrgMode;
  features: Record<OrgFeature, boolean>;
  limits: OrgLimits;
  notes: string;
  suspendedReason: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  webhook: { url: string; secret: Sealed; createdAt: string } | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ApiClientRecord {
  clientId: string;
  tenantId: string;
  label: string;
  source: 'admin' | 'env';
  status: 'active' | 'revoked';
  secretHash: string | null;
  secretHint: string | null;
  previousSecretHash: string | null;
  previousSecretExpiresAt: string | null;
  tokenGeneration: number;
  createdAt: string;
  createdBy: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
}

export interface TenantKeyRecord {
  tenantId: string;
  version: number;
  sealed: Sealed | null;
  source: 'admin' | 'env';
  createdAt: string;
  createdBy: string;
  activatesAt: string;
  retiredAt: string | null;
  retiredBy: string | null;
}

export type AuditValue = string | number | boolean | null | string[];

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  tenantId: string | null;
  target: string | null;
  details: Record<string, AuditValue>;
  ip: string | null;
}

export interface AdminSession {
  idHash: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApiCallEvent {
  tenantId: string;
  clientId: string;
  method: string;
  route: string;
  status: number;
  code: string | null;
  at: string;
}

export interface ApiUsageDay {
  day: string;
  calls: number;
  errors: number;
  byRoute: Record<string, number>;
  byStatus: Record<string, number>;
  byClient: Record<string, number>;
}

export interface MessageRecord {
  id: string;
  tenantId: string;
  recipientKey: string;
  contentKey: string;
  keyVersion: number;
  channel: Channel;
  category: Category;
  hasLink: boolean;
  linkDomains: string[];
  asksCallback: boolean;
  sentAt: string;
  expiresAt: string;
  registeredAt: string;
}

export interface ReceiptRecord {
  id: string;
  tenantId: string;
  payerTenantId: string;
  accountKey: string;
  receiptKey: string;
  keyVersion: number;
  currency: 'NGN';
  registeredAt: string;
  expiresAt: string;
}

export interface CallSession {
  id: string;
  tenantId: string;
  recipientKey: string;
  purpose: CallPurpose;
  agentRef: string;
  code: string;
  status: CallStatus;
  openedAt: string;
  expiresAt: string;
}

export interface VerificationLog {
  tenantId: string;
  recipientKey: string;
  channelUsed: VerifyChannel;
  kind: 'message' | 'link' | 'call' | 'screenshot' | 'receipt' | 'contact' | 'licence';
  verdict: Verdict | 'belongs' | 'official_app' | 'calling' | 'not_calling' | 'received' | 'official' | 'not_official' | 'licensed' | 'not_listed';
  matchedRecordId: string | null;
  createdAt: string;
}

export interface Report {
  id: string;
  tenantId: string;
  maskedText: string;
  indicators: Indicator[];
  embedding: number[];
  embeddingModel: string;
  linkDomains: string[];
  callbackKeys: string[];
  campaignId: string | null;
  consentAt: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  summary: string;
  indicators: Indicator[];
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
    notifiedAt?: string | null;
  };
  alert?: { lastAt: string; lastCount: number } | null;
  briefing?: CampaignBriefing | null;
}

export interface RegistrationAlert {
  id: string;
  tenantId: string;
  kind: 'unknown_link_domain' | 'volume_spike';
  domain: string | null;
  category: Category | null;
  channel: Channel | null;
  clientId: string | null;
  count: number;
  expected: number | null;
  windowMinutes: number | null;
  firstSeen: string;
  lastSeen: string;
}

export interface Device {
  tenantId: string;
  recipientKey: string;
  pushToken: string;
  platform: 'android' | 'ios' | 'web';
  // iPhone PushKit token: bank calls ring through CallKit instead of a banner.
  voipToken?: string;
  updatedAt: string;
}

export interface LanguagePreference {
  tenantId: string;
  recipientKey: string;
  language: Language;
  updatedAt: string;
}

export interface Store {
  ping(): Promise<void>;

  putMessage(record: MessageRecord, idempotencyKey?: string): Promise<{ record: MessageRecord; created: boolean }>;
  putMessages(entries: { record: MessageRecord; idempotencyKey?: string }[]): Promise<{ record: MessageRecord; created: boolean }[]>;
  findMessage(tenantId: string, recipientKey: string, contentKey: string, now: Date): Promise<MessageRecord | null>;
  recentMessages(tenantId: string, recipientKey: string, since: Date, now: Date): Promise<MessageRecord[]>;

  putReceipts(entries: { record: ReceiptRecord; idempotencyKey?: string }[]): Promise<{ record: ReceiptRecord; created: boolean }[]>;
  findReceipt(tenantId: string, accountKey: string, receiptKey: string, now: Date): Promise<ReceiptRecord | null>;

  putCall(call: CallSession): Promise<void>;
  getCall(tenantId: string, id: string): Promise<CallSession | null>;
  openCalls(tenantId: string, recipientKey: string, now: Date): Promise<CallSession[]>;
  updateCall(tenantId: string, id: string, patch: Partial<Pick<CallSession, 'status' | 'expiresAt'>>): Promise<CallSession | null>;

  logVerification(log: VerificationLog): Promise<void>;
  countSimSwap(tenantId: string, key: string): Promise<void>;

  putDevice(device: Device): Promise<void>;
  devices(tenantId: string, recipientKey: string): Promise<Device[]>;
  tenantDevices(tenantId: string): Promise<Device[]>;
  removeDevice(tenantId: string, recipientKey: string, pushToken: string): Promise<void>;

  setLanguage(pref: LanguagePreference): Promise<void>;
  language(tenantId: string, recipientKey: string): Promise<Language | null>;

  putReport(report: Report): Promise<void>;
  listReports(tenantId: string, filter?: { unassigned?: boolean }): Promise<Report[]>;
  updateReport(id: string, patch: Partial<Pick<Report, 'campaignId'>>): Promise<void>;

  putCampaign(campaign: Campaign): Promise<void>;
  getCampaign(tenantId: string, id: string): Promise<Campaign | null>;
  listCampaigns(tenantId: string): Promise<Campaign[]>;

  putAlert(alert: RegistrationAlert): Promise<void>;
  getAlert(tenantId: string, id: string): Promise<RegistrationAlert | null>;
  listAlerts(tenantId: string, limit?: number): Promise<RegistrationAlert[]>;

  metrics(tenantId: string): Promise<{
    registrations: number;
    registrationsByCategory: Record<string, number>;
    registrationsByChannel: Record<string, number>;
    verifications: Record<string, number>;
    verificationsByChannel: Record<string, number>;
    messageChecksByChannel: Record<string, number>;
    links: Record<string, number>;
    callChecks: Record<string, number>;
    licenceChecks: Record<string, number>;
    contactChecks: Record<string, number>;
    receiptsRegistered: number;
    receiptChecks: Record<string, number>;
    openCalls: number;
    reports: number;
    registrationAlerts: Record<string, number>;
    simSwap: Record<string, number>;
  }>;

  listOrgs(): Promise<OrgRecord[]>;
  getOrg(id: string): Promise<OrgRecord | null>;
  putOrg(org: OrgRecord): Promise<void>;
  listApiClients(): Promise<ApiClientRecord[]>;
  getApiClient(clientId: string): Promise<ApiClientRecord | null>;
  putApiClient(client: ApiClientRecord): Promise<void>;
  touchApiClient(clientId: string, at: string): Promise<void>;
  listTenantKeys(): Promise<TenantKeyRecord[]>;
  createTenantKey(key: TenantKeyRecord): Promise<boolean>;
  putTenantKey(key: TenantKeyRecord): Promise<void>;
  putAudit(entry: AuditEntry): Promise<void>;
  listAudit(query: { tenantId?: string; limit: number }): Promise<AuditEntry[]>;
  putAdminSession(session: AdminSession): Promise<void>;
  getAdminSession(idHash: string): Promise<AdminSession | null>;
  deleteAdminSession(idHash: string): Promise<void>;
  recordApiCall(event: ApiCallEvent): Promise<void>;
  apiUsage(tenantId: string, days: string[]): Promise<ApiUsageDay[]>;
  apiErrors(tenantId: string, limit: number): Promise<ApiCallEvent[]>;

  reset(): Promise<void>;
  resetTenant(tenantId: string): Promise<void>;
  dump(): Promise<unknown>;
}
