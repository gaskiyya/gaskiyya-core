import { createHmac } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LicenceDataFile, REGULATORS, type LicenceEntry } from '@gaskiya/licences';
import { BUNDLED_LICENCES } from '@gaskiya/licences/bundled';
import { copy, copyFor, fill, LANGUAGES, type LicenceResult } from '@gaskiya/schemas';
import { asksForSecret } from '../packages/api/src/ai/explain.ts';
import { appIdKey, buildLicenceIndex, editDistance, findLicence, nameKey, websiteKey } from '../packages/api/src/domain/licence.ts';
import { decideLicenceVerdict } from '../packages/api/src/domain/verdict.ts';
import { DirectoryLicenceRegistry } from '../packages/api/src/licences/directory.ts';
import { MemoryLicenceRegistry, UnavailableLicenceRegistry } from '../packages/api/src/licences/registry.ts';
import { ascii, licenceScreen, menuScreen, moreScreen, USSD_MAX } from '../packages/api/src/ussd.ts';
import { parseLicenceCommand } from '../packages/api/src/whatsapp.ts';
import { parseCbnJson, parseCbnPsps } from '../scripts/licences/import-cbn.ts';
import { appNames, parseFccpc } from '../scripts/licences/import-fccpc.ts';
import { ALICE, BOB, harness, USSD, WA, type Harness } from './helpers.ts';

const RETRIEVED = '2026-10-01';
const NOW = new Date('2026-10-20T11:00:00Z');

const FCCPC_FIXTURE: LicenceDataFile = {
  source: {
    id: 'test-fccpc',
    regulator: 'FCCPC',
    regulatorUrl: 'https://fccpc.gov.ng/registration-of-digital-money-lenders/',
    title: 'Test digital lenders',
    url: 'https://fccpc.gov.ng/registration-of-digital-money-lenders/approvals-of-dmls/',
    publishedAt: null,
    retrievedAt: RETRIEVED,
    format: 'test fixture',
    sample: true,
  },
  entries: [
    { name: 'EXAMPLE CREDIT LIMITED', category: 'digital_lender', status: 'Full approval', aliases: ['ExampleCash'], websites: ['https://www.examplecredit.ng/'], appIds: ['ng.example.credit'] },
    { name: 'Quorvane Lending Nigeria Ltd', category: 'digital_lender', status: 'Conditional approval' },
  ],
};
const CBN_FIXTURE: LicenceDataFile = {
  source: { ...FCCPC_FIXTURE.source, id: 'test-cbn', regulator: 'CBN', regulatorUrl: 'https://www.cbn.gov.ng/Supervision/fi.html', title: 'Test microfinance banks', url: 'https://www.cbn.gov.ng/Supervision/Inst-MF.html' },
  entries: [{ name: 'Zentrabuk Microfinance Bank Limited', category: 'microfinance_bank' }],
};
const fixtures = () => new MemoryLicenceRegistry([FCCPC_FIXTURE, CBN_FIXTURE]);

async function licenceHarness(o: Parameters<typeof harness>[0] = {}) {
  const h = await harness({ licences: fixtures(), ...o });
  h.clock.now = NOW;
  return h;
}

async function check(h: Harness, query: unknown, phone = ALICE) {
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/licence', headers: { authorization: `Bearer ${await h.customerToken(phone)}` }, payload: { query } });
  return { status: r.statusCode, body: r.json() as LicenceResult & { code?: string } };
}

async function send(h: Harness, text: string, from = ALICE) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from: from.slice(1), id: `wamid.${Math.random()}`, timestamp: '1', type: 'text', text: { body: text } }] } }] }] });
  const signature = `sha256=${createHmac('sha256', WA.appSecret).update(raw).digest('hex')}`;
  const r = await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
  expect(r.statusCode).toBe(200);
  return h.messaging.sent.at(-1)!.body;
}

async function dial(h: Harness, phone: string, text: string) {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: `/webhooks/ussd?token=${encodeURIComponent(USSD.token)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ sessionId: 'ATUid_lic', serviceCode: '*347*123#', phoneNumber: phone, networkCode: '62130', text }).toString(),
  });
  expect(r.statusCode).toBe(200);
  expect(r.body.length).toBeLessThanOrEqual(USSD_MAX);
  expect(r.body).toMatch(/^(CON|END) [\n\x20-\x7e]*$/);
  return r.body;
}

describe('licence check (decision 0016)', () => {
  it('LIC-1: an exact name, alias, website, app ID or Play Store link on a fresh list is licensed, with regulator, category and list date', async () => {
    const h = await licenceHarness();
    const r = await check(h, 'Example Credit Limited');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      verdict: 'licensed',
      firm: { name: 'EXAMPLE CREDIT LIMITED', regulator: 'FCCPC', category: 'digital_lender', status: 'Full approval', source: { id: 'test-fccpc', retrievedAt: RETRIEVED, url: FCCPC_FIXTURE.source.url } },
    });
    for (const q of ['ExampleCash', 'examplecredit.ng', 'https://www.examplecredit.ng/apply?x=1', 'ng.example.credit', 'https://play.google.com/store/apps/details?id=ng.example.credit&hl=en']) {
      expect((await check(h, q)).body, q).toMatchObject({ verdict: 'licensed', firm: { name: 'EXAMPLE CREDIT LIMITED' } });
    }
    const mfb = await check(h, 'Zentrabuk Microfinance Bank');
    expect(mfb.body).toMatchObject({ verdict: 'licensed', firm: { regulator: 'CBN', category: 'microfinance_bank', status: null } });
  });

  it('LIC-2: matching ignores case, punctuation, spacing and Ltd / Limited / Plc / Nigeria', async () => {
    expect(nameKey('EXAMPLE CREDIT LIMITED')).toBe('examplecredit');
    for (const q of ['example credit ltd', 'Example Credit Ltd.', 'EXAMPLE-CREDIT NIGERIA LIMITED', '  example   credit  ', 'ExampleCredit Plc', 'Example Credit Nigeria']) expect(nameKey(q), q).toBe('examplecredit');
    expect(nameKey('Quorvane Lending Nigeria Ltd')).toBe(nameKey('quorvane lending'));
    expect(nameKey('A & B Credit')).toBe(nameKey('A and B Credit'));
    expect(websiteKey('HTTPS://WWW.ExampleCredit.ng/path')).toBe('examplecredit.ng');
    expect(appIdKey('https://play.google.com/store/apps/details?id=ng.Example.Credit')).toBe('ng.example.credit');
    expect(appIdKey('Example Credit')).toBeNull();
    const h = await licenceHarness();
    for (const q of ['example credit ltd', 'EXAMPLE CREDIT NIGERIA LIMITED', 'Quorvane Lending', 'quorvane lending nigeria limited']) {
      expect((await check(h, q)).body.verdict, q).toBe('licensed');
    }
  });

  it('LIC-3: an unknown name is not_listed, never "fraud", names the regulators and warns against upfront fees', async () => {
    const h = await licenceHarness();
    const r = await check(h, 'Totally Unheard Of Lender');
    expect(r.body).toMatchObject({ verdict: 'not_listed', similarTo: null });
    if (r.body.verdict !== 'not_listed') throw new Error('expected not_listed');
    expect(r.body.regulators).toEqual(REGULATORS.map((x) => ({ name: x.name, url: x.url })));
    expect(r.body.sources.map((s) => s.id)).toEqual(['test-fccpc', 'test-cbn']);
    expect(JSON.stringify(r.body)).not.toMatch(/fraud|scam|unlicensed|illegal/i);
    expect(copy.licence.not_listed.body).toMatch(/upfront fee/);
    expect(copy.licence.ussd.notListed).toMatch(/upfront fee/);
    expect(['licensed', 'not_listed', 'cannot_check']).toContain(r.body.verdict);
  });

  it('LIC-4: a near miss gets similar_to_licensed naming the listed firm, and is still not_listed', async () => {
    const h = await licenceHarness();
    for (const q of ['Exampel Credit', 'Examp1e Credit', 'Example Credits', 'ExampleCredit Loans', 'examplecredit-ng.com', 'Zentrabuk Microfinanse Bank']) {
      const r = await check(h, q);
      expect(r.body.verdict, q).toBe('not_listed');
      if (r.body.verdict !== 'not_listed') continue;
      expect(r.body.similarTo?.name, q).toMatch(/EXAMPLE CREDIT LIMITED|Zentrabuk/);
    }
    for (const q of ['Moonbeam Capital', 'Exa', 'Credit']) {
      const r = await check(h, q);
      expect(r.body, q).toMatchObject({ verdict: 'not_listed', similarTo: null });
    }
    for (const distance of [0, 1, 2, 3]) {
      const v = decideLicenceVerdict({ data: { ok: true, sources: [{ id: 'a', retrievedAt: RETRIEVED }] }, exactSourceId: null, nearest: { distance, contains: true, length: 20 }, maxAgeDays: 120, now: NOW });
      expect(v).toEqual({ verdict: 'not_listed', similar: true });
    }
    expect(editDistance('examplecredit', 'exampelcredit')).toBe(2);
    expect(editDistance('a', 'abcdefghijklmnop', 3)).toBe(4);
  });

  it('LIC-5: stale or missing lists fail closed with cannot_check', async () => {
    const h = await licenceHarness();
    h.clock.now = new Date(Date.parse(RETRIEVED) + 121 * 24 * 3600_000);
    for (const q of ['Example Credit Limited', 'Exampel Credit', 'Totally Unheard Of Lender']) expect((await check(h, q)).body.verdict, q).toBe('cannot_check');
    const metrics = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } })).json();
    expect(metrics.licenceData).toMatchObject({ status: 'stale', maxAgeDays: 120 });
    expect(metrics.licenceData.sources[0]).toMatchObject({ id: 'test-fccpc', retrievedAt: RETRIEVED, entries: 2, stale: true });

    const lenient = await licenceHarness({ licenceMaxAgeDays: 400 });
    lenient.clock.now = h.clock.now;
    expect((await check(lenient, 'Example Credit Limited')).body.verdict).toBe('licensed');

    const mixed = await licenceHarness({ licences: new MemoryLicenceRegistry([FCCPC_FIXTURE, { ...CBN_FIXTURE, source: { ...CBN_FIXTURE.source, retrievedAt: '2026-01-01' } }]) });
    expect((await check(mixed, 'Example Credit')).body.verdict).toBe('licensed');
    expect((await check(mixed, 'Zentrabuk Microfinance Bank')).body.verdict).toBe('cannot_check');
    expect((await check(mixed, 'Totally Unheard Of Lender')).body.verdict).toBe('cannot_check');

    const future = await licenceHarness({ licences: new MemoryLicenceRegistry([{ ...FCCPC_FIXTURE, source: { ...FCCPC_FIXTURE.source, retrievedAt: '2027-06-01' } }]) });
    expect((await check(future, 'Example Credit')).body.verdict).toBe('cannot_check');

    const down = await licenceHarness({ licences: new UnavailableLicenceRegistry() });
    const r = await check(down, 'Example Credit Limited');
    expect(r.body.verdict).toBe('cannot_check');
    expect(r.body.regulators.map((x) => x.name)).toEqual(['FCCPC', 'CBN', 'SEC']);
    const metricsDown = (await down.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${down.bankToken}` } })).json();
    expect(metricsDown.licenceData).toMatchObject({ status: 'unavailable', sources: [] });
    const empty = mkdtempSync(join(tmpdir(), 'lic-'));
    await expect(new DirectoryLicenceRegistry(empty).snapshot()).rejects.toThrow();
    await expect(new DirectoryLicenceRegistry(join(empty, 'missing')).snapshot()).rejects.toThrow();
    writeFileSync(join(empty, 'bad.json'), '{"source":{}}');
    await expect(new DirectoryLicenceRegistry(empty).snapshot()).rejects.toThrow();
  });

  it('LIC-5: a directory registry re-reads its files, and keeps the last good lists when a re-read fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lic-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify(FCCPC_FIXTURE));
    let t = 0;
    const reg = new DirectoryLicenceRegistry(dir, 1000, () => t);
    expect(findLicence(await reg.snapshot(), 'Example Credit').exact).not.toBeNull();
    writeFileSync(join(dir, 'b.json'), JSON.stringify(CBN_FIXTURE));
    expect(findLicence(await reg.snapshot(), 'Zentrabuk Microfinance Bank').exact).toBeNull();
    t = 1000;
    expect(findLicence(await reg.snapshot(), 'Zentrabuk Microfinance Bank').exact).not.toBeNull();
    writeFileSync(join(dir, 'b.json'), 'not json');
    t = 2000;
    expect((await reg.snapshot()).sources.map((s) => s.id)).toEqual(['test-fccpc', 'test-cbn']);
  });

  it('LIC-6: nothing from a query is stored or logged; only the verdict is counted', async () => {
    const h = await licenceHarness();
    const marker = 'Marker Lender Zq7x';
    expect((await check(h, marker)).body.verdict).toBe('not_listed');
    expect((await check(h, 'Example Credit')).body.verdict).toBe('licensed');
    expect(await send(h, `LOAN ${marker}`)).toContain(copy.licence.not_listed.title);
    expect(await dial(h, BOB, `4*${marker}`)).toMatch(/^END /);
    const dump = JSON.stringify(await h.sys.store.dump());
    for (const s of [marker, marker.toLowerCase(), 'markerlenderzq7x', 'EXAMPLE CREDIT', 'Example Credit']) expect(dump).not.toContain(s);
    expect(h.logs.join('\n')).not.toMatch(/Zq7x|zq7x/);
    const metrics = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } })).json();
    expect(metrics.licenceChecks).toEqual({ not_listed: 3, licensed: 1 });
    expect(metrics.verifications).toEqual({});
    expect(metrics.licenceData).toMatchObject({ status: 'fresh' });
  });

  it('LIC-7: on WhatsApp, LOAN or LICENCE and a name answers from the fixed text; a pasted message is not a command', async () => {
    expect(parseLicenceCommand('LOAN Example Credit')).toBe('Example Credit');
    expect(parseLicenceCommand('licence: examplecredit.ng')).toBe('examplecredit.ng');
    expect(parseLicenceCommand('License Example Credit Nigeria Limited')).toBe('Example Credit Nigeria Limited');
    expect(parseLicenceCommand('loan')).toBeNull();
    expect(parseLicenceCommand('Loan approved! Click https://bit.ly/x to collect NGN50,000 today')).toBeUndefined();
    expect(parseLicenceCommand('Loans are great')).toBeUndefined();
    for (const pasted of ['Loan approved! Collect now', 'LOAN: NGN50,000 approved', 'Loan approved, click bit.ly/x', 'Loan 2500000 credited', 'loan https://quick.example/apply', 'Loan due? Pay today', 'Loan approved.\nClick here']) {
      expect(parseLicenceCommand(pasted), pasted).toBeUndefined();
    }
    expect(parseLicenceCommand('LOAN 9 PSB')).toBe('9 PSB');
    expect(parseLicenceCommand('LOAN examplecredit.ng')).toBe('examplecredit.ng');
    expect(parseLicenceCommand('LICENCE https://www.examplecredit.ng')).toBe('https://www.examplecredit.ng');
    expect(parseLicenceCommand('Hello there')).toBeUndefined();

    const h = await licenceHarness();
    expect(await send(h, 'hi')).toContain(copy.licence.bot.hint);
    expect(await send(h, 'LOAN')).toBe(copy.licence.bot.usage);
    const ok = await send(h, 'LOAN Example Credit');
    expect(ok).toContain(copy.licence.licensed.title);
    expect(ok).toContain(fill(copy.licence.licensed.body, { name: 'EXAMPLE CREDIT LIMITED', regulator: 'FCCPC', category: copy.licence.categories.digital_lender }));
    expect(ok).toContain(RETRIEVED);
    expect(ok).toContain(copy.licence.sample);
    const near = await send(h, 'LICENCE Exampel Credit');
    expect(near).toContain(copy.licence.not_listed.title);
    expect(near).toContain(fill(copy.licence.similar, { name: 'EXAMPLE CREDIT LIMITED' }));
    expect(near).not.toContain(copy.licence.licensed.title);
    const none = await send(h, 'LOAN Moonbeam Capital');
    expect(none).toContain(fill(copy.licence.not_listed.body, { regulators: 'FCCPC, CBN or SEC' }));
    expect(none).toContain('https://fccpc.gov.ng');

    const licenceTitles = [copy.licence.licensed.title, copy.licence.not_listed.title, copy.licence.cannot_check.title, copy.licence.bot.usage];
    for (const contact of ['@demobank_care', '08012345678', '+2349015550199']) {
      const reply = await send(h, contact);
      for (const t of licenceTitles) expect(reply, contact).not.toContain(t);
      expect(reply, contact).toMatch(new RegExp(`^(${copy.official.contact.official.title}|${copy.official.contact.not_official.title})`));
    }
    for (const pasted of ['Loan 2500000 credited', 'LOAN NGN50,000 approved']) {
      const reply = await send(h, pasted);
      for (const t of licenceTitles) expect(reply, pasted).not.toContain(t);
      expect(reply, pasted).toContain(copy.verdict.not_confirmed.title);
    }

    await send(h, 'LANG HA');
    expect(await send(h, 'LOAN Moonbeam Capital')).toContain(copyFor('ha').licence.not_listed.title);

    const down = await licenceHarness({ licences: new UnavailableLicenceRegistry() });
    expect(await send(down, 'LOAN Example Credit')).toContain(copy.licence.cannot_check.title);
  });

  it('LIC-8: USSD option 4 asks for a name and answers on one 160-character ASCII screen, in every language', async () => {
    const h = await licenceHarness();
    const menu = await dial(h, ALICE, '');
    expect(menu).toContain(copy.licence.ussd.moreOption);
    expect(menu).toContain(copy.ussd.neverAsks);
    const more = await dial(h, ALICE, '9');
    expect(more).toBe(`CON ${copy.licence.ussd.moreHeading}\n${copy.licence.ussd.menuOption}\n${copy.licence.ussd.backOption}`);
    expect(await dial(h, ALICE, '9*0')).toBe(menu);
    expect(await dial(h, ALICE, '9*4')).toBe(`CON ${copy.licence.ussd.prompt}`);
    expect(await dial(h, ALICE, '9*4*Example Credit')).toBe(`END ${fill(copy.licence.ussd.licensed, { name: 'EXAMPLE CREDIT LIMITED', regulator: 'FCCPC' })}`);
    expect(await dial(h, ALICE, '9*0*4*Example Credit')).toBe(`END ${fill(copy.licence.ussd.licensed, { name: 'EXAMPLE CREDIT LIMITED', regulator: 'FCCPC' })}`);
    for (const bad of ['9*5', '9*9', '9*x']) expect(await dial(h, ALICE, bad), bad).toBe(`END ${copy.ussd.invalid}`);
    expect(await dial(h, ALICE, '4')).toBe(`CON ${copy.licence.ussd.prompt}`);
    expect(await dial(h, ALICE, '4*Example Credit')).toBe(`END ${fill(copy.licence.ussd.licensed, { name: 'EXAMPLE CREDIT LIMITED', regulator: 'FCCPC' })}`);
    expect(await dial(h, ALICE, '4*Exampel Credit')).toBe(`END ${fill(copy.licence.ussd.similar, { name: 'EXAMPLE CREDIT LIMITED' })}`);
    expect(await dial(h, ALICE, '4*Moonbeam Capital')).toBe(`END ${fill(copy.licence.ussd.notListed, { regulators: 'FCCPC, CBN, SEC' })}`);
    expect(await dial(h, ALICE, '4*x')).toBe(`END ${copy.ussd.invalid}`);
    const down = await licenceHarness({ licences: new UnavailableLicenceRegistry() });
    expect(await dial(down, ALICE, '4*Example Credit')).toBe(`END ${copy.licence.ussd.cannotCheck}`);

    const longest = BUNDLED_LICENCES.flatMap((f) => f.entries).sort((a, b) => b.name.length - a.name.length)[0]!;
    const source = { id: 's', regulator: 'FCCPC', title: 't', url: 'https://fccpc.gov.ng', publishedAt: null, retrievedAt: RETRIEVED, sample: false };
    const firm = { name: longest.name, regulator: 'FCCPC', category: 'digital_lender', status: null, source };
    const regulators = REGULATORS.map((x) => ({ name: x.name, url: x.url }));
    const results: LicenceResult[] = [
      { verdict: 'licensed', firm, regulators },
      { verdict: 'not_listed', similarTo: firm, regulators, sources: [source] },
      { verdict: 'not_listed', similarTo: null, regulators, sources: [source] },
      { verdict: 'cannot_check', regulators },
    ];
    for (const lang of LANGUAGES) {
      const c = copyFor(lang);
      const screens = [menuScreen(c, 'X'.repeat(16), false), moreScreen(c), ascii(`CON ${c.licence.ussd.prompt}`), ...results.map((r) => licenceScreen(c, r))];
      for (const s of screens) {
        expect(s.length, `${lang}: ${s}`).toBeLessThanOrEqual(USSD_MAX);
        expect(s, `${lang}: ${s}`).toMatch(/^(CON|END) [\n\x20-\x7e]*$/);
      }
      expect(screens[4]).toContain(longest.name.slice(0, 8));
    }
  });

  it('LIC-9: the endpoint needs a customer token, validates the query and is rate limited', async () => {
    const h = await licenceHarness({ rateLimit: 5 });
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/verify/licence', payload: { query: 'Example Credit' } })).statusCode).toBe(401);
    expect((await check(h, 'x')).status).toBe(400);
    expect((await check(h, 'y'.repeat(201))).status).toBe(400);
    expect((await check(h, 42)).status).toBe(400);
    expect((await check(h, 'Example Credit')).status).toBe(200);
    expect((await check(h, 'Example Credit')).status).toBe(200);
    const limited = await check(h, 'Example Credit');
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
  });

  it('LIC-10: licence text never asks for a secret, and its warnings never reassure, in any language', () => {
    const REASSURING: Record<string, RegExp> = {
      en: /\b(genuine|safe|legit|trusted|verified|guaranteed)\b/i,
      pcm: /\b(genuine|legit|original|safe|e dey okay|e fine|na real|correct|authentic)\b/i,
      ha: /\b(lafiya|na gaske|ingantacce|amintacce|sahihi|babu matsala)\b/i,
      yo: /\b(ododo|ailewu|gidi|ojulowo|tooto|ko si wahala)\b/i,
      ig: /\b(ezigbo|n’ezie|n'ezie|eziokwu|dị mma|nchekwa)\b/i,
    };
    for (const lang of LANGUAGES) {
      const l = copyFor(lang).licence;
      const all = JSON.stringify(l);
      expect(asksForSecret(all), lang).toBe(false);
      const warnings = [l.not_listed.title, l.not_listed.body, l.similar, l.cannot_check.title, l.cannot_check.body, l.ussd.notListed, l.ussd.similar, l.ussd.cannotCheck];
      for (const w of warnings) expect(REASSURING[lang]!.test(w), `${lang}: ${w}`).toBe(false);
      expect(l.licensed.title).not.toBe(copyFor(lang).verdict.confirmed.title);
    }
    expect(copy.licence.licensed.body).toMatch(/does not confirm/);
    expect(copy.licence.ussd.licensed).toMatch(/does not prove/);
  });

  it('LIC-11: the bundled lists are real, sourced, dated, valid and ASCII; the importers parse the published formats', () => {
    const files = readdirSync('packages/licences/data').filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBe(BUNDLED_LICENCES.length);
    let total = 0;
    for (const f of files) {
      const raw = readFileSync(`packages/licences/data/${f}`, 'utf8');
      expect(/[^\t\n\r\x20-\x7e]/.test(raw), `${f} must be ASCII`).toBe(false);
      const d = LicenceDataFile.parse(JSON.parse(raw));
      expect(`${d.source.id}.json`).toBe(f);
      expect(d.source.url).toMatch(/^https:\/\/(www\.)?(fccpc\.gov\.ng|cbn\.gov\.ng|sec\.gov\.ng)\//);
      expect(d.source.sample).toBe(false);
      expect(Date.parse(d.source.retrievedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
      total += d.entries.length;
    }
    expect(total).toBeGreaterThan(1000);
    expect(BUNDLED_LICENCES[0]!.source.id).toBe('fccpc-digital-lenders');
    const index = buildLicenceIndex(BUNDLED_LICENCES);
    for (const f of BUNDLED_LICENCES) for (const e of f.entries) expect(findLicence(index, e.name).exact, e.name).not.toBeNull();

    const fccpc = `<h2>Approval</h2><table id="table_1"><tbody><tr><td>1</td><td>EXAMPLE CREDIT LIMITED,</td><td>EXCASH, QUICKEX APPS AND LENDEX APP</td><td></td></tr></tbody></table>
      <table id="table_2"><tbody><tr><td>1</td><td>EXAMPLE CREDIT LIMITED,</td><td>EXCASH, QUICKEX APPS AND LENDEX APP</td><td></td></tr></tbody></table>
      <h2>apps and companies on FCCPC watchlist</h2><table id="table_5"><tbody><tr><td>1</td><td>SHADY APP</td><td></td></tr></tbody></table>
      <h2>waivers [ licensed by CBN ]</h2><table id="table_9"><tbody><tr><td>1</td><td>BANK MFB LTD</td><td>-</td><td>THE COMPANY IS LICENSED BY THE CBN</td></tr></tbody></table>`;
    expect(parseFccpc(fccpc)).toEqual<LicenceEntry[]>([
      { name: 'EXAMPLE CREDIT LIMITED', category: 'digital_lender', status: 'Full approval', aliases: ['EXCASH', 'QUICKEX', 'LENDEX'] },
      { name: 'BANK MFB LTD', category: 'digital_lender', status: 'Waiver (licensed by the CBN)' },
    ]);
    expect(appNames('LETSGO APP UNDER THE DEVELOPER NAME LETSHEGO DIGITAL APPS')).toEqual(['LETSGO', 'LETSHEGO DIGITAL']);
    expect(parseCbnJson('[{"id":1,"name":"Example Bank Plc"},{"id":2,"name":"Example Bank Plc"},{"id":3,"name":null}]', 'commercial_bank')).toEqual([{ name: 'Example Bank Plc', category: 'commercial_bank' }]);
    expect(parseCbnPsps('<h3>B. MOBILE MONEY OPERATOR LICENCE CATEGORY</h3><table><tr><td>S/N</td><td>LICENCE</td></tr><tr><td>1.</td><td>Example Pay Limited (Formerly Old Name Limited)</td></tr></table>')).toEqual([
      { name: 'Example Pay Limited', category: 'payment_service_provider', status: 'MOBILE MONEY OPERATOR LICENCE CATEGORY' },
    ]);
  });
});
