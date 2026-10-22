import { ORG_KINDS, SOCIAL_PLATFORMS } from '@gaskiya/schemas';
import { z } from 'zod';
import { ORG_FEATURES } from '../store/types.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const list = <T extends z.ZodType>(item: T, max = 20) => z.array(item).max(max);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'must be a domain such as bank.com');
const url = z.string().trim().url().max(500).refine((u) => /^https?:\/\//.test(u), 'must be an http(s) URL');

export const OrgId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, 'use 3 to 32 lowercase letters, digits and dashes');

export const Features = z.strictObject(Object.fromEntries(ORG_FEATURES.map((f) => [f, z.boolean().optional()])) as Record<(typeof ORG_FEATURES)[number], z.ZodOptional<z.ZodBoolean>>);

export const Limits = z.strictObject({
  bankApiPerMinute: z.number().int().min(1).max(1_000_000).nullable().optional(),
  customerChecksPerMinute: z.number().int().min(1).max(10_000).nullable().optional(),
});

const Jwks = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(10) });

const Profile = {
  name: text(80),
  legalName: z.string().trim().max(160).nullable().optional(),
  technicalContact: z.strictObject({ name: text(80), email: z.string().trim().max(254), phone: z.string().trim().max(32).optional() }).nullable().optional(),
  kind: z.enum(ORG_KINDS),
  bankCode: z.string().regex(/^[0-9]{6}$/, "must be the bank's 6-digit NIBSS institution code").nullable().optional(),
  domains: list(domain).min(1),
  senderIds: list(text(11)),
  officialContacts: z
    .strictObject({
      phones: list(z.string().trim().max(32)).optional(),
      whatsapp: list(z.string().trim().max(32)).optional(),
      emails: list(z.string().trim().max(254)).optional(),
      social: list(z.strictObject({ platform: z.enum(SOCIAL_PLATFORMS), handle: z.string().trim().max(60) })).optional(),
    })
    .optional(),
  officialApps: z.strictObject({ android: list(z.string().trim().max(200)).optional(), ios: list(z.string().trim().max(200)).optional() }).optional(),
  alertEmails: list(z.string().trim().max(254), 10).optional(),
  tokenKeysUrl: url.nullable().optional(),
  tokenKeys: Jwks.nullable().optional(),
  customerTokenUrl: z.string().trim().max(500).nullable().optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  recordTtlDays: z.number().int().min(1).max(365).nullable().optional(),
};

export const CreateOrg = z.strictObject({
  id: OrgId,
  ...Profile,
  mode: z.enum(['live', 'sandbox']).default('sandbox'),
  features: Features.optional(),
  limits: Limits.optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateOrg = z.infer<typeof CreateOrg>;

export const UpdateOrg = z
  .strictObject({
    name: Profile.name.optional(),
    legalName: Profile.legalName,
    technicalContact: Profile.technicalContact,
    kind: Profile.kind.optional(),
    bankCode: Profile.bankCode,
    domains: Profile.domains.optional(),
    senderIds: Profile.senderIds.optional(),
    officialContacts: Profile.officialContacts,
    officialApps: Profile.officialApps,
    alertEmails: Profile.alertEmails,
    tokenKeysUrl: Profile.tokenKeysUrl,
    tokenKeys: Profile.tokenKeys,
    customerTokenUrl: Profile.customerTokenUrl,
    logoUrl: Profile.logoUrl,
    recordTtlDays: Profile.recordTtlDays,
    mode: z.enum(['live', 'sandbox']).optional(),
    features: Features.optional(),
    limits: Limits.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'nothing to change');
export type UpdateOrg = z.infer<typeof UpdateOrg>;

// Fields a bank may edit itself. Domains and sender IDs stay with Gaskiyya.
export const ConsoleEditOrg = z
  .strictObject({
    technicalContact: Profile.technicalContact,
    officialContacts: Profile.officialContacts,
    officialApps: Profile.officialApps,
    alertEmails: Profile.alertEmails,
  })
  .refine((o) => Object.keys(o).length > 0, 'nothing to change');
export type ConsoleEditOrg = z.infer<typeof ConsoleEditOrg>;

export const SuspendOrg = z.strictObject({ reason: text(500) });
export const CreateClient = z.strictObject({ label: text(60) });
export const RotateClient = z.strictObject({ graceMinutes: z.number().int().min(0).max(1440).default(0) });
export const SetWebhook = z.strictObject({ url });
export const AdminLogin = z.strictObject({ username: text(64), password: z.string().min(1).max(256) });
