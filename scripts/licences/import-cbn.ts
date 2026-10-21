import type { LicenceCategory, LicenceEntry } from '@gaskiya/licences';
import { cellText, cleanName, dedupe, getText, retrievedAt, tableRows, writeDataFile } from './common.ts';

const CBN = 'https://www.cbn.gov.ng';

const LISTS: { id: string; api: string; page: string; title: string; category: LicenceCategory }[] = [
  { id: 'cbn-commercial-banks', api: 'GetDMBs', page: 'Inst-DM', title: 'CBN licensed commercial banks', category: 'commercial_bank' },
  { id: 'cbn-merchant-banks', api: 'GetMBs', page: 'Inst-MB', title: 'CBN licensed merchant banks', category: 'merchant_bank' },
  { id: 'cbn-non-interest-banks', api: 'GetNIBs', page: 'Inst-NI', title: 'CBN licensed non-interest banks', category: 'non_interest_bank' },
  { id: 'cbn-payment-service-banks', api: 'GetPSBs', page: 'Inst-PSB', title: 'CBN licensed payment service banks', category: 'payment_service_bank' },
  { id: 'cbn-microfinance-banks', api: 'GetMFBs', page: 'Inst-MF', title: 'CBN licensed microfinance banks', category: 'microfinance_bank' },
  { id: 'cbn-finance-companies', api: 'GetFCs', page: 'Inst-FC', title: 'CBN licensed finance companies', category: 'finance_company' },
  { id: 'cbn-primary-mortgage-banks', api: 'GetPMIs', page: 'Inst-PMI', title: 'CBN licensed primary mortgage banks', category: 'primary_mortgage_bank' },
];

export function parseCbnJson(json: string, category: LicenceCategory): LicenceEntry[] {
  const rows = JSON.parse(json) as { name?: unknown }[];
  return dedupe(
    rows
      .map((r) => (typeof r.name === 'string' ? cleanName(r.name) : ''))
      .filter((n) => n.length >= 2)
      .map((name) => ({ name, category })),
  );
}

export function parseCbnPsps(html: string): LicenceEntry[] {
  const headings = [...html.matchAll(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi)].map((m) => ({ at: m.index, text: cellText(m[1] ?? '') }));
  const entries: LicenceEntry[] = [];
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const heading = headings.filter((h) => h.at < m.index).at(-1)?.text ?? '';
    const status = heading.replace(/^[A-Za-z]{1,3}\.\s*/, '').replace(/\s+/g, ' ').slice(0, 80);
    for (const cells of tableRows(m[0])) {
      const name = cleanName(cells[1] ?? '');
      if (name.length < 2 || /^licen[cs]ee?$/i.test(name)) continue;
      entries.push({ name, category: 'payment_service_provider', ...(status ? { status } : {}) });
    }
  }
  return dedupe(entries);
}

async function main() {
  const date = retrievedAt();
  for (const l of LISTS) {
    const entries = parseCbnJson(await getText(`${CBN}/api/${l.api}`, `${l.api}.json`), l.category);
    writeDataFile({
      source: {
        id: l.id,
        regulator: 'CBN',
        regulatorUrl: `${CBN}/Supervision/fi.html`,
        title: l.title,
        url: `${CBN}/Supervision/${l.page}.html`,
        publishedAt: null,
        retrievedAt: date,
        format: 'JSON (the page’s own data endpoint)',
        sample: false,
        note: `Read from ${CBN}/api/${l.api}, which the page loads. Names only; the list gives no date or licence tier.`,
      },
      entries,
    });
  }
  const psps = parseCbnPsps(await getText(`${CBN}/PaymentsSystem/PSPs.html`, 'PSPs.html'));
  writeDataFile({
    source: {
      id: 'cbn-payment-service-providers',
      regulator: 'CBN',
      regulatorUrl: `${CBN}/PaymentsSystem/PSPs.html`,
      title: 'CBN licensed payment service providers (mobile money, switching, payment solutions, terminals, super-agents)',
      url: `${CBN}/PaymentsSystem/PSPs.html`,
      publishedAt: null,
      retrievedAt: date,
      format: 'HTML tables',
      sample: false,
      note: 'Every licensee in the page’s tables, with the licence category heading as status. "Formerly" names are dropped.',
    },
    entries: psps,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
