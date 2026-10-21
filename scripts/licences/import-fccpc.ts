import type { LicenceEntry } from '@gaskiya/licences';
import { cellText, cleanName, dedupe, getText, retrievedAt, tableRows, writeDataFile } from './common.ts';

const URL_DMLS = 'https://fccpc.gov.ng/registration-of-digital-money-lenders/approvals-of-dmls/';

const SECTIONS: { match: RegExp; status: string }[] = [
  { match: /^approval$/i, status: 'Full approval' },
  { match: /^conditional approval$/i, status: 'Conditional approval' },
  { match: /^waivers/i, status: 'Waiver (licensed by the CBN)' },
];

export function appNames(raw: string): string[] {
  return raw
    .split(/,|\bAND\b|\bUNDER THE DEVELOPER NAME\b|\//i)
    .map((s) =>
      s
        .replace(/\b(mobile\s+)?(web\s+)?apps?\b\.?/gi, '')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((s) => s.length >= 3 && !/^-+$/.test(s));
}

export function parseFccpc(html: string): LicenceEntry[] {
  const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => ({ at: m.index, text: cellText(m[1] ?? '') }));
  const entries: LicenceEntry[] = [];
  for (const m of html.matchAll(/<table id="table_\d+"[\s\S]*?<\/table>/gi)) {
    const heading = headings.filter((h) => h.at < m.index).at(-1)?.text ?? '';
    const section = SECTIONS.find((s) => s.match.test(heading));
    if (!section) continue;
    for (const cells of tableRows(m[0])) {
      const [, company = '', apps = ''] = cells;
      const name = cleanName(company);
      if (name.length < 2) continue;
      const aliases = appNames(apps).filter((a) => a.toLowerCase() !== name.toLowerCase());
      entries.push({ name, category: 'digital_lender', status: section.status, ...(aliases.length ? { aliases: aliases.slice(0, 20) } : {}) });
    }
  }
  return dedupe(entries);
}

async function main() {
  const html = await getText(URL_DMLS, 'approvals-of-dmls.html');
  const entries = parseFccpc(html);
  if (entries.length < 100) throw new Error(`only ${entries.length} entries parsed; the page layout may have changed`);
  writeDataFile({
    source: {
      id: 'fccpc-digital-lenders',
      regulator: 'FCCPC',
      regulatorUrl: 'https://fccpc.gov.ng/registration-of-digital-money-lenders/',
      title: 'FCCPC approved digital lenders (DEON Consumer Lending Regulations 2025)',
      url: URL_DMLS,
      publishedAt: null,
      retrievedAt: retrievedAt(),
      format: 'HTML tables',
      sample: false,
      note: 'Full approval, conditional approval and CBN-licensed waiver tables. Company names with their app names as aliases. The watchlist and delisted tables are not imported.',
    },
    entries,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
