import { copyForOrg, ExplanationSchema, fill, type OrgKind, type Explanation, type Indicator } from '@gaskiya/schemas';
import { maskDigits, ruleIndicators } from '../domain/text.ts';
import type { ModelProvider } from './provider.ts';
import { asksForSecret, mentionsSecret } from './secrets.ts';

export interface ExplainResult extends Explanation {
  source: 'model' | 'fallback';
}

export { asksForSecret, mentionsSecret } from './secrets.ts';

const CLAIM =
  /\b(genuine|genuinely|safe|safely|verified|legitimate|legit|authentic|real|trustworthy|trusted|official|confirmed|(from|by) (your|the) bank|(from|by) [a-z]+bank)\b/i;

const DENIAL =
  /\b(not|never|no|cannot|can't|cant|couldn't|could not|isn't|isnt|wasn't|aren't|don't|dont|doesn't|doesnt|didn't|unable|without|neither|nor|pretends?|pretending|claims?|claiming|claimed|poses?|posing|impersonat\w*|imitat\w*|mimic\w*|fraudsters?|scammers?|wants? you to (think|believe))\b/i;

const AFFIRMING =
  /\b((no|without( a| any)?|beyond( a| any)?) (doubt|question)|not only|nothing but|no reason to \w+|no need to \w+|(do not|don't|dont|need not|needn't) (worry|panic|fear|be \w+)|nothing to (worry|fear) about|not (a |an )?(scam|fake|fraud|phishing|suspicious|risky|dangerous)\w*|cannot be (anything|other) (but|than))\b/gi;

const DENIAL_WINDOW = 6;

export function claimsGenuine(text: string, bankName = ''): boolean {
  const name = bankName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const claim = name ? `${CLAIM.source}|\\b(from|by) ${name}\\b` : CLAIM.source;
  const clauses = text
    .replace(AFFIRMING, ' ')
    .split(/[.!?;:,\u2013\u2014()]+|\s-\s|\b(?:and|but|so|yet|while|whereas|however|although|though|because)\b/i);
  for (const clause of clauses) {
    if (!clause) continue;
    const re = new RegExp(claim, 'gi');
    for (const m of clause.matchAll(re)) {
      const before = clause.slice(0, m.index).trim().split(/\s+/).filter(Boolean).slice(-DENIAL_WINDOW).join(' ');
      if (!DENIAL.test(before)) return true;
    }
  }
  return false;
}

const LOCAL_RISK =
  /\b(pin|password|passcode|card number|cvv|otp|one[- ]time)\b|kalmar sirri|lafiya|na gaske|ingantacce|sahihi|amintacce|igbaniw\u1ecdle|ododo|ailewu|ojulowo|okwunt\u1ee5ghe|ezigbo|eziokwu|n\u2019ezie|n'ezie/i;

export function localOutputRisky(text: string): boolean {
  return LOCAL_RISK.test(text) || mentionsSecret(text);
}

export function fallbackExplanation(indicators: Indicator[], language = 'en', org?: { name: string; kind?: OrgKind }): ExplainResult {
  const c = copyForOrg(language, org?.kind);
  const bank = org?.name ?? '';
  return { indicators, explanation: fill(c.explain.fallback, { bank }), action: fill(c.explain.action, { bank }), source: 'fallback' };
}

export async function explain(
  provider: ModelProvider,
  input: { text: string; language: string; bankName: string; bankDomains: string[]; orgKind?: OrgKind },
  timeoutMs: number,
): Promise<ExplainResult> {
  const maskedText = maskDigits(input.text);
  const org = { name: input.bankName, kind: input.orgKind };
  const rules = ruleIndicators(maskedText, input.bankDomains, input.bankName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await Promise.race([
      provider.explain({ maskedText, language: input.language, bankName: input.bankName, ruleIndicators: rules }, controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    const parsed = ExplanationSchema.safeParse(raw);
    if (!parsed.success) return fallbackExplanation(rules, input.language, org);
    const out = parsed.data;
    if (asksForSecret(out.explanation) || asksForSecret(out.action)) return fallbackExplanation(rules, input.language, org);
    if (claimsGenuine(out.explanation, input.bankName) || claimsGenuine(out.action, input.bankName)) return fallbackExplanation(rules, input.language, org);
    if (['ha', 'yo', 'ig'].includes(input.language) && (localOutputRisky(out.explanation) || localOutputRisky(out.action))) return fallbackExplanation(rules, input.language, org);
    const indicators = [...new Set<Indicator>([...out.indicators, ...rules])];
    return { ...out, indicators, source: 'model' };
  } catch {
    return fallbackExplanation(rules, input.language, org);
  } finally {
    clearTimeout(timer);
  }
}
