import type { KeyService } from '../keys/keys.ts';

// Crockford base32: no I, L, O or U, so a code read aloud or retyped is hard to get wrong.
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CONSOLE_CODE_LENGTH = 6;

// A console code is signed with the organisation's own hashing key: HMAC(key, "console:<org>:<generation>").
export function deriveConsoleCode(keys: KeyService, tenantId: string, generation: number, keyVersion?: number): string {
  const hex = keys.keyed(tenantId, 'console', `${tenantId}:${generation}`, keyVersion);
  return Array.from({ length: CONSOLE_CODE_LENGTH }, (_, i) => CODE_ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) & 31]!).join('');
}
