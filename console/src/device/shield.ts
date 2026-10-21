import { copy, fill, type VerifyResult } from '@gaskiya/schemas';
import type { CallState } from './api.ts';

export interface Shield {
  tone: 'confirmed' | 'not_confirmed' | 'cannot_check';
  title: string;
  body: string;
}

const MONTHS = copy.app.result.months.split(',');
const pad = (n: number) => String(n).padStart(2, '0');

export const dateText = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const timeText = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const looksLikeCreditAlert = (text: string) => /\bcredit(ed)?\b/i.test(text) && !/\bdebit(ed)?\b/i.test(text) && /(NGN|₦|N)\s?\d[\d,]*(\.\d{2})?/.test(text);

export function messageShield(r: VerifyResult | null | undefined, text: string, bank: string): Shield {
  if (r?.verdict === 'confirmed' && typeof r.sentAt === 'string' && typeof r.channel === 'string') {
    return {
      tone: 'confirmed',
      title: copy.verdict.confirmed.title,
      body: fill(copy.verdict.confirmed.body, { bank: r.bank, channel: copy.channels[r.channel] ?? r.channel, date: dateText(r.sentAt), time: timeText(r.sentAt) }),
    };
  }
  if (r?.verdict === 'not_confirmed') {
    return looksLikeCreditAlert(text)
      ? { tone: 'not_confirmed', title: copy.shield.creditAlert.title, body: fill(copy.shield.creditAlert.body, { bank: r.bank || bank }) }
      : { tone: 'not_confirmed', title: copy.verdict.not_confirmed.title, body: copy.shield.message.notConfirmedBody };
  }
  return { tone: 'cannot_check', title: copy.verdict.cannot_check.title, body: copy.verdict.cannot_check.body };
}

export function callShield(state: CallState | null | undefined, bank: string): Shield & { codes: string[] } {
  if (state?.kind === 'calling' && state.calls.length > 0) {
    const codes = state.calls.map((c) => c.code);
    return { tone: 'confirmed', title: fill(copy.shield.call.really.title, { bank }), body: fill(copy.shield.call.really.body, { code: codes.join(' / ') }), codes };
  }
  if (state?.kind === 'not_calling') {
    return { tone: 'not_confirmed', title: fill(copy.shield.call.notCalling.title, { bank }), body: fill(copy.shield.call.notCalling.body, { bank }), codes: [] };
  }
  return { tone: 'cannot_check', title: copy.shield.call.cannotCheck.title, body: fill(copy.shield.call.cannotCheck.body, { bank }), codes: [] };
}
