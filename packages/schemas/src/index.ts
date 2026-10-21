import { z } from 'zod';
import copyJson from '../copy.json' with { type: 'json' };
import copyHa from '../copy.ha.json' with { type: 'json' };
import copyIg from '../copy.ig.json' with { type: 'json' };
import copyPcm from '../copy.pcm.json' with { type: 'json' };
import copyYo from '../copy.yo.json' with { type: 'json' };

export const copy = copyJson;
export type Copy = typeof copyJson;

export const LANGUAGES = ['en', 'pcm', 'ha', 'yo', 'ig'] as const;
export type Language = (typeof LANGUAGES)[number];

export const COPY_OVERLAYS: Record<Exclude<Language, 'en'>, Record<string, unknown>> = {
  pcm: copyPcm,
  ha: copyHa,
  yo: copyYo,
  ig: copyIg,
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

function overlay(base: unknown, over: unknown): unknown {
  if (typeof base === 'string') return typeof over === 'string' ? over : base;
  if (!base || typeof base !== 'object') return base;
  const o = over && typeof over === 'object' ? (over as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, overlay(v, o[k])]));
}

const merged = new Map<Language, Copy>([['en', copyJson]]);

export function copyFor(language: string | null | undefined): Copy {
  const lang: Language = isLanguage(language) ? language : 'en';
  let c = merged.get(lang);
  if (!c) merged.set(lang, (c = overlay(copyJson, COPY_OVERLAYS[lang as Exclude<Language, 'en'>]) as Copy));
  return c;
}

export const ORG_KINDS = ['bank', 'agency', 'company'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export const SOCIAL_PLATFORMS = ['x', 'facebook', 'instagram', 'tiktok', 'telegram'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const CONTACT_TYPES = ['phone', 'whatsapp', 'email', 'social'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

const orgMerged = new Map<Language, Copy>();

export function copyForOrg(language: string | null | undefined, kind: OrgKind | string | null | undefined): Copy {
  const c = copyFor(language);
  if (!kind || kind === 'bank') return c;
  const lang: Language = isLanguage(language) ? language : 'en';
  let m = orgMerged.get(lang);
  if (m) return m;
  const o = c.official.org;
  m = {
    ...c,
    verdict: {
      ...c.verdict,
      confirmed: { ...c.verdict.confirmed, title: o.confirmedTitle },
      cannot_check: { ...c.verdict.cannot_check, body: o.cannotCheckBody },
    },
    link: { ...c.link, belongs: { ...c.link.belongs, title: o.linkBelongsTitle }, lookalike: o.linkLookalike },
    call: { ...c.call, not_calling: { title: o.notCallingTitle, body: o.notCallingBody } },
    explain: { ...c.explain, fallback: o.explainFallback, action: o.explainAction },
    bot: { ...c.bot, otpAdvice: o.otpAdvice },
    report: { ...c.report, prompt: o.reportPrompt, thanks: o.reportThanks },
    activity: { ...c.activity, heading: o.activityHeading },
    ussd: { ...c.ussd, menu: o.ussdMenu },
    official: { ...c.official, ussd: { ...c.official.ussd, option: o.ussdOption } },
  };
  orgMerged.set(lang, m);
  return m;
}

export const CATEGORIES = [
  'otp',
  'transaction_alert',
  'security_notice',
  'service_update',
  'marketing',
  'call_follow_up',
] as const;
export const CHANNELS = ['sms', 'whatsapp', 'email', 'push'] as const;
export const VERIFY_CHANNELS = ['app', 'whatsapp', 'ussd'] as const;
export const VERDICTS = ['confirmed', 'not_confirmed', 'cannot_check'] as const;
export const INDICATORS = [
  'urgency_or_threat',
  'credential_request',
  'non_bank_link',
  'callback_number',
  'reward_or_refund',
] as const;
export const CALL_PURPOSES = [
  'card_activation',
  'fraud_check',
  'loan_follow_up',
  'account_update',
  'service_follow_up',
] as const;
export const CALL_STATUSES = ['open', 'answered', 'ended', 'expired'] as const;
export const RECEIPT_VERDICTS = ['received', 'not_confirmed', 'cannot_check'] as const;
export const SIM_SWAP_WARNINGS = ['sim_swapped_recently', 'sim_status_unknown'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Channel = (typeof CHANNELS)[number];
export type VerifyChannel = (typeof VERIFY_CHANNELS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type Indicator = (typeof INDICATORS)[number];
export type CallPurpose = (typeof CALL_PURPOSES)[number];
export type CallStatus = (typeof CALL_STATUSES)[number];
export type ReceiptVerdict = (typeof RECEIPT_VERDICTS)[number];
export type SimSwapWarning = (typeof SIM_SWAP_WARNINGS)[number];

export const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'must be an E.164 phone number');
export const Digest = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex characters');
export const IsoTime = z.iso.datetime({ offset: true });
export const Domain = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i, 'must be a domain name')
  .transform((d) => d.toLowerCase());

export const RegisterMessage = z.strictObject({
  recipient: E164,
  channel: z.enum(CHANNELS),
  contentDigest: Digest,
  category: z.enum(CATEGORIES),
  hasLink: z.boolean(),
  linkDomains: z.array(Domain).max(10).default([]),
  asksCallback: z.boolean().default(false),
  sentAt: IsoTime,
});
export type RegisterMessage = z.infer<typeof RegisterMessage>;

export const RegisterBatch = z.strictObject({
  messages: z.array(RegisterMessage).min(1).max(500),
});

export const AccountNumber = z.string().regex(/^[0-9]{10}$/, 'must be a 10-digit account number');
export const BankCode = z.string().regex(/^[0-9]{6}$/, 'must be a 6-digit NIBSS institution code');

export const RegisterReceipt = z.strictObject({
  receiptDigest: Digest,
  beneficiaryAccount: AccountNumber,
  beneficiaryBank: BankCode,
});
export type RegisterReceipt = z.infer<typeof RegisterReceipt>;

export const RegisterReceiptBatch = z.strictObject({
  receipts: z.array(RegisterReceipt).min(1).max(500),
});

export const OpenCall = z.strictObject({
  recipient: E164,
  purpose: z.enum(CALL_PURPOSES),
  agentRef: z.string().min(1).max(64),
});
export type OpenCall = z.infer<typeof OpenCall>;

export const UpdateCall = z.strictObject({
  status: z.enum(['answered', 'ended']),
});

export const ApproveAdvisory = z.strictObject({
  analyst: z.string().trim().min(2).max(100),
});

export const WithdrawAdvisory = ApproveAdvisory;

export const SimSwapCheck = z.strictObject({
  phone: E164,
  maxAgeHours: z.number().int().min(1).max(2400).default(240),
});
export type SimSwapCheck = z.infer<typeof SimSwapCheck>;

export const SimSwapDemo = z.strictObject({
  phone: E164,
  action: z.enum(['swap', 'restore']).default('swap'),
});

export const TokenRequest = z.strictObject({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

export const VerifyMessage = z.strictObject({
  contentDigest: Digest,
  channelHint: z.enum(CHANNELS).optional(),
});

export const VerifyReceipt = z.union([
  z.strictObject({
    receiptDigest: Digest,
    beneficiaryAccount: AccountNumber,
  }),
  z.strictObject({
    beneficiaryAccount: AccountNumber,
    beneficiaryBank: BankCode.optional(),
    amountKobo: z.number().int().positive().max(999_999_999_999_999),
    reference: z.string().min(6).max(128),
    valueDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'must be YYYY-MM-DD'),
  }),
]);
export type VerifyReceipt = z.infer<typeof VerifyReceipt>;

export const VerifyLink = z.strictObject({
  url: z.string().min(1).max(2048),
});

export const VerifyLicence = z.strictObject({
  query: z.string().trim().min(2).max(200),
});

export const VerifyContact = z.strictObject({
  contact: z.string().trim().min(3).max(512),
  tenantId: z.string().min(1).max(64).optional(),
});

export const VerifyIndicators = z
  .strictObject({
    domains: z.array(Domain).max(10).optional(),
    phones: z
      .array(z.string().trim().regex(/^\+?[\d\s().-]{7,24}$/, 'must be a phone number'))
      .max(10)
      .optional(),
  })
  .refine((b) => (b.domains?.length ?? 0) + (b.phones?.length ?? 0) > 0, { message: 'give at least one domain or phone', path: ['domains'] });
export type VerifyIndicators = z.infer<typeof VerifyIndicators>;

export const VerifyScreenshot = z.strictObject({
  imageBase64: z.string().min(16).max(8_000_000),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});

export const Explain = z.strictObject({
  maskedText: z.string().min(1).max(4000),
  language: z.enum(LANGUAGES).default('en'),
});

export const SubmitReport = z.strictObject({
  maskedText: z.string().min(1).max(4000),
  consent: z.literal(true),
  indicators: z.array(z.enum(INDICATORS)).max(5).default([]),
  callbackDigests: z.array(Digest).max(5).default([]),
});

export const TestNotifications = z.strictObject({
  pushToken: z.string().min(8).max(4096).optional(),
  email: z.boolean().default(false),
});

export const WelcomeEmails = z.strictObject({
  emails: z.array(z.email()).min(1).max(20).optional(),
});

export const RegisterDevice = z.strictObject({
  pushToken: z.string().min(8).max(4096),
  platform: z.enum(['android', 'ios', 'web']),
});

export interface ActivityItem {
  category: Category;
  channel: Channel;
  count: number;
  anyWithLink: boolean;
}

export type VerifyResult = (
  | { verdict: 'confirmed'; channel: Channel; category: Category; sentAt: string; bank: string }
  | { verdict: 'not_confirmed'; recentActivity: ActivityItem[]; activityText: string; bank: string }
  | { verdict: 'cannot_check' }
) & { warnings?: SimSwapWarning[] };

export interface LicenceSourceView {
  id: string;
  regulator: string;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  sample: boolean;
}

export interface LicensedFirm {
  name: string;
  regulator: string;
  category: string;
  status: string | null;
  source: LicenceSourceView;
}

export interface RegulatorLink {
  name: string;
  url: string;
}

export type LicenceResult =
  | { verdict: 'licensed'; firm: LicensedFirm; regulators: RegulatorLink[] }
  | { verdict: 'not_listed'; similarTo: LicensedFirm | null; regulators: RegulatorLink[]; sources: LicenceSourceView[] }
  | { verdict: 'cannot_check'; regulators: RegulatorLink[] };
export interface OrgRef {
  id: string;
  name: string;
  kind: OrgKind;
}

export interface ContactView {
  type: ContactType | 'handle';
  value: string;
  platform?: SocialPlatform;
}

export type ContactResult =
  | { verdict: 'official'; contact: ContactView; matches: (OrgRef & { as: ContactType[]; platforms?: SocialPlatform[] })[] }
  | { verdict: 'not_official'; contact: ContactView; organisation: OrgRef | null; reasons: ('impersonation' | 'not_registered')[]; impersonates: OrgRef[] }
  | { verdict: 'cannot_check' };

export type ReceiptResult =
  | { verdict: 'received'; bank: string; paidFrom: string; registeredAt: string }
  | { verdict: 'not_confirmed'; bank: string }
  | { verdict: 'cannot_check' };

export const ExplanationSchema = z.strictObject({
  indicators: z.array(z.enum(INDICATORS)).max(5),
  explanation: z
    .string()
    .min(10)
    .max(400)
    .refine((s) => (s.match(/[.!?](\s|$)/g) ?? []).length <= 2, 'at most two sentences'),
  action: z.string().min(5).max(240),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in values ? String(values[key]) : m,
  );
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function plural(noun: string, n: number): string {
  return n === 1 ? noun : `${noun}s`;
}

export function activityText(bank: string, items: ActivityItem[]): string {
  if (items.length === 0) return fill(copy.activity.none, { bank });
  const parts = items.map(
    (i) =>
      `${countWord(i.count)} ${plural(copy.categories[i.category], i.count)} by ${copy.channels[i.channel]}`,
  );
  const joined =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const total = items.reduce((n, i) => n + i.count, 0);
  const withLink = items.filter((i) => i.anyWithLink).reduce((n, i) => n + i.count, 0);
  let linkLine: string;
  if (total === 1) linkLine = withLink ? copy.activity.linkOne : copy.activity.linkNoneOne;
  else if (withLink === 0) linkLine = total === 2 ? copy.activity.linkNeither : copy.activity.linkNone;
  else linkLine = fill(copy.activity.linkSome, { count: countWord(withLink).replace(/^./, (c) => c.toUpperCase()) });
  return `${fill(copy.activity.summary, { bank, items: joined })} ${linkLine}`;
}
