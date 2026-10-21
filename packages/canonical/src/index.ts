import { createHash } from 'node:crypto';
import { nfkcPinned } from './nfkc.ts';
import { canonicalReceipt, type ReceiptFields } from './receipt.ts';

// Must match packages/canonical_dart byte for byte.

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

// Explicit set so TypeScript and Dart agree exactly (their \s classes differ).
const WHITESPACE_RUN =
  // eslint-disable-next-line no-control-regex
  /[\t\n\u000B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

export function canonicalise(text: string): string {
  return nfkcPinned(text.replace(ZERO_WIDTH, ''))
    .replace(WHITESPACE_RUN, ' ')
    .replace(/^ +| +$/g, '');
}

export function contentDigest(text: string): string {
  return createHash('sha256').update(canonicalise(text), 'utf8').digest('hex');
}

export function receiptDigest(fields: ReceiptFields): string {
  return createHash('sha256').update(canonicalReceipt(fields), 'utf8').digest('hex');
}

export { isAssigned, nfkcPinned, UNICODE_VERSION } from './nfkc.ts';
export {
  canonicalReceipt,
  lagosDate,
  normaliseAccount,
  normaliseAmountKobo,
  normaliseBankCode,
  normaliseReference,
  normaliseValueDate,
  parseAmountToKobo,
  RECEIPT_VERSION,
  ReceiptFieldError,
  type ReceiptField,
  type ReceiptFields,
} from './receipt.ts';

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
