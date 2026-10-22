import type { Language } from '@gaskiya/schemas';
import type {
  AdminSession,
  ConsoleCodeRecord,
  ConsoleSession,
  ApiCallEvent,
  ApiClientRecord,
  ApiUsageDay,
  AppUser,
  AuditEntry,
  Campaign,
  CallSession,
  Device,
  LanguagePreference,
  MessageRecord,
  OrgRecord,
  ReceiptRecord,
  RegistrationAlert,
  Report,
  Store,
  TenantKeyRecord,
  VerificationLog,
} from './types.ts';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const pairKey = (tenantId: string, recipientKey: string) => `${tenantId}\u0000${recipientKey}`;

export class MemoryStore implements Store {
  private messages = new Map<string, MessageRecord>();
  private byContent = new Map<string, string>();
  private byRecipient = new Map<string, Set<string>>();
  private idempotency = new Map<string, { id: string; at: number }>();
  private calls = new Map<string, CallSession>();
  private callsByRecipient = new Map<string, Set<string>>();
  private verifications: VerificationLog[] = [];
  private deviceMap = new Map<string, Device>();
  private reports = new Map<string, Report>();
  private campaigns = new Map<string, Campaign>();
  private alerts = new Map<string, RegistrationAlert>();
  private languages = new Map<string, LanguagePreference>();
  private receipts = new Map<string, ReceiptRecord>();
  private receiptIdempotency = new Map<string, { index: string; id: string; at: number }>();

  async ping(): Promise<void> {}

  async putMessage(record: MessageRecord, idempotencyKey?: string) {
    if (idempotencyKey) {
      const k = `${record.tenantId}\u0000${idempotencyKey}`;
      const hit = this.idempotency.get(k);
      if (hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS) {
        const existing = this.messages.get(hit.id);
        if (existing) return { record: existing, created: false };
      }
      this.idempotency.set(k, { id: record.id, at: Date.now() });
    }
    const contentIndex = `${pairKey(record.tenantId, record.recipientKey)}\u0000${record.contentKey}`;
    const previous = this.byContent.get(contentIndex);
    if (previous) this.removeMessage(previous);
    this.messages.set(record.id, record);
    this.byContent.set(contentIndex, record.id);
    const pk = pairKey(record.tenantId, record.recipientKey);
    let set = this.byRecipient.get(pk);
    if (!set) this.byRecipient.set(pk, (set = new Set()));
    set.add(record.id);
    return { record, created: true };
  }

  async putMessages(entries: { record: MessageRecord; idempotencyKey?: string }[]) {
    const out: { record: MessageRecord; created: boolean }[] = [];
    for (const e of entries) out.push(await this.putMessage(e.record, e.idempotencyKey));
    return out;
  }

  private removeMessage(id: string) {
    const r = this.messages.get(id);
    if (!r) return;
    this.messages.delete(id);
    this.byContent.delete(`${pairKey(r.tenantId, r.recipientKey)}\u0000${r.contentKey}`);
    this.byRecipient.get(pairKey(r.tenantId, r.recipientKey))?.delete(id);
  }

  async findMessage(tenantId: string, recipientKey: string, contentKey: string, now: Date) {
    const id = this.byContent.get(`${pairKey(tenantId, recipientKey)}\u0000${contentKey}`);
    const r = id ? this.messages.get(id) : undefined;
    if (!r || Date.parse(r.expiresAt) <= now.getTime()) return null;
    return r;
  }

  async putReceipts(entries: { record: ReceiptRecord; idempotencyKey?: string }[]) {
    const out: { record: ReceiptRecord; created: boolean }[] = [];
    for (const { record, idempotencyKey } of entries) {
      const index = `${pairKey(record.tenantId, record.accountKey)}\u0000${record.receiptKey}`;
      const k = idempotencyKey ? `${record.payerTenantId}\u0000${idempotencyKey}` : null;
      if (k) {
        const hit = this.receiptIdempotency.get(k);
        const existing = hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS ? this.receipts.get(hit.index) : undefined;
        if (existing && existing.id === hit!.id) {
          out.push({ record: existing, created: false });
          continue;
        }
        this.receiptIdempotency.set(k, { index, id: record.id, at: Date.now() });
      }
      this.receipts.set(index, record);
      out.push({ record, created: true });
    }
    return out;
  }

  async findReceipt(tenantId: string, accountKey: string, receiptKey: string, now: Date) {
    const r = this.receipts.get(`${pairKey(tenantId, accountKey)}\u0000${receiptKey}`);
    if (!r || Date.parse(r.expiresAt) <= now.getTime()) return null;
    return r;
  }

  async recentMessages(tenantId: string, recipientKey: string, since: Date, now: Date) {
    const ids = this.byRecipient.get(pairKey(tenantId, recipientKey));
    if (!ids) return [];
    const out: MessageRecord[] = [];
    for (const id of ids) {
      const r = this.messages.get(id);
      if (!r) continue;
      if (Date.parse(r.expiresAt) <= now.getTime()) continue;
      if (Date.parse(r.sentAt) >= since.getTime()) out.push(r);
    }
    return out.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  }

  async putCall(call: CallSession) {
    this.calls.set(call.id, call);
    const pk = pairKey(call.tenantId, call.recipientKey);
    let set = this.callsByRecipient.get(pk);
    if (!set) this.callsByRecipient.set(pk, (set = new Set()));
    set.add(call.id);
  }

  async getCall(tenantId: string, id: string) {
    const c = this.calls.get(id);
    return c && c.tenantId === tenantId ? c : null;
  }

  async openCalls(tenantId: string, recipientKey: string, now: Date) {
    const ids = this.callsByRecipient.get(pairKey(tenantId, recipientKey));
    if (!ids) return [];
    const out: CallSession[] = [];
    for (const id of ids) {
      const c = this.calls.get(id);
      if (!c) continue;
      if ((c.status === 'open' || c.status === 'answered') && Date.parse(c.expiresAt) > now.getTime()) out.push(c);
    }
    return out.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  }

  async updateCall(tenantId: string, id: string, patch: Partial<Pick<CallSession, 'status' | 'expiresAt' | 'endedBy' | 'declined'>>) {
    const c = await this.getCall(tenantId, id);
    if (!c) return null;
    const next = { ...c, ...patch };
    this.calls.set(id, next);
    return next;
  }

  private simSwapCounts = new Map<string, Record<string, number>>();

  async countSimSwap(tenantId: string, key: string) {
    const c = this.simSwapCounts.get(tenantId) ?? {};
    c[key] = (c[key] ?? 0) + 1;
    this.simSwapCounts.set(tenantId, c);
  }

  async logVerification(log: VerificationLog) {
    this.verifications.push(log);
    if (this.verifications.length > 100_000) this.verifications.splice(0, 50_000);
  }

  async putDevice(device: Device) {
    this.deviceMap.set(`${pairKey(device.tenantId, device.recipientKey)}\u0000${device.pushToken}`, device);
  }

  async devices(tenantId: string, recipientKey: string) {
    const prefix = `${pairKey(tenantId, recipientKey)}\u0000`;
    return [...this.deviceMap.entries()].filter(([k]) => k.startsWith(prefix)).map(([, d]) => d);
  }

  async tenantDevices(tenantId: string) {
    return [...this.deviceMap.values()].filter((d) => d.tenantId === tenantId);
  }

  async removeDevice(tenantId: string, recipientKey: string, pushToken: string) {
    this.deviceMap.delete(`${pairKey(tenantId, recipientKey)}\u0000${pushToken}`);
  }

  async setLanguage(pref: LanguagePreference) {
    this.languages.set(pairKey(pref.tenantId, pref.recipientKey), pref);
  }

  async language(tenantId: string, recipientKey: string): Promise<Language | null> {
    return this.languages.get(pairKey(tenantId, recipientKey))?.language ?? null;
  }

  async putReport(report: Report) {
    this.reports.set(report.id, report);
  }

  async listReports(tenantId: string, filter?: { unassigned?: boolean }) {
    return [...this.reports.values()].filter(
      (r) => r.tenantId === tenantId && (!filter?.unassigned || r.campaignId === null),
    );
  }

  async updateReport(id: string, patch: Partial<Pick<Report, 'campaignId'>>) {
    const r = this.reports.get(id);
    if (r) this.reports.set(id, { ...r, ...patch });
  }

  async putCampaign(c: Campaign) {
    this.campaigns.set(c.id, c);
  }

  async getCampaign(tenantId: string, id: string) {
    const c = this.campaigns.get(id);
    return c && c.tenantId === tenantId ? c : null;
  }

  async listCampaigns(tenantId: string) {
    return [...this.campaigns.values()]
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  }

  async putAlert(a: RegistrationAlert) {
    this.alerts.set(`${a.tenantId}\u0000${a.id}`, a);
  }

  async getAlert(tenantId: string, id: string) {
    return this.alerts.get(`${tenantId}\u0000${id}`) ?? null;
  }

  async listAlerts(tenantId: string, limit = 50) {
    return [...this.alerts.values()]
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
      .slice(0, limit);
  }

  async metrics(tenantId: string) {
    const registrationsByCategory: Record<string, number> = {};
    const registrationsByChannel: Record<string, number> = {};
    let registrations = 0;
    for (const r of this.messages.values()) {
      if (r.tenantId !== tenantId) continue;
      registrations++;
      registrationsByCategory[r.category] = (registrationsByCategory[r.category] ?? 0) + 1;
      registrationsByChannel[r.channel] = (registrationsByChannel[r.channel] ?? 0) + 1;
    }
    const verifications: Record<string, number> = {};
    const verificationsByChannel: Record<string, number> = {};
    const messageChecksByChannel: Record<string, number> = {};
    const links: Record<string, number> = {};
    const callChecks: Record<string, number> = {};
    const receiptChecks: Record<string, number> = {};
    const contactChecks: Record<string, number> = {};
    const licenceChecks: Record<string, number> = {};
    for (const v of this.verifications) {
      if (v.tenantId !== tenantId) continue;
      const bucket = v.kind === 'link' ? links : v.kind === 'call' ? callChecks : v.kind === 'receipt' ? receiptChecks : v.kind === 'contact' ? contactChecks : v.kind === 'licence' ? licenceChecks : verifications;
      bucket[v.verdict] = (bucket[v.verdict] ?? 0) + 1;
      verificationsByChannel[v.channelUsed] = (verificationsByChannel[v.channelUsed] ?? 0) + 1;
      if (bucket === verifications) messageChecksByChannel[v.channelUsed] = (messageChecksByChannel[v.channelUsed] ?? 0) + 1;
    }
    const now = Date.now();
    const openCalls = [...this.calls.values()].filter(
      (c) => c.tenantId === tenantId && (c.status === 'open' || c.status === 'answered') && Date.parse(c.expiresAt) > now,
    ).length;
    const reports = [...this.reports.values()].filter((r) => r.tenantId === tenantId).length;
    const registrationAlerts: Record<string, number> = {};
    for (const a of this.alerts.values()) if (a.tenantId === tenantId) registrationAlerts[a.kind] = (registrationAlerts[a.kind] ?? 0) + 1;
    const receiptsRegistered = [...this.receipts.values()].filter((r) => r.payerTenantId === tenantId).length;
    const simSwap = { ...(this.simSwapCounts.get(tenantId) ?? {}) };
    return { registrations, registrationsByCategory, registrationsByChannel, verifications, verificationsByChannel, messageChecksByChannel, links, callChecks, contactChecks, licenceChecks, receiptsRegistered, receiptChecks, openCalls, reports, registrationAlerts, simSwap };
  }

  sweep(now = new Date()) {
    for (const [id, r] of this.messages) if (Date.parse(r.expiresAt) <= now.getTime()) this.removeMessage(id);
    for (const [k, v] of this.idempotency) if (now.getTime() - v.at > IDEMPOTENCY_TTL_MS) this.idempotency.delete(k);
    for (const [k, r] of this.receipts) if (Date.parse(r.expiresAt) <= now.getTime()) this.receipts.delete(k);
    for (const [k, v] of this.receiptIdempotency) if (now.getTime() - v.at > IDEMPOTENCY_TTL_MS) this.receiptIdempotency.delete(k);
    for (const [id, c] of this.calls) {
      if (Date.parse(c.expiresAt) <= now.getTime() - 60 * 60 * 1000) {
        this.calls.delete(id);
        this.callsByRecipient.get(pairKey(c.tenantId, c.recipientKey))?.delete(id);
      }
    }
  }

  private orgs = new Map<string, OrgRecord>();
  private apiClients = new Map<string, ApiClientRecord>();
  private tenantKeys = new Map<string, TenantKeyRecord>();
  private audit: AuditEntry[] = [];
  private adminSessions = new Map<string, AdminSession>();
  private consoleCodes = new Map<string, ConsoleCodeRecord>();
  private consoleSessions = new Map<string, ConsoleSession>();
  private appUsers = new Map<string, AppUser>();
  private usage = new Map<string, ApiUsageDay>();
  private errors: ApiCallEvent[] = [];

  async listOrgs() {
    return [...this.orgs.values()].map((o) => structuredClone(o));
  }

  async getOrg(id: string) {
    const o = this.orgs.get(id);
    return o ? structuredClone(o) : null;
  }

  async putOrg(org: OrgRecord) {
    this.orgs.set(org.id, structuredClone(org));
  }

  async listApiClients() {
    return [...this.apiClients.values()].map((c) => ({ ...c }));
  }

  async getApiClient(clientId: string) {
    const c = this.apiClients.get(clientId);
    return c ? { ...c } : null;
  }

  async putApiClient(client: ApiClientRecord) {
    this.apiClients.set(client.clientId, { ...client });
  }

  async touchApiClient(clientId: string, at: string) {
    const c = this.apiClients.get(clientId);
    if (c) c.lastUsedAt = at;
  }

  async listTenantKeys() {
    return [...this.tenantKeys.values()].map((k) => structuredClone(k));
  }

  async createTenantKey(key: TenantKeyRecord) {
    const id = `${key.tenantId}\u0000${key.version}`;
    if (this.tenantKeys.has(id)) return false;
    this.tenantKeys.set(id, structuredClone(key));
    return true;
  }

  async putTenantKey(key: TenantKeyRecord) {
    this.tenantKeys.set(`${key.tenantId}\u0000${key.version}`, structuredClone(key));
  }

  async putAudit(entry: AuditEntry) {
    this.audit.push(structuredClone(entry));
    if (this.audit.length > 20_000) this.audit.splice(0, 10_000);
  }

  async listAudit(query: { tenantId?: string; limit: number }) {
    const out: AuditEntry[] = [];
    for (let i = this.audit.length - 1; i >= 0 && out.length < query.limit; i--) {
      const e = this.audit[i]!;
      if (!query.tenantId || e.tenantId === query.tenantId) out.push(structuredClone(e));
    }
    return out;
  }

  async putAdminSession(session: AdminSession) {
    this.adminSessions.set(session.idHash, { ...session });
  }

  async getAdminSession(idHash: string) {
    const s = this.adminSessions.get(idHash);
    return s ? { ...s } : null;
  }

  async deleteAdminSession(idHash: string) {
    this.adminSessions.delete(idHash);
  }

  async listConsoleCodes(tenantId: string) {
    return [...this.consoleCodes.values()].filter((c) => c.tenantId === tenantId).map((c) => ({ ...c }));
  }

  async getConsoleCode(idHash: string) {
    const c = this.consoleCodes.get(idHash);
    return c ? { ...c } : null;
  }

  async putConsoleCode(code: ConsoleCodeRecord) {
    this.consoleCodes.set(code.idHash, { ...code });
  }

  async putConsoleSession(session: ConsoleSession) {
    this.consoleSessions.set(session.idHash, { ...session });
  }

  async getConsoleSession(idHash: string) {
    const s = this.consoleSessions.get(idHash);
    return s ? { ...s } : null;
  }

  async deleteConsoleSession(idHash: string) {
    this.consoleSessions.delete(idHash);
  }

  async recordAppUser(tenantId: string, phone: string, at: string) {
    const k = pairKey(tenantId, phone);
    const user = { tenantId, phone, firstSeenAt: this.appUsers.get(k)?.firstSeenAt ?? at, lastSeenAt: at };
    this.appUsers.delete(k);
    this.appUsers.set(k, user);
    return { ...user };
  }

  async removeAppUser(tenantId: string, phone: string) {
    return this.appUsers.delete(pairKey(tenantId, phone));
  }

  async listAppUsers(tenantId: string, limit: number) {
    return [...this.appUsers.values()]
      .reverse()
      .filter((u) => u.tenantId === tenantId)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limit)
      .map((u) => ({ ...u }));
  }

  async recordApiCall(e: ApiCallEvent) {
    const day = e.at.slice(0, 10);
    const k = `${e.tenantId}\u0000${day}`;
    const u = this.usage.get(k) ?? { day, calls: 0, errors: 0, byRoute: {}, byStatus: {}, byClient: {} };
    u.calls++;
    if (e.status >= 400) u.errors++;
    const route = `${e.method} ${e.route}`;
    u.byRoute[route] = (u.byRoute[route] ?? 0) + 1;
    u.byStatus[String(e.status)] = (u.byStatus[String(e.status)] ?? 0) + 1;
    u.byClient[e.clientId] = (u.byClient[e.clientId] ?? 0) + 1;
    this.usage.set(k, u);
    if (e.status >= 400) {
      this.errors.push({ ...e });
      if (this.errors.length > 5_000) this.errors.splice(0, 2_500);
    }
  }

  async apiUsage(tenantId: string, days: string[]) {
    return days.map((day) => structuredClone(this.usage.get(`${tenantId}\u0000${day}`) ?? { day, calls: 0, errors: 0, byRoute: {}, byStatus: {}, byClient: {} }));
  }

  async apiErrors(tenantId: string, limit: number) {
    const out: ApiCallEvent[] = [];
    for (let i = this.errors.length - 1; i >= 0 && out.length < limit; i--) if (this.errors[i]!.tenantId === tenantId) out.push({ ...this.errors[i]! });
    return out;
  }

  async reset() {
    this.messages.clear();
    this.byContent.clear();
    this.byRecipient.clear();
    this.idempotency.clear();
    this.calls.clear();
    this.callsByRecipient.clear();
    this.verifications = [];
    this.deviceMap.clear();
    this.reports.clear();
    this.campaigns.clear();
    this.alerts.clear();
    this.languages.clear();
    this.receipts.clear();
    this.receiptIdempotency.clear();
    this.simSwapCounts.clear();
  }

  async resetTenant(tenantId: string) {
    for (const [id, r] of this.messages) if (r.tenantId === tenantId) this.removeMessage(id);
    const prefix = `${tenantId}\u0000`;
    for (const k of [...this.idempotency.keys()]) if (k.startsWith(prefix)) this.idempotency.delete(k);
    for (const [id, c] of this.calls) if (c.tenantId === tenantId) this.calls.delete(id);
    for (const k of [...this.callsByRecipient.keys()]) if (k.startsWith(prefix)) this.callsByRecipient.delete(k);
    this.verifications = this.verifications.filter((v) => v.tenantId !== tenantId);
    for (const [k, d] of this.deviceMap) if (d.tenantId === tenantId) this.deviceMap.delete(k);
    for (const [k, r] of this.reports) if (r.tenantId === tenantId) this.reports.delete(k);
    for (const [k, c] of this.campaigns) if (c.tenantId === tenantId) this.campaigns.delete(k);
    for (const [k, a] of this.alerts) if (a.tenantId === tenantId) this.alerts.delete(k);
    for (const [k, r] of this.receipts) if (r.payerTenantId === tenantId) this.receipts.delete(k);
    for (const k of [...this.receiptIdempotency.keys()]) if (k.startsWith(prefix)) this.receiptIdempotency.delete(k);
    this.simSwapCounts.delete(tenantId);
  }

  async dump() {
    return {
      messages: [...this.messages.values()],
      idempotencyKeys: [...this.idempotency.keys()],
      calls: [...this.calls.values()],
      verifications: this.verifications,
      devices: [...this.deviceMap.values()],
      reports: [...this.reports.values()],
      campaigns: [...this.campaigns.values()],
      alerts: [...this.alerts.values()],
      languages: [...this.languages.values()],
      receipts: [...this.receipts.values()],
      receiptIdempotencyKeys: [...this.receiptIdempotency.keys()],
      simSwap: Object.fromEntries(this.simSwapCounts),
    };
  }
}
