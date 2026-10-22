import { createHmac } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { copy, copyFor, copyForOrg, fill, LANGUAGES } from '@gaskiya/schemas';
import { checkLink, configFromEnv, createSystem, decideContactVerdict, decideLinkVerdict, MemoryStore, parseContact, StaticKeyService, type Tenant } from '../packages/api/src/index.ts';
import { buildSimulator, DEMO_BANKS, demoTenant } from '../packages/api/src/simulator/index.ts';
import { createSandbox } from '../console/src/sandbox/backend.ts';
import { asksForSecret } from '../packages/api/src/ai/explain.ts';
import { BUNDLED_LICENCES } from '@gaskiya/licences/bundled';
import { REGULATORS } from '@gaskiya/licences';
import { callingMany, callingScreen, cannotCheck, contactAnswerScreen, licenceScreen, ascii as ussdAscii, menuOptions, menuScreen, moreScreen, notCallingScreen, paginate, USSD_MAX } from '../packages/api/src/ussd.ts';
import { ALICE, BANK_CLIENT, BOB, clientFor, demoEnv, harness, TENANT, TOKEN_SECRET, USSD, WA, type Harness } from './helpers.ts';

const DEMOBANK_PUBLISHES: Partial<Tenant> = {
  kind: 'bank',
  officialContacts: {
    phones: ['+2342019000000'],
    whatsapp: ['+2349060000000'],
    emails: ['Care@DemoBank.ng'],
    social: [
      { platform: 'x', handle: 'DemoBankNG' },
      { platform: 'instagram', handle: 'demobank.ng' },
      { platform: 'tiktok', handle: '@demobank' },
      { platform: 'telegram', handle: 'demobank_official' },
      { platform: 'facebook', handle: 'DemoBankNG' },
    ],
  },
  officialApps: { android: ['ng.demobank.mobile'], ios: ['id1234567890'] },
};

const AGENCY: Omit<Tenant, 'tokenKeys'> = {
  id: 'roadsafety',
  name: 'Road Safety Agency (demo)',
  kind: 'agency',
  domains: ['roadsafety.example'],
  senderIds: ['RSA-DEMO'],
  officialContacts: { phones: ['+2342090000122'], whatsapp: ['+2349070000122'], emails: ['help@roadsafety.example'], social: [{ platform: 'x', handle: 'RoadSafetyDemo' }] },
  officialApps: { android: ['example.roadsafety.demo'] },
};

const SCAM_WHATSAPP = '+2349015550199';

const orgHarness = (opts: Parameters<typeof harness>[0] = {}) => harness({ tenant: DEMOBANK_PUBLISHES, extraTenants: [AGENCY], ...opts });

async function checkContact(h: Harness, contact: string, extra: Record<string, unknown> = {}, phone = ALICE, iss?: string) {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: '/v1/verify/contact',
    headers: { authorization: `Bearer ${await h.customerToken(phone, iss ? { iss } : {})}` },
    payload: { contact, ...extra },
  });
  return { status: r.statusCode, body: r.json() };
}

async function whatsapp(h: Harness, text: string, from = ALICE) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from: from.slice(1), id: `wamid.${Math.random()}`, timestamp: '1', type: 'text', text: { body: text } }] } }] }] });
  const signature = `sha256=${createHmac('sha256', WA.appSecret).update(raw).digest('hex')}`;
  const r = await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
  expect(r.statusCode).toBe(200);
  return h.messaging.sent.at(-1)!.body;
}

async function dial(h: Harness, phone: string, text = '') {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: `/webhooks/ussd?token=${encodeURIComponent(USSD.token)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ sessionId: 'ATUid_off', serviceCode: '*347*123#', phoneNumber: phone, networkCode: '62130', text }).toString(),
  });
  expect(r.statusCode).toBe(200);
  expect(r.body.length).toBeLessThanOrEqual(USSD_MAX);
  expect(r.body).toMatch(/^(CON|END) [\n\x20-\x7e]*$/);
  return r.body;
}

describe('organisations beyond banks (decision 0014)', () => {
  it('OFF-1: a tenant without a kind is a bank; kinds, contacts and apps are validated at start-up', () => {
    const ok = configFromEnv(demoEnv({ AI_PROVIDER: 'none' }));
    expect(ok.tenants[0]!.kind ?? 'bank').toBe('bank');
    const withOrg = (t: Record<string, unknown>) =>
      demoEnv({
        AI_PROVIDER: 'none',
        GASKIYA_TENANTS: JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], tokenKeysUrl: 'http://127.0.0.1:5170/sim/.well-known/jwks.json', ...t }]),
      });
    expect(configFromEnv(withOrg({ kind: 'agency', officialContacts: { phones: ['0809 555 0101'], emails: ['a@b.ng'], social: [{ platform: 'x', handle: '@Ok_1' }] }, officialApps: { android: ['ng.demo.app'], ios: ['https://apps.apple.com/ng/app/demo/id1234567890'] } })).tenants[0]!.kind).toBe('agency');
    const bad = [
      [{ kind: 'ministry' }, 'kind must be one of bank, agency, company'],
      [{ officialContacts: { phones: ['12'] } }, 'officialContacts.phones "12" is not a phone number'],
      [{ officialContacts: { emails: ['nope'] } }, 'officialContacts.emails "nope" is not an email address'],
      [{ officialContacts: { social: [{ platform: 'myspace', handle: 'x' }] } }, 'officialContacts.social platform must be one of'],
      [{ officialContacts: { social: [{ platform: 'x', handle: 'has space' }] } }, 'is not a handle'],
      [{ officialApps: { android: ['not a package'] } }, 'officialApps.android "not a package" is not a package ID'],
      [{ officialApps: { ios: ['abc'] } }, 'officialApps.ios "abc" is not an App Store ID'],
    ] as const;
    for (const [fields, message] of bad) expect(() => configFromEnv(withOrg(fields)), message).toThrow(message);
  });

  it('OFF-1: /v1/organisations lists every organisation with its kind and what it publishes; /v1/banks stays compatible', async () => {
    const h = await orgHarness();
    const r = await h.sys.app.inject({ method: 'GET', url: '/v1/organisations' });
    expect(r.statusCode).toBe(200);
    const { organisations } = r.json();
    expect(organisations.map((o: { id: string; kind: string }) => [o.id, o.kind])).toEqual([['demobank', 'bank'], ['roadsafety', 'agency']]);
    expect(organisations[1]).toMatchObject({ name: 'Road Safety Agency (demo)', domains: ['roadsafety.example'], officialContacts: { whatsapp: ['+2349070000122'] }, officialApps: { android: ['example.roadsafety.demo'], ios: [] } });
    expect(r.body).not.toMatch(/tokenKeys|clientSecret|kty/);
    const banks = (await h.sys.app.inject({ method: 'GET', url: '/v1/banks' })).json();
    expect(banks).toEqual({ banks: [] });
  });

  it('OFF-2: an agency registers a message exactly like a bank, and it verifies for its recipient only', async () => {
    const h = await orgHarness();
    const text = 'Road Safety Agency (demo): your vehicle licence ends on 31 Oct. Renew at https://roadsafety.example/renew or at any office.';
    const reg = await h.sys.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${await h.bankTokenFor(AGENCY.id)}` },
      payload: { recipient: ALICE, channel: 'sms', contentDigest: contentDigest(text), category: 'service_update', hasLink: true, linkDomains: ['roadsafety.example'], asksCallback: false, sentAt: h.clock.now.toISOString() },
    });
    expect(reg.statusCode).toBe(202);
    const verify = async (phone: string, iss: string, t = text) =>
      (await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: { authorization: `Bearer ${await h.customerToken(phone, { iss })}` }, payload: { contentDigest: contentDigest(t) } })).json();
    expect(await verify(ALICE, AGENCY.id)).toMatchObject({ verdict: 'confirmed', bank: 'Road Safety Agency (demo)', category: 'service_update' });
    expect((await verify(BOB, AGENCY.id)).verdict).toBe('not_confirmed');
    expect((await verify(ALICE, TENANT.id)).verdict).toBe('not_confirmed');
    expect((await verify(ALICE, AGENCY.id, text.replace('roadsafety.example', 'road-safety.example'))).verdict).toBe('not_confirmed');
  });

  it('OFF-2: on the agency\'s WhatsApp number every reply names the agency and never says "your bank"', async () => {
    const h = await orgHarness({ whatsappTenantId: AGENCY.id });
    const text = 'Road Safety Agency (demo): your fine of NGN 10,000 was paid. Reference 55102.';
    await h.sys.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${await h.bankTokenFor(AGENCY.id)}` },
      payload: { recipient: ALICE, channel: 'whatsapp', contentDigest: contentDigest(text), category: 'transaction_alert', hasLink: false, linkDomains: [], asksCallback: false, sentAt: h.clock.now.toISOString() },
    });
    const confirmed = await whatsapp(h, text);
    expect(confirmed).toContain(`Sent by ${AGENCY.name}`);
    const fake = await whatsapp(h, 'Road Safety Agency (demo): pay your unpaid fine now at https://roadsafety-fines.example or your licence is cancelled. Your code: 1234');
    expect(fake).toContain(copy.verdict.not_confirmed.title);
    expect(fake).toContain(fill(copy.official.org.explainFallback, { bank: AGENCY.name }));
    expect(fake).toContain(fill(copy.official.org.otpAdvice, { bank: AGENCY.name }));
    const call = await whatsapp(h, 'CALL');
    expect(call).toContain(`${AGENCY.name} isn't calling you`);
    for (const reply of [confirmed, fake, call, await whatsapp(h, 'hi')]) expect(reply.toLowerCase()).not.toMatch(/your bank|my bank/);
    await whatsapp(h, 'LANG HA');
    expect(await whatsapp(h, 'CALL')).toContain(fill(copyFor('ha').official.org.notCallingTitle, { bank: AGENCY.name }));
    const bank = await orgHarness();
    expect(await whatsapp(bank, 'CALL')).toContain(copy.call.not_calling.title);
  });

  it('OFF-2: a store failure on the agency\'s channels is "cannot check" naming the agency, never "your bank"', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async findMessage(...args: Parameters<MemoryStore['findMessage']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.findMessage(...args);
      }
      override async openCalls(...args: Parameters<MemoryStore['openCalls']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.openCalls(...args);
      }
    }
    const store = new BrokenStore();
    const h = await orgHarness({ store, whatsappTenantId: AGENCY.id, ussd: { token: USSD.token, tenantId: AGENCY.id } });
    store.broken = true;
    const reply = await whatsapp(h, 'Road Safety Agency (demo): renew now');
    expect(reply).toContain(copy.verdict.cannot_check.title);
    expect(reply).toContain(fill(copy.official.org.cannotCheckBody, { bank: AGENCY.name }));
    expect(reply).not.toContain(copy.verdict.confirmed.short);
    const screen = await dial(h, ALICE, '1');
    expect(screen).toContain(ussdAscii(copy.verdict.cannot_check.title));
    expect(screen.toLowerCase()).not.toContain('your bank');
    store.broken = false;
    const menu = await dial(h, ALICE);
    expect(menu).toContain(fill(copy.official.org.ussdMenu, { bank: AGENCY.name }));
    expect(menu).toContain(copy.official.org.ussdOption);
    expect(menu.toLowerCase()).not.toContain('my bank');
  });
});

describe('official contacts (decision 0014)', () => {
  it('OFF-3: an exact match with a registered phone, WhatsApp number, email or account is official, naming the organisation and the kind of contact', async () => {
    const h = await orgHarness();
    const cases: [string, string, string, string[]][] = [
      ['+234 201 900 0000', 'phone', 'demobank', ['phone']],
      ['0201 900 0000', 'phone', 'demobank', ['phone']],
      ['tel:+2342019000000', 'phone', 'demobank', ['phone']],
      ['+2349060000000', 'phone', 'demobank', ['whatsapp']],
      ['https://wa.me/2349060000000', 'whatsapp', 'demobank', ['whatsapp']],
      ['api.whatsapp.com/send?phone=2349060000000', 'whatsapp', 'demobank', ['whatsapp']],
      ['CARE@demobank.NG', 'email', 'demobank', ['email']],
      ['mailto:care@demobank.ng', 'email', 'demobank', ['email']],
      ['@DemoBankNG', 'handle', 'demobank', ['social']],
      ['https://x.com/demobankng', 'social', 'demobank', ['social']],
      ['twitter.com/DemoBankNG?lang=en', 'social', 'demobank', ['social']],
      ['https://www.instagram.com/demobank.ng/', 'social', 'demobank', ['social']],
      ['https://www.tiktok.com/@demobank', 'social', 'demobank', ['social']],
      ['t.me/demobank_official', 'social', 'demobank', ['social']],
      ['https://m.facebook.com/DemoBankNG', 'social', 'demobank', ['social']],
      ['+234 907 000 0122', 'phone', 'roadsafety', ['whatsapp']],
      ['help@roadsafety.example', 'email', 'roadsafety', ['email']],
    ];
    for (const [contact, type, org, as] of cases) {
      const r = await checkContact(h, contact);
      expect(r.status, contact).toBe(200);
      expect(r.body, contact).toMatchObject({ verdict: 'official', contact: { type }, matches: [{ id: org, as }] });
      expect(r.body.matches, contact).toHaveLength(1);
    }
    expect((await checkContact(h, '@DemoBankNG')).body.matches[0].platforms).toEqual(['x', 'facebook']);
    expect((await checkContact(h, 'x.com/DemoBankNG')).body.matches[0]).toMatchObject({ name: 'DemoBank', kind: 'bank', platforms: ['x'] });
    expect((await checkContact(h, 'instagram.com/DemoBankNG')).body.verdict).toBe('not_official');
    expect((await checkContact(h, 'wa.me/2342019000000')).body.verdict).toBe('not_official');
  });

  it('OFF-4: anything else is not official; a handle or email that imitates an organisation\'s name carries an impersonation warning', async () => {
    const h = await orgHarness();
    expect((await checkContact(h, SCAM_WHATSAPP)).body).toEqual({ verdict: 'not_official', contact: { type: 'phone', value: SCAM_WHATSAPP }, organisation: null, reasons: ['not_registered'], impersonates: [] });
    expect((await checkContact(h, 'https://wa.me/2349015550199')).body).toMatchObject({ verdict: 'not_official', reasons: ['not_registered'] });
    const lookalikes = ['@demobank_care_desk', '@dem0bank_help', 'https://x.com/DemoBankNG_Support', 'facebook.com/demobank.customer.care', 'demobank.support@gmail.com', 'help@demobank-care.com', 't.me/DemoBankRefunds'];
    for (const contact of lookalikes) {
      expect((await checkContact(h, contact)).body, contact).toMatchObject({ verdict: 'not_official', reasons: ['impersonation', 'not_registered'], impersonates: [{ id: 'demobank', name: 'DemoBank', kind: 'bank' }] });
    }
    expect((await checkContact(h, '@roadsafety_fines_desk')).body).toMatchObject({ verdict: 'not_official', impersonates: [{ id: 'roadsafety', kind: 'agency' }] });
    expect((await checkContact(h, '@chidi_fashion')).body).toMatchObject({ verdict: 'not_official', reasons: ['not_registered'], impersonates: [] });
    expect((await checkContact(h, 'loans@demobank.ng')).body).toMatchObject({ verdict: 'not_official', reasons: ['not_registered'], impersonates: [] });
    expect((await checkContact(h, '+2349070000122', { tenantId: 'demobank' })).body).toMatchObject({ verdict: 'not_official', organisation: { id: 'demobank', name: 'DemoBank', kind: 'bank' } });
    expect((await checkContact(h, '+2349070000122', { tenantId: 'roadsafety' })).body).toMatchObject({ verdict: 'official', matches: [{ id: 'roadsafety' }] });
  });

  it('OFF-5: when the registry cannot answer, a contact check is cannot check, never official', async () => {
    class UnreachableStore extends MemoryStore {
      down = false;
      override async ping() {
        if (this.down) throw new Error('ECONNREFUSED');
      }
    }
    const store = new UnreachableStore();
    const h = await orgHarness({ store });
    expect((await checkContact(h, '+2342019000000')).body.verdict).toBe('official');
    store.down = true;
    for (const contact of ['+2342019000000', 'care@demobank.ng', '@DemoBankNG', SCAM_WHATSAPP]) {
      const r = await checkContact(h, contact);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ verdict: 'cannot_check' });
    }
    expect(decideContactVerdict({ directoryOk: false, parsed: true, exactMatches: 3 })).toBe('cannot_check');
    expect(decideContactVerdict({ directoryOk: true, parsed: true, exactMatches: 0 })).toBe('not_official');
    expect(decideContactVerdict({ directoryOk: true, parsed: false, exactMatches: 1 })).toBe('not_official');
    expect(decideContactVerdict({ directoryOk: true, parsed: true, exactMatches: 1 })).toBe('official');
  });

  it('OFF-6: no checked contact is stored or logged; only counts are kept', async () => {
    const h = await orgHarness();
    const checked = ['+2349015550199', 'scam.marker.desk@gmail.com', '@markerdemobankscam', 'https://x.com/markerhandle77'];
    for (const contact of checked) await checkContact(h, contact);
    await whatsapp(h, '+234 901 555 0188');
    await dial(h, ALICE, '3*09015550177');
    await new Promise((r) => setTimeout(r, 20));
    const dump = JSON.stringify(await h.sys.store.dump());
    for (const s of ['2349015550199', '9015550199', 'scam.marker.desk', 'markerdemobankscam', 'markerhandle77', '9015550188', '9015550177', ALICE.slice(1)]) {
      expect(dump, s).not.toContain(s);
      expect(h.logs.join('\n'), s).not.toContain(s);
    }
    const m = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } })).json();
    expect(m.contactChecks).toEqual({ not_official: 6 });
  });

  it('OFF-7: contact checks need a customer token, are rate limited, and say when the text is not a contact', async () => {
    const h = await orgHarness({ rateLimit: 2 });
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/verify/contact', payload: { contact: '+2342019000000' } })).statusCode).toBe(401);
    expect((await checkContact(h, 'hello there, call me')).status).toBe(422);
    expect((await checkContact(h, 'https://www.demobank.ng/app', {}, BOB)).body).toMatchObject({ code: 'not_a_contact' });
    expect((await checkContact(h, '+2342019000000', {}, BOB)).status).toBe(200);
    expect((await checkContact(h, '+2342019000000', {}, BOB)).status).toBe(429);
    const other = await orgHarness();
    expect((await checkContact(other, '+2342019000000', { tenantId: 'nobank' })).status).toBe(404);
    expect((await checkContact(other, '+2342019000000', { surprise: true })).status).toBe(400);
    expect((await checkContact(other, 'x')).status).toBe(400);
    expect(parseContact('Your DemoBank account is blocked, call 0809 555 0101')).toBeNull();
  });
});

describe('official apps (decision 0014)', () => {
  const apps = DEMOBANK_PUBLISHES.officialApps;
  const link = (url: string) => checkLink(url, TENANT.domains, TENANT.name, apps);

  it('OFF-8: a store page is the official app only on an exact package or App Store ID match', async () => {
    expect(link('https://play.google.com/store/apps/details?id=ng.demobank.mobile&hl=en')).toMatchObject({ verdict: 'official_app', reasons: [], app: { store: 'play', id: 'ng.demobank.mobile', official: true } });
    expect(link('https://apps.apple.com/ng/app/demobank/id1234567890')).toMatchObject({ verdict: 'official_app', app: { store: 'app_store', id: '1234567890', official: true } });
    const h = await orgHarness();
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` }, payload: { url: 'play.google.com/store/apps/details?id=ng.demobank.mobile' } });
    expect(r.json()).toMatchObject({ verdict: 'official_app', bank: 'DemoBank' });
    expect(checkLink('https://play.google.com/store/apps/details?id=ng.demobank.mobile', TENANT.domains, TENANT.name).verdict).toBe('not_confirmed');
    expect(decideLinkVerdict({ matchedDomain: null, reasons: [], appStore: true, officialApp: false })).toBe('not_confirmed');
    expect(decideLinkVerdict({ matchedDomain: null, reasons: ['fake_app'], appStore: true, officialApp: true })).toBe('not_confirmed');
  });

  it('OFF-8: an APK download is never confirmed, and a store page imitating the bank under another ID is a fake app', () => {
    for (const url of ['https://demobank-update.com/DemoBank.apk', 'http://198.51.100.7/app.apk', 'https://www.demobank.ng/files/demobank.apk']) {
      const r = link(url);
      expect(r.verdict, url).toBe('not_confirmed');
      expect(r.reasons, url).toEqual(expect.arrayContaining(['apk', 'fake_app']));
      expect(r.app, url).toMatchObject({ store: 'apk', official: false });
    }
    for (const url of ['https://play.google.com/store/apps/details?id=com.demobank.secure.update', 'https://play.google.com/store/apps/details?id=ng.dem0bank.mobile', 'https://apps.apple.com/ng/app/demobank-security/id999999999']) {
      expect(link(url), url).toMatchObject({ verdict: 'not_confirmed', reasons: ['fake_app', 'not_registered'], app: { official: false } });
    }
    expect(link('https://play.google.com/store/apps/details?id=com.whatsapp')).toMatchObject({ verdict: 'not_confirmed', reasons: ['not_registered'] });
    expect(link('https://www.demobank.ng/app')).toMatchObject({ verdict: 'belongs', matchedDomain: 'demobank.ng' });
    expect(link('https://www.demo-bank.ng/app')).toMatchObject({ verdict: 'not_confirmed', reasons: ['lookalike', 'not_registered'] });
  });
});

describe('official contacts on USSD and WhatsApp (decision 0014)', () => {
  it('OFF-9: USSD option 3 answers whether a number is the bank\'s own, on one screen', async () => {
    const h = await orgHarness();
    const menu = await dial(h, ALICE);
    expect(menu.startsWith('CON ')).toBe(true);
    expect(menu).toContain(copy.official.ussd.option);
    expect(await dial(h, ALICE, '3')).toBe(`CON ${copy.official.ussd.enterNumber}`);
    expect(await dial(h, ALICE, '3*02019000000')).toBe(`END ${fill(copy.official.ussd.official, { number: '+2342019000000', bank: 'DemoBank' })}`);
    expect(await dial(h, ALICE, '3*2349060000000')).toContain('is an official DemoBank number');
    expect(await dial(h, ALICE, '3*09015550199')).toBe(`END ${fill(copy.official.ussd.notOfficial, { number: SCAM_WHATSAPP, bank: 'DemoBank' })}`);
    expect(await dial(h, ALICE, '3*09070000122')).toContain('is not a DemoBank number');
    expect(await dial(h, ALICE, '3*12')).toBe(`END ${copy.official.ussd.badNumber}`);
    expect(await dial(h, ALICE, '3*09015550199*1')).toBe(`END ${copy.ussd.invalid}`);
  });

  it('OFF-9: USSD option 3 fails closed when the registry cannot answer', async () => {
    class UnreachableStore extends MemoryStore {
      override async ping() {
        throw new Error('ECONNREFUSED');
      }
    }
    const h = await orgHarness({ store: new UnreachableStore() });
    const screen = await dial(h, ALICE, '3*02019000000');
    expect(screen).toBe(ussdAscii(`END ${copy.verdict.cannot_check.title}\n${copy.verdict.cannot_check.body}`));
  });

  const LONGEST_FIRM = BUNDLED_LICENCES.flatMap((f) => f.entries).sort((a, b) => b.name.length - a.name.length)[0]!.name;
  const licenceScreens = (c: ReturnType<typeof copyForOrg>, name: string) => {
    const source = { id: 's', regulator: 'FCCPC', title: 't', url: 'https://fccpc.gov.ng', publishedAt: null, retrievedAt: '2026-10-20', sample: false };
    const firm = { name, regulator: 'FCCPC', category: 'digital_lender', status: null, source };
    const regulators = REGULATORS.map((x) => ({ name: x.name, url: x.url }));
    return {
      [`licensed ${name.length}`]: licenceScreen(c, { verdict: 'licensed', firm, regulators }),
      [`similar ${name.length}`]: licenceScreen(c, { verdict: 'not_listed', similarTo: firm, regulators, sources: [source] }),
      notListed: licenceScreen(c, { verdict: 'not_listed', similarTo: null, regulators, sources: [source] }),
      licenceCannotCheck: licenceScreen(c, { verdict: 'cannot_check', regulators }),
    };
  };

  it('OFF-9: every USSD screen fits 160 plain ASCII characters, in every language, for names of 8, 16 and 24 characters, with and without the SIM caution', () => {
    const names = ['N'.repeat(8), 'N'.repeat(16), 'N'.repeat(24), 'DemoBank', 'Road Safety Agency (demo)'.slice(0, 24), 'Tax Office (demo)', 'ZB Demo Bank (demo)'];
    const number = '+234801234567890';
    for (const lang of LANGUAGES) {
      for (const kind of ['bank', 'agency'] as const) {
        const c = copyForOrg(lang, kind);
        const longestPurpose = Object.values(c.purposes).sort((a, b) => b.length - a.length)[0]!;
        for (const bank of names) {
          for (const swapped of [false, true]) {
            const menu = menuScreen(c, bank, swapped);
            const at = `${lang} ${kind} ${bank.length} chars swapped=${swapped}: ${menu}`;
            expect(menu.length, at).toBeLessThanOrEqual(USSD_MAX);
            expect(menu, at).toMatch(/^CON [\n\x20-\x7e]*$/);
            if (swapped) expect(menu, at).toContain(ussdAscii(c.simswap.ussd));
            for (const line of fill(c.ussd.menu, { bank }).split('\n').slice(1)) expect(menu, at).toContain(ussdAscii(line));
            for (const o of menuOptions(c).filter((x) => x.required)) expect(menu, at).toContain(ussdAscii(o.text));
            expect(menu.includes(bank) || /\.\.\./.test(menu) || !menu.includes(fill(c.ussd.menu, { bank: '' }).split('\n')[0]!.trim()), at).toBe(true);
            const more = ussdAscii(c.licence.ussd.moreOption);
            const screenOf = (opts: { text: string }[], withNeverAsks: boolean) =>
              ussdAscii(`CON ${[...(swapped ? [c.simswap.ussd] : []), fill(c.ussd.menu, { bank }), ...opts.map((o) => o.text), ...(withNeverAsks ? [c.ussd.neverAsks] : [])].join('\n')}`);
            if (screenOf(menuOptions(c), true).length <= USSD_MAX) expect(menu, at).toContain(more);
            if (screenOf(menuOptions(c).filter((o) => o.required), true).length <= USSD_MAX) expect(menu, at).toContain(ussdAscii(c.ussd.neverAsks));
            else if (screenOf(menuOptions(c), false).length <= USSD_MAX) expect(menu, at).toContain(more);
            if (menu.includes('...')) expect(menu, at).not.toContain(more);
          }
          const closing = {
            notCalling: notCallingScreen(c, bank),
            calling: callingScreen(c, bank, '4821', longestPurpose),
            callingMany: ussdAscii(`END ${callingMany(c, bank, ['4821', '9031', '1442'])}`),
            cannotCheck: cannotCheck(c, bank),
            official: contactAnswerScreen(c, true, number, bank),
            notOfficial: contactAnswerScreen(c, false, number, bank),
            enter: ussdAscii(`CON ${c.official.ussd.enterNumber}`),
            bad: ussdAscii(`END ${c.official.ussd.badNumber}`),
            none: ussdAscii(`END ${paginate(fill(c.ussd.todayNone, { bank }), [], c.ussd.todayNote, c)[0]!.body}`),
            licencePrompt: ussdAscii(`CON ${c.licence.ussd.prompt}`),
            more: moreScreen(c),
            ...licenceScreens(c, bank),
            ...licenceScreens(c, LONGEST_FIRM),
          };
          for (const [name, screen] of Object.entries(closing)) {
            expect(screen.length, `${lang} ${kind} ${bank.length} chars ${name}: ${screen}`).toBeLessThanOrEqual(USSD_MAX);
            expect(screen, `${lang} ${kind} ${name}`).toMatch(/^(CON|END) [\n\x20-\x7e]*$/);
          }
          expect(closing.more, `${lang} ${kind} more`).toContain(ussdAscii(c.licence.ussd.menuOption));
          expect(closing.more, `${lang} ${kind} more`).toContain(ussdAscii(c.licence.ussd.backOption));
          expect(closing.notOfficial, `${lang} ${kind}`).toContain(ussdAscii(c.official.ussd.notOfficial.split('\n')[1]!));
          if (bank.length <= 8) for (const screen of [closing.notCalling, closing.official, closing.cannotCheck]) expect(screen).not.toContain('...');
        }
        expect(menuScreen(c, 'N'.repeat(16), false), `${lang} ${kind}`).toContain(ussdAscii(c.ussd.neverAsks));
      }
    }
  });

  it('OFF-9: a 24-character organisation name gets screens within 160 characters through the live handler', async () => {
    const h = await orgHarness({ tenant: { ...DEMOBANK_PUBLISHES, name: 'Lagos Union Savings Bank' } });
    for (const text of ['', '1', '2', '3', '3*02019000000', '3*09015550199', '3*12']) await dial(h, ALICE, text);
    expect(await dial(h, ALICE, '3*09015550199')).toContain('is not a Lagos Union Savings Bank number');
  });

  it('OFF-9: every option 3 screen fits 160 plain ASCII characters in every language, for a bank and for an agency', () => {
    const bank = 'X'.repeat(16);
    const number = '+234801234567890';
    for (const lang of LANGUAGES) {
      for (const kind of ['bank', 'agency'] as const) {
        const c = copyForOrg(lang, kind);
        const screens = {
          menu: `CON ${fill(c.ussd.menu, { bank })}\n${c.official.ussd.option}\n${c.ussd.neverAsks}`,
          enter: `CON ${c.official.ussd.enterNumber}`,
          official: `END ${fill(c.official.ussd.official, { number, bank })}`,
          notOfficial: `END ${fill(c.official.ussd.notOfficial, { number, bank })}`,
          bad: `END ${c.official.ussd.badNumber}`,
          notCalling: `END ${fill(c.call.not_calling.title, { bank })}\n${fill(c.call.not_calling.body, { bank })}`,
          cannotCheck: `END ${c.verdict.cannot_check.title}\n${fill(c.verdict.cannot_check.body, { bank })}`,
        };
        for (const [name, s] of Object.entries(screens)) expect(ussdAscii(s).length, `${lang} ${kind} ${name}: ${ussdAscii(s)}`).toBeLessThanOrEqual(USSD_MAX);
      }
      const o = copyFor(lang).official;
      for (const s of [o.ussd.option, o.ussd.enterNumber, o.ussd.official, o.ussd.notOfficial, o.ussd.badNumber, o.org.ussdMenu, o.org.ussdOption]) {
        expect(/^[\n\x20-\x7e]*$/.test(s), `${lang}: ${s} must be plain ASCII`).toBe(true);
      }
    }
  });

  it('OFF-10: on WhatsApp, a pasted number, email, handle or profile link gets the contact answer', async () => {
    const h = await orgHarness();
    const official = await whatsapp(h, '+234 906 000 0000');
    expect(official).toContain(copy.official.contact.official.title);
    expect(official).toContain(fill(copy.official.contact.official.body, { org: 'DemoBank', contact: copy.official.contact.kinds.phone }));
    expect(official).toContain(copy.official.contact.spoofNote);
    const scam = await whatsapp(h, 'https://wa.me/2349015550199');
    expect(scam).toContain(copy.official.contact.not_official.title);
    expect(scam).toContain(fill(copy.official.contact.not_official.bodyAny, { contact: copy.official.contact.kinds.whatsapp }));
    const handle = await whatsapp(h, '@demobank_care_desk');
    expect(handle).toContain(fill(copy.official.contact.impersonation, { org: 'DemoBank' }));
    expect(await whatsapp(h, 'x.com/DemoBankNG')).toContain(fill(copy.official.contact.official.body, { org: 'DemoBank', contact: 'X account' }));
    expect(await whatsapp(h, 'DemoBank: call 0809 555 0101 now to unblock your account')).toContain(copy.verdict.not_confirmed.title);
    await whatsapp(h, 'LANG PCM');
    expect(await whatsapp(h, SCAM_WHATSAPP)).toContain(copyFor('pcm').official.contact.not_official.title);
  });

  it('OFF-11: no new fixed text asks for a secret, and no warning reassures', () => {
    for (const lang of LANGUAGES) {
      const c = copyFor(lang).official;
      const strings = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : strings(v as object)));
      for (const s of strings(c)) expect(asksForSecret(s), `${lang}: ${s}`).toBe(false);
      for (const w of [c.contact.not_official.body, c.contact.not_official.bodyAny, c.contact.impersonation, c.apps.apk, c.apps.fakeApp, c.ussd.notOfficial]) {
        expect(w.toLowerCase(), `${lang}: ${w}`).not.toMatch(/\b(genuine|safe|verified|legit)\b/);
      }
    }
  });
});

describe('console: the fake customer care step (decision 0014)', () => {
  it('OFF-12: the demo bank\'s scam customer care contact is not one it publishes', () => {
    expect(DEMO_BANKS.demobank!.fakeCustomerCare).toBeDefined();
    expect(demoTenant(DEMO_BANKS.demobank!).officialContacts?.whatsapp).not.toContain(DEMO_BANKS.demobank!.fakeCustomerCare!.whatsapp);
  });

  it('OFF-12: the sandbox console runs the demo bank alone and runs the fake customer care step', async () => {
    const sb = createSandbox();
    const call = async (method: string, path: string, body?: unknown, token?: string) =>
      sb.handle(method, new URL(path, 'https://gaskiyya.test'), body, token ? `Bearer ${token}` : null) as Promise<{ status: number; body: any }>;
    const config = (await call('GET', '/sim/config')).body;
    expect(config.orgs.map((o: { id: string }) => o.id)).toEqual(['demobank']);
    const { token } = (await call('POST', '/sim/customer-token', { phone: ALICE })).body;
    const care = await call('POST', '/sim/send-fake-care', { phone: ALICE });
    expect(care.body.item.text).toContain(`wa.me/${care.body.contact.whatsapp.slice(1)}`);
    const verdict = await call('POST', '/sim/registry/v1/verify/contact', { contact: `https://wa.me/${care.body.contact.whatsapp.slice(1)}` }, token);
    expect(verdict.body).toMatchObject({ verdict: 'not_official', organisation: null });
    expect((await call('POST', '/sim/registry/v1/verify/contact', { contact: `@${care.body.contact.handle}` }, token)).body).toMatchObject({ reasons: ['impersonation', 'not_registered'] });
    expect((await call('POST', '/sim/registry/v1/verify/contact', { contact: '+2349060000000' }, token)).body).toMatchObject({ verdict: 'official', matches: [{ id: 'demobank' }] });
    expect((await call('POST', '/sim/registry/v1/verify/contact', { contact: 'hello' }, token)).status).toBe(422);
  });

  it('OFF-12: the bank simulator sends as another organisation with its own client, and that organisation\'s customer sees it confirmed', async () => {
    const simPort = await freePort();
    const sim0 = `http://127.0.0.1:${simPort}/sim`;
    const sample = 'Road Safety Agency (demo): your vehicle licence ends on 31 Oct. Renew at https://roadsafety.example/renew or at any office.';
    const agency = { ...AGENCY, tokenKeysUrl: `${sim0}/.well-known/jwks.json` };
    const api = createSystem({
      tenants: [{ ...TENANT, ...DEMOBANK_PUBLISHES, tokenKeysUrl: `${sim0}/.well-known/jwks.json` }, agency],
      keys: StaticKeyService.random([TENANT.id, agency.id]),
      bankClients: [BANK_CLIENT, clientFor(agency.id)],
      tokenSecret: TOKEN_SECRET,
      logger: false,
    });
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    const apiUrl = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    const c = clientFor(agency.id);
    const sim = await buildSimulator({
      apiUrl,
      clientId: BANK_CLIENT.clientId,
      clientSecret: BANK_CLIENT.clientSecret,
      tenantId: TENANT.id,
      bankName: TENANT.name,
      demoLogin: true,
      logger: false,
      orgs: [{ tenantId: agency.id, name: agency.name, kind: 'agency', domain: agency.domains[0], clientId: c.clientId, clientSecret: c.clientSecret, sampleMessage: sample }],
      fakeCustomerCare: DEMO_BANKS.demobank!.fakeCustomerCare,
    });
    await sim.app.listen({ port: simPort, host: '127.0.0.1' });
    try {
      const post = (url: string, payload: unknown) => sim.app.inject({ method: 'POST', url, payload: payload as object });
      const sent = (await post('/sim/send', { phone: ALICE, org: agency.id })).json();
      expect(sent.item.text).toBe(sample);
      const agencyToken = (await sim.app.inject({ method: 'POST', url: `/sim/customer-token?tenant=${agency.id}`, payload: { phone: ALICE } })).json().token as string;
      const bankToken = (await post('/sim/customer-token', { phone: ALICE })).json().token as string;
      const verify = async (token: string) =>
        (await (await fetch(`${apiUrl}/v1/verify/message`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ contentDigest: contentDigest(sent.item.text) }) })).json()) as { verdict: string; bank?: string };
      expect(await verify(agencyToken)).toMatchObject({ verdict: 'confirmed', bank: agency.name });
      expect((await verify(bankToken)).verdict).toBe('not_confirmed');
      const inbox = (await sim.app.inject({ method: 'GET', url: '/sim/inbox', headers: { authorization: `Bearer ${agencyToken}` } })).json();
      expect(inbox.items.map((i: { from: string }) => i.from)).toEqual([agency.name]);
      expect((await post('/sim/send', { phone: ALICE, org: 'nobody' })).statusCode).toBe(400);
      expect((await sim.app.inject({ method: 'GET', url: '/sim/organisations' })).json().organisations.map((o: { kind: string }) => o.kind)).toEqual(['bank', 'agency']);
      const care = (await post('/sim/send-fake-care', { phone: ALICE })).json();
      const r = await sim.app.inject({ method: 'POST', url: '/sim/registry/v1/verify/contact', headers: { authorization: `Bearer ${bankToken}` }, payload: { contact: care.contact.whatsapp } });
      expect(r.json()).toMatchObject({ verdict: 'not_official' });
    } finally {
      await sim.app.close();
      await api.app.close();
    }
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}
