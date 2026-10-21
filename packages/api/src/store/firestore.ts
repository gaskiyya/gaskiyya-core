import { createHash, randomInt } from 'node:crypto';
import { FieldPath, FieldValue, Firestore, Timestamp, type CollectionReference, type DocumentData, type DocumentReference, type DocumentSnapshot } from '@google-cloud/firestore';
import type { Language } from '@gaskiya/schemas';
import type {
  AdminSession,
  ApiCallEvent,
  ApiClientRecord,
  ApiUsageDay,
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
const READ_TIMEOUT_MS = 3000;
const RECORDS_PER_TRANSACTION = 200;
export const DEFAULT_STATS_SHARDS = 10;

const hashId = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

function timed<T>(p: Promise<T>, ms = READ_TIMEOUT_MS): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error('Firestore did not respond in time')), ms)))]).finally(() => clearTimeout(t));
}

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

const newestFirst = (iso: string) => String(9_999_999_999_999 - Date.parse(iso)).padStart(13, '0');
const ADMIN_LOG_TTL_MS = 400 * 24 * 3600_000;
const API_ERROR_TTL_MS = 30 * 24 * 3600_000;
const USAGE_TTL_MS = 120 * 24 * 3600_000;

type Counters = { [k: string]: number | Counters };

function addCounters(acc: Counters, src: Record<string, unknown>): Counters {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'number') acc[k] = ((acc[k] as number | undefined) ?? 0) + v;
    else if (v && typeof v === 'object') acc[k] = addCounters((acc[k] as Counters | undefined) ?? {}, v as Record<string, unknown>);
  }
  return acc;
}

function clean<T extends object>(o: T): DocumentData {
  return JSON.parse(JSON.stringify(o)) as DocumentData;
}

export interface FirestoreStoreOptions {
  prefix?: string;
  firestore?: Firestore;
  projectId?: string;
  databaseId?: string;
  credentials?: { client_email: string; private_key: string };
  statsShards?: number;
}

export class FirestoreStore implements Store {
  readonly db: Firestore;
  private readonly statsShards: number;
  readonly prefix: string;
  private c: Record<'messages' | 'idempotency' | 'receipts' | 'calls' | 'verifications' | 'devices' | 'languages' | 'reports' | 'campaigns' | 'alerts' | 'stats', CollectionReference>;
  private a: Record<'orgs' | 'clients' | 'keys' | 'audit' | 'sessions' | 'usage' | 'errors', CollectionReference>;

  constructor(o: FirestoreStoreOptions = {}) {
    this.db =
      o.firestore ??
      new Firestore({
        projectId: o.projectId,
        databaseId: o.databaseId,
        ...(o.credentials ? { credentials: o.credentials } : {}),
        ignoreUndefinedProperties: true,
      });
    this.statsShards = o.statsShards ?? DEFAULT_STATS_SHARDS;
    if (!Number.isInteger(this.statsShards) || this.statsShards < 1) throw new Error('statsShards must be a positive integer');
    this.prefix = o.prefix ?? 'gaskiya';
    const p = this.prefix;
    const col = (n: string) => this.db.collection(`${p}_${n}`);
    this.c = {
      messages: col('messages'),
      idempotency: col('idempotency'),
      receipts: col('receipts'),
      calls: col('calls'),
      verifications: col('verifications'),
      devices: col('devices'),
      languages: col('languages'),
      reports: col('reports'),
      campaigns: col('campaigns'),
      alerts: col('alerts'),
      stats: col('stats'),
    };
    this.a = {
      orgs: col('admin_orgs'),
      clients: col('admin_clients'),
      keys: col('admin_keys'),
      audit: col('admin_audit'),
      sessions: col('admin_sessions'),
      usage: col('api_usage'),
      errors: col('api_errors'),
    };
  }

  async ping(): Promise<void> {
    await timed(this.c.stats.doc('_ping').get());
  }

  private messageDoc(tenantId: string, recipientKey: string, contentKey: string) {
    return this.c.messages.doc(hashId(tenantId, recipientKey, contentKey));
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

  private async putChunk(entries: { record: MessageRecord; idempotencyKey?: string }[]) {
    const items = entries.map(({ record, idempotencyKey }) => ({
      record,
      msgRef: this.messageDoc(record.tenantId, record.recipientKey, record.contentKey),
      idemRef: idempotencyKey ? this.c.idempotency.doc(hashId(record.tenantId, idempotencyKey)) : null,
    }));
    const results = await this.db.runTransaction(async (tx) => {
      const idemRefs = [...new Map(items.filter((i) => i.idemRef).map((i) => [i.idemRef!.id, i.idemRef!])).values()];
      const live = new Map<string, DocumentSnapshot>();
      for (const snap of idemRefs.length ? await tx.getAll(...idemRefs) : []) {
        if (snap.exists && Date.now() - (snap.get('createdAt') as Timestamp).toMillis() < IDEMPOTENCY_TTL_MS) live.set(snap.id, snap);
      }
      const msgIds = [...new Set([...live.values()].map((snap) => snap.get('messageDocId') as string))];
      const existing = new Map<string, DocumentSnapshot>();
      for (const snap of msgIds.length ? await tx.getAll(...msgIds.map((id) => this.c.messages.doc(id))) : []) existing.set(snap.id, snap);

      const out: { record: MessageRecord; created: boolean }[] = [];
      const claimed = new Map<string, MessageRecord>();
      for (const { record, msgRef, idemRef } of items) {
        if (idemRef) {
          const earlier = claimed.get(idemRef.id);
          if (earlier) {
            out.push({ record: earlier, created: false });
            continue;
          }
          const idem = live.get(idemRef.id);
          const prior = idem && existing.get(idem.get('messageDocId') as string);
          if (idem && prior?.exists && prior.get('id') === idem.get('recordId')) {
            out.push({ record: this.toRecord(prior.data()!), created: false });
            continue;
          }
        }
        tx.set(msgRef, { ...clean(record), expireAt: ts(record.expiresAt) });
        if (idemRef) {
          tx.set(idemRef, {
            tenantId: record.tenantId,
            messageDocId: msgRef.id,
            recordId: record.id,
            createdAt: Timestamp.now(),
            expireAt: Timestamp.fromMillis(Date.now() + IDEMPOTENCY_TTL_MS),
          });
          claimed.set(idemRef.id, record);
        }
        out.push({ record, created: true });
      }
      return out;
    });

    const byTenant = new Map<string, { registrations: number; registrationsByCategory: Record<string, number>; registrationsByChannel: Record<string, number> }>();
    for (const r of results) {
      if (!r.created) continue;
      const t = byTenant.get(r.record.tenantId) ?? { registrations: 0, registrationsByCategory: {}, registrationsByChannel: {} };
      t.registrations++;
      t.registrationsByCategory[r.record.category] = (t.registrationsByCategory[r.record.category] ?? 0) + 1;
      t.registrationsByChannel[r.record.channel] = (t.registrationsByChannel[r.record.channel] ?? 0) + 1;
      byTenant.set(r.record.tenantId, t);
    }
    await Promise.all(
      [...byTenant].map(([tenantId, t]) =>
        this.statsShard(tenantId)
          .set(
            {
              registrations: FieldValue.increment(t.registrations),
              registrationsByCategory: Object.fromEntries(Object.entries(t.registrationsByCategory).map(([k, n]) => [k, FieldValue.increment(n)])),
              registrationsByChannel: Object.fromEntries(Object.entries(t.registrationsByChannel).map(([k, n]) => [k, FieldValue.increment(n)])),
            },
            { merge: true },
          )
          .catch(() => {}),
      ),
    );
    return results;
  }

  private statsShard(tenantId: string) {
    return this.c.stats.doc(`${tenantId}_${randomInt(this.statsShards)}`);
  }

  private toRecord(d: DocumentData): MessageRecord {
    const { expireAt: _e, ...rest } = d;
    return { keyVersion: 1, ...rest } as MessageRecord;
  }

  async findMessage(tenantId: string, recipientKey: string, contentKey: string, now: Date) {
    const snap = await timed(this.messageDoc(tenantId, recipientKey, contentKey).get());
    if (!snap.exists) return null;
    const r = this.toRecord(snap.data()!);
    if (r.tenantId !== tenantId || r.recipientKey !== recipientKey || r.contentKey !== contentKey) return null;
    if (Date.parse(r.expiresAt) <= now.getTime()) return null;
    return r;
  }

  async recentMessages(tenantId: string, recipientKey: string, since: Date, now: Date) {
    const q = await timed(
      this.c.messages
        .where('tenantId', '==', tenantId)
        .where('recipientKey', '==', recipientKey)
        .where('sentAt', '>=', since.toISOString())
        .get(),
    );
    return q.docs
      .map((d) => this.toRecord(d.data()))
      .filter((r) => Date.parse(r.expiresAt) > now.getTime())
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  }

  private receiptDoc(tenantId: string, accountKey: string, receiptKey: string) {
    return this.c.receipts.doc(hashId('receipt', tenantId, accountKey, receiptKey));
  }

  async putReceipts(entries: { record: ReceiptRecord; idempotencyKey?: string }[]) {
    const out: { record: ReceiptRecord; created: boolean }[] = [];
    for (let i = 0; i < entries.length; i += RECORDS_PER_TRANSACTION) {
      out.push(...(await this.putReceiptChunk(entries.slice(i, i + RECORDS_PER_TRANSACTION))));
    }
    return out;
  }

  private async putReceiptChunk(entries: { record: ReceiptRecord; idempotencyKey?: string }[]) {
    const items = entries.map(({ record, idempotencyKey }) => ({
      record,
      ref: this.receiptDoc(record.tenantId, record.accountKey, record.receiptKey),
      idemRef: idempotencyKey ? this.c.idempotency.doc(hashId('receipt', record.payerTenantId, idempotencyKey)) : null,
    }));
    const results = await this.db.runTransaction(async (tx) => {
      const idemRefs = [...new Map(items.filter((i) => i.idemRef).map((i) => [i.idemRef!.id, i.idemRef!])).values()];
      const live = new Map<string, DocumentSnapshot>();
      for (const snap of idemRefs.length ? await tx.getAll(...idemRefs) : []) {
        if (snap.exists && Date.now() - (snap.get('createdAt') as Timestamp).toMillis() < IDEMPOTENCY_TTL_MS) live.set(snap.id, snap);
      }
      const docIds = [...new Set([...live.values()].map((snap) => snap.get('receiptDocId') as string))];
      const existing = new Map<string, DocumentSnapshot>();
      for (const snap of docIds.length ? await tx.getAll(...docIds.map((id) => this.c.receipts.doc(id))) : []) existing.set(snap.id, snap);

      const out: { record: ReceiptRecord; created: boolean }[] = [];
      const claimed = new Map<string, ReceiptRecord>();
      for (const { record, ref, idemRef } of items) {
        if (idemRef) {
          const earlier = claimed.get(idemRef.id);
          if (earlier) {
            out.push({ record: earlier, created: false });
            continue;
          }
          const idem = live.get(idemRef.id);
          const prior = idem && existing.get(idem.get('receiptDocId') as string);
          if (idem && prior?.exists && prior.get('id') === idem.get('recordId')) {
            out.push({ record: this.toReceipt(prior.data()!), created: false });
            continue;
          }
        }
        tx.set(ref, { ...clean(record), expireAt: ts(record.expiresAt) });
        if (idemRef) {
          tx.set(idemRef, {
            tenantId: record.payerTenantId,
            receiptDocId: ref.id,
            recordId: record.id,
            createdAt: Timestamp.now(),
            expireAt: Timestamp.fromMillis(Date.now() + IDEMPOTENCY_TTL_MS),
          });
          claimed.set(idemRef.id, record);
        }
        out.push({ record, created: true });
      }
      return out;
    });
    const byPayer = new Map<string, number>();
    for (const r of results) if (r.created) byPayer.set(r.record.payerTenantId, (byPayer.get(r.record.payerTenantId) ?? 0) + 1);
    await Promise.all(
      [...byPayer].map(([tenantId, n]) => this.statsShard(tenantId).set({ receiptsRegistered: FieldValue.increment(n) }, { merge: true }).catch(() => {})),
    );
    return results;
  }

  private toReceipt(d: DocumentData): ReceiptRecord {
    const { expireAt: _e, ...rest } = d;
    return rest as ReceiptRecord;
  }

  async findReceipt(tenantId: string, accountKey: string, receiptKey: string, now: Date) {
    const snap = await timed(this.receiptDoc(tenantId, accountKey, receiptKey).get());
    if (!snap.exists) return null;
    const r = this.toReceipt(snap.data()!);
    if (r.tenantId !== tenantId || r.accountKey !== accountKey || r.receiptKey !== receiptKey) return null;
    if (Date.parse(r.expiresAt) <= now.getTime()) return null;
    return r;
  }

  async putCall(call: CallSession) {
    await this.c.calls.doc(call.id).set({ ...clean(call), expireAt: Timestamp.fromMillis(Date.parse(call.expiresAt) + 24 * 3600_000) });
  }

  private toCall(d: DocumentData): CallSession {
    const { expireAt: _e, ...rest } = d;
    return rest as CallSession;
  }

  async getCall(tenantId: string, id: string) {
    const snap = await timed(this.c.calls.doc(id).get());
    if (!snap.exists || snap.get('tenantId') !== tenantId) return null;
    return this.toCall(snap.data()!);
  }

  async openCalls(tenantId: string, recipientKey: string, now: Date) {
    const q = await timed(
      this.c.calls.where('tenantId', '==', tenantId).where('recipientKey', '==', recipientKey).where('status', 'in', ['open', 'answered']).get(),
    );
    return q.docs
      .map((d) => this.toCall(d.data()))
      .filter((c) => Date.parse(c.expiresAt) > now.getTime())
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  }

  async updateCall(tenantId: string, id: string, patch: Partial<Pick<CallSession, 'status' | 'expiresAt'>>) {
    const ref = this.c.calls.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get('tenantId') !== tenantId) return null;
      const next = { ...this.toCall(snap.data()!), ...patch };
      tx.set(ref, { ...clean(next), expireAt: Timestamp.fromMillis(Date.parse(next.expiresAt) + 24 * 3600_000) });
      return next;
    });
  }

  async logVerification(log: VerificationLog) {
    const bucket = log.kind === 'link' ? 'links' : log.kind === 'call' ? 'callChecks' : log.kind === 'receipt' ? 'receiptChecks' : log.kind === 'contact' ? 'contactChecks' : log.kind === 'licence' ? 'licenceChecks' : 'verifications';
    const batch = this.db.batch();
    batch.set(this.c.verifications.doc(), { ...clean(log), expireAt: Timestamp.fromMillis(Date.parse(log.createdAt) + 90 * 24 * 3600_000) });
    batch.set(
      this.statsShard(log.tenantId),
      {
        [bucket]: { [log.verdict]: FieldValue.increment(1) },
        verificationsByChannel: { [log.channelUsed]: FieldValue.increment(1) },
        ...(bucket === 'verifications' ? { messageChecksByChannel: { [log.channelUsed]: FieldValue.increment(1) } } : {}),
      },
      { merge: true },
    );
    await batch.commit();
  }

  async countSimSwap(tenantId: string, key: string) {
    await timed(this.statsShard(tenantId).set({ simSwap: { [key]: FieldValue.increment(1) } }, { merge: true }));
  }

  async putDevice(device: Device) {
    await this.c.devices.doc(hashId(device.tenantId, device.recipientKey, device.pushToken)).set(clean(device));
  }

  async devices(tenantId: string, recipientKey: string) {
    const q = await timed(this.c.devices.where('tenantId', '==', tenantId).where('recipientKey', '==', recipientKey).get());
    return q.docs.map((d) => d.data() as Device);
  }

  async tenantDevices(tenantId: string) {
    const q = await timed(this.c.devices.where('tenantId', '==', tenantId).get());
    return q.docs.map((d) => d.data() as Device);
  }

  async removeDevice(tenantId: string, recipientKey: string, pushToken: string) {
    await this.c.devices.doc(hashId(tenantId, recipientKey, pushToken)).delete();
  }

  async setLanguage(pref: LanguagePreference) {
    await this.c.languages.doc(hashId(pref.tenantId, pref.recipientKey)).set(clean(pref));
  }

  async language(tenantId: string, recipientKey: string): Promise<Language | null> {
    const snap = await timed(this.c.languages.doc(hashId(tenantId, recipientKey)).get());
    if (!snap.exists || snap.get('tenantId') !== tenantId) return null;
    return (snap.get('language') as Language | undefined) ?? null;
  }

  async putReport(report: Report) {
    const ref = this.c.reports.doc(report.id);
    await this.db.runTransaction(async (tx) => {
      const existed = (await tx.get(ref)).exists;
      tx.set(ref, clean(report));
      if (!existed) tx.set(this.statsShard(report.tenantId), { reports: FieldValue.increment(1) }, { merge: true });
    });
  }

  async listReports(tenantId: string, filter?: { unassigned?: boolean }) {
    let q = this.c.reports.where('tenantId', '==', tenantId);
    if (filter?.unassigned) q = q.where('campaignId', '==', null);
    return (await timed(q.get())).docs.map((d) => d.data() as Report);
  }

  async updateReport(id: string, patch: Partial<Pick<Report, 'campaignId'>>) {
    await this.c.reports.doc(id).update(clean(patch));
  }

  async putCampaign(c: Campaign) {
    await this.c.campaigns.doc(c.id).set(clean(c));
  }

  async getCampaign(tenantId: string, id: string) {
    const snap = await timed(this.c.campaigns.doc(id).get());
    if (!snap.exists || snap.get('tenantId') !== tenantId) return null;
    return snap.data() as Campaign;
  }

  async listCampaigns(tenantId: string) {
    const q = await timed(this.c.campaigns.where('tenantId', '==', tenantId).get());
    return q.docs.map((d) => d.data() as Campaign).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  }

  private alertDoc(tenantId: string, id: string) {
    return this.c.alerts.doc(hashId(tenantId, id));
  }

  async putAlert(a: RegistrationAlert) {
    const ref = this.alertDoc(a.tenantId, a.id);
    await this.db.runTransaction(async (tx) => {
      const existed = (await tx.get(ref)).exists;
      tx.set(ref, { ...clean(a), expireAt: Timestamp.fromMillis(Date.parse(a.lastSeen) + 90 * 24 * 3600_000) });
      if (!existed) tx.set(this.statsShard(a.tenantId), { registrationAlerts: { [a.kind]: FieldValue.increment(1) } }, { merge: true });
    });
  }

  async getAlert(tenantId: string, id: string) {
    const snap = await timed(this.alertDoc(tenantId, id).get());
    if (!snap.exists || snap.get('tenantId') !== tenantId) return null;
    const { expireAt: _e, ...rest } = snap.data()!;
    return rest as RegistrationAlert;
  }

  async listAlerts(tenantId: string, limit = 50) {
    const q = await timed(this.c.alerts.where('tenantId', '==', tenantId).get());
    return q.docs
      .map((d) => {
        const { expireAt: _e, ...rest } = d.data();
        return rest as RegistrationAlert;
      })
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
      .slice(0, limit);
  }

  async metrics(tenantId: string) {
    const statRefs = [this.c.stats.doc(tenantId), ...Array.from({ length: this.statsShards }, (_, i) => this.c.stats.doc(`${tenantId}_${i}`))];
    const [shards, calls] = await Promise.all([
      timed(this.db.getAll(...statRefs)),
      timed(this.c.calls.where('tenantId', '==', tenantId).where('status', 'in', ['open', 'answered']).get()),
    ]);
    const s = shards.reduce<Counters>((acc, d) => addCounters(acc, d.data() ?? {}), {});
    const map = (k: string) => (s[k] as Record<string, number> | undefined) ?? {};
    const now = Date.now();
    return {
      registrations: (s.registrations as number | undefined) ?? 0,
      registrationsByCategory: map('registrationsByCategory'),
      registrationsByChannel: map('registrationsByChannel'),
      verifications: map('verifications'),
      verificationsByChannel: map('verificationsByChannel'),
      messageChecksByChannel: map('messageChecksByChannel'),
      links: map('links'),
      callChecks: map('callChecks'),
      licenceChecks: map('licenceChecks'),
      contactChecks: map('contactChecks'),
      receiptsRegistered: (s.receiptsRegistered as number | undefined) ?? 0,
      receiptChecks: map('receiptChecks'),
      openCalls: calls.docs.filter((d) => Date.parse(d.get('expiresAt') as string) > now).length,
      reports: (s.reports as number | undefined) ?? 0,
      registrationAlerts: map('registrationAlerts'),
      simSwap: map('simSwap'),
    };
  }

  async listOrgs() {
    return (await timed(this.a.orgs.get())).docs.map((d) => d.data() as OrgRecord);
  }

  async getOrg(id: string) {
    const snap = await timed(this.a.orgs.doc(id).get());
    return snap.exists ? (snap.data() as OrgRecord) : null;
  }

  async putOrg(org: OrgRecord) {
    await timed(this.a.orgs.doc(org.id).set(clean(org)));
  }

  async listApiClients() {
    return (await timed(this.a.clients.get())).docs.map((d) => d.data() as ApiClientRecord);
  }

  async getApiClient(clientId: string) {
    const snap = await timed(this.a.clients.doc(hashId(clientId)).get());
    return snap.exists && snap.get('clientId') === clientId ? (snap.data() as ApiClientRecord) : null;
  }

  async putApiClient(client: ApiClientRecord) {
    await timed(this.a.clients.doc(hashId(client.clientId)).set(clean(client)));
  }

  async touchApiClient(clientId: string, at: string) {
    await timed(this.a.clients.doc(hashId(clientId)).update({ lastUsedAt: at }));
  }

  private keyDoc(tenantId: string, version: number) {
    return this.a.keys.doc(hashId(tenantId, String(version)));
  }

  async listTenantKeys() {
    return (await timed(this.a.keys.get())).docs.map((d) => d.data() as TenantKeyRecord);
  }

  async createTenantKey(key: TenantKeyRecord) {
    try {
      await timed(this.keyDoc(key.tenantId, key.version).create(clean(key)));
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 6) return false;
      throw err;
    }
  }

  async putTenantKey(key: TenantKeyRecord) {
    await timed(this.keyDoc(key.tenantId, key.version).set(clean(key)));
  }

  async putAudit(entry: AuditEntry) {
    await timed(this.a.audit.doc(`${newestFirst(entry.at)}_${entry.id}`).set({ ...clean(entry), expireAt: Timestamp.fromMillis(Date.parse(entry.at) + ADMIN_LOG_TTL_MS) }));
  }

  async listAudit(query: { tenantId?: string; limit: number }) {
    const q = query.tenantId
      ? this.a.audit.where('tenantId', '==', query.tenantId)
      : this.a.audit.orderBy(FieldPath.documentId()).limit(query.limit);
    const docs = (await timed(q.get())).docs.sort((x, y) => (x.id < y.id ? -1 : 1)).slice(0, query.limit);
    return docs.map((d) => {
      const { expireAt: _e, ...rest } = d.data();
      return rest as AuditEntry;
    });
  }

  async putAdminSession(session: AdminSession) {
    await timed(this.a.sessions.doc(session.idHash).set({ ...clean(session), expireAt: ts(session.expiresAt) }));
  }

  async getAdminSession(idHash: string) {
    const snap = await timed(this.a.sessions.doc(idHash).get());
    if (!snap.exists) return null;
    const { expireAt: _e, ...rest } = snap.data()!;
    return rest as AdminSession;
  }

  async deleteAdminSession(idHash: string) {
    await timed(this.a.sessions.doc(idHash).delete());
  }

  private usageDoc(tenantId: string, day: string, shard: number) {
    return this.a.usage.doc(`${tenantId}_${day}_${shard}`);
  }

  async recordApiCall(e: ApiCallEvent) {
    const day = e.at.slice(0, 10);
    const enc = encodeURIComponent;
    const batch = this.db.batch();
    batch.set(
      this.usageDoc(e.tenantId, day, randomInt(this.statsShards)),
      {
        tenantId: e.tenantId,
        day,
        calls: FieldValue.increment(1),
        errors: FieldValue.increment(e.status >= 400 ? 1 : 0),
        byRoute: { [enc(`${e.method} ${e.route}`)]: FieldValue.increment(1) },
        byStatus: { [String(e.status)]: FieldValue.increment(1) },
        byClient: { [enc(e.clientId)]: FieldValue.increment(1) },
        expireAt: Timestamp.fromMillis(Date.parse(e.at) + USAGE_TTL_MS),
      },
      { merge: true },
    );
    if (e.status >= 400) {
      batch.set(this.a.errors.doc(`${e.tenantId}_${newestFirst(e.at)}_${randomInt(1_000_000)}`), { ...clean(e), expireAt: Timestamp.fromMillis(Date.parse(e.at) + API_ERROR_TTL_MS) });
    }
    await timed(batch.commit());
  }

  async apiUsage(tenantId: string, days: string[]) {
    if (days.length === 0) return [];
    const refs = days.flatMap((day) => Array.from({ length: this.statsShards }, (_, i) => this.usageDoc(tenantId, day, i)));
    const snaps = await timed(this.db.getAll(...refs));
    const dec = (m: unknown) => Object.fromEntries(Object.entries((m ?? {}) as Record<string, number>).map(([k, v]) => [decodeURIComponent(k), v]));
    return days.map((day, i): ApiUsageDay => {
      const s = snaps.slice(i * this.statsShards, (i + 1) * this.statsShards).reduce<Counters>((acc, d) => {
        const data = d.data();
        if (!data) return acc;
        return addCounters(acc, { calls: data.calls, errors: data.errors, byRoute: dec(data.byRoute), byStatus: data.byStatus ?? {}, byClient: dec(data.byClient) });
      }, {});
      return {
        day,
        calls: (s.calls as number | undefined) ?? 0,
        errors: (s.errors as number | undefined) ?? 0,
        byRoute: (s.byRoute as Record<string, number> | undefined) ?? {},
        byStatus: (s.byStatus as Record<string, number> | undefined) ?? {},
        byClient: (s.byClient as Record<string, number> | undefined) ?? {},
      };
    });
  }

  async apiErrors(tenantId: string, limit: number) {
    const q = this.a.errors.orderBy(FieldPath.documentId()).startAt(`${tenantId}_`).endAt(`${tenantId}_\uf8ff`).limit(limit);
    return (await timed(q.get())).docs
      .map((d) => {
        const { expireAt: _e, ...rest } = d.data();
        return rest as ApiCallEvent;
      })
      .filter((e) => e.tenantId === tenantId);
  }

  async reset() {
    await Promise.all(Object.values(this.c).map((col) => this.db.recursiveDelete(col)));
  }

  async resetTenant(tenantId: string) {
    const { stats, receipts, ...rest } = this.c;
    const refs: DocumentReference[] = [];
    for (const col of Object.values(rest)) {
      refs.push(...(await col.where('tenantId', '==', tenantId).select().get()).docs.map((d) => d.ref));
    }
    refs.push(...(await receipts.where('payerTenantId', '==', tenantId).select().get()).docs.map((d) => d.ref));
    refs.push(stats.doc(tenantId), ...Array.from({ length: this.statsShards }, (_, i) => stats.doc(`${tenantId}_${i}`)));
    for (let i = 0; i < refs.length; i += 400) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
      await batch.commit();
    }
  }

  async dump() {
    const out: Record<string, unknown[]> = {};
    for (const [name, col] of Object.entries(this.c)) {
      out[name] = (await col.get()).docs.map((d) => ({ _id: d.id, ...d.data() }));
    }
    return { ...out, idempotencyKeys: out.idempotency };
  }
}
