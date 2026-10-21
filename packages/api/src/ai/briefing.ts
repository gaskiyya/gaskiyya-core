import { z } from 'zod';
import type { Indicator } from '@gaskiya/schemas';
import { maskDigits } from '../domain/text.ts';
import { asksForSecret } from './explain.ts';
import type { BriefingInput, ModelProvider } from './provider.ts';

export const BRIEFING_CHANNELS = ['sms', 'whatsapp', 'call', 'email', 'social', 'unknown'] as const;
export type BriefingChannel = (typeof BRIEFING_CHANNELS)[number];

export const BriefingOutput = z.strictObject({
  pattern: z.string().trim().min(10).max(400),
  channel: z.enum(BRIEFING_CHANNELS),
  advisory: z.string().trim().min(20).max(600),
});

export interface CampaignBriefing {
  pattern: string;
  channel: BriefingChannel;
  source: 'model' | 'template';
  generatedAt: string;
}

const CLAIMS = /\b(genuine|verified|authentic|authenticated|legitimate|confirmed|trusted|approved)\b/i;

export function unsafeBriefingText(text: string): boolean {
  if (CLAIMS.test(text)) return true;
  if (asksForSecret(text)) return true;
  if (/\d{4,}/.test(text)) return true;
  return false;
}

export function guardAdvisory(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t && !unsafeBriefingText(t) ? t : null;
}

export function validateBriefing(raw: unknown): z.infer<typeof BriefingOutput> | null {
  const parsed = BriefingOutput.safeParse(raw);
  if (!parsed.success) return null;
  const { pattern, advisory } = parsed.data;
  for (const text of [pattern, advisory]) if (unsafeBriefingText(text)) return null;
  return parsed.data;
}

const MAX_SAMPLES = 5;
const MAX_SAMPLE_CHARS = 500;

export function briefingInput(o: {
  bankName: string;
  summary: string;
  indicators: Indicator[];
  linkDomains: string[];
  callbackKeyCount: number;
  reportCount: number;
  reportTexts: string[];
}): BriefingInput {
  return {
    bankName: o.bankName,
    summary: maskDigits(o.summary),
    indicators: o.indicators,
    linkDomains: o.linkDomains,
    callbackKeyCount: o.callbackKeyCount,
    reportCount: o.reportCount,
    samples: o.reportTexts.slice(0, MAX_SAMPLES).map((t) => maskDigits(t).slice(0, MAX_SAMPLE_CHARS)),
  };
}

export function inferChannel(input: BriefingInput): BriefingChannel {
  const text = input.samples.join('\n').toLowerCase();
  if (/whats\s?app/.test(text)) return 'whatsapp';
  if (/\be-?mail\b|\binbox\b|\bsubject:/.test(text)) return 'email';
  if (/\b(facebook|instagram|telegram|twitter|tiktok)\b/.test(text)) return 'social';
  if (input.callbackKeyCount > 0 && input.linkDomains.length === 0) return 'call';
  if (/\bsms\b|\btext message\b/.test(text)) return 'sms';
  return 'unknown';
}

const PATTERN_TEXT: Record<Indicator, string> = {
  urgency_or_threat: 'threatens to block or restrict the account to rush the customer',
  credential_request: 'asks for login details',
  non_bank_link: 'sends the customer to a non-bank website',
  callback_number: 'asks the customer to call a number',
  reward_or_refund: 'promises a reward or refund',
};

export function templateAdvisory(bank: string, linkDomains: string[]): string {
  const where = linkDomains.length ? ` linking to ${linkDomains.join(', ')}` : '';
  return `${bank} is aware of fake messages${where} that pretend to come from us. We will never ask for your PIN, password, card number or one-time code. Do not click the link or call any number in these messages; check any message in the ${bank} app.`;
}

export function templateBriefing(input: BriefingInput): { pattern: string; channel: BriefingChannel; advisory: string } {
  const traits = input.indicators.flatMap((i) => (i in PATTERN_TEXT ? [PATTERN_TEXT[i as Indicator]] : []));
  const where = input.linkDomains.length ? ` Links point to ${input.linkDomains.join(', ')}.` : '';
  const calls = input.callbackKeyCount ? ` ${input.callbackKeyCount === 1 ? 'One callback number is' : `${input.callbackKeyCount} callback numbers are`} shared across reports.` : '';
  const pattern = `Impersonation of ${input.bankName} reported by ${input.reportCount} customers${traits.length ? `; the message ${traits.join(', ')}` : ''}.${where}${calls}`;
  return { pattern, channel: inferChannel(input), advisory: templateAdvisory(input.bankName, input.linkDomains) };
}

export async function briefCampaign(
  provider: ModelProvider,
  input: BriefingInput,
  timeoutMs: number,
  now: Date = new Date(),
): Promise<CampaignBriefing & { advisory: string }> {
  const template = () => ({ ...templateBriefing(input), source: 'template' as const, generatedAt: now.toISOString() });
  if (!provider.briefCampaign) return template();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await Promise.race([
      provider.briefCampaign(input, controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    const out = validateBriefing(raw);
    if (!out) return template();
    return { pattern: out.pattern, channel: out.channel, advisory: out.advisory, source: 'model', generatedAt: now.toISOString() };
  } catch {
    return template();
  } finally {
    clearTimeout(timer);
  }
}
