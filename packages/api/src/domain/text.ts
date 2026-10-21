import { createHash } from 'node:crypto';
import type { Indicator } from '@gaskiya/schemas';
import { checkLink, extractDomains } from './link.ts';

export function maskDigits(text: string): string {
  return text.replace(/\d{4,}/g, (run) => '#'.repeat(run.length));
}

export function extractPhoneNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+?\d[\d\s-]{8,16}\d)/g)) {
    let digits = m[0].replace(/\D/g, '');
    if (digits.startsWith('234')) digits = `0${digits.slice(3)}`;
    if (digits.length >= 10 && digits.length <= 13) out.add(digits);
  }
  return [...out];
}

export function callbackDigits(e164: string): string | null {
  let digits = e164.replace(/\D/g, '');
  if (digits.startsWith('234')) digits = `0${digits.slice(3)}`;
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

export function callbackDigest(digits: string): string {
  return createHash('sha256').update(`tel:${digits}`).digest('hex');
}

const URGENCY = /\b(urgent|immediately|within \d+ ?(hours?|hrs?|minutes?|mins?)|suspend|suspended|blocked|block|deactivat|restrict|final (notice|warning)|act now|expire[sd]?|today only|last chance|failure to)\b/i;
const CREDENTIAL = /\b(pin|password|passcode|otp|one[- ]time|token|bvn|card (number|details)|cvv|login|log in|sign in|verify your (account|details|identity)|update your (account|details|bvn|nin))\b/i;
const CALLBACK = /\b(call|dial|contact|whatsapp|reach)\b[^.]{0,40}(\+?\d[\d\s#-]{6,}|#{4,})/i;
const REWARD = /\b(won|winner|reward|prize|bonus|refund|cash ?back|gift|promo|free|claim|compensation|grant)\b/i;

export function ruleIndicators(text: string, bankDomains: string[], bankName: string): Indicator[] {
  const found: Indicator[] = [];
  if (URGENCY.test(text)) found.push('urgency_or_threat');
  if (CREDENTIAL.test(text)) found.push('credential_request');
  if (extractDomains(text).some((d) => checkLink(d, bankDomains, bankName).verdict !== 'belongs')) found.push('non_bank_link');
  if (CALLBACK.test(text)) found.push('callback_number');
  if (REWARD.test(text)) found.push('reward_or_refund');
  return found;
}
