import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  activityText,
  copy,
  fill,
  type ActivityItem,
  type CallPurpose,
  type Channel,
  type Category,
  type ContactResult,
  type ContactView,
  type Indicator,
  type Language,
  type LicenceResult,
  type LicenceSourceView,
  type LicensedFirm,
  type ReceiptResult,
  type RegisterMessage,
  type RegisterReceipt,
  type SimSwapWarning,
  type VerifyChannel,
  type VerifyResult,
} from '@gaskiya/schemas';
import { guardAdvisory } from './ai/briefing.ts';
import { explain, type ExplainResult } from './ai/explain.ts';
import type { ModelProvider } from './ai/provider.ts';
import { InvalidPushTokenError, type AdvisoryNotice, type CallNotice, type EventHub, type PushProvider } from './channels/channels.ts';
import type { VoipCall, VoipPush } from './channels/voip.ts';
import { REGULATORS, type LicenceSource } from '@gaskiya/licences';
import { contactFacts, contactPhone, parseContact, type ContactFacts } from './domain/contact.ts';
import { decideContactVerdict, decideLicenceVerdict, decideOtpHold, decideReceiptVerdict, decideSimSwapStatus, decideSimSwapWarnings, decideVerdict, type SimSwapProbe } from './domain/verdict.ts';
import { findLicence, type LicenceHit, type LicenceIndex } from './domain/licence.ts';
import type { LicenceRegistry } from './licences/registry.ts';
import type { SimSwapMonitor } from './simswap/monitor.ts';
import { checkLink, extractDomains, type LinkResult } from './domain/link.ts';
import { callbackDigest, callbackDigits, extractPhoneNumbers, maskDigits } from './domain/text.ts';
import { coverage } from './domain/coverage.ts';
import type { RegistrationGuard } from './guard.ts';
import type { KeyService } from './keys/keys.ts';
import { isSuspended, type CallSession, type Campaign, type Device, type MessageRecord, type ReceiptRecord, type Report, type Store, type Tenant } from './store/types.ts';

export interface ServiceConfig {
  recordTtlDays: number;
  callRingSeconds: number;
  callMaxSeconds: number;
  aiTimeoutMs: number;
  registerMaxFutureSeconds: number;
  receiptTtlDays?: number;
  advisoryTtlDays?: number;
}

export class AdvisoryError extends Error {
  constructor(
    readonly statusCode: 409 | 422,
    readonly code: 'unsafe_advisory' | 'not_approved',
    message: string,
  ) {
    super(message);
  }
}

export class CallInProgressError extends Error {
  readonly statusCode = 409;
  readonly code = 'call_in_progress';
  constructor(readonly call: { id: string; status: string; expiresAt: string }) {
    super('A call to this number is already open. End it before announcing another.');
  }
}

export interface AdvisoryView {
  id: string;
  bank: string;
  title: string;
  text: string;
  approvedAt: string;
  expiresAt: string;
  indicators: Indicator[];
  linkDomains: string[];
  asksCallback: boolean;
}

export const INDICATOR_WINDOW_DAYS = 7;

export interface OfficialIdentity {
  bankId: string;
  name: string;
  kind: string;
  phones: string[];
  senderIds: string[];
  domains: string[];
  updatedAt: string;
}

export interface IndicatorMatch {
  kind: 'domain' | 'phone';
  value: string;
  campaignId: string;
  reports: number;
  lastSeen: string;
}

export type ReceiptRegistration =
  | { receiptId: string; expiresAt: string; created: boolean }
  | { receiptId: null; expiresAt: null; created: false; reason: 'beneficiary_bank_not_enrolled' };

export class RegistrationError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: 'sent_at_in_future' | 'sent_at_expired',
    message: string,
  ) {
    super(message);
  }
}

export interface Logger {
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CallView {
  id: string;
  purpose: CallPurpose;
  code: string;
  status: CallSession['status'];
  openedAt: string;
  expiresAt: string;
  token?: string;
}

export type CallActor = 'agent' | 'customer';

/** Who is acting on a call from the phone: the signed-in customer, or the call's own token. */
export type CallParty = { tenant: Tenant; phone: string } | { token: string };

export interface CallState {
  id: string;
  status: 'open' | 'answered' | 'ended' | 'expired';
  expiresAt: string;
  code?: string;
  endedBy?: CallActor;
  declined?: boolean;
}

interface UnverifiedCall {
  id: string;
  tenantId: string;
  recipientKey: string;
  caller: string;
  number: string;
  status: 'open' | 'answered' | 'ended';
  expiresAt: string;
  endedBy?: CallActor;
  declined?: boolean;
}

export type CallCheck =
  | {
      verdict: 'calling';
      calling: true;
      bank: string;
      call: CallView;
      calls: CallView[];
    }
  | { verdict: 'not_calling'; calling: false; bank: string }
  | { verdict: 'cannot_check'; bank: string };

export type CallCheckResult = CallCheck & { warnings?: SimSwapWarning[] };

export interface Registered {
  recordId: string;
  expiresAt: string;
  created: boolean;
  simSwap?: { warning: boolean; status: 'swapped' | 'not_swapped' | 'unknown' };
}

export type SimSwapAnswer =
  | { status: 'swapped' | 'not_swapped'; swapped: boolean; latestSimChange: string | null; maxAgeHours: number; checkedAt: string }
  | { status: 'unknown'; reason: 'provider_unavailable' | 'not_configured'; maxAgeHours: number; checkedAt: string };

export class GaskiyaService {
  voip: VoipPush | null = null;

  constructor(
    readonly tenants: Map<string, Tenant>,
    readonly store: Store,
    private keys: KeyService,
    private model: ModelProvider,
    private push: PushProvider,
    private events: EventHub,
    private cfg: ServiceConfig,
    private log: Logger,
    private clock: () => Date = () => new Date(),
  ) {}

  now() {
    return this.clock();
  }

  tenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  hasKey(tenantId: string) {
    return this.keys.has(tenantId);
  }

  recipientKey(tenantId: string, phone: string) {
    return this.keys.keyed(tenantId, 'recipient', phone);
  }

  recipientKeys(tenantId: string, phone: string) {
    return this.keys.versions(tenantId).map((v) => this.keys.keyed(tenantId, 'recipient', phone, v));
  }

  eventChannel(tenantId: string, phone: string) {
    return `${tenantId}:${this.recipientKey(tenantId, phone)}`;
  }

  guard: RegistrationGuard | null = null;

  simSwap: SimSwapMonitor | null = null;

  private countSim(tenantId: string, key: string): Promise<void> {
    return this.store.countSimSwap(tenantId, key).catch(() => {});
  }

  private startSim(tenantId: string, phone: string, notify = true): (() => Promise<SimSwapProbe>) | null {
    if (!this.simSwap || !this.tenants.has(tenantId)) return null;
    try {
      return this.simSwap.start(tenantId, this.recipientKey(tenantId, phone), phone, { notify });
    } catch {
      return () => Promise.resolve({ ok: false });
    }
  }

  private async simWarnings(tenantId: string, wait: (() => Promise<SimSwapProbe>) | null, verdict: Parameters<typeof decideSimSwapWarnings>[0]['verdict'], category?: string | null): Promise<SimSwapWarning[]> {
    if (!wait) return [];
    const warnings = decideSimSwapWarnings({ probe: await wait(), verdict, category });
    for (const w of warnings) void this.countSim(tenantId, w === 'sim_swapped_recently' ? 'customer_warned' : 'customer_unknown');
    return warnings;
  }

  simSwapWarnings(tenant: Tenant, phone: string): Promise<SimSwapWarning[]> {
    return this.simWarnings(tenant.id, this.startSim(tenant.id, phone), 'none');
  }

  async checkSimSwap(tenantId: string, phone: string, maxAgeHours: number): Promise<SimSwapAnswer> {
    const probe = this.simSwap ? await this.simSwap.ask(phone, maxAgeHours) : null;
    const checkedAt = this.now().toISOString();
    const status = decideSimSwapStatus(probe);
    await this.countSim(tenantId, `bank_${status}`);
    if (status === 'unknown' || !probe?.ok) return { status: 'unknown', reason: this.simSwap ? 'provider_unavailable' : 'not_configured', maxAgeHours, checkedAt };
    return { status, swapped: status === 'swapped', latestSimChange: probe.latestSimChange ?? null, maxAgeHours, checkedAt };
  }

  private async otpSimSwap(tenantId: string, wait: (() => Promise<SimSwapProbe>) | null): Promise<Registered['simSwap']> {
    if (!wait) return undefined;
    const probe = await wait();
    const warning = decideOtpHold({ category: 'otp', probe });
    const status = decideSimSwapStatus(probe);
    await this.countSim(tenantId, warning ? 'registration_hold' : status === 'unknown' ? 'registration_unknown' : 'registration_clear');
    return { warning, status };
  }

  private checkSentAt(sentAt: Date, now: Date, ttlDays: number, at: string) {
    const maxFuture = this.cfg.registerMaxFutureSeconds;
    if (sentAt.getTime() > now.getTime() + maxFuture * 1000) {
      throw new RegistrationError('sent_at_in_future', `${at}sentAt is more than ${maxFuture} seconds ahead of server time`);
    }
    if (sentAt.getTime() + ttlDays * DAY_MS <= now.getTime()) {
      throw new RegistrationError('sent_at_expired', `${at}sentAt is more than ${ttlDays} days ago, so the record would already have expired`);
    }
  }

  private buildRecord(tenantId: string, m: RegisterMessage, index?: number): MessageRecord {
    const tenant = this.tenants.get(tenantId)!;
    const ttlDays = tenant.recordTtlDays ?? this.cfg.recordTtlDays;
    const sentAt = new Date(m.sentAt);
    const now = this.now();
    this.checkSentAt(sentAt, now, ttlDays, index === undefined ? '' : `messages.${index}: `);
    const keyVersion = this.keys.currentVersion(tenantId);
    return {
      id: `rec_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      tenantId,
      recipientKey: this.keys.keyed(tenantId, 'recipient', m.recipient, keyVersion),
      contentKey: this.keys.keyed(tenantId, 'content', m.contentDigest, keyVersion),
      keyVersion,
      channel: m.channel,
      category: m.category,
      hasLink: m.hasLink,
      linkDomains: m.linkDomains,
      asksCallback: m.asksCallback,
      sentAt: sentAt.toISOString(),
      expiresAt: new Date(sentAt.getTime() + ttlDays * DAY_MS).toISOString(),
      registeredAt: now.toISOString(),
    };
  }

  async registerMessage(tenantId: string, m: RegisterMessage, idempotencyKey?: string, clientId: string | null = null): Promise<Registered> {
    const record = this.buildRecord(tenantId, m);
    const sim = m.category === 'otp' ? this.startSim(tenantId, m.recipient, false) : null;
    const { record: stored, created } = await this.store.putMessage(record, idempotencyKey);
    if (created) await this.guard?.observe(this.tenants.get(tenantId)!, [m], clientId);
    const simSwap = await this.otpSimSwap(tenantId, sim);
    return { recordId: stored.id, expiresAt: stored.expiresAt, created, ...(simSwap ? { simSwap } : {}) };
  }

  async registerMessages(tenantId: string, ms: RegisterMessage[], idempotencyKey?: string, clientId: string | null = null): Promise<Registered[]> {
    const entries = ms.map((m, i) => ({ record: this.buildRecord(tenantId, m, i), idempotencyKey: idempotencyKey ? `${idempotencyKey}:${i}` : undefined }));
    const sims = ms.map((m) => (m.category === 'otp' ? this.startSim(tenantId, m.recipient, false) : null));
    const stored = await this.store.putMessages(entries);
    await this.guard?.observe(this.tenants.get(tenantId)!, ms.filter((_, i) => stored[i]!.created), clientId);
    const simSwaps = await Promise.all(sims.map((w) => this.otpSimSwap(tenantId, w)));
    return stored.map(({ record, created }, i) => ({ recordId: record.id, expiresAt: record.expiresAt, created, ...(simSwaps[i] ? { simSwap: simSwaps[i] } : {}) }));
  }

  tenantByBankCode(code: string): Tenant | undefined {
    for (const t of this.tenants.values()) if (t.bankCode === code && this.keys.has(t.id) && !isSuspended(t)) return t;
    return undefined;
  }

  async registerReceipts(
    payerTenantId: string,
    receipts: RegisterReceipt[],
    idempotencyKey?: string,
    clientId: string | null = null,
    single = false,
  ): Promise<ReceiptRegistration[]> {
    const now = this.now();
    const ttlDays = this.cfg.receiptTtlDays ?? 30;
    const entries: { index: number; record: ReceiptRecord; idempotencyKey?: string }[] = [];
    receipts.forEach((r, i) => {
      const beneficiary = this.tenantByBankCode(r.beneficiaryBank);
      if (!beneficiary) return;
      const keyVersion = this.keys.currentVersion(beneficiary.id);
      entries.push({
        index: i,
        idempotencyKey: idempotencyKey ? (single ? idempotencyKey : `${idempotencyKey}:${i}`) : undefined,
        record: {
          id: `rct_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          tenantId: beneficiary.id,
          payerTenantId,
          accountKey: this.keys.keyed(beneficiary.id, 'account', r.beneficiaryAccount, keyVersion),
          receiptKey: this.keys.keyed(beneficiary.id, 'receipt', r.receiptDigest, keyVersion),
          keyVersion,
          currency: 'NGN',
          registeredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + ttlDays * DAY_MS).toISOString(),
        },
      });
    });
    const stored = entries.length ? await this.store.putReceipts(entries.map(({ record, idempotencyKey: k }) => ({ record, idempotencyKey: k }))) : [];
    const out: ReceiptRegistration[] = receipts.map(() => ({ receiptId: null, expiresAt: null, created: false, reason: 'beneficiary_bank_not_enrolled' }));
    entries.forEach((e, j) => {
      const { record, created } = stored[j]!;
      out[e.index] = { receiptId: record.id, expiresAt: record.expiresAt, created };
    });
    const created = out.filter((r) => r.created).length;
    const payer = this.tenants.get(payerTenantId);
    if (payer && created) await this.guard?.observeCount(payer, created, clientId);
    return out;
  }

  async verifyReceipt(
    tenant: Tenant,
    phone: string,
    accounts: string[],
    beneficiaryAccount: string,
    receiptDigest: string,
    channelUsed: VerifyChannel,
  ): Promise<ReceiptResult> {
    const now = this.now();
    const enrolled = Boolean(tenant.bankCode) && this.keys.has(tenant.id) && !isSuspended(tenant);
    const accountBound = accounts.includes(beneficiaryAccount);
    let accountKey = '';
    let receiptKey = '';
    let keyVersion: number | undefined;
    let lookup: { ok: false } | { ok: true; record: ReceiptRecord | null } = { ok: false };
    try {
      if (enrolled && accountBound) {
        const attempts = this.keys.versions(tenant.id).map((v) => ({
          version: v,
          accountKey: this.keys.keyed(tenant.id, 'account', beneficiaryAccount, v),
          receiptKey: this.keys.keyed(tenant.id, 'receipt', receiptDigest, v),
        }));
        const found = await Promise.all(attempts.map((a) => this.store.findReceipt(tenant.id, a.accountKey, a.receiptKey, now)));
        const hit = attempts.findIndex((a, i) => found[i] !== null && (found[i]!.keyVersion ?? 1) === a.version);
        const used = attempts[hit === -1 ? 0 : hit]!;
        ({ accountKey, receiptKey, version: keyVersion } = used);
        lookup = { ok: true, record: hit === -1 ? null : found[hit]! };
      }
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'receipt lookup failed');
      lookup = { ok: false };
    }
    const verdict = decideReceiptVerdict({ enrolled, accountBound, lookup, accountKey, receiptKey, keyVersion, now });

    let result: ReceiptResult;
    if (verdict === 'received' && lookup.ok && lookup.record) {
      const r = lookup.record;
      result = { verdict, bank: tenant.name, paidFrom: this.tenants.get(r.payerTenantId)?.name ?? r.payerTenantId, registeredAt: r.registeredAt };
    } else if (verdict === 'not_confirmed') {
      result = { verdict, bank: tenant.name };
    } else {
      result = { verdict: 'cannot_check' };
    }
    if (!this.keys.has(tenant.id)) return result;
    this.store
      .logVerification({
        tenantId: tenant.id,
        recipientKey: this.recipientKey(tenant.id, phone),
        channelUsed,
        kind: 'receipt',
        verdict,
        matchedRecordId: verdict === 'received' && lookup.ok ? (lookup.record?.id ?? null) : null,
        createdAt: now.toISOString(),
      })
      .catch(() => {});
    return result;
  }

  async activity(tenant: Tenant, recipientKeys: string[]): Promise<{ items: ActivityItem[]; text: string }> {
    const now = this.now();
    const since = new Date(now.getTime() - DAY_MS);
    const recent = (await Promise.all(recipientKeys.map((k) => this.store.recentMessages(tenant.id, k, since, now)))).flat();
    const groups = new Map<string, ActivityItem>();
    for (const r of recent) {
      const k = `${r.category}|${r.channel}`;
      const g = groups.get(k) ?? { category: r.category as Category, channel: r.channel as Channel, count: 0, anyWithLink: false };
      g.count++;
      g.anyWithLink ||= r.hasLink;
      groups.set(k, g);
    }
    const items = [...groups.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category) || a.channel.localeCompare(b.channel));
    return { items, text: activityText(tenant.name, items) };
  }

  async verifyDigest(tenantId: string, phone: string, contentDigest: string, channelUsed: VerifyChannel): Promise<VerifyResult> {
    const tenant = this.tenants.get(tenantId);
    const now = this.now();
    const sim = this.startSim(tenantId, phone);
    let recipientKey = '';
    let contentKey = '';
    let keyVersion: number | undefined;
    let recipientKeys: string[] = [];
    let lookup: { ok: false } | { ok: true; record: MessageRecord | null } = { ok: false };
    try {
      if (tenant && !isSuspended(tenant)) {
        const attempts = this.keys.versions(tenantId).map((v) => ({
          version: v,
          recipientKey: this.keys.keyed(tenantId, 'recipient', phone, v),
          contentKey: this.keys.keyed(tenantId, 'content', contentDigest, v),
        }));
        recipientKeys = attempts.map((a) => a.recipientKey);
        const found = await Promise.all(attempts.map((a) => this.store.findMessage(tenantId, a.recipientKey, a.contentKey, now)));
        const hit = attempts.findIndex((a, i) => found[i] !== null && found[i]!.keyVersion === a.version);
        const used = attempts[hit === -1 ? 0 : hit]!;
        ({ recipientKey, contentKey, version: keyVersion } = used);
        lookup = { ok: true, record: hit === -1 ? null : found[hit]! };
      }
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'registry lookup failed');
      lookup = { ok: false };
    }
    const verdict = decideVerdict({ enrolled: Boolean(tenant) && !isSuspended(tenant), lookup, recipientKey, contentKey, keyVersion, now });
    if (recipientKeys.length) recipientKey = recipientKeys[0]!;

    let result: VerifyResult;
    if (verdict === 'confirmed' && lookup.ok && lookup.record) {
      const r = lookup.record;
      result = { verdict, channel: r.channel, category: r.category, sentAt: r.sentAt, bank: tenant!.name };
    } else if (verdict === 'not_confirmed') {
      let items: ActivityItem[] = [];
      let text = '';
      try {
        ({ items, text } = await this.activity(tenant!, recipientKeys));
      } catch {
        // Activity is supplementary; keep the not-confirmed verdict if unavailable.
      }
      result = { verdict, recentActivity: items, activityText: text, bank: tenant!.name };
    } else {
      result = { verdict: 'cannot_check' };
    }

    if (tenant && recipientKey) {
      this.store
        .logVerification({
          tenantId,
          recipientKey,
          channelUsed,
          kind: 'message',
          verdict,
          matchedRecordId: verdict === 'confirmed' && lookup.ok ? (lookup.record?.id ?? null) : null,
          createdAt: now.toISOString(),
        })
        .catch(() => {});
    }
    const warnings = await this.simWarnings(tenantId, sim, verdict, result.verdict === 'confirmed' ? result.category : null);
    return warnings.length ? { ...result, warnings } : result;
  }

  verifyLink(tenant: Tenant, phone: string, url: string, channelUsed: VerifyChannel): LinkResult {
    const result = checkLink(url, tenant.domains, tenant.name, tenant.officialApps);
    this.store
      .logVerification({
        tenantId: tenant.id,
        recipientKey: this.recipientKey(tenant.id, phone),
        channelUsed,
        kind: 'link',
        verdict: result.verdict,
        matchedRecordId: null,
        createdAt: this.now().toISOString(),
      })
      .catch(() => {});
    return result;
  }

  licences: { registry: LicenceRegistry; maxAgeDays: number } | null = null;

  private async licenceIndex(): Promise<LicenceIndex | null> {
    try {
      return this.licences ? await this.licences.registry.snapshot() : null;
    } catch {
      return null;
    }
  }

  async checkLicence(tenant: Tenant, phone: string, query: string, channelUsed: VerifyChannel): Promise<LicenceResult> {
    const index = await this.licenceIndex();
    const facts = index ? findLicence(index, query) : { exact: null, nearest: null };
    const decision = decideLicenceVerdict({
      data: index ? { ok: true, sources: index.sources } : { ok: false },
      exactSourceId: facts.exact?.source.id ?? null,
      nearest: facts.nearest,
      maxAgeDays: this.licences?.maxAgeDays ?? 0,
      now: this.now(),
    });
    this.store
      .logVerification({
        tenantId: tenant.id,
        recipientKey: this.recipientKey(tenant.id, phone),
        channelUsed,
        kind: 'licence',
        verdict: decision.verdict,
        matchedRecordId: null,
        createdAt: this.now().toISOString(),
      })
      .catch(() => {});
    const regulators = REGULATORS.map((r) => ({ name: r.name, url: r.url }));
    if (decision.verdict === 'licensed' && facts.exact) return { verdict: 'licensed', firm: firmView(facts.exact), regulators };
    if (decision.verdict === 'not_listed') {
      return { verdict: 'not_listed', similarTo: decision.similar && facts.nearest ? firmView(facts.nearest) : null, regulators, sources: index!.sources.map(sourceView) };
    }
    return { verdict: 'cannot_check', regulators };
  }

  async licenceStatus() {
    const index = await this.licenceIndex();
    const maxAgeDays = this.licences?.maxAgeDays ?? 0;
    if (!index) return { status: 'unavailable' as const, maxAgeDays, sources: [] };
    const sources = index.sources.map((s) => {
      const fresh = decideLicenceVerdict({ data: { ok: true, sources: [s] }, exactSourceId: null, nearest: null, maxAgeDays, now: this.now() }).verdict !== 'cannot_check';
      return { ...sourceView(s), entries: index.entryCount.get(s.id) ?? 0, stale: !fresh };
    });
    return { status: sources.some((s) => s.stale) ? ('stale' as const) : ('fresh' as const), maxAgeDays, sources };
  }

  async verifyContact(
    who: { tenant: Tenant; phone: string },
    raw: string,
    channelUsed: VerifyChannel,
    only?: Tenant,
  ): Promise<ContactResult | null> {
    const parsed = parseContact(raw);
    if (!parsed) return null;
    let facts: ContactFacts | null = null;
    try {
      await this.store.ping();
      facts = contactFacts(parsed, only ? [only] : this.tenants.values());
      const unvouched = (id: string) => {
        const t = this.tenants.get(id);
        return !t || isSuspended(t) || t.mode === 'sandbox';
      };
      if ((only && unvouched(only.id)) || facts.matches.some((m) => unvouched(m.id))) facts = null;
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'contact check failed');
    }
    const verdict = decideContactVerdict({ directoryOk: facts !== null, parsed: true, exactMatches: facts?.matches.length ?? 0 });
    this.store
      .logVerification({
        tenantId: who.tenant.id,
        recipientKey: this.recipientKey(who.tenant.id, who.phone),
        channelUsed,
        kind: 'contact',
        verdict,
        matchedRecordId: null,
        createdAt: this.now().toISOString(),
      })
      .catch(() => {});
    if (verdict === 'cannot_check' || !facts) return { verdict: 'cannot_check' };
    const contact: ContactView = parsed.type === 'social' ? { type: parsed.type, value: parsed.value, platform: parsed.platform } : { type: parsed.type, value: parsed.value };
    if (verdict === 'official') return { verdict, contact, matches: facts.matches };
    return {
      verdict,
      contact,
      organisation: only ? { id: only.id, name: only.name, kind: only.kind ?? 'bank' } : null,
      reasons: facts.impersonates.length ? ['impersonation', 'not_registered'] : ['not_registered'],
      impersonates: facts.impersonates,
    };
  }

  explain(tenant: Tenant, text: string, language: string): Promise<ExplainResult> {
    return explain(this.model, { text, language, bankName: tenant.name, bankDomains: tenant.domains, orgKind: tenant.kind }, this.cfg.aiTimeoutMs);
  }

  extractText(imageBase64: string, mediaType: string) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20_000);
    return this.model
      .extractText({ imageBase64, mediaType }, controller.signal)
      .catch(() => null)
      .finally(() => clearTimeout(t));
  }

  /** A token that lets the phone answer or end this one call without the customer's sign-in, e.g. from CallKit with the app closed. */
  callToken(tenantId: string, callId: string) {
    return `${tenantId}.${this.keys.keyed(tenantId, 'call', callId)}`;
  }

  private tokenTenant(callId: string, token: string): string | null {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const tenantId = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    if (!this.tenants.has(tenantId) || !this.keys.has(tenantId)) return null;
    const ok = this.keys.versions(tenantId).some((v) => {
      const want = Buffer.from(this.keys.keyed(tenantId, 'call', callId, v));
      return want.length === given.length && timingSafeEqual(want, given);
    });
    return ok ? tenantId : null;
  }

  private callState(c: { id: string; code?: string; status: string; expiresAt: string; endedBy?: CallActor; declined?: boolean }): CallState {
    const status = c.status === 'ended' ? 'ended' : c.status === 'expired' || Date.parse(c.expiresAt) <= this.now().getTime() ? 'expired' : (c.status as 'open' | 'answered');
    return { id: c.id, status, expiresAt: c.expiresAt, ...(c.code ? { code: c.code } : {}), ...(c.endedBy ? { endedBy: c.endedBy } : {}), ...(c.declined ? { declined: true } : {}) };
  }

  private notice(type: 'call.opened' | 'call.closed', tenant: Tenant, c: CallSession): CallNotice {
    const base = { callId: c.id, bank: tenant.name, purpose: c.purpose, expiresAt: c.expiresAt };
    if (type === 'call.opened') return { type, ...base, code: c.code, token: this.callToken(tenant.id, c.id) };
    return { type, ...base, code: null, ...(c.endedBy ? { endedBy: c.endedBy } : {}) };
  }

  private async notify(tenant: Tenant, recipientKey: string, notice: CallNotice) {
    this.events.publish(`${tenant.id}:${recipientKey}`, notice);
    // The call is stored; a failed lookup only skips the push.
    let devices: Device[];
    try {
      devices = await this.store.devices(tenant.id, recipientKey);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'call push: device list failed');
      return;
    }
    const voip = this.voip;
    const base = { callId: notice.callId, orgId: tenant.id, expiresAt: notice.expiresAt, ...(notice.token ? { token: notice.token } : {}) };
    const voipCall: VoipCall | null =
      notice.type === 'call.opened' && notice.code
        ? { ...base, bank: tenant.name, code: notice.code, kind: 'bank' }
        : notice.type === 'call.unverified'
          ? { ...base, bank: notice.caller ?? tenant.name, code: '', kind: 'unverified', number: notice.number ?? '' }
          : null;
    const ring = (d: Device) =>
      voip && d.voipToken && voipCall
        ? voip.send(d.voipToken, voipCall).then(
            () => true,
            (err: Error) => {
              this.log.warn({ err: err.message }, 'voip push failed');
              return false;
            },
          )
        : Promise.resolve(false);
    await Promise.all(
      devices.map(async (d) => {
        // An iPhone that rang through CallKit does not also get the "is calling you" banner.
        if (await ring(d)) return;
        await this.push.send(d.pushToken, notice).catch(async (err: Error) => {
          if (err instanceof InvalidPushTokenError) {
            await this.store.removeDevice(tenant.id, recipientKey, d.pushToken).catch(() => {});
          } else {
            this.log.warn({ err: err.message }, 'push failed');
          }
        });
      }),
    );
  }

  private readonly callLocks = new Map<string, Promise<unknown>>();

  /** One open call per number. Requests for the same number run in turn. */
  async openCall(tenantId: string, input: { recipient: string; purpose: CallPurpose; agentRef: string }) {
    const recipientKey = this.keys.keyed(tenantId, 'recipient', input.recipient);
    const lock = `${tenantId}:${recipientKey}`;
    const mine = (this.callLocks.get(lock) ?? Promise.resolve()).then(() => this.openCallNow(tenantId, recipientKey, input));
    const tail = mine.catch(() => {});
    this.callLocks.set(lock, tail);
    try {
      return await mine;
    } finally {
      if (this.callLocks.get(lock) === tail) this.callLocks.delete(lock);
    }
  }

  private async openCallNow(tenantId: string, recipientKey: string, input: { purpose: CallPurpose; agentRef: string }) {
    const tenant = this.tenants.get(tenantId)!;
    const now = this.now();
    const [open] = await this.store.openCalls(tenantId, recipientKey, now);
    if (open) throw new CallInProgressError({ id: open.id, status: open.status, expiresAt: open.expiresAt });
    const call: CallSession = {
      id: `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      tenantId,
      recipientKey,
      purpose: input.purpose,
      agentRef: input.agentRef,
      code: randomInt(0, 10_000).toString().padStart(4, '0'),
      status: 'open',
      openedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.cfg.callRingSeconds * 1000).toISOString(),
    };
    await this.store.putCall(call);
    await this.notify(tenant, recipientKey, this.notice('call.opened', tenant, call));
    return { id: call.id, code: call.code, status: call.status, expiresAt: call.expiresAt };
  }

  async getCallState(tenantId: string, id: string): Promise<CallState | null> {
    const c = await this.store.getCall(tenantId, id);
    return c ? this.callState(c) : null;
  }

  /** The agent (by default) or the customer answers or ends the call. Ending it ends it on the other side too. */
  async updateCall(tenantId: string, id: string, status: 'answered' | 'ended', by: CallActor = 'agent'): Promise<CallState | null> {
    const tenant = this.tenants.get(tenantId)!;
    const current = await this.store.getCall(tenantId, id);
    if (!current) return null;
    const now = this.now();
    if (current.status === 'ended' || current.status === 'expired' || Date.parse(current.expiresAt) <= now.getTime()) return this.callState(current);
    const cap = Date.parse(current.openedAt) + (this.cfg.callRingSeconds + this.cfg.callMaxSeconds) * 1000;
    const patch =
      status === 'ended'
        ? { status, expiresAt: now.toISOString(), endedBy: by, ...(by === 'customer' && current.status === 'open' ? { declined: true } : {}) }
        : { status, expiresAt: new Date(Math.min(now.getTime() + this.cfg.callMaxSeconds * 1000, cap)).toISOString() };
    const updated = (await this.store.updateCall(tenantId, id, patch))!;
    if (status === 'ended') await this.notify(tenant, updated.recipientKey, this.notice('call.closed', tenant, updated));
    return this.callState(updated);
  }

  /** The call this customer may act on: one addressed to their number, or the one their call token names. */
  private async partyCall(id: string, who: CallParty) {
    const tenantId = 'token' in who ? this.tokenTenant(id, who.token) : who.tenant.id;
    if (!tenantId) return null;
    const keys = 'token' in who ? null : new Set(this.recipientKeys(tenantId, who.phone));
    const mine = (k: string) => !keys || keys.has(k);
    const u = this.unverified.get(id);
    if (u) return u.tenantId === tenantId && mine(u.recipientKey) ? { kind: 'unverified' as const, unverified: u } : null;
    const call = await this.store.getCall(tenantId, id);
    return call && mine(call.recipientKey) ? { kind: 'call' as const, call } : null;
  }

  async customerCallState(id: string, who: CallParty): Promise<CallState | null> {
    const r = await this.partyCall(id, who);
    if (!r) return null;
    return this.callState(r.kind === 'call' ? r.call : r.unverified);
  }

  /** The customer answered, declined or hung up on the phone. Only a call addressed to them. */
  async customerUpdateCall(id: string, who: CallParty, status: 'answered' | 'ended'): Promise<CallState | null> {
    const r = await this.partyCall(id, who);
    if (!r) return null;
    if (r.kind === 'unverified') return this.updateUnverified(r.unverified, status, 'customer');
    return this.updateCall(r.call.tenantId, id, status, 'customer');
  }

  // Demo only: the console's fraud calls, ringing the customer's real phone from a spoofed number.
  // They are not call sessions: there is no code, the registry still says the bank is not calling,
  // and they live in memory only, for the phone and the console to end them on both sides.
  private readonly unverified = new Map<string, UnverifiedCall>();

  async ringUnverified(tenantId: string, phone: string, input: { id: string; caller: string; number: string; expiresAt: string }): Promise<CallState | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || !this.keys.has(tenantId)) return null;
    const cutoff = this.now().getTime() - 10 * 60_000;
    for (const [k, v] of this.unverified) if (Date.parse(v.expiresAt) < cutoff) this.unverified.delete(k);
    const u: UnverifiedCall = {
      id: input.id,
      tenantId,
      recipientKey: this.recipientKey(tenantId, phone),
      caller: input.caller.slice(0, 64),
      number: input.number.slice(0, 24),
      status: 'open',
      expiresAt: input.expiresAt,
    };
    this.unverified.set(u.id, u);
    await this.notify(tenant, u.recipientKey, {
      type: 'call.unverified',
      callId: u.id,
      bank: tenant.name,
      purpose: 'unverified',
      code: null,
      expiresAt: u.expiresAt,
      token: this.callToken(tenantId, u.id),
      caller: u.caller,
      number: u.number,
    });
    return this.callState(u);
  }

  unverifiedState(id: string): CallState | null {
    const u = this.unverified.get(id);
    return u ? this.callState(u) : null;
  }

  async endUnverified(id: string): Promise<CallState | null> {
    const u = this.unverified.get(id);
    return u ? this.updateUnverified(u, 'ended', 'agent') : null;
  }

  private async updateUnverified(u: UnverifiedCall, status: 'answered' | 'ended', by: CallActor): Promise<CallState> {
    const now = this.now();
    if (u.status === 'ended' || Date.parse(u.expiresAt) <= now.getTime()) return this.callState(u);
    if (status === 'answered') {
      Object.assign(u, { status, expiresAt: new Date(now.getTime() + this.cfg.callMaxSeconds * 1000).toISOString() });
      return this.callState(u);
    }
    Object.assign(u, { status, expiresAt: now.toISOString(), endedBy: by, ...(by === 'customer' && u.status === 'open' ? { declined: true } : {}) });
    const tenant = this.tenants.get(u.tenantId);
    if (tenant) {
      await this.notify(tenant, u.recipientKey, { type: 'call.closed', callId: u.id, bank: tenant.name, purpose: 'unverified', code: null, expiresAt: u.expiresAt, endedBy: by });
    }
    return this.callState(u);
  }

  async languageFor(tenant: Tenant, phone: string): Promise<Language> {
    for (const key of this.recipientKeys(tenant.id, phone)) {
      const lang = await this.store.language(tenant.id, key).catch(() => null);
      if (lang) return lang;
    }
    return 'en';
  }

  async setLanguage(tenant: Tenant, phone: string, language: Language): Promise<void> {
    await this.store.setLanguage({ tenantId: tenant.id, recipientKey: this.recipientKey(tenant.id, phone), language, updatedAt: this.now().toISOString() });
  }

  async openCallFor(tenant: Tenant, phone: string, channelUsed: VerifyChannel): Promise<CallCheckResult> {
    const sim = this.startSim(tenant.id, phone);
    const r = await this.callCheck(tenant, phone, channelUsed);
    const warnings = await this.simWarnings(tenant.id, sim, r.verdict);
    return warnings.length ? { ...r, warnings } : r;
  }

  private async callCheck(tenant: Tenant, phone: string, channelUsed: VerifyChannel): Promise<CallCheck> {
    const recipientKey = this.recipientKey(tenant.id, phone);
    let calls: CallSession[];
    try {
      if (isSuspended(this.tenants.get(tenant.id) ?? tenant)) throw new Error('organisation suspended');
      calls = await this.store.openCalls(tenant.id, recipientKey, this.now());
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'call lookup failed');
      this.logCallCheck(tenant, recipientKey, channelUsed, 'cannot_check', null);
      return { verdict: 'cannot_check', bank: tenant.name };
    }
    const views = calls.map(
      (c): CallView => ({
        id: c.id,
        purpose: c.purpose,
        code: c.code,
        status: c.status,
        openedAt: c.openedAt,
        expiresAt: c.expiresAt,
        // The app hands it to the phone's call screen, which can then end the call with the app closed.
        ...(channelUsed === 'app' ? { token: this.callToken(tenant.id, c.id) } : {}),
      }),
    );
    const [call] = views;
    this.logCallCheck(tenant, recipientKey, channelUsed, call ? 'calling' : 'not_calling', call?.id ?? null);
    if (!call) return { verdict: 'not_calling', calling: false, bank: tenant.name };
    return { verdict: 'calling', calling: true, bank: tenant.name, call, calls: views };
  }

  private logCallCheck(tenant: Tenant, recipientKey: string, channelUsed: VerifyChannel, verdict: 'calling' | 'not_calling' | 'cannot_check', id: string | null) {
    this.store
      .logVerification({
        tenantId: tenant.id,
        recipientKey,
        channelUsed,
        kind: 'call',
        verdict,
        matchedRecordId: id,
        createdAt: this.now().toISOString(),
      })
      .catch(() => {});
  }

  async submitReport(tenant: Tenant, input: { maskedText: string; indicators: Indicator[]; callbackDigests?: string[] }) {
    const maskedText = maskDigits(input.maskedText);
    const digests = new Set([...(input.callbackDigests ?? []), ...extractPhoneNumbers(input.maskedText).map(callbackDigest)]);
    const embedding = await this.model.embed(maskedText);
    const report: Report = {
      id: `rep_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      tenantId: tenant.id,
      maskedText,
      indicators: input.indicators,
      embedding: embedding.vector,
      embeddingModel: embedding.model,
      linkDomains: extractDomains(maskedText),
      callbackKeys: [...digests].slice(0, 10).map((d) => this.keys.keyed(tenant.id, 'callback', d)),
      campaignId: null,
      consentAt: this.now().toISOString(),
    };
    await this.store.putReport(report);
    return { reportId: report.id };
  }

  async officialIdentity(tenant: Tenant, updatedAt: string): Promise<OfficialIdentity> {
    await this.store.ping();
    const phones = [...(tenant.officialContacts?.phones ?? []), ...(tenant.officialContacts?.whatsapp ?? [])]
      .map(contactPhone)
      .filter((p): p is string => p !== null);
    return {
      bankId: tenant.id,
      name: tenant.name,
      kind: tenant.kind ?? 'bank',
      phones: [...new Set(phones)],
      senderIds: [...new Set(tenant.senderIds ?? [])],
      domains: [...new Set(tenant.domains.map((d) => d.toLowerCase()))],
      updatedAt,
    };
  }

  async matchIndicators(tenant: Tenant, query: { domains?: string[]; phones?: string[] }): Promise<IndicatorMatch[]> {
    const now = this.now().getTime();
    const since = now - INDICATOR_WINDOW_DAYS * DAY_MS;
    const [campaigns, reports] = await Promise.all([this.store.listCampaigns(tenant.id), this.store.listReports(tenant.id)]);
    const active = new Map(campaigns.filter((c) => c.status !== 'dismissed' && c.advisory.status !== 'withdrawn').map((c) => [c.id, c]));
    const byCampaign = new Map<string, Report[]>();
    for (const r of reports) {
      if (!r.campaignId || !active.has(r.campaignId)) continue;
      const list = byCampaign.get(r.campaignId) ?? [];
      list.push(r);
      byCampaign.set(r.campaignId, list);
    }

    const stripWww = (d: string) => d.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const own = tenant.domains.map(stripWww);
    const isOwn = (d: string) => own.some((o) => d === o || d.endsWith(`.${o}`));
    const official = new Set(
      [...(tenant.officialContacts?.phones ?? []), ...(tenant.officialContacts?.whatsapp ?? [])].map(contactPhone).filter((p): p is string => p !== null),
    );
    const versions = this.keys.has(tenant.id) ? this.keys.versions(tenant.id) : [];
    const phoneKeys = (query.phones ?? []).map((raw) => {
      const e164 = contactPhone(raw);
      const digits = e164 && !official.has(e164) ? callbackDigits(e164) : null;
      return { raw, keys: digits ? new Set(versions.map((v) => this.keys.keyed(tenant.id, 'callback', callbackDigest(digits), v))) : new Set<string>() };
    });

    const out: IndicatorMatch[] = [];
    for (const [id, list] of byCampaign) {
      const recent = list.filter((r) => Date.parse(r.consentAt) >= since && Date.parse(r.consentAt) <= now);
      if (recent.length === 0) continue;
      const lastSeen = new Date(Math.max(...recent.map((r) => Date.parse(r.consentAt)))).toISOString();
      const domains = new Set([...active.get(id)!.linkDomains, ...list.flatMap((r) => r.linkDomains)].map(stripWww));
      const callbackKeys = new Set(list.flatMap((r) => r.callbackKeys));
      for (const value of new Set(query.domains ?? [])) {
        const d = stripWww(value);
        if (isOwn(d)) continue;
        if ([...domains].some((c) => d === c || d.endsWith(`.${c}`))) out.push({ kind: 'domain', value, campaignId: id, reports: recent.length, lastSeen });
      }
      for (const p of phoneKeys) {
        if ([...p.keys].some((k) => callbackKeys.has(k))) out.push({ kind: 'phone', value: p.raw, campaignId: id, reports: recent.length, lastSeen });
      }
    }
    return out.sort((a, b) => b.reports - a.reports || b.lastSeen.localeCompare(a.lastSeen));
  }

  advisoryChannel(tenantId: string) {
    return `${tenantId}:advisories`;
  }

  private advisoryTtlMs() {
    return (this.cfg.advisoryTtlDays ?? 14) * DAY_MS;
  }

  private advisoryExpiry(c: Campaign): string | null {
    const a = c.advisory;
    if (a.expiresAt) return a.expiresAt;
    return a.approvedAt ? new Date(Date.parse(a.approvedAt) + this.advisoryTtlMs()).toISOString() : null;
  }

  async approveAdvisory(tenantId: string, campaignId: string, analyst: string, clientId: string | null = null): Promise<Campaign | null> {
    const c = await this.store.getCampaign(tenantId, campaignId);
    if (!c) return null;
    if (!guardAdvisory(c.advisory.text)) {
      throw new AdvisoryError(422, 'unsafe_advisory', 'The advisory text is empty or fails the safety checks, so it cannot be approved');
    }
    const now = this.now();
    const next: Campaign = {
      ...c,
      status: 'confirmed',
      advisory: {
        ...c.advisory,
        status: 'approved',
        approvedBy: analyst,
        approvedByClient: clientId,
        approvedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.advisoryTtlMs()).toISOString(),
        withdrawnBy: null,
        withdrawnAt: null,
        notifiedAt: c.advisory.notifiedAt ?? now.toISOString(),
      },
    };
    await this.store.putCampaign(next);
    const tenant = this.tenants.get(tenantId)!;
    if (c.advisory.notifiedAt) this.events.publish(this.advisoryChannel(tenantId), this.advisoryNotice('advisory.published', tenant, next));
    else await this.notifyAdvisory(tenant, next);
    return next;
  }

  async withdrawAdvisory(tenantId: string, campaignId: string, analyst: string): Promise<Campaign | null> {
    const c = await this.store.getCampaign(tenantId, campaignId);
    if (!c) return null;
    if (c.advisory.status !== 'approved') throw new AdvisoryError(409, 'not_approved', 'Only an approved advisory can be withdrawn');
    const next: Campaign = { ...c, advisory: { ...c.advisory, status: 'withdrawn', withdrawnBy: analyst, withdrawnAt: this.now().toISOString() } };
    await this.store.putCampaign(next);
    this.events.publish(this.advisoryChannel(tenantId), this.advisoryNotice('advisory.withdrawn', this.tenants.get(tenantId)!, next));
    return next;
  }

  private advisoryNotice(type: AdvisoryNotice['type'], tenant: Tenant, c: Campaign): AdvisoryNotice {
    return {
      type,
      advisoryId: c.id,
      bank: tenant.name,
      title: fill(copy.advisory.title, { bank: tenant.name }),
      expiresAt: this.advisoryExpiry(c) ?? this.now().toISOString(),
    };
  }

  private async notifyAdvisory(tenant: Tenant, c: Campaign) {
    const notice = this.advisoryNotice('advisory.published', tenant, c);
    this.events.publish(this.advisoryChannel(tenant.id), notice);
    let devices: Device[];
    try {
      devices = await this.store.tenantDevices(tenant.id);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'advisory push: device list failed');
      return;
    }
    const byToken = new Map(devices.map((d) => [d.pushToken, d]));
    await Promise.all(
      [...byToken.values()].map((d) =>
        this.push.send(d.pushToken, notice).catch(async (err: Error) => {
          if (err instanceof InvalidPushTokenError) await this.store.removeDevice(tenant.id, d.recipientKey, d.pushToken).catch(() => {});
          else this.log.warn({ err: err.message }, 'advisory push failed');
        }),
      ),
    );
  }

  async activeAdvisories(tenant: Tenant): Promise<AdvisoryView[]> {
    const now = this.now().getTime();
    const out: AdvisoryView[] = [];
    for (const c of await this.store.listCampaigns(tenant.id)) {
      const a = c.advisory;
      const expiresAt = this.advisoryExpiry(c);
      const text = guardAdvisory(a.text);
      if (a.status !== 'approved' || !a.approvedAt || !expiresAt || Date.parse(expiresAt) <= now || !text) continue;
      out.push({
        id: c.id,
        bank: tenant.name,
        title: fill(copy.advisory.title, { bank: tenant.name }),
        text,
        approvedAt: a.approvedAt,
        expiresAt,
        indicators: c.indicators,
        linkDomains: c.linkDomains,
        asksCallback: c.callbackKeyCount > 0,
      });
    }
    return out.sort((x, y) => y.approvedAt.localeCompare(x.approvedAt));
  }

  async dismissCampaign(tenantId: string, campaignId: string): Promise<Campaign | null> {
    const c = await this.store.getCampaign(tenantId, campaignId);
    if (!c) return null;
    const next: Campaign = { ...c, status: 'dismissed' };
    await this.store.putCampaign(next);
    return next;
  }

  async metrics(tenantId: string) {
    const [m, licenceData] = await Promise.all([this.store.metrics(tenantId), this.licenceStatus()]);
    return { ...m, coverage: coverage(m), licenceData };
  }

  alerts(tenantId: string, limit = 50) {
    return this.store.listAlerts(tenantId, limit);
  }

  modelProvider() {
    return this.model;
  }
}

export type { ExplainResult };

function sourceView(s: LicenceSource): LicenceSourceView {
  return { id: s.id, regulator: s.regulator, title: s.title, url: s.url, publishedAt: s.publishedAt, retrievedAt: s.retrievedAt, sample: s.sample };
}

function firmView(h: LicenceHit): LicensedFirm {
  return { name: h.entry.name, regulator: h.source.regulator, category: h.entry.category, status: h.entry.status ?? null, source: sourceView(h.source) };
}
