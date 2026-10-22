import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { sha256Hex } from '../admin/crypto.ts';
import type { KeyService } from '../keys/keys.ts';
import { CODE_ALPHABET as ALPHABET, CONSOLE_CODE_LENGTH, deriveConsoleCode } from './code.ts';
import { isSuspended, type ConsoleCodeRecord, type Store, type Tenant } from '../store/types.ts';

export { CONSOLE_CODE_LENGTH } from './code.ts';
const SESSION_PREFIX = 'gsc_';
const MAX_GENERATIONS = 64;

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

export interface ConsoleIdentity {
  tenantId: string;
  codeId: string;
  label: string;
  expiresAt: string;
  idHash: string;
}

// Accepts the code however it was typed: any case, with spaces or dashes, and O, I or L for 0 and 1.
export function normaliseConsoleCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === CONSOLE_CODE_LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export function consoleCodeView(c: ConsoleCodeRecord): ConsoleCodeView {
  return {
    id: c.id,
    tenantId: c.tenantId,
    hint: c.hint,
    generation: c.generation,
    status: c.revokedAt ? 'revoked' : 'active',
    createdAt: c.createdAt,
    createdBy: c.createdBy,
    revokedAt: c.revokedAt,
    revokedBy: c.revokedBy,
    lastUsedAt: c.lastUsedAt,
  };
}

export class ConsoleAccessError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ConsoleAccessOptions {
  store: Store;
  keys: KeyService;
  tenant: (id: string) => Tenant | undefined;
  clock: () => Date;
  sessionHours: number;
  // Server secret for the lookup hash, so a copy of the store alone cannot be searched for codes.
  pepper: string;
}

export class ConsoleAccess {
  constructor(private o: ConsoleAccessOptions) {}

  private now() {
    return this.o.clock();
  }

  private lookupHash(code: string) {
    return createHmac('sha256', this.o.pepper).update(`gaskiyya-console:${code}`).digest('hex');
  }

  private derive(tenantId: string, generation: number, keyVersion: number): string {
    return deriveConsoleCode(this.o.keys, tenantId, generation, keyVersion);
  }

  async list(tenantId: string): Promise<ConsoleCodeView[]> {
    const codes = await this.o.store.listConsoleCodes(tenantId);
    return codes.sort((a, b) => b.generation - a.generation).map(consoleCodeView);
  }

  private async active(tenantId: string): Promise<ConsoleCodeRecord | null> {
    const codes = await this.o.store.listConsoleCodes(tenantId);
    return codes.filter((c) => !c.revokedAt).sort((a, b) => b.generation - a.generation)[0] ?? null;
  }

  // The current code in full, for Gaskiyya staff and for the demo organisation's sign-in page.
  async current(tenantId: string): Promise<{ code: string; view: ConsoleCodeView } | null> {
    const rec = await this.active(tenantId);
    if (!rec) return null;
    try {
      return { code: this.derive(tenantId, rec.generation, rec.keyVersion), view: consoleCodeView(rec) };
    } catch {
      return null;
    }
  }

  async ensure(tenantId: string, actor: string): Promise<{ code: string; view: ConsoleCodeView; created: boolean }> {
    const existing = await this.current(tenantId);
    if (existing) return { ...existing, created: false };
    return { ...(await this.issue(tenantId, actor)), created: true };
  }

  async ensureAll(tenantIds: Iterable<string>, actor = 'system'): Promise<string[]> {
    const created: string[] = [];
    for (const id of tenantIds) {
      if (!this.o.keys.has(id)) continue;
      if ((await this.ensure(id, actor)).created) created.push(id);
    }
    return created;
  }

  async regenerate(tenantId: string, actor: string): Promise<{ code: string; view: ConsoleCodeView }> {
    const old = await this.active(tenantId);
    if (old) await this.o.store.putConsoleCode({ ...old, revokedAt: this.now().toISOString(), revokedBy: actor });
    return this.issue(tenantId, actor);
  }

  private async issue(tenantId: string, actor: string): Promise<{ code: string; view: ConsoleCodeView }> {
    if (!this.o.tenant(tenantId)) throw new ConsoleAccessError(404, 'not_found', `No organisation ${tenantId}`);
    if (!this.o.keys.has(tenantId)) throw new ConsoleAccessError(409, 'no_key', 'This organisation has no hashing key yet, so no code can be signed');
    const keyVersion = this.o.keys.currentVersion(tenantId);
    const used = await this.o.store.listConsoleCodes(tenantId);
    let generation = used.reduce((m, c) => Math.max(m, c.generation), 0);
    for (let i = 0; i < MAX_GENERATIONS; i++) {
      generation++;
      const code = this.derive(tenantId, generation, keyVersion);
      const idHash = this.lookupHash(code);
      // A six-character code can collide with another organisation's; the next generation is then used.
      if (await this.o.store.getConsoleCode(idHash)) continue;
      const rec: ConsoleCodeRecord = {
        id: randomUUID(),
        idHash,
        tenantId,
        label: 'Bank console',
        hint: code.slice(-2),
        generation,
        keyVersion,
        createdAt: this.now().toISOString(),
        createdBy: actor,
        revokedAt: null,
        revokedBy: null,
        lastUsedAt: null,
      };
      await this.o.store.putConsoleCode(rec);
      return { code, view: consoleCodeView(rec) };
    }
    throw new Error('could not find a free console code');
  }

  async login(input: string): Promise<{ token: string; identity: ConsoleIdentity; tenant: Tenant } | { error: 'invalid' | 'suspended' }> {
    const normalised = normaliseConsoleCode(input);
    const rec = normalised ? await this.o.store.getConsoleCode(this.lookupHash(normalised)) : null;
    const tenant = rec && !rec.revokedAt ? this.o.tenant(rec.tenantId) : undefined;
    if (!rec || !tenant) return { error: 'invalid' };
    if (isSuspended(tenant)) return { error: 'suspended' };
    const token = `${SESSION_PREFIX}${randomBytes(32).toString('base64url')}`;
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.o.sessionHours * 3600_000).toISOString();
    const idHash = sha256Hex(token);
    await this.o.store.putConsoleSession({ idHash, tenantId: tenant.id, codeHash: rec.idHash, createdAt: now.toISOString(), expiresAt });
    await this.o.store.putConsoleCode({ ...rec, lastUsedAt: now.toISOString() });
    return { token, identity: { tenantId: tenant.id, codeId: rec.id, label: rec.label, expiresAt, idHash }, tenant };
  }

  // A session lives only as long as the code that opened it: regenerating the code signs everyone out.
  async check(authorization: string | undefined): Promise<ConsoleIdentity | null> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token.startsWith(SESSION_PREFIX)) return null;
    const idHash = sha256Hex(token);
    const s = await this.o.store.getConsoleSession(idHash);
    if (!s || Date.parse(s.expiresAt) <= this.now().getTime()) return null;
    const rec = await this.o.store.getConsoleCode(s.codeHash);
    if (!rec || rec.revokedAt || rec.tenantId !== s.tenantId || !this.o.tenant(s.tenantId)) return null;
    return { tenantId: s.tenantId, codeId: rec.id, label: rec.label, expiresAt: s.expiresAt, idHash };
  }

  async logout(idHash: string) {
    await this.o.store.deleteConsoleSession(idHash);
  }
}
