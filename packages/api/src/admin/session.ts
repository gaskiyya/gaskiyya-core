import { randomBytes } from 'node:crypto';
import type { Store } from '../store/types.ts';
import { burnSecretCheck, hashSecret, isSecretHash, sha256Hex, verifySecret } from './crypto.ts';

export interface AdminUser {
  username: string;
  passwordHash: string;
}

const USERNAME_RE = /^[A-Za-z0-9._@-]{1,64}$/;

export function adminUsersFromEnv(env: NodeJS.ProcessEnv, errors: string[]): { users: AdminUser[]; plain: { username: string; password: string } | null } {
  const users: AdminUser[] = [];
  if (env.ADMIN_USERS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.ADMIN_USERS);
    } catch {
      errors.push('ADMIN_USERS must be valid JSON: [{ "username": "...", "passwordHash": "scrypt$..." }]');
    }
    if (parsed !== undefined && !Array.isArray(parsed)) errors.push('ADMIN_USERS must be a JSON list');
    for (const u of Array.isArray(parsed) ? (parsed as Partial<AdminUser>[]) : []) {
      if (!u || typeof u.username !== 'string' || !USERNAME_RE.test(u.username)) errors.push('every ADMIN_USERS entry needs a username of letters, digits and . _ @ -');
      else if (!isSecretHash(u.passwordHash)) errors.push(`ADMIN_USERS ${u.username}: passwordHash must come from pnpm admin:hash`);
      else users.push({ username: u.username, passwordHash: u.passwordHash });
    }
  }
  let plain: { username: string; password: string } | null = null;
  if (env.ADMIN_PASSWORD) {
    if (env.NODE_ENV === 'production') errors.push('ADMIN_PASSWORD is for local use; in production list staff in ADMIN_USERS with hashed passwords (pnpm admin:hash)');
    else if (env.ADMIN_PASSWORD.length < 12) errors.push('ADMIN_PASSWORD must be at least 12 characters');
    else plain = { username: 'admin', password: env.ADMIN_PASSWORD };
  }
  if (new Set(users.map((u) => u.username)).size !== users.length) errors.push('ADMIN_USERS lists a username twice');
  return { users, plain };
}

export interface AdminAuthOptions {
  store: Store;
  users: AdminUser[];
  plain?: { username: string; password: string } | null;
  sessionHours: number;
  clock: () => Date;
}

export class AdminAuth {
  private users: Promise<AdminUser[]>;

  constructor(private o: AdminAuthOptions) {
    const plain = o.plain;
    this.users = plain
      ? hashSecret(plain.password).then((passwordHash) => [...o.users.filter((u) => u.username !== plain.username), { username: plain.username, passwordHash }])
      : Promise.resolve(o.users);
  }

  // The local admin login from ADMIN_PASSWORD, which production refuses; staff in ADMIN_USERS exist only as hashes.
  get localLogin(): { username: string; password: string } | null {
    return this.o.plain ? { ...this.o.plain } : null;
  }

  get enabled() {
    return this.o.users.length > 0 || Boolean(this.o.plain);
  }

  async login(username: string, password: string): Promise<{ token: string; username: string; expiresAt: string } | null> {
    const user = (await this.users).find((u) => u.username === username);
    if (!user) return burnSecretCheck(password).then(() => null);
    if (!(await verifySecret(password, user.passwordHash))) return null;
    const token = `gsa_${randomBytes(32).toString('base64url')}`;
    const now = this.o.clock();
    const expiresAt = new Date(now.getTime() + this.o.sessionHours * 3600_000).toISOString();
    await this.o.store.putAdminSession({ idHash: sha256Hex(token), username: user.username, createdAt: now.toISOString(), expiresAt });
    return { token, username: user.username, expiresAt };
  }

  async check(authorization: string | undefined): Promise<{ username: string; expiresAt: string; idHash: string } | null> {
    return authorization?.startsWith('Bearer ') ? this.checkToken(authorization.slice(7)) : null;
  }

  async checkToken(token: string): Promise<{ username: string; expiresAt: string; idHash: string } | null> {
    if (!token.startsWith('gsa_')) return null;
    const idHash = sha256Hex(token);
    const s = await this.o.store.getAdminSession(idHash);
    if (!s || Date.parse(s.expiresAt) <= this.o.clock().getTime()) return null;
    if (!(await this.users).some((u) => u.username === s.username)) return null;
    return { username: s.username, expiresAt: s.expiresAt, idHash };
  }

  async logout(idHash: string) {
    await this.o.store.deleteAdminSession(idHash);
  }
}

export const ADMIN_COOKIE = 'gaskiyya_admin';
export const ADMIN_CSRF_HEADER = 'x-gaskiya-admin';

export function adminToken(headers: { authorization?: string; cookie?: string }): { token: string; via: 'bearer' | 'cookie' } | null {
  if (headers.authorization?.startsWith('Bearer ')) return { token: headers.authorization.slice(7), via: 'bearer' };
  for (const part of (headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === ADMIN_COOKIE) return { token: part.slice(i + 1).trim(), via: 'cookie' };
  }
  return null;
}

export function adminCookie(token: string | null, maxAgeSeconds: number, secure: boolean): string {
  return `${ADMIN_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? Math.max(0, Math.floor(maxAgeSeconds)) : 0}${secure ? '; Secure' : ''}`;
}
