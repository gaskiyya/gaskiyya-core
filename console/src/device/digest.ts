// Must match packages/canonical byte for byte.
import { nfkcPinned } from '@gaskiya/canonical/nfkc';

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const WHITESPACE_RUN = /[\t\n\u000B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

export const canonicalise = (t: string) => nfkcPinned(t.replace(ZERO_WIDTH, '')).replace(WHITESPACE_RUN, ' ').replace(/^ +| +$/g, '');

export async function contentDigest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalise(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const maskDigits = (t: string) => t.replace(/\d{4,}/g, (m) => '#'.repeat(m.length));
