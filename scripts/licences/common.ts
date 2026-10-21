import { readFileSync, writeFileSync } from 'node:fs';
import { LicenceDataFile, type LicenceEntry } from '@gaskiya/licences';

export const DATA_DIR = new URL('../../packages/licences/data/', import.meta.url);

export const retrievedAt = () => process.env.LICENCE_RETRIEVED_AT || new Date().toISOString().slice(0, 10);

export async function getText(url: string, localName: string): Promise<string> {
  const dir = process.env.LICENCE_SOURCE_DIR;
  if (dir) return readFileSync(`${dir.replace(/\/$/, '')}/${localName}`, 'utf8');
  const r = await fetch(url, { headers: { 'user-agent': 'GaskiyyaLicenceImport/1.0 (+https://github.com/gaskiyya)' } });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#038': '&', '#8211': '-', '#8217': "'" };

export function cellText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/\s+/g, ' ')
    .trim();
}

export function tableRows(tableHtml: string): string[][] {
  const body = /<tbody[\s\S]*?<\/tbody>/i.exec(tableHtml)?.[0] ?? tableHtml;
  return [...body.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((m) => [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1] ?? '')))
    .filter((cells) => cells.length > 0);
}

export function cleanName(raw: string): string {
  return raw
    .replace(/\(\s*formerly[^)]*\)?/gi, '')
    .replace(/[\s,.;:)]+$/, '')
    .replace(/^\(+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupe(entries: LicenceEntry[]): LicenceEntry[] {
  const out = new Map<string, LicenceEntry>();
  for (const e of entries) {
    const k = e.name.toLowerCase();
    const prev = out.get(k);
    if (!prev) out.set(k, e);
    else if (e.aliases?.length) prev.aliases = [...new Set([...(prev.aliases ?? []), ...e.aliases])].slice(0, 20);
  }
  return [...out.values()];
}

export function writeDataFile(file: LicenceDataFile): void {
  const valid = LicenceDataFile.parse(file);
  const json = JSON.stringify(valid, null, 2).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const path = new URL(`${valid.source.id}.json`, DATA_DIR);
  writeFileSync(path, `${json}\n`);
  console.log(`wrote ${path.pathname}: ${valid.entries.length} entries`);
}
