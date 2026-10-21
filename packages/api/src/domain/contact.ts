import type { ContactType, OrgKind, OrgRef, SocialPlatform } from '@gaskiya/schemas';
import { brandSkeletons, skeleton } from './link.ts';
import { normalisePhone } from './phone.ts';

export type ParsedContact =
  | { type: 'phone'; value: string }
  | { type: 'whatsapp'; value: string }
  | { type: 'email'; value: string }
  | { type: 'social'; platform: SocialPlatform; value: string }
  | { type: 'handle'; value: string };

export interface ContactOrg {
  id: string;
  name: string;
  kind?: OrgKind;
  domains: string[];
  officialContacts?: {
    phones?: string[];
    whatsapp?: string[];
    emails?: string[];
    social?: { platform: SocialPlatform; handle: string }[];
  };
}

export interface ContactFacts {
  contact: ParsedContact;
  matches: (OrgRef & { as: ContactType[]; platforms?: SocialPlatform[] })[];
  impersonates: OrgRef[];
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const HANDLE_RE = /^[a-z0-9._]{1,50}$/;

const SOCIAL_HOSTS: Record<string, SocialPlatform> = {
  'x.com': 'x',
  'twitter.com': 'x',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'instagram.com': 'instagram',
  'instagr.am': 'instagram',
  'tiktok.com': 'tiktok',
  't.me': 'telegram',
  'telegram.me': 'telegram',
};
const WHATSAPP_HOSTS = new Set(['wa.me', 'api.whatsapp.com', 'whatsapp.com']);
const NOT_ACCOUNTS = new Set(['home', 'share', 'sharer', 'intent', 'search', 'explore', 'login', 'p', 'reel', 'reels', 'watch', 'groups', 'profile.php', 'i', 'hashtag', 'joinchat', 's', 'tv', 'stories']);

export function contactPhone(raw: string): string | null {
  const t = raw.trim();
  if (!/^\+?[\d\s().-]{7,24}$/.test(t)) return null;
  const digits = t.replace(/\D/g, '');
  if (!t.startsWith('+') && /^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (!t.startsWith('+') && digits.startsWith('00')) return normalisePhone(digits.slice(2));
  return normalisePhone(digits);
}

const cleanHandle = (h: string) => decodeURIComponent(h).trim().replace(/^@+/, '').toLowerCase();

export function parseContact(raw: string): ParsedContact | null {
  const t = raw.trim().replace(/^<|>$/g, '');
  if (!t || t.length > 512) return null;

  const mail = /^mailto:/i.test(t) ? t.slice(7).split('?')[0]! : t;
  if (EMAIL_RE.test(mail.toLowerCase())) return { type: 'email', value: mail.toLowerCase() };

  if (/^@[A-Za-z0-9._]{1,50}$/.test(t)) return { type: 'handle', value: cleanHandle(t) };

  const phone = contactPhone(t.replace(/^tel:/i, ''));
  if (phone) return { type: 'phone', value: phone };

  if (/\s/.test(t)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (WHATSAPP_HOSTS.has(host)) {
    const number = host === 'wa.me' ? segments[0] : url.searchParams.get('phone');
    const value = number ? normalisePhone(number) : null;
    return value ? { type: 'whatsapp', value } : null;
  }
  const platform = SOCIAL_HOSTS[host];
  if (platform) {
    const first = segments[0] ?? '';
    if (platform === 'facebook' && first === 'profile.php') {
      const id = url.searchParams.get('id');
      return id && /^\d{5,20}$/.test(id) ? { type: 'social', platform, value: id } : null;
    }
    const handle = cleanHandle(first);
    if (!handle || NOT_ACCOUNTS.has(handle) || !HANDLE_RE.test(handle)) return null;
    return { type: 'social', platform, value: handle };
  }
  return null;
}

const ref = (o: ContactOrg): OrgRef => ({ id: o.id, name: o.name, kind: o.kind ?? 'bank' });
const phones = (list: string[] | undefined) => new Set((list ?? []).map(contactPhone).filter((p): p is string => p !== null));

export function contactFacts(contact: ParsedContact, orgs: Iterable<ContactOrg>): ContactFacts {
  const matches: ContactFacts['matches'] = [];
  const impersonates: OrgRef[] = [];
  for (const org of orgs) {
    const oc = org.officialContacts ?? {};
    const as: ContactType[] = [];
    const platforms: SocialPlatform[] = [];
    if (contact.type === 'phone' || contact.type === 'whatsapp') {
      if (contact.type === 'phone' && phones(oc.phones).has(contact.value)) as.push('phone');
      if (phones(oc.whatsapp).has(contact.value)) as.push('whatsapp');
    } else if (contact.type === 'email') {
      if ((oc.emails ?? []).some((e) => e.trim().toLowerCase() === contact.value)) as.push('email');
    } else {
      for (const s of oc.social ?? []) {
        if (cleanHandle(s.handle) !== contact.value) continue;
        if (contact.type === 'handle' || s.platform === contact.platform) platforms.push(s.platform);
      }
      if (platforms.length) as.push('social');
    }
    if (as.length) {
      matches.push({ ...ref(org), as, ...(platforms.length ? { platforms } : {}) });
      continue;
    }
    if (contact.type === 'phone' || contact.type === 'whatsapp') continue;
    const domains = org.domains.map((d) => d.toLowerCase());
    let text = contact.value;
    if (contact.type === 'email') {
      const [local = '', domain = ''] = contact.value.split('@');
      text = domains.some((d) => domain === d || domain.endsWith(`.${d}`)) ? '' : `${local} ${domain}`;
    }
    const sk = skeleton(text);
    if (sk && [...brandSkeletons(org.name, domains)].some((b) => sk.includes(b))) impersonates.push(ref(org));
  }
  return { contact, matches, impersonates };
}
