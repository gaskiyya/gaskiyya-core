import { z } from 'zod';

export const LICENCE_CATEGORIES = [
  'digital_lender',
  'commercial_bank',
  'merchant_bank',
  'non_interest_bank',
  'microfinance_bank',
  'payment_service_bank',
  'payment_service_provider',
  'finance_company',
  'primary_mortgage_bank',
  'capital_market_operator',
] as const;
export type LicenceCategory = (typeof LICENCE_CATEGORIES)[number];

export const REGULATORS = [
  { name: 'FCCPC', url: 'https://fccpc.gov.ng' },
  { name: 'CBN', url: 'https://www.cbn.gov.ng' },
  { name: 'SEC', url: 'https://sec.gov.ng' },
] as const;

export const LicenceSource = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  regulator: z.string().min(2).max(20),
  regulatorUrl: z.url(),
  title: z.string().min(3).max(200),
  url: z.url(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.string().min(2).max(40),
  sample: z.boolean(),
  note: z.string().max(600).optional(),
});
export type LicenceSource = z.infer<typeof LicenceSource>;

export const LicenceEntry = z.strictObject({
  name: z.string().min(2).max(200),
  category: z.enum(LICENCE_CATEGORIES),
  status: z.string().max(80).optional(),
  aliases: z.array(z.string().min(2).max(200)).max(20).optional(),
  websites: z.array(z.string().min(3).max(253)).max(10).optional(),
  appIds: z.array(z.string().min(3).max(200)).max(10).optional(),
});
export type LicenceEntry = z.infer<typeof LicenceEntry>;

export const LicenceDataFile = z.strictObject({
  source: LicenceSource,
  entries: z.array(LicenceEntry).min(1).max(20_000),
});
export type LicenceDataFile = z.infer<typeof LicenceDataFile>;
