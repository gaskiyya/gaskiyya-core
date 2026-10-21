import { decideLinkVerdict } from './verdict.ts';

export type LinkReason = 'invalid' | 'shortened' | 'punycode' | 'lookalike' | 'not_registered' | 'not_http' | 'ip_address' | 'apk' | 'fake_app';

export interface AppLink {
  store: 'play' | 'app_store' | 'apk';
  id: string | null;
  official: boolean;
}

export interface LinkResult {
  verdict: 'belongs' | 'official_app' | 'not_confirmed';
  host: string | null;
  matchedDomain: string | null;
  reasons: LinkReason[];
  app?: AppLink;
}

export interface OfficialAppIds {
  android?: string[];
  ios?: string[];
}

export const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly',
  'shorturl.at', 'rb.gy', 't.ly', 'tiny.cc', 'bit.do', 's.id', 'v.gd', 'qr.ae', 'lnkd.in', 'shorte.st',
  'adf.ly', 'bl.ink', 'short.io', 'tiny.one', 'urlz.fr', 'wa.link', 'linktr.ee',
]);

const CONFUSABLE: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '|': 'l', '!': 'i' };

export function skeleton(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0-9@$|!]/g, (c) => CONFUSABLE[c] ?? c)
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/i/g, 'l')
    .replace(/[^a-z]/g, '');
}

export function brandSkeletons(name: string, domains: string[]): Set<string> {
  return new Set(
    [name, ...domains.map((d) => d.toLowerCase().split('.')[0] ?? '')]
      .map(skeleton)
      .filter((s) => s.length >= 4),
  );
}

export function appStoreId(raw: string): string | null {
  const m = /(?:^|\/)(?:id)?(\d{6,12})(?:[/?#]|$)/i.exec(raw.trim());
  return m ? m[1]! : null;
}

const PLAY_HOSTS = new Set(['play.google.com', 'market.android.com']);
const APPLE_HOSTS = new Set(['apps.apple.com', 'itunes.apple.com']);
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

function appFacts(url: URL, host: string, apps: OfficialAppIds | undefined): (AppLink & { label: string }) | null {
  if (url.protocol === 'market:' || PLAY_HOSTS.has(host)) {
    const id = url.searchParams.get('id');
    if (!id || !PACKAGE_RE.test(id)) return { store: 'play', id: null, official: false, label: '' };
    const official = (apps?.android ?? []).some((p) => p.trim().toLowerCase() === id.toLowerCase());
    return { store: 'play', id, official, label: id };
  }
  if (APPLE_HOSTS.has(host)) {
    const id = appStoreId(url.pathname);
    const official = id !== null && (apps?.ios ?? []).some((x) => appStoreId(x) === id);
    const slug = url.pathname.split('/').filter(Boolean).find((p, i, all) => all[i + 1]?.startsWith('id')) ?? '';
    return { store: 'app_store', id, official, label: slug };
  }
  if (/\.apk$/i.test(url.pathname)) return { store: 'apk', id: null, official: false, label: url.pathname };
  return null;
}

function parse(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

export function checkLink(raw: string, bankDomains: string[], bankName: string, apps?: OfficialAppIds): LinkResult {
  const url = parse(raw);
  if (!url) return { verdict: 'not_confirmed', host: null, matchedDomain: null, reasons: ['invalid'] };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const reasons: LinkReason[] = [];
  if (url.protocol !== 'https:' && url.protocol !== 'http:') reasons.push('not_http');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) reasons.push('ip_address');
  if (SHORTENERS.has(host)) reasons.push('shortened');
  if (host.split('.').some((label) => label.startsWith('xn--'))) reasons.push('punycode');

  const domains = bankDomains.map((d) => d.toLowerCase());
  const matched = domains.find((d) => host === d || host.endsWith(`.${d}`)) ?? null;
  const brands = brandSkeletons(bankName, domains);

  const fact = appFacts(url, host, apps);
  const app: AppLink | undefined = fact ? { store: fact.store, id: fact.id, official: fact.official } : undefined;
  if (fact?.store === 'apk') reasons.push('apk', 'fake_app');
  else if (fact && !fact.official && [...brands].some((b) => skeleton(fact.label).includes(b))) reasons.push('fake_app');

  const verdict = decideLinkVerdict({ matchedDomain: matched, reasons, appStore: fact ? fact.store !== 'apk' : false, officialApp: fact?.official ?? false });
  if (verdict === 'official_app') return { verdict, host, matchedDomain: null, reasons: [], app };
  if (verdict === 'belongs') return { verdict, host, matchedDomain: matched, reasons: [], ...(app ? { app } : {}) };

  const hostSkeleton = skeleton(host);
  if (!matched && [...brands].some((b) => hostSkeleton.includes(b))) reasons.push('lookalike');
  if (!matched) reasons.push('not_registered');

  return { verdict: 'not_confirmed', host, matchedDomain: null, reasons, ...(app ? { app } : {}) };
}

export function extractDomains(text: string): string[] {
  const found = new Set<string>();
  const re = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,63})(?=[/\s:?#]|$)/gi;
  for (const m of text.matchAll(re)) {
    const d = m[1]!.toLowerCase();
    if (!/^\d+(\.\d+)+$/.test(d)) found.add(d);
  }
  return [...found];
}
