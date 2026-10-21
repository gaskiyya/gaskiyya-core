import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Sealed } from '../store/types.ts';

const scrypt = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function isSecretHash(value: unknown): value is string {
  return typeof value === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(value);
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  if (!isSecretHash(stored)) return false;
  const [, n, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash!, 'base64url');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (cost.N > 1 << 20 || cost.r > 32 || cost.p > 16 || expected.length < 16) return false;
  const actual = await scrypt(secret, Buffer.from(salt!, 'base64url'), expected.length, { ...cost, maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

export async function burnSecretCheck(secret: string): Promise<false> {
  dummyHash ??= hashSecret(randomBytes(16).toString('hex'));
  await verifySecret(secret, await dummyHash);
  return false;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseMasterKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('GASKIYA_MASTER_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
  return key;
}

export function seal(masterKey: Buffer, plain: Buffer, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function unseal(masterKey: Buffer, sealed: Sealed, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
}

export function newClientSecret(mode: 'live' | 'sandbox'): { secret: string; hint: string } {
  const secret = `gsk_${mode === 'live' ? 'live' : 'test'}_${randomBytes(32).toString('base64url')}`;
  return { secret, hint: `${secret.slice(0, 13)}...${secret.slice(-4)}` };
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function newClientId(tenantId: string): string {
  return `${tenantId}-${randomBytes(5).toString('hex')}`;
}
