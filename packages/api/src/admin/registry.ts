import { randomBytes, randomUUID } from 'node:crypto';
import type { ClientDirectory, CustomerAuth } from '../auth/auth.ts';
import { signWebhook, type WebhookEvent, type WebhookSender } from '../channels/webhook.ts';
import type { ManagedKeyService } from '../keys/managed.ts';
import { profileErrors } from '../orgs.ts';
import type { Logger } from '../service.ts';
import {
  ORG_FEATURES,
  type ApiClientRecord,
  type AuditEntry,
  type AuditValue,
  type OrgFeature,
  type OrgRecord,
  type Store,
  type Tenant,
  type TenantKeyRecord,
} from '../store/types.ts';
import { burnSecretCheck, hashSecret, newClientId, newClientSecret, newWebhookSecret, seal, unseal, verifySecret } from './crypto.ts';
import type { CreateOrg, UpdateOrg } from './schemas.ts';

export class AdminError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  username: string;
  ip: string | null;
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

export interface AdminRegistryOptions {
  store: Store;
  tenants: Map<string, Tenant>;
  envTenants: Tenant[];
  envClients: { clientId: string; tenantId: string }[];
  keys: ManagedKeyService;
  masterKey: Buffer | null;
  customerAuth: CustomerAuth;
  webhooks: WebhookSender;
  clock: () => Date;
  keyActivationSeconds: number;
  log: Logger;
  production?: boolean;
}

const ALL_ON = Object.fromEntries(ORG_FEATURES.map((f) => [f, true])) as Record<OrgFeature, boolean>;
const PROFILE_FIELDS = ['name', 'legalName', 'technicalContact', 'kind', 'bankCode', 'domains', 'senderIds', 'officialContacts', 'officialApps', 'alertEmails', 'tokenKeysUrl', 'tokenKeys', 'customerTokenUrl', 'recordTtlDays'] as const;
const TOUCH_INTERVAL_MS = 60_000;

const keyAad = (tenantId: string, version: number) => `gaskiyya-key:${tenantId}:${version}`;
const webhookAad = (tenantId: string) => `gaskiyya-webhook:${tenantId}`;
const clone = <T>(v: T): T => structuredClone(v);
const tokenKeysOf = (t: Tenant | undefined) => JSON.stringify([t?.tokenKeysUrl ?? null, t?.tokenKeys ?? null]);

type Profile = NonNullable<OrgRecord['profile']>;

function profileOf(t: Tenant): Profile {
  const { status: _s, mode: _m, features: _f, limits: _l, webhookUrl: _w, ...rest } = clone(t);
  return rest;
}

export class AdminRegistry implements ClientDirectory {
  private orgs = new Map<string, OrgRecord>();
  private clients = new Map<string, ApiClientRecord>();
  private keyRecords: TenantKeyRecord[] = [];
  private webhookSecrets = new Map<string, string>();
  private envTenants: Map<string, Tenant>;
  private envClientIds: Map<string, string>;
  private touched = new Map<string, number>();
  loadedAt: string | null = null;

  constructor(private o: AdminRegistryOptions) {
    this.envTenants = new Map(o.envTenants.map((t) => [t.id, clone(t)]));
    this.envClientIds = new Map(o.envClients.map((c) => [c.clientId, c.tenantId]));
  }

  get masterKeySet() {
    return this.o.masterKey !== null;
  }

  private now() {
    return this.o.clock();
  }

  async refresh() {
    const [orgs, clients, keys] = await Promise.all([this.o.store.listOrgs(), this.o.store.listApiClients(), this.o.store.listTenantKeys()]);
    this.orgs = new Map(orgs.map((x) => [x.id, x]));
    this.clients = new Map(clients.map((c) => [c.clientId, c]));
    this.keyRecords = keys;
    this.applyKeys();
    this.applyTenants();
    this.loadedAt = this.now().toISOString();
  }

  private applyKeys() {
    const entries = [];
    for (const k of this.keyRecords) {
      if (k.retiredAt) {
        entries.push({ tenantId: k.tenantId, version: k.version, key: null, activatesAt: 0, retired: true });
        continue;
      }
      if (!k.sealed) continue;
      if (!this.o.masterKey) {
        this.o.log.error({ tenantId: k.tenantId, version: k.version }, 'hashing key stored by the dashboard cannot be read: GASKIYA_MASTER_KEY is not set');
        continue;
      }
      try {
        entries.push({ tenantId: k.tenantId, version: k.version, key: unseal(this.o.masterKey, k.sealed, keyAad(k.tenantId, k.version)), activatesAt: Date.parse(k.activatesAt), retired: false });
      } catch {
        this.o.log.error({ tenantId: k.tenantId, version: k.version }, 'hashing key stored by the dashboard cannot be decrypted with GASKIYA_MASTER_KEY');
      }
    }
    this.o.keys.load(entries);
  }

  private materialise(id: string): Tenant | null {
    const org = this.orgs.get(id);
    const env = this.envTenants.get(id);
    if (org?.source === 'env' && !env) return null;
    const profile = org?.profile ?? env;
    if (!profile) return null;
    const t: Tenant = { ...clone(profile), id };
    if (!org) return t;
    t.status = org.status;
    t.mode = org.mode;
    t.features = { ...org.features };
    t.limits = { ...org.limits };
    if (org.webhook) t.webhookUrl = org.webhook.url;
    return t;
  }

  private applyTenant(id: string) {
    const before = this.o.tenants.get(id);
    const t = this.materialise(id);
    if (t) this.o.tenants.set(id, t);
    else this.o.tenants.delete(id);
    if (tokenKeysOf(before) !== tokenKeysOf(t ?? undefined)) this.o.customerAuth.forget(id);
    const org = this.orgs.get(id);
    if (org?.webhook && this.o.masterKey) {
      try {
        this.webhookSecrets.set(id, unseal(this.o.masterKey, org.webhook.secret, webhookAad(id)).toString('utf8'));
      } catch {
        this.webhookSecrets.delete(id);
      }
    } else {
      this.webhookSecrets.delete(id);
    }
  }

  private applyTenants() {
    for (const id of new Set([...this.envTenants.keys(), ...this.orgs.keys()])) this.applyTenant(id);
  }

  orgIds(): string[] {
    return [...this.o.tenants.keys()].sort();
  }

  record(id: string): OrgRecord | null {
    return this.orgs.get(id) ?? null;
  }

  source(id: string): 'admin' | 'env' | null {
    if (this.envTenants.has(id)) return 'env';
    return this.orgs.get(id)?.source === 'admin' ? 'admin' : null;
  }

  tenant(id: string): Tenant {
    const t = this.o.tenants.get(id);
    if (!t) throw new AdminError(404, 'not_found', `No organisation ${id}`);
    return t;
  }

  clientsFor(tenantId: string): ClientView[] {
    const out = new Map<string, ClientView>();
    for (const [clientId, tid] of this.envClientIds) {
      if (tid !== tenantId) continue;
      const rec = this.clients.get(clientId);
      out.set(clientId, {
        clientId,
        tenantId,
        label: rec?.label ?? 'Configured in GASKIYA_BANK_CLIENTS',
        source: 'env',
        status: rec?.status ?? 'active',
        secretHint: null,
        createdAt: null,
        createdBy: null,
        rotatedAt: null,
        revokedAt: rec?.revokedAt ?? null,
        revokedBy: rec?.revokedBy ?? null,
        lastUsedAt: rec?.lastUsedAt ?? null,
        previousSecretExpiresAt: null,
      });
    }
    for (const c of this.clients.values()) {
      if (c.tenantId !== tenantId || c.source !== 'admin') continue;
      out.set(c.clientId, {
        clientId: c.clientId,
        tenantId,
        label: c.label,
        source: 'admin',
        status: c.status,
        secretHint: c.secretHint,
        createdAt: c.createdAt,
        createdBy: c.createdBy,
        rotatedAt: c.rotatedAt,
        revokedAt: c.revokedAt,
        revokedBy: c.revokedBy,
        lastUsedAt: c.lastUsedAt,
        previousSecretExpiresAt: c.previousSecretExpiresAt && Date.parse(c.previousSecretExpiresAt) > this.now().getTime() ? c.previousSecretExpiresAt : null,
      });
    }
    return [...out.values()].sort((a, b) => (a.status === b.status ? (b.createdAt ?? '').localeCompare(a.createdAt ?? '') : a.status === 'active' ? -1 : 1));
  }

  keysFor(tenantId: string): KeyView[] {
    const now = this.now().getTime();
    const recs = new Map(this.keyRecords.filter((k) => k.tenantId === tenantId).map((k) => [k.version, k]));
    const out: KeyView[] = this.o.keys.describe(tenantId).map((k) => {
      const r = recs.get(k.version);
      const pending = k.activatesAt !== null && k.activatesAt > now;
      return {
        version: k.version,
        source: k.source,
        state: k.current ? 'current' : pending ? 'pending' : 'previous',
        activatesAt: k.activatesAt === null ? null : new Date(k.activatesAt).toISOString(),
        createdAt: r?.createdAt ?? null,
        createdBy: r?.createdBy ?? null,
        retiredAt: null,
        retiredBy: null,
      };
    });
    for (const v of this.o.keys.retiredVersions(tenantId)) {
      const r = recs.get(v);
      out.push({ version: v, source: r?.source ?? 'env', state: 'retired', activatesAt: null, createdAt: r?.createdAt ?? null, createdBy: r?.createdBy ?? null, retiredAt: r?.retiredAt ?? null, retiredBy: r?.retiredBy ?? null });
    }
    return out.sort((a, b) => b.version - a.version);
  }

  async authenticate(clientId: string, clientSecret: string): Promise<{ tenantId: string } | null> {
    let c = this.clients.get(clientId);
    if (!c && !this.envClientIds.has(clientId)) {
      c = (await this.o.store.getApiClient(clientId).catch(() => null)) ?? undefined;
      if (c) this.clients.set(clientId, c);
    }
    if (!c || c.source !== 'admin' || c.status !== 'active' || !c.secretHash) return burnSecretCheck(clientSecret).then(() => null);
    if (await verifySecret(clientSecret, c.secretHash)) return { tenantId: c.tenantId };
    const graceUntil = c.previousSecretExpiresAt ? Date.parse(c.previousSecretExpiresAt) : 0;
    if (c.previousSecretHash && graceUntil > this.now().getTime() && (await verifySecret(clientSecret, c.previousSecretHash))) return { tenantId: c.tenantId };
    return null;
  }

  generation(clientId: string): number {
    return this.clients.get(clientId)?.tokenGeneration ?? 0;
  }

  refuses(clientId: string, generation: number | undefined): boolean {
    const c = this.clients.get(clientId);
    if (!c) return false;
    if (c.status === 'revoked') return true;
    return generation !== undefined && generation !== (c.tokenGeneration ?? 0);
  }

  used(clientId: string) {
    const now = this.now();
    const last = this.touched.get(clientId) ?? 0;
    if (now.getTime() - last < TOUCH_INTERVAL_MS) return;
    this.touched.set(clientId, now.getTime());
    const at = now.toISOString();
    const c = this.clients.get(clientId);
    if (c) {
      c.lastUsedAt = at;
      void this.o.store.touchApiClient(clientId, at).catch(() => {});
      return;
    }
    const tenantId = this.envClientIds.get(clientId);
    if (!tenantId) return;
    const rec = this.envClientRecord(clientId, tenantId, 'system');
    rec.lastUsedAt = at;
    this.clients.set(clientId, rec);
    void this.o.store.putApiClient(rec).catch(() => {});
  }

  private envClientRecord(clientId: string, tenantId: string, actor: string): ApiClientRecord {
    return {
      clientId,
      tenantId,
      label: 'Configured in GASKIYA_BANK_CLIENTS',
      source: 'env',
      status: 'active',
      secretHash: null,
      secretHint: null,
      previousSecretHash: null,
      previousSecretExpiresAt: null,
      tokenGeneration: 0,
      createdAt: this.now().toISOString(),
      createdBy: actor,
      rotatedAt: null,
      revokedAt: null,
      revokedBy: null,
      lastUsedAt: null,
    };
  }

  async audit(actor: Actor, action: string, tenantId: string | null, target: string | null, details: Record<string, AuditValue> = {}) {
    const entry: AuditEntry = { id: randomUUID(), at: this.now().toISOString(), actor: actor.username, action, tenantId, target, details, ip: actor.ip };
    await this.o.store.putAudit(entry);
    return entry;
  }

  private needMasterKey() {
    if (!this.o.masterKey) throw new AdminError(503, 'master_key_missing', 'Set GASKIYA_MASTER_KEY (32 random bytes, base64) so the dashboard can store hashing keys and webhook secrets encrypted');
  }

  private checkProfile(t: Tenant) {
    const errors = profileErrors(t, this.o.tenants.values());
    if (this.o.production) {
      for (const [k, u] of [['tokenKeysUrl', t.tokenKeysUrl]] as const) if (u && !u.startsWith('https://')) errors.push(`${k} must use https in production`);
    }
    if (errors.length) throw new AdminError(400, 'invalid_organisation', errors.map((e) => e.replace(/^tenant [^:]+: /, '')).join('; '));
  }

  private profileFromInput(input: CreateOrg): Profile {
    const profile: Profile = { id: input.id, name: input.name, kind: input.kind, domains: input.domains, senderIds: input.senderIds };
    for (const f of PROFILE_FIELDS) {
      const v = (input as Record<string, unknown>)[f];
      if (v !== undefined && v !== null && v !== '') (profile as Record<string, unknown>)[f] = v;
    }
    return profile;
  }

  validateOrg(input: CreateOrg): string[] {
    const errors: string[] = [];
    if (this.o.tenants.has(input.id) || this.orgs.has(input.id) || this.envTenants.has(input.id)) errors.push(`id: an organisation with id ${input.id} already exists`);
    errors.push(...profileErrors(this.profileFromInput(input), this.o.tenants.values()).map((e) => e.replace(/^tenant [^:]+: /, '')));
    if (this.o.production && input.tokenKeysUrl && !input.tokenKeysUrl.startsWith('https://')) errors.push('tokenKeysUrl must use https in production');
    if (!this.o.masterKey) errors.push('GASKIYA_MASTER_KEY is not set on the server, so no hashing key can be stored for a new organisation');
    return errors;
  }

  async createOrg(input: CreateOrg, actor: Actor): Promise<Tenant> {
    if (this.o.tenants.has(input.id) || this.orgs.has(input.id) || this.envTenants.has(input.id)) throw new AdminError(409, 'exists', `An organisation with id ${input.id} already exists`);
    this.needMasterKey();
    const now = this.now().toISOString();
    const profile = this.profileFromInput(input);
    const org: OrgRecord = {
      id: input.id,
      source: 'admin',
      profile,
      status: 'active',
      mode: input.mode,
      features: { ...ALL_ON, ...input.features },
      limits: input.limits ?? {},
      notes: input.notes ?? '',
      suspendedReason: null,
      suspendedAt: null,
      suspendedBy: null,
      webhook: null,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
      updatedBy: actor.username,
    };
    this.checkProfile({ ...profile });
    const key: TenantKeyRecord = {
      tenantId: org.id,
      version: 1,
      sealed: seal(this.o.masterKey!, randomBytes(32), keyAad(org.id, 1)),
      source: 'admin',
      createdAt: now,
      createdBy: actor.username,
      activatesAt: now,
      retiredAt: null,
      retiredBy: null,
    };
    if (!(await this.o.store.createTenantKey(key))) throw new AdminError(409, 'exists', `Hashing keys already exist for ${org.id}`);
    await this.o.store.putOrg(org);
    this.keyRecords.push(key);
    this.orgs.set(org.id, org);
    this.applyKeys();
    this.applyTenant(org.id);
    await this.audit(actor, 'org.create', org.id, org.id, { name: input.name, kind: input.kind, mode: org.mode, features: ORG_FEATURES.filter((f) => org.features[f]) });
    return this.tenant(org.id);
  }

  private baseRecord(id: string, actor: Actor): OrgRecord {
    const existing = this.orgs.get(id);
    if (existing) return clone(existing);
    const env = this.envTenants.get(id);
    if (!env) throw new AdminError(404, 'not_found', `No organisation ${id}`);
    const now = this.now().toISOString();
    return {
      id,
      source: 'env',
      profile: null,
      status: 'active',
      mode: 'live',
      features: { ...ALL_ON },
      limits: {},
      notes: '',
      suspendedReason: null,
      suspendedAt: null,
      suspendedBy: null,
      webhook: null,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
      updatedBy: actor.username,
    };
  }

  private async save(org: OrgRecord, actor: Actor) {
    org.updatedAt = this.now().toISOString();
    org.updatedBy = actor.username;
    await this.o.store.putOrg(org);
    this.orgs.set(org.id, org);
    this.applyTenant(org.id);
  }

  async updateOrg(id: string, patch: UpdateOrg, actor: Actor): Promise<Tenant> {
    const current = this.tenant(id);
    const org = this.baseRecord(id, actor);
    const changed: string[] = [];
    const profileChanged = PROFILE_FIELDS.filter((f) => f in patch);
    if (profileChanged.length) {
      const profile = clone(org.profile ?? profileOf(current));
      for (const f of profileChanged) {
        const v = (patch as Record<string, unknown>)[f];
        if (v === null || v === undefined) delete (profile as Record<string, unknown>)[f];
        else (profile as Record<string, unknown>)[f] = v;
      }
      this.checkProfile({ ...profile, id });
      org.profile = profile;
      changed.push(...profileChanged);
    }
    if (patch.mode && patch.mode !== org.mode) {
      org.mode = patch.mode;
      changed.push('mode');
    }
    if (patch.features) {
      org.features = { ...ALL_ON, ...org.features, ...Object.fromEntries(Object.entries(patch.features).filter(([, v]) => v !== undefined)) };
      changed.push('features');
    }
    if (patch.limits) {
      const limits = { ...org.limits };
      for (const [k, v] of Object.entries(patch.limits)) {
        if (v === null || v === undefined) delete limits[k as keyof typeof limits];
        else limits[k as keyof typeof limits] = v;
      }
      org.limits = limits;
      changed.push('limits');
    }
    if (patch.notes !== undefined) {
      org.notes = patch.notes;
      changed.push('notes');
    }
    await this.save(org, actor);
    await this.audit(actor, 'org.update', id, id, {
      fields: changed,
      ...(changed.includes('mode') ? { mode: org.mode } : {}),
      ...(changed.includes('features') ? { features: ORG_FEATURES.filter((f) => org.features[f]) } : {}),
      ...(changed.includes('limits') ? { bankApiPerMinute: org.limits.bankApiPerMinute ?? null, customerChecksPerMinute: org.limits.customerChecksPerMinute ?? null } : {}),
    });
    return this.tenant(id);
  }

  async resetProfile(id: string, actor: Actor): Promise<Tenant> {
    if (!this.envTenants.has(id)) throw new AdminError(409, 'not_configured_in_env', 'Only an organisation configured in GASKIYA_TENANTS can go back to its configured profile');
    const org = this.baseRecord(id, actor);
    org.profile = null;
    await this.save(org, actor);
    await this.audit(actor, 'org.profile_reset', id, id);
    return this.tenant(id);
  }

  async setStatus(id: string, status: 'active' | 'suspended', reason: string | null, actor: Actor): Promise<Tenant> {
    this.tenant(id);
    const org = this.baseRecord(id, actor);
    if (org.status === status) throw new AdminError(409, 'unchanged', `Organisation ${id} is already ${status}`);
    org.status = status;
    if (status === 'suspended') {
      org.suspendedReason = reason;
      org.suspendedAt = this.now().toISOString();
      org.suspendedBy = actor.username;
    } else {
      org.suspendedReason = null;
      org.suspendedAt = null;
      org.suspendedBy = null;
    }
    await this.save(org, actor);
    await this.audit(actor, status === 'suspended' ? 'org.suspend' : 'org.reactivate', id, id, status === 'suspended' ? { reason } : {});
    return this.tenant(id);
  }

  async createClient(tenantId: string, label: string, actor: Actor): Promise<{ client: ClientView; clientSecret: string }> {
    const t = this.tenant(tenantId);
    const { secret, hint } = newClientSecret(t.mode ?? 'live');
    const now = this.now().toISOString();
    let clientId = newClientId(tenantId);
    while (this.clients.has(clientId) || this.envClientIds.has(clientId)) clientId = newClientId(tenantId);
    const rec: ApiClientRecord = {
      clientId,
      tenantId,
      label,
      source: 'admin',
      status: 'active',
      secretHash: await hashSecret(secret),
      secretHint: hint,
      previousSecretHash: null,
      previousSecretExpiresAt: null,
      tokenGeneration: 0,
      createdAt: now,
      createdBy: actor.username,
      rotatedAt: null,
      revokedAt: null,
      revokedBy: null,
      lastUsedAt: null,
    };
    await this.o.store.putApiClient(rec);
    this.clients.set(clientId, rec);
    await this.audit(actor, 'client.create', tenantId, clientId, { label, secretHint: hint });
    return { client: this.clientsFor(tenantId).find((c) => c.clientId === clientId)!, clientSecret: secret };
  }

  private clientOf(tenantId: string, clientId: string) {
    this.tenant(tenantId);
    const rec = this.clients.get(clientId);
    const env = this.envClientIds.get(clientId);
    if (env === tenantId) return { rec: rec ?? this.envClientRecord(clientId, tenantId, 'system'), env: true };
    if (!rec || rec.tenantId !== tenantId) throw new AdminError(404, 'not_found', `No API client ${clientId} for ${tenantId}`);
    return { rec, env: false };
  }

  async rotateClient(tenantId: string, clientId: string, graceMinutes: number, actor: Actor): Promise<{ client: ClientView; clientSecret: string }> {
    const { rec, env } = this.clientOf(tenantId, clientId);
    if (env) throw new AdminError(409, 'configured_in_env', 'This client secret lives in GASKIYA_BANK_CLIENTS: change it there, or create a dashboard client and revoke this one');
    if (rec.status !== 'active') throw new AdminError(409, 'revoked', 'A revoked client cannot be rotated; create a new one');
    const t = this.tenant(tenantId);
    const { secret, hint } = newClientSecret(t.mode ?? 'live');
    const now = this.now();
    const next: ApiClientRecord = {
      ...rec,
      secretHash: await hashSecret(secret),
      secretHint: hint,
      previousSecretHash: graceMinutes > 0 ? rec.secretHash : null,
      previousSecretExpiresAt: graceMinutes > 0 ? new Date(now.getTime() + graceMinutes * 60_000).toISOString() : null,
      tokenGeneration: graceMinutes > 0 ? (rec.tokenGeneration ?? 0) : (rec.tokenGeneration ?? 0) + 1,
      rotatedAt: now.toISOString(),
    };
    await this.o.store.putApiClient(next);
    this.clients.set(clientId, next);
    await this.audit(actor, 'client.rotate', tenantId, clientId, { graceMinutes, secretHint: hint });
    return { client: this.clientsFor(tenantId).find((c) => c.clientId === clientId)!, clientSecret: secret };
  }

  async setClientStatus(tenantId: string, clientId: string, status: 'active' | 'revoked', actor: Actor): Promise<ClientView> {
    const { rec, env } = this.clientOf(tenantId, clientId);
    if (rec.status === status) throw new AdminError(409, 'unchanged', `Client ${clientId} is already ${status}`);
    if (status === 'active' && !env) throw new AdminError(409, 'revoked', 'A revoked dashboard client cannot come back; create a new one');
    const now = this.now();
    const next: ApiClientRecord = {
      ...rec,
      status,
      revokedAt: status === 'revoked' ? now.toISOString() : null,
      revokedBy: status === 'revoked' ? actor.username : null,
      previousSecretHash: status === 'revoked' ? null : rec.previousSecretHash,
      tokenGeneration: (rec.tokenGeneration ?? 0) + 1,
    };
    await this.o.store.putApiClient(next);
    this.clients.set(clientId, next);
    await this.audit(actor, status === 'revoked' ? 'client.revoke' : 'client.restore', tenantId, clientId);
    return this.clientsFor(tenantId).find((c) => c.clientId === clientId)!;
  }

  async rotateKey(tenantId: string, actor: Actor): Promise<KeyView[]> {
    this.tenant(tenantId);
    this.needMasterKey();
    if (this.keysFor(tenantId).some((k) => k.state === 'pending')) throw new AdminError(409, 'rotation_pending', 'A new key is already waiting to become current');
    const known = this.keyRecords.filter((k) => k.tenantId === tenantId).map((k) => k.version);
    const version = Math.max(this.o.keys.highestVersion(tenantId), ...known, 0) + 1;
    const now = this.now();
    const rec: TenantKeyRecord = {
      tenantId,
      version,
      sealed: seal(this.o.masterKey!, randomBytes(32), keyAad(tenantId, version)),
      source: 'admin',
      createdAt: now.toISOString(),
      createdBy: actor.username,
      activatesAt: new Date(now.getTime() + this.o.keyActivationSeconds * 1000).toISOString(),
      retiredAt: null,
      retiredBy: null,
    };
    if (!(await this.o.store.createTenantKey(rec))) throw new AdminError(409, 'rotation_pending', 'Another rotation made that version first; reload');
    this.keyRecords.push(rec);
    this.applyKeys();
    await this.audit(actor, 'key.rotate', tenantId, `v${version}`, { version, activatesAt: rec.activatesAt });
    return this.keysFor(tenantId);
  }

  async retireKey(tenantId: string, version: number, actor: Actor): Promise<KeyView[]> {
    this.tenant(tenantId);
    const key = this.keysFor(tenantId).find((k) => k.version === version);
    if (!key || key.state === 'retired') throw new AdminError(404, 'not_found', `No usable key version ${version}`);
    if (key.state !== 'previous') throw new AdminError(409, 'in_use', 'Only a previous key can be retired: the current and pending keys are in use');
    const now = this.now().toISOString();
    const existing = this.keyRecords.find((k) => k.tenantId === tenantId && k.version === version);
    const rec: TenantKeyRecord = existing
      ? { ...existing, sealed: null, retiredAt: now, retiredBy: actor.username }
      : { tenantId, version, sealed: null, source: 'env', createdAt: now, createdBy: actor.username, activatesAt: now, retiredAt: now, retiredBy: actor.username };
    await this.o.store.putTenantKey(rec);
    this.keyRecords = [...this.keyRecords.filter((k) => !(k.tenantId === tenantId && k.version === version)), rec];
    this.applyKeys();
    await this.audit(actor, 'key.retire', tenantId, `v${version}`, { version });
    return this.keysFor(tenantId);
  }

  async setWebhook(tenantId: string, url: string, actor: Actor): Promise<{ url: string; signingSecret: string }> {
    this.tenant(tenantId);
    this.needMasterKey();
    if (this.o.production && !url.startsWith('https://')) throw new AdminError(400, 'invalid_request', 'Webhook URLs must use https in production');
    const org = this.baseRecord(tenantId, actor);
    const secret = newWebhookSecret();
    org.webhook = { url, secret: seal(this.o.masterKey!, Buffer.from(secret, 'utf8'), webhookAad(tenantId)), createdAt: this.now().toISOString() };
    await this.save(org, actor);
    await this.audit(actor, 'webhook.set', tenantId, new URL(url).host, { url });
    return { url, signingSecret: secret };
  }

  async removeWebhook(tenantId: string, actor: Actor) {
    const org = this.baseRecord(tenantId, actor);
    if (!org.webhook) throw new AdminError(404, 'not_found', 'No webhook is set');
    org.webhook = null;
    await this.save(org, actor);
    await this.audit(actor, 'webhook.remove', tenantId, null);
  }

  async sendWebhook(tenantId: string, type: WebhookEvent['type'], data: Record<string, unknown>): Promise<{ ok: boolean; status?: number; error?: string }> {
    const t = this.o.tenants.get(tenantId);
    const secret = this.webhookSecrets.get(tenantId);
    if (!t?.webhookUrl || !secret) return { ok: false, error: 'No webhook is set' };
    const event: WebhookEvent = { type, tenantId, at: this.now().toISOString(), data };
    const body = JSON.stringify(event);
    try {
      const r = await this.o.webhooks.post(t.webhookUrl, body, { 'x-gaskiyya-signature': signWebhook(secret, body, Math.floor(Date.now() / 1000)), 'x-gaskiyya-event': type });
      const ok = r.status >= 200 && r.status < 300;
      if (!ok) this.o.log.warn({ tenantId, type, status: r.status }, 'alert webhook refused');
      return ok ? { ok, status: r.status } : { ok, status: r.status, error: `The endpoint answered ${r.status}` };
    } catch (err) {
      this.o.log.warn({ tenantId, type, err: (err as Error).message }, 'alert webhook failed');
      return { ok: false, error: (err as Error).message };
    }
  }
}
