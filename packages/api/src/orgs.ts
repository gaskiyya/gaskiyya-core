import { ORG_KINDS, SOCIAL_PLATFORMS } from '@gaskiya/schemas';
import { contactPhone } from './domain/contact.ts';
import { appStoreId } from './domain/link.ts';
import type { Tenant } from './store/types.ts';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function orgErrors(t: Tenant): string[] {
  const errors: string[] = [];
  const at = `tenant ${t.id}`;
  if (t.kind !== undefined && !(ORG_KINDS as readonly string[]).includes(t.kind)) errors.push(`${at}: kind must be one of ${ORG_KINDS.join(', ')}`);
  const oc = t.officialContacts;
  if (oc !== undefined && (typeof oc !== 'object' || oc === null || Array.isArray(oc))) errors.push(`${at}: officialContacts must be an object`);
  else if (oc) {
    for (const [field, list] of [['phones', oc.phones], ['whatsapp', oc.whatsapp]] as const) {
      for (const n of list ?? []) if (typeof n !== 'string' || !contactPhone(n)) errors.push(`${at}: officialContacts.${field} "${String(n)}" is not a phone number (use +country code)`);
    }
    for (const e of oc.emails ?? []) if (typeof e !== 'string' || !EMAIL_RE.test(e)) errors.push(`${at}: officialContacts.emails "${String(e)}" is not an email address`);
    for (const s of oc.social ?? []) {
      if (!s || !(SOCIAL_PLATFORMS as readonly string[]).includes(s.platform)) errors.push(`${at}: officialContacts.social platform must be one of ${SOCIAL_PLATFORMS.join(', ')}`);
      else if (typeof s.handle !== 'string' || !/^@?[A-Za-z0-9._]{1,50}$/.test(s.handle.trim())) errors.push(`${at}: officialContacts.social handle "${String(s.handle)}" is not a handle`);
    }
  }
  const apps = t.officialApps;
  for (const p of apps?.android ?? []) if (typeof p !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(p)) errors.push(`${at}: officialApps.android "${String(p)}" is not a package ID`);
  for (const i of apps?.ios ?? []) if (typeof i !== 'string' || !appStoreId(i)) errors.push(`${at}: officialApps.ios "${String(i)}" is not an App Store ID or URL`);
  return errors;
}

export function profileErrors(t: Tenant, others: Iterable<Tenant>): string[] {
  const errors = orgErrors(t);
  const at = `tenant ${t.id}`;
  if (!t.name) errors.push(`${at}: a name is required`);
  if (!t.domains?.length) errors.push(`${at}: domains must list the organisation's own domains`);
  if (!t.tokenKeysUrl && !t.tokenKeys) errors.push(`${at}: tokenKeysUrl or tokenKeys is required (the JWKS that signs customer tokens)`);
  for (const a of t.alertEmails ?? []) if (!EMAIL_RE.test(a)) errors.push(`${at}: alert email "${a}" is not an email address`);
  if (t.bankCode !== undefined && !/^[0-9]{6}$/.test(String(t.bankCode))) errors.push(`${at}: bankCode must be the bank's 6-digit NIBSS institution code`);
  if (t.bankCode) for (const o of others) if (o.id !== t.id && o.bankCode === t.bankCode) errors.push(`${at}: bankCode ${t.bankCode} is used by ${o.id}`);
  const tc = t.technicalContact;
  if (tc) {
    if (!tc.name?.trim()) errors.push(`${at}: technicalContact.name is required`);
    if (!EMAIL_RE.test(tc.email ?? '')) errors.push(`${at}: technicalContact.email "${String(tc.email)}" is not an email address`);
    if (tc.phone && !contactPhone(tc.phone)) errors.push(`${at}: technicalContact.phone "${tc.phone}" is not a phone number (use +country code)`);
  }
  const u = t.customerTokenUrl;
  if (u && !u.startsWith('/') && !/^https?:\/\//.test(u)) errors.push(`${at}: customerTokenUrl must be an http(s) URL or a path on this server`);
  return errors;
}
