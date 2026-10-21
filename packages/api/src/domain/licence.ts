import type { LicenceDataFile, LicenceEntry, LicenceSource } from '@gaskiya/licences';

const SUFFIXES = new Set(['ltd', 'limited', 'plc', 'nigeria', 'nig', 'ng', 'inc', 'llc', 'co']);

export function nameKey(raw: string): string {
  const words = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1]!)) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join('');
}

export function websiteKey(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s || /\s/.test(s)) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/\.$/, '').replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

export function appIdKey(raw: string): string | null {
  const s = raw.trim();
  const fromStore = /[?&]id=([A-Za-z][\w]*(?:\.[\w]+)+)/.exec(s);
  const id = (fromStore?.[1] ?? s).toLowerCase();
  return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(id) ? id : null;
}

const CONFUSABLE: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };
const skeleton = (key: string) => key.replace(/[0-9]/g, (c) => CONFUSABLE[c] ?? c).replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/i/g, 'l');

export function editDistance(a: string, b: string, limit = 8): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export interface LicenceHit {
  entry: LicenceEntry;
  source: LicenceSource;
}

export interface NearestName extends LicenceHit {
  distance: number;
  contains: boolean;
  length: number;
}

export interface LicenceIndex {
  sources: LicenceSource[];
  entryCount: Map<string, number>;
  byName: Map<string, LicenceHit>;
  byWebsite: Map<string, LicenceHit>;
  byAppId: Map<string, LicenceHit>;
  names: { key: string; skeleton: string; hit: LicenceHit }[];
}

export function buildLicenceIndex(files: readonly LicenceDataFile[]): LicenceIndex {
  const index: LicenceIndex = { sources: files.map((f) => f.source), entryCount: new Map(files.map((f) => [f.source.id, f.entries.length])), byName: new Map(), byWebsite: new Map(), byAppId: new Map(), names: [] };
  for (const f of files) {
    for (const entry of f.entries) {
      const hit = { entry, source: f.source };
      for (const n of [entry.name, ...(entry.aliases ?? [])]) {
        const key = nameKey(n);
        if (key.length < 2 || index.byName.has(key)) continue;
        index.byName.set(key, hit);
        index.names.push({ key, skeleton: skeleton(key), hit });
      }
      for (const w of entry.websites ?? []) {
        const key = websiteKey(w);
        if (key && !index.byWebsite.has(key)) index.byWebsite.set(key, hit);
      }
      for (const a of entry.appIds ?? []) {
        const key = appIdKey(a);
        if (key && !index.byAppId.has(key)) index.byAppId.set(key, hit);
      }
    }
  }
  return index;
}

export interface LicenceFacts {
  exact: LicenceHit | null;
  nearest: NearestName | null;
}

export function findLicence(index: LicenceIndex, query: string): LicenceFacts {
  const appId = appIdKey(query);
  const site = websiteKey(query);
  const exact =
    (appId && index.byAppId.get(appId)) ||
    (site && index.byWebsite.get(site)) ||
    (!site && !appId ? index.byName.get(nameKey(query)) : undefined) ||
    null;
  if (exact) return { exact, nearest: null };

  const key = site && !appId ? nameKey(site.split('.')[0] ?? '') : nameKey(query);
  if (key.length < 4) return { exact: null, nearest: null };
  const sk = skeleton(key);
  let nearest: NearestName | null = null;
  let nearestKey = '';
  for (const n of index.names) {
    const contains = n.key.length >= 6 && key.includes(n.key);
    const distance = sk === n.skeleton ? 0 : editDistance(key, n.key, 3);
    if (distance > 3 && !contains) continue;
    const better =
      !nearest ||
      distance < nearest.distance ||
      (distance === nearest.distance && (contains && !nearest.contains)) ||
      (distance === nearest.distance && contains === nearest.contains && n.key < nearestKey);
    if (better) {
      nearest = { ...n.hit, distance, contains, length: n.key.length };
      nearestKey = n.key;
    }
  }
  return { exact: null, nearest };
}
