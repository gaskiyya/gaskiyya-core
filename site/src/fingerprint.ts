// Must match packages/canonical byte for byte.
import { nfkcPinned } from '@gaskiya/canonical/nfkc';

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const WHITESPACE_RUN = /[\t\n\u000B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

export const canonicalise = (t: string) => nfkcPinned(t.replace(ZERO_WIDTH, '')).replace(WHITESPACE_RUN, ' ').replace(/^ +| +$/g, '');

export async function digest(text: string, subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle ?? null): Promise<string | null> {
  if (!subtle) return null;
  try {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalise(text)));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

export function demoResult(sent: string | null | undefined, got: string | null | undefined): 'match' | 'no_match' | 'cannot_check' {
  if (!sent || !got || !HEX64.test(sent) || !HEX64.test(got)) return 'cannot_check';
  return sent === got ? 'match' : 'no_match';
}
