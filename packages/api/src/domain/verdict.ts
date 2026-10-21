import type { ReceiptVerdict, SimSwapWarning, Verdict } from '@gaskiya/schemas';

export interface VerdictInput {
  enrolled: boolean;
  lookup:
    | { ok: false }
    | {
        ok: true;
        record: { recipientKey: string; contentKey: string; expiresAt: string; keyVersion?: number } | null;
      };
  recipientKey: string;
  contentKey: string;
  keyVersion?: number;
  now: Date;
}

export function decideVerdict(input: VerdictInput): Verdict {
  if (!input.enrolled) return 'cannot_check';
  if (!input.lookup.ok) return 'cannot_check';
  const r = input.lookup.record;
  if (r === null) return 'not_confirmed';
  if (r.recipientKey !== input.recipientKey) return 'not_confirmed';
  if (r.contentKey !== input.contentKey) return 'not_confirmed';
  if ((r.keyVersion ?? 1) !== (input.keyVersion ?? 1)) return 'not_confirmed';
  const expires = Date.parse(r.expiresAt);
  if (!Number.isFinite(expires) || expires <= input.now.getTime()) return 'not_confirmed';
  return 'confirmed';
}

export interface ReceiptVerdictInput {
  enrolled: boolean;
  accountBound: boolean;
  lookup:
    | { ok: false }
    | {
        ok: true;
        record: { accountKey: string; receiptKey: string; expiresAt: string; keyVersion?: number } | null;
      };
  accountKey: string;
  receiptKey: string;
  keyVersion?: number;
  now: Date;
}

export function decideReceiptVerdict(input: ReceiptVerdictInput): ReceiptVerdict {
  if (!input.enrolled) return 'cannot_check';
  if (!input.accountBound) return 'not_confirmed';
  if (!input.lookup.ok) return 'cannot_check';
  const r = input.lookup.record;
  if (r === null) return 'not_confirmed';
  if (r.accountKey !== input.accountKey) return 'not_confirmed';
  if (r.receiptKey !== input.receiptKey) return 'not_confirmed';
  if ((r.keyVersion ?? 1) !== (input.keyVersion ?? 1)) return 'not_confirmed';
  const expires = Date.parse(r.expiresAt);
  if (!Number.isFinite(expires) || expires <= input.now.getTime()) return 'not_confirmed';
  return 'received';
}

export interface LinkVerdictInput {
  matchedDomain: string | null;
  reasons: readonly string[];
  appStore?: boolean;
  officialApp?: boolean;
}

export function decideLinkVerdict(input: LinkVerdictInput): 'belongs' | 'official_app' | 'not_confirmed' {
  if (input.reasons.length > 0) return 'not_confirmed';
  if (input.appStore) return input.officialApp ? 'official_app' : 'not_confirmed';
  if (!input.matchedDomain) return 'not_confirmed';
  return 'belongs';
}

export interface LicenceVerdictInput {
  data: { ok: false } | { ok: true; sources: readonly { id: string; retrievedAt: string }[] };
  exactSourceId: string | null;
  nearest: { distance: number; contains: boolean; length: number } | null;
  maxAgeDays: number;
  now: Date;
}

export type LicenceVerdict = { verdict: 'licensed' } | { verdict: 'not_listed'; similar: boolean } | { verdict: 'cannot_check' };

export function lookalikeLimit(length: number): number {
  if (length < 5) return 0;
  if (length < 8) return 1;
  if (length < 12) return 2;
  return 3;
}

const DAY = 24 * 60 * 60 * 1000;

export function decideLicenceVerdict(input: LicenceVerdictInput): LicenceVerdict {
  if (!input.data.ok || input.data.sources.length === 0) return { verdict: 'cannot_check' };
  const now = input.now.getTime();
  // A retrieval date in the future is as untrustworthy as a stale one.
  const fresh = (s: { retrievedAt: string }) => {
    const t = Date.parse(s.retrievedAt);
    return Number.isFinite(t) && t <= now + DAY && now - t <= input.maxAgeDays * DAY;
  };
  if (input.exactSourceId !== null) {
    const source = input.data.sources.find((s) => s.id === input.exactSourceId);
    return source && fresh(source) ? { verdict: 'licensed' } : { verdict: 'cannot_check' };
  }
  if (!input.data.sources.every(fresh)) return { verdict: 'cannot_check' };
  const n = input.nearest;
  const similar = n !== null && (n.contains || n.distance <= lookalikeLimit(n.length));
  return { verdict: 'not_listed', similar };
}

export interface ContactVerdictInput {
  directoryOk: boolean;
  parsed: boolean;
  exactMatches: number;
}

export function decideContactVerdict(input: ContactVerdictInput): 'official' | 'not_official' | 'cannot_check' {
  if (!input.directoryOk) return 'cannot_check';
  if (!input.parsed) return 'not_official';
  return input.exactMatches > 0 ? 'official' : 'not_official';
}

export type SimSwapProbe = { ok: false } | { ok: true; swapped: boolean; latestSimChange?: string | null };
export type { SimSwapWarning };

export interface SimSwapWarningInput {
  probe: SimSwapProbe | null;
  verdict: Verdict | 'calling' | 'not_calling' | 'none';
  category?: string | null;
}

export function decideSimSwapWarnings(input: SimSwapWarningInput): SimSwapWarning[] {
  if (!input.probe) return [];
  if (input.probe.ok) return input.probe.swapped ? ['sim_swapped_recently'] : [];
  return input.verdict === 'confirmed' && input.category === 'otp' ? ['sim_status_unknown'] : [];
}

export function decideSimSwapStatus(probe: SimSwapProbe | null): 'swapped' | 'not_swapped' | 'unknown' {
  if (!probe || !probe.ok) return 'unknown';
  return probe.swapped ? 'swapped' : 'not_swapped';
}

export function decideOtpHold(input: { category: string; probe: SimSwapProbe | null }): boolean {
  return input.category === 'otp' && input.probe !== null && input.probe.ok && input.probe.swapped;
}
