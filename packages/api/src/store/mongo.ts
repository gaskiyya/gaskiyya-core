import { createHash } from 'node:crypto';
import { MongoClient, MongoServerError, ObjectId, type AnyBulkWriteOperation, type ClientSession, type Collection, type Db, type Document } from 'mongodb';
import type { Language } from '@gaskiya/schemas';
import type {
  AdminSession,
  ApiCallEvent,
  ApiClientRecord,
  ApiUsageDay,
  AppUser,
  AuditEntry,
  Campaign,
  CallSession,
  ConsoleCodeRecord,
  ConsoleSession,
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
const READ_TIMEOUT_MS = 3000;
const RECORDS_PER_TRANSACTION = 200;
const CALL_TTL_MS = 24 * 3600_000;
const VERIFICATION_TTL_MS = 90 * 24 * 3600_000;
const ALERT_TTL_MS = 90 * 24 * 3600_000;
const ADMIN_LOG_TTL_MS = 400 * 24 * 3600_000;
const API_ERROR_TTL_MS = 30 * 24 * 3600_000;
const USAGE_TTL_MS = 120 * 24 * 3600_000;

type Row = Document & { _id: string };

const hashId = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');
const newestFirst = (iso: string) => String(9_999_999_999_999 - Date.parse(iso)).padStart(13, '0');
const clean = <T extends object>(o: T): Document => JSON.parse(JSON.stringify(o)) as Document;
// Counter keys become field names, which may not contain '.' or start with '$'.
const enc = (k: string) => encodeURIComponent(k).replace(/\./g, '%2E');
const decMap = (m: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries((m ?? {}) as Record<string, number>).map(([k, v]) => [decodeURIComponent(k), v]));

function strip<T>(d: Document | null): T | null {
  if (!d) return null;
  const { _id: _i, expireAt: _e, ...rest } = d;
  return rest as T;
}

function timed<T>(p: Promise<T>, ms = READ_TIMEOUT_MS): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error('MongoDB did not respond in time')), ms)))]).finally(() => clearTimeout(t));
}

const COLLECTIONS = ['messages', 'idempotency', 'receipts', 'calls', 'verifications', 'devices', 'languages', 'reports', 'campaigns', 'alerts', 'stats'] as const;
const ADMIN = { orgs: 'admin_orgs', clients: 'admin_clients', keys: 'admin_keys', audit: 'admin_audit', sessions: 'admin_sessions', consoleCodes: 'console_codes', consoleSessions: 'console_sessions', appUsers: 'app_users', usage: 'api_usage', errors: 'api_errors' } as const;

export interface MongoStoreOptions {
  uri?: string;
  client?: MongoClient;
  dbName?: string;
  prefix?: string;
}

export class MongoStore implements Store {
  readonly client: MongoClient;
  readonly db: Db;
  readonly prefix: string;
  private c: Record<(typeof COLLECTIONS)[number], Collection<Row>>;
  private a: Record<keyof typeof ADMIN, Collection<Row>>;
  private indexes: Promise<void> | null = null;

  constructor(o: MongoStoreOptions) {
    if (!o.client && !o.uri) throw new Error('MongoStore needs a uri or a client');
    this.client = o.client ?? new MongoClient(o.uri!, { appName: 'gaskiyya', serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, maxPoolSize: 20 });
    this.db = this.client.db(o.dbName ?? 'gaskiyya');
    this.prefix = o.prefix ?? 'gaskiya';
    const col = (n: string) => this.db.collection<Row>(`${this.prefix}_${n}`);
    this.c = Object.fromEntries(COLLECTIONS.map((n) => [n, col(n)])) as typeof this.c;
    this.a = Object.fromEntries(Object.entries(ADMIN).map(([k, n]) => [k, col(n)])) as typeof this.a;
  }

  async ping(): Promise<void> {
    await timed(this.db.command({ ping: 1 }), 8000);
    await (this.indexes ??= this.ensureIndexes().catch((err: Error) => {
      this.indexes = null;
      throw err;
    }));
  }

  async close() {
    await this.client.close();
  }

  private async ensureIndexes() {
    const ttl = { expireAfterSeconds: 0 };
    await Promise.all([
      ...[this.c.messages, this.c.idempotency, this.c.receipts, this.c.calls, this.c.verifications, this.c.alerts, this.a.audit, this.a.sessions, this.a.consoleSessions, this.a.usage, this.a.errors, this.db.collection(`${this.prefix}_ratelimits`)].map((c) =>
        c.createIndex({ expireAt: 1 }, ttl),
      ),
      this.c.messages.createIndex({ tenantId: 1, recipientKey: 1, sentAt: -1 }),
      this.c.receipts.createIndex({ payerTenantId: 1 }),
      this.c.calls.createIndex({ tenantId: 1, recipientKey: 1, status: 1 }),
      this.c.calls.createIndex({ tenantId: 1, status: 1, expiresAt: 1 }),
      this.c.devices.createIndex({ tenantId: 1, recipientKey: 1 }),
      this.c.reports.createIndex({ tenantId: 1, campaignId: 1 }),
      this.c.campaigns.createIndex({ tenantId: 1, lastSeen: -1 }),
      this.c.alerts.createIndex({ tenantId: 1, lastSeen: -1 }),
      this.c.verifications.createIndex({ tenantId: 1 }),
      this.c.languages.createIndex({ tenantId: 1 }),
      this.a.audit.createIndex({ tenantId: 1, at: -1, seq: -1 }),
      this.a.consoleCodes.createIndex({ tenantId: 1 }),
      this.a.appUsers.createIndex({ tenantId: 1, lastSeenAt: -1 }),
      this.a.errors.createIndex({ tenantId: 1, at: -1 }),
    ]);
  }

  private async bump(tenantId: string, inc: Record<string, number>) {
    await this.c.stats.updateOne({ _id: tenantId }, { $inc: inc }, { upsert: true });
  }

  private async transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(fn);
    } finally {
      await session.endSession();
    }
  }

  private messageId(tenantId: string, recipientKey: string, contentKey: string) {
    return hashId(tenantId, recipientKey, contentKey);
  }

  async putMessage(record: MessageRecord, idempotencyKey?: string) {
    return (await this.putMessages([{ record, idempotencyKey }]))[0]!;
  }

  async putMessages(entries: { record: MessageRecord; idempotencyKey?: string }[]) {
    const out: { record: MessageRecord; created: boolean }[] = [];
    for (let i = 0; i < entries.length; i += RECORDS_PER_TRANSACTION) {
      out.push(...(await this.putChunk(entries.slice(i, i + RECORDS_PER_TRANSACTION))));
    }
    return out;
  }

  // Shared by messages and receipts: an idempotency key seen in the last 24 hours returns the record it created.
  private async putIdempotent<R extends { id: string; expiresAt: string }>(
    target: Collection<Row>,
    items: { record: R; docId: string; idemId: string | null; idemTenant: string }[],
    toRecord: (d: Document) => R,
  ): Promise<{ record: R; created: boolean }[]> {
    return this.transaction(async (session) => {
      const idemIds = [...new Set(items.flatMap((i) => (i.idemId ? [i.idemId] : [])))];
      const now = Date.now();
      const live = new Map<string, Document>();
      for (const d of idemIds.length ? await this.c.idempotency.find({ _id: { $in: idemIds } }, { session }).toArray() : []) {
        if (now - (d.createdAt as Date).getTime() < IDEMPOTENCY_TTL_MS) live.set(d._id, d);
      }
      const priorIds = [...new Set([...live.values()].map((d) => d.docId as string))];
      const existing = new Map<string, Document>();
      for (const d of priorIds.length ? await target.find({ _id: { $in: priorIds } }, { session }).toArray() : []) existing.set(d._id, d);

      const out: { record: R; created: boolean }[] = [];
      const claimed = new Map<string, R>();
      const writes: AnyBulkWriteOperation<Row>[] = [];
      const idemWrites: AnyBulkWriteOperation<Row>[] = [];
      for (const { record, docId, idemId, idemTenant } of items) {
        if (idemId) {
          const earlier = claimed.get(idemId);
          if (earlier) {
            out.push({ record: earlier, created: false });
            continue;
          }
          const idem = live.get(idemId);
          const prior = idem && existing.get(idem.docId as string);
          if (idem && prior && prior.id === idem.recordId) {
            out.push({ record: toRecord(prior), created: false });
            continue;
          }
        }
        writes.push({ replaceOne: { filter: { _id: docId }, replacement: { _id: docId, ...clean(record), expireAt: new Date(record.expiresAt) }, upsert: true } });
        if (idemId) {
          idemWrites.push({
            replaceOne: {
              filter: { _id: idemId },
              replacement: { _id: idemId, tenantId: idemTenant, docId, recordId: record.id, createdAt: new Date(now), expireAt: new Date(now + IDEMPOTENCY_TTL_MS) },
              upsert: true,
            },
          });
          claimed.set(idemId, record);
        }
        out.push({ record, created: true });
      }
      if (writes.length) await target.bulkWrite(writes, { session, ordered: true });
      if (idemWrites.length) await this.c.idempotency.bulkWrite(idemWrites, { session, ordered: true });
      return out;
    });
  }

  private async putChunk(entries: { record: MessageRecord; idempotencyKey?: string }[]) {
    const results = await this.putIdempotent(
      this.c.messages,
      entries.map(({ record, idempotencyKey }) => ({
        record,
        docId: this.messageId(record.tenantId, record.recipientKey, record.contentKey),
        idemId: idempotencyKey ? hashId(record.tenantId, idempotencyKey) : null,
        idemTenant: record.tenantId,
      })),
      (d) => this.toRecord(d),
    );
    const byTenant = new Map<string, Record<string, number>>();
    for (const r of results) {
      if (!r.created) continue;
      const inc = byTenant.get(r.record.tenantId) ?? {};
      for (const k of ['registrations', `registrationsByCategory.${enc(r.record.category)}`, `registrationsByChannel.${enc(r.record.channel)}`]) inc[k] = (inc[k] ?? 0) + 1;
      byTenant.set(r.record.tenantId, inc);
    }
    await Promise.all([...byTenant].map(([tenantId, inc]) => this.bump(tenantId, inc).catch(() => {})));
    return results;
  }

  private toRecord(d: Document): MessageRecord {
    const r = strip<MessageRecord>(d)!;
    return { ...r, keyVersion: r.keyVersion ?? 1 };
  }

  async findMessage(tenantId: string, recipientKey: string, contentKey: string, now: Date) {
    const d = await timed(this.c.messages.findOne({ _id: this.messageId(tenantId, recipientKey, contentKey) }));
    if (!d) return null;
    const r = this.toRecord(d);
    if (r.tenantId !== tenantId || r.recipientKey !== recipientKey || r.contentKey !== contentKey) return null;
    if (Date.parse(r.expiresAt) <= now.getTime()) return null;
    return r;
  }

  async recentMessages(tenantId: string, recipientKey: string, since: Date, now: Date) {
    const docs = await timed(this.c.messages.find({ tenantId, recipientKey, sentAt: { $gte: since.toISOString() } }).toArray());
    return docs
      .map((d) => this.toRecord(d))
      .filter((r) => Date.parse(r.expiresAt) > now.getTime())
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  }

  private receiptId(tenantId: string, accountKey: string, receiptKey: string) {
    return hashId('receipt', tenantId, accountKey, receiptKey);
  }

  async putReceipts(entries: { record: ReceiptRecord; idempotencyKey?: string }[]) {
    const out: { record: ReceiptRecord; created: boolean }[] = [];
    for (let i = 0; i < entries.length; i += RECORDS_PER_TRANSACTION) {
      const results = await this.putIdempotent(
        this.c.receipts,
        entries.slice(i, i + RECORDS_PER_TRANSACTION).map(({ record, idempotencyKey }) => ({
          record,
          docId: this.receiptId(record.tenantId, record.accountKey, record.receiptKey),
          idemId: idempotencyKey ? hashId('receipt', record.payerTenantId, idempotencyKey) : null,
          idemTenant: record.payerTenantId,
        })),
        (d) => strip<ReceiptRecord>(d)!,
      );
      const byPayer = new Map<string, number>();
      for (const r of results) if (r.created) byPayer.set(r.record.payerTenantId, (byPayer.get(r.record.payerTenantId) ?? 0) + 1);
      await Promise.all([...byPayer].map(([tenantId, n]) => this.bump(tenantId, { receiptsRegistered: n }).catch(() => {})));
      out.push(...results);
    }
    return out;
  }

  async findReceipt(tenantId: string, accountKey: string, receiptKey: string, now: Date) {
    const r = strip<ReceiptRecord>(await timed(this.c.receipts.findOne({ _id: this.receiptId(tenantId, accountKey, receiptKey) })));
    if (!r) return null;
    if (r.tenantId !== tenantId || r.accountKey !== accountKey || r.receiptKey !== receiptKey) return null;
    if (Date.parse(r.expiresAt) <= now.getTime()) return null;
    return r;
  }

  async putCall(call: CallSession) {
    await this.c.calls.replaceOne({ _id: call.id }, { _id: call.id, ...clean(call), expireAt: new Date(Date.parse(call.expiresAt) + CALL_TTL_MS) }, { upsert: true });
  }

  async getCall(tenantId: string, id: string) {
    return strip<CallSession>(await timed(this.c.calls.findOne({ _id: id, tenantId })));
  }

  async openCalls(tenantId: string, recipientKey: string, now: Date) {
    const docs = await timed(this.c.calls.find({ tenantId, recipientKey, status: { $in: ['open', 'answered'] } }).toArray());
    return docs
      .map((d) => strip<CallSession>(d)!)
      .filter((c) => Date.parse(c.expiresAt) > now.getTime())
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  }

  async updateCall(tenantId: string, id: string, patch: Partial<Pick<CallSession, 'status' | 'expiresAt' | 'endedBy' | 'declined'>>) {
    const set: Document = clean(patch);
    if (patch.expiresAt) set.expireAt = new Date(Date.parse(patch.expiresAt) + CALL_TTL_MS);
    return strip<CallSession>(await this.c.calls.findOneAndUpdate({ _id: id, tenantId }, { $set: set }, { returnDocument: 'after' }));
  }

  async logVerification(log: VerificationLog) {
    const bucket = log.kind === 'link' ? 'links' : log.kind === 'call' ? 'callChecks' : log.kind === 'receipt' ? 'receiptChecks' : log.kind === 'contact' ? 'contactChecks' : log.kind === 'licence' ? 'licenceChecks' : 'verifications';
    const inc: Record<string, number> = { [`${bucket}.${enc(log.verdict)}`]: 1, [`verificationsByChannel.${enc(log.channelUsed)}`]: 1 };
    if (bucket === 'verifications') inc[`messageChecksByChannel.${enc(log.channelUsed)}`] = 1;
    await Promise.all([
      this.c.verifications.insertOne({ _id: hashId(log.tenantId, log.createdAt, String(Math.random())), ...clean(log), expireAt: new Date(Date.parse(log.createdAt) + VERIFICATION_TTL_MS) }),
      this.bump(log.tenantId, inc),
    ]);
  }

  async countSimSwap(tenantId: string, key: string) {
    await timed(this.bump(tenantId, { [`simSwap.${enc(key)}`]: 1 }));
  }

  async putDevice(device: Device) {
    const _id = hashId(device.tenantId, device.recipientKey, device.pushToken);
    await this.c.devices.replaceOne({ _id }, { _id, ...clean(device) }, { upsert: true });
  }

  async devices(tenantId: string, recipientKey: string) {
    return (await timed(this.c.devices.find({ tenantId, recipientKey }).toArray())).map((d) => strip<Device>(d)!);
  }

  async tenantDevices(tenantId: string) {
    return (await timed(this.c.devices.find({ tenantId }).toArray())).map((d) => strip<Device>(d)!);
  }

  async removeDevice(tenantId: string, recipientKey: string, pushToken: string) {
    await this.c.devices.deleteOne({ _id: hashId(tenantId, recipientKey, pushToken) });
  }

  async setLanguage(pref: LanguagePreference) {
    const _id = hashId(pref.tenantId, pref.recipientKey);
    await this.c.languages.replaceOne({ _id }, { _id, ...clean(pref) }, { upsert: true });
  }

  async language(tenantId: string, recipientKey: string): Promise<Language | null> {
    const d = await timed(this.c.languages.findOne({ _id: hashId(tenantId, recipientKey), tenantId }));
    return (d?.language as Language | undefined) ?? null;
  }

  async putReport(report: Report) {
    const r = await this.c.reports.replaceOne({ _id: report.id }, { _id: report.id, ...clean(report) }, { upsert: true });
    if (r.upsertedCount) await this.bump(report.tenantId, { reports: 1 });
  }

  async listReports(tenantId: string, filter?: { unassigned?: boolean }) {
    return (await timed(this.c.reports.find({ tenantId, ...(filter?.unassigned ? { campaignId: null } : {}) }).toArray())).map((d) => strip<Report>(d)!);
  }

  async updateReport(id: string, patch: Partial<Pick<Report, 'campaignId'>>) {
    await this.c.reports.updateOne({ _id: id }, { $set: clean(patch) });
  }

  async putCampaign(c: Campaign) {
    await this.c.campaigns.replaceOne({ _id: c.id }, { _id: c.id, ...clean(c) }, { upsert: true });
  }

  async getCampaign(tenantId: string, id: string) {
    return strip<Campaign>(await timed(this.c.campaigns.findOne({ _id: id, tenantId })));
  }

  async listCampaigns(tenantId: string) {
    return (await timed(this.c.campaigns.find({ tenantId }).toArray())).map((d) => strip<Campaign>(d)!).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  }

  async putAlert(a: RegistrationAlert) {
    const _id = hashId(a.tenantId, a.id);
    const r = await this.c.alerts.replaceOne({ _id }, { _id, ...clean(a), expireAt: new Date(Date.parse(a.lastSeen) + ALERT_TTL_MS) }, { upsert: true });
    if (r.upsertedCount) await this.bump(a.tenantId, { [`registrationAlerts.${enc(a.kind)}`]: 1 });
  }

  async getAlert(tenantId: string, id: string) {
    return strip<RegistrationAlert>(await timed(this.c.alerts.findOne({ _id: hashId(tenantId, id), tenantId })));
  }

  async listAlerts(tenantId: string, limit = 50) {
    return (await timed(this.c.alerts.find({ tenantId }).sort({ lastSeen: -1 }).limit(limit).toArray())).map((d) => strip<RegistrationAlert>(d)!);
  }

  async metrics(tenantId: string) {
    const [s, openCalls] = await Promise.all([
      timed(this.c.stats.findOne({ _id: tenantId })),
      timed(this.c.calls.countDocuments({ tenantId, status: { $in: ['open', 'answered'] }, expiresAt: { $gt: new Date().toISOString() } })),
    ]);
    const map = (k: string) => decMap(s?.[k]);
    return {
      registrations: (s?.registrations as number | undefined) ?? 0,
      registrationsByCategory: map('registrationsByCategory'),
      registrationsByChannel: map('registrationsByChannel'),
      verifications: map('verifications'),
      verificationsByChannel: map('verificationsByChannel'),
      messageChecksByChannel: map('messageChecksByChannel'),
      links: map('links'),
      callChecks: map('callChecks'),
      licenceChecks: map('licenceChecks'),
      contactChecks: map('contactChecks'),
      receiptsRegistered: (s?.receiptsRegistered as number | undefined) ?? 0,
      receiptChecks: map('receiptChecks'),
      openCalls,
      reports: (s?.reports as number | undefined) ?? 0,
      registrationAlerts: map('registrationAlerts'),
      simSwap: map('simSwap'),
    };
  }

  async listOrgs() {
    return (await timed(this.a.orgs.find().toArray())).map((d) => strip<OrgRecord>(d)!);
  }

  async getOrg(id: string) {
    return strip<OrgRecord>(await timed(this.a.orgs.findOne({ _id: id })));
  }

  async putOrg(org: OrgRecord) {
    await timed(this.a.orgs.replaceOne({ _id: org.id }, { _id: org.id, ...clean(org) }, { upsert: true }));
  }

  async listApiClients() {
    return (await timed(this.a.clients.find().toArray())).map((d) => strip<ApiClientRecord>(d)!);
  }

  async getApiClient(clientId: string) {
    const d = strip<ApiClientRecord>(await timed(this.a.clients.findOne({ _id: hashId(clientId) })));
    return d && d.clientId === clientId ? d : null;
  }

  async putApiClient(client: ApiClientRecord) {
    const _id = hashId(client.clientId);
    await timed(this.a.clients.replaceOne({ _id }, { _id, ...clean(client) }, { upsert: true }));
  }

  async touchApiClient(clientId: string, at: string) {
    await timed(this.a.clients.updateOne({ _id: hashId(clientId) }, { $set: { lastUsedAt: at } }));
  }

  async listTenantKeys() {
    return (await timed(this.a.keys.find().toArray())).map((d) => strip<TenantKeyRecord>(d)!);
  }

  async createTenantKey(key: TenantKeyRecord) {
    try {
      await timed(this.a.keys.insertOne({ _id: hashId(key.tenantId, String(key.version)), ...clean(key) }));
      return true;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) return false;
      throw err;
    }
  }

  async putTenantKey(key: TenantKeyRecord) {
    const _id = hashId(key.tenantId, String(key.version));
    await timed(this.a.keys.replaceOne({ _id }, { _id, ...clean(key) }, { upsert: true }));
  }

  async putAudit(entry: AuditEntry) {
    const _id = `${newestFirst(entry.at)}_${entry.id}`;
    // seq orders entries written in the same millisecond, newest first.
    await timed(this.a.audit.replaceOne({ _id }, { _id, ...clean(entry), seq: new ObjectId(), expireAt: new Date(Date.parse(entry.at) + ADMIN_LOG_TTL_MS) }, { upsert: true }));
  }

  async listAudit(query: { tenantId?: string; limit: number }) {
    const docs = await timed(this.a.audit.find(query.tenantId ? { tenantId: query.tenantId } : {}).sort({ at: -1, seq: -1 }).limit(query.limit).toArray());
    return docs.map((d) => {
      const { seq: _s, ...entry } = strip<AuditEntry & { seq: unknown }>(d)!;
      return entry;
    });
  }

  async putAdminSession(session: AdminSession) {
    await timed(this.a.sessions.replaceOne({ _id: session.idHash }, { _id: session.idHash, ...clean(session), expireAt: new Date(session.expiresAt) }, { upsert: true }));
  }

  async getAdminSession(idHash: string) {
    return strip<AdminSession>(await timed(this.a.sessions.findOne({ _id: idHash })));
  }

  async deleteAdminSession(idHash: string) {
    await timed(this.a.sessions.deleteOne({ _id: idHash }));
  }

  async listConsoleCodes(tenantId: string) {
    return (await timed(this.a.consoleCodes.find({ tenantId }).toArray())).map((d) => strip<ConsoleCodeRecord>(d)!);
  }

  async getConsoleCode(idHash: string) {
    return strip<ConsoleCodeRecord>(await timed(this.a.consoleCodes.findOne({ _id: idHash })));
  }

  async putConsoleCode(code: ConsoleCodeRecord) {
    await timed(this.a.consoleCodes.replaceOne({ _id: code.idHash }, { _id: code.idHash, ...clean(code) }, { upsert: true }));
  }

  async putConsoleSession(session: ConsoleSession) {
    await timed(this.a.consoleSessions.replaceOne({ _id: session.idHash }, { _id: session.idHash, ...clean(session), expireAt: new Date(session.expiresAt) }, { upsert: true }));
  }

  async getConsoleSession(idHash: string) {
    return strip<ConsoleSession>(await timed(this.a.consoleSessions.findOne({ _id: idHash })));
  }

  async deleteConsoleSession(idHash: string) {
    await timed(this.a.consoleSessions.deleteOne({ _id: idHash }));
  }

  async recordAppUser(tenantId: string, phone: string, at: string) {
    const d = await timed(
      this.a.appUsers.findOneAndUpdate({ _id: hashId(tenantId, phone) }, { $set: { tenantId, phone, lastSeenAt: at }, $setOnInsert: { firstSeenAt: at } }, { upsert: true, returnDocument: 'after' }),
    );
    return strip<AppUser>(d)!;
  }

  async removeAppUser(tenantId: string, phone: string) {
    return (await timed(this.a.appUsers.deleteOne({ _id: hashId(tenantId, phone) }))).deletedCount > 0;
  }

  async listAppUsers(tenantId: string, limit: number) {
    return (await timed(this.a.appUsers.find({ tenantId }).sort({ lastSeenAt: -1 }).limit(limit).toArray())).map((d) => strip<AppUser>(d)!);
  }

  async recordApiCall(e: ApiCallEvent) {
    const day = e.at.slice(0, 10);
    const inc: Record<string, number> = {
      calls: 1,
      errors: e.status >= 400 ? 1 : 0,
      [`byRoute.${enc(`${e.method} ${e.route}`)}`]: 1,
      [`byStatus.${e.status}`]: 1,
      [`byClient.${enc(e.clientId)}`]: 1,
    };
    await timed(
      Promise.all([
        this.a.usage.updateOne({ _id: `${e.tenantId}_${day}` }, { $inc: inc, $setOnInsert: { tenantId: e.tenantId, day, expireAt: new Date(Date.parse(e.at) + USAGE_TTL_MS) } }, { upsert: true }),
        e.status >= 400
          ? this.a.errors.insertOne({ _id: `${e.tenantId}_${newestFirst(e.at)}_${hashId(String(Math.random())).slice(0, 8)}`, ...clean(e), expireAt: new Date(Date.parse(e.at) + API_ERROR_TTL_MS) })
          : null,
      ]),
    );
  }

  async apiUsage(tenantId: string, days: string[]) {
    if (days.length === 0) return [];
    const docs = await timed(this.a.usage.find({ _id: { $in: days.map((d) => `${tenantId}_${d}`) } }).toArray());
    const byDay = new Map(docs.map((d) => [d.day as string, d]));
    return days.map((day): ApiUsageDay => {
      const d = byDay.get(day);
      return {
        day,
        calls: (d?.calls as number | undefined) ?? 0,
        errors: (d?.errors as number | undefined) ?? 0,
        byRoute: decMap(d?.byRoute),
        byStatus: (d?.byStatus as Record<string, number> | undefined) ?? {},
        byClient: decMap(d?.byClient),
      };
    });
  }

  async apiErrors(tenantId: string, limit: number) {
    return (await timed(this.a.errors.find({ tenantId }).sort({ at: -1 }).limit(limit).toArray())).map((d) => strip<ApiCallEvent>(d)!);
  }

  async reset() {
    await Promise.all(Object.values(this.c).map((col) => col.deleteMany({})));
  }

  async resetTenant(tenantId: string) {
    const { stats, receipts, ...rest } = this.c;
    await Promise.all([...Object.values(rest).map((col) => col.deleteMany({ tenantId })), receipts.deleteMany({ payerTenantId: tenantId }), stats.deleteOne({ _id: tenantId })]);
  }

  async dump() {
    const out: Record<string, unknown[]> = {};
    for (const [name, col] of Object.entries(this.c)) out[name] = await col.find().toArray();
    return { ...out, idempotencyKeys: out.idempotency };
  }
}
