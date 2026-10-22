import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normaliseConsoleCode } from '../packages/api/src/console/access.ts';
import { ALERT, ALICE, harness, type Harness } from './helpers.ts';

const PASSWORD = 'test-admin-password-not-real';
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const REPORTS = [
  'Your DemoBank account is restricted. Restore access at https://demobank-restore.com today.',
  'Dear customer, BVN update required. Visit https://demobank-restore.com/bvn to avoid suspension.',
  'Final notice from DemoBank: verify your details at demobank-restore.com/secure',
];

type Res = Awaited<ReturnType<Harness['sys']['app']['inject']>>;

async function setup(opts: Parameters<typeof harness>[0] = {}) {
  const h = await harness({ admin: { password: PASSWORD, keyActivationSeconds: 0, masterKey: Buffer.alloc(32, 7) }, otherBank: true, ...opts });
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: PASSWORD } });
  const adminToken = r.json().token as string;
  const admin = (method: 'GET' | 'POST', url: string, payload?: unknown): Promise<Res> =>
    h.sys.app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { h, admin, adminToken };
}

async function codeOf(admin: Awaited<ReturnType<typeof setup>>['admin'], org: string): Promise<string> {
  const r = await admin('GET', `/v1/admin/orgs/${org}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().consoleCode as string;
}

const signIn = (h: Harness, code: string) => h.sys.app.inject({ method: 'POST', url: '/v1/console/session', payload: { code } });

const as = (h: Harness, token: string) => (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  h.sys.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe('bank console access codes', () => {
  it('CON-1: every registered organisation gets one six-character code, signed with its own key and unique', async () => {
    const { h, admin } = await setup();
    const demo = await codeOf(admin, 'demobank');
    const other = await codeOf(admin, 'otherbank');
    for (const c of [demo, other]) expect(c).toMatch(CODE_RE);
    expect(demo).not.toBe(other);

    // The code is HMAC("console:<org>:<generation>") under the organisation's hashing key.
    const mac = Buffer.from(h.sys.keys.keyed('demobank', 'console', 'demobank:1'), 'hex');
    expect(demo).toBe(Array.from(mac.subarray(0, 6), (b) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b & 31]).join(''));

    expect(JSON.stringify(await h.sys.store.dump())).not.toContain(demo);
    const history = (await admin('GET', '/v1/admin/orgs/demobank')).json().consoleCodes;
    expect(history).toEqual([expect.objectContaining({ status: 'active', generation: 1, hint: demo.slice(-2) })]);
    expect(JSON.stringify(history)).not.toContain(demo);
  });

  it('CON-2: a code signs in to the organisation that owns it and loads its profile, however it is typed', async () => {
    const { h, admin } = await setup();
    const code = await codeOf(admin, 'demobank');
    const typed = [code, code.toLowerCase(), `${code.slice(0, 3)} ${code.slice(3)}`, code.replace(/0/g, 'O').replace(/1/g, 'l')];
    for (const t of typed) {
      const r = await signIn(h, t);
      expect(r.statusCode, t).toBe(200);
      expect(r.json().org).toMatchObject({ id: 'demobank', name: 'DemoBank', kind: 'bank' });
    }
    const { token, org } = (await signIn(h, code)).json();
    expect(token).toMatch(/^gsc_/);
    expect(org).not.toHaveProperty('tokenKeys');
    expect((await as(h, token)('GET', '/v1/console/session')).json().org.domains).toEqual(h.sys.svc.tenant('demobank')!.domains);
  });

  it('CON-3: a session never sees another organisation\'s data', async () => {
    const { h, admin } = await setup();
    await h.register(ALICE, ALERT);
    const demo = as(h, (await signIn(h, await codeOf(admin, 'demobank'))).json().token);
    const otherIn = (await signIn(h, await codeOf(admin, 'otherbank'))).json();
    const other = as(h, otherIn.token);
    expect(otherIn.org).toMatchObject({ id: 'otherbank', name: 'OtherBank' });
    expect((await demo('GET', '/v1/console/metrics')).json().registrations).toBe(1);
    expect((await other('GET', '/v1/console/metrics')).json().registrations).toBe(0);
  });

  it('CON-4: no code, a wrong code or another kind of token opens nothing', async () => {
    const { h, admin, adminToken } = await setup();
    const code = await codeOf(admin, 'demobank');
    const wrong = code.slice(0, 5) + (code.endsWith('A') ? 'B' : 'A');
    for (const bad of [wrong, 'ABC12', 'ABCDEFG', 'not a code', '']) expect([400, 401], bad).toContain((await signIn(h, bad)).statusCode);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/console/metrics' })).statusCode).toBe(401);
    expect((await as(h, adminToken)('GET', '/v1/console/metrics')).statusCode).toBe(401);
    expect((await as(h, h.bankToken)('GET', '/v1/console/metrics')).statusCode).toBe(401);
    const token = (await signIn(h, code)).json().token;
    expect((await as(h, token)('GET', '/v1/admin/orgs')).statusCode).toBe(401);
    expect((await as(h, token)('GET', '/v1/metrics')).statusCode).toBe(401);
  });

  it('CON-5: regenerating a code refuses the old one, signs its sessions out and is audited', async () => {
    const { h, admin } = await setup();
    const old = await codeOf(admin, 'demobank');
    const session = as(h, (await signIn(h, old)).json().token);
    const r = await admin('POST', '/v1/admin/orgs/demobank/console-code/regenerate');
    expect(r.statusCode, r.body).toBe(200);
    const fresh = r.json().consoleCode as string;
    expect(fresh).toMatch(CODE_RE);
    expect(fresh).not.toBe(old);
    expect((await session('GET', '/v1/console/metrics')).statusCode).toBe(401);
    expect((await signIn(h, old)).statusCode).toBe(401);
    expect((await signIn(h, fresh)).json().org.id).toBe('demobank');
    expect(r.json().consoleCodes.map((c: { status: string }) => c.status)).toEqual(['active', 'revoked']);
    const audit = (await admin('GET', '/v1/admin/audit?org=demobank')).json().entries;
    expect(audit.some((e: { action: string }) => e.action === 'console_code.regenerate')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(fresh);
  });

  it('CON-6: a suspended organisation cannot sign in, and open sessions stop working', async () => {
    const { h, admin } = await setup();
    const code = await codeOf(admin, 'demobank');
    const session = as(h, (await signIn(h, code)).json().token);
    expect((await admin('POST', '/v1/admin/orgs/demobank/suspend', { reason: 'Contract paused' })).statusCode).toBe(200);
    expect((await signIn(h, code)).statusCode).toBe(403);
    expect((await session('GET', '/v1/console/metrics')).statusCode).toBe(403);
  });

  it('CON-7: the fraud desk works from the console, approvals are audited, and staff IPs stay hidden', async () => {
    const { h, admin } = await setup();
    const session = as(h, (await signIn(h, await codeOf(admin, 'demobank'))).json().token);
    const auth = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
    for (const t of REPORTS) {
      expect((await h.sys.app.inject({ method: 'POST', url: '/v1/reports', headers: auth, payload: { maskedText: t, consent: true, indicators: ['non_bank_link', 'urgency_or_threat'] } })).statusCode).toBe(201);
    }
    expect((await session('POST', '/v1/console/agent/run')).statusCode).toBe(200);
    const [c] = (await session('GET', '/v1/console/campaigns')).json().campaigns;
    expect((await session('POST', `/v1/console/campaigns/${c.id}/approve`, {})).statusCode).toBe(400);
    const ok = await session('POST', `/v1/console/campaigns/${c.id}/approve`, { analyst: 'Aisha Bello' });
    expect(ok.json().advisory).toMatchObject({ status: 'approved', approvedBy: 'Aisha Bello' });
    const activity = (await session('GET', '/v1/console/activity')).json().entries;
    expect(activity.find((e: { action: string }) => e.action === 'console.advisory_approve')).toMatchObject({ target: c.id });
    expect(activity.every((e: object) => !('ip' in e))).toBe(true);
  });

  it('CON-8: guessing is limited per address and across all addresses', async () => {
    const { h } = await setup({ admin: { password: PASSWORD, keyActivationSeconds: 0, loginRateLimit: 3 } });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await signIn(h, randomBytes(4).toString('hex').slice(0, 6).toUpperCase())).statusCode);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);

    const g = await setup();
    let locked = false;
    for (let i = 0; i < 320 && !locked; i++) {
      const r = await g.h.sys.app.inject({ method: 'POST', url: '/v1/console/session', payload: { code: 'ZZZZZZ' }, remoteAddress: `10.0.${i >> 8}.${i & 255}` });
      locked = r.statusCode === 429;
    }
    expect(locked).toBe(true);
    const code = await codeOf(g.admin, 'demobank');
    expect((await g.h.sys.app.inject({ method: 'POST', url: '/v1/console/session', payload: { code }, remoteAddress: '10.9.9.9' })).statusCode).toBe(429);
  });

  it('CON-9: onboarding an organisation issues its code at once, and only a demo server shows the demo code', async () => {
    const { h, admin } = await setup();
    const created = await admin('POST', '/v1/admin/orgs', {
      id: 'firstcity',
      name: 'First City Bank',
      kind: 'bank',
      domains: ['firstcity.example'],
      senderIds: ['FirstCity'],
      tokenKeys: { keys: [{ kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0', kid: 'k1' }] },
      mode: 'live',
    });
    expect(created.statusCode, created.body).toBe(201);
    const code = created.json().consoleCode as string;
    expect(code).toMatch(CODE_RE);
    expect((await signIn(h, code)).json().org).toMatchObject({ id: 'firstcity', name: 'First City Bank' });
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/console/demo' })).statusCode).toBe(404);

    const demo = await setup({ consoleDemoTenantId: 'demobank' });
    const shown = await demo.h.sys.app.inject({ method: 'GET', url: '/v1/console/demo' });
    expect(shown.json()).toEqual({ org: { id: 'demobank', name: 'DemoBank' }, code: await codeOf(demo.admin, 'demobank') });
  });

  it('CON-10: the lookup hash is keyed with a server secret, so stored hashes cannot be searched offline', async () => {
    const { h, admin } = await setup();
    const code = await codeOf(admin, 'demobank');
    const plain = createHmac('sha256', 'wrong-secret').update(`gaskiyya-console:${code}`).digest('hex');
    const ids = (await h.sys.store.listConsoleCodes('demobank')).map((c) => c.idHash);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(plain);
    expect(normaliseConsoleCode(' ab-c1 2z ')).toBe('ABC12Z');
  });
});

describe('bank console: editing the organisation', () => {
  it('CON-11: a bank edits its own contacts, apps, alert emails and technical contact; the change is checked, applied and audited', async () => {
    const { h, admin } = await setup();
    const { token } = (await signIn(h, await codeOf(admin, 'demobank'))).json();
    const patch = (payload: unknown) => h.sys.app.inject({ method: 'PATCH', url: '/v1/console/organisation', headers: { authorization: `Bearer ${token}` }, payload: payload as object });
    const r = await patch({
      officialContacts: { phones: ['+2342019990000'], whatsapp: ['+2349019990000'], emails: ['care@demobank.ng'], social: [{ platform: 'x', handle: 'DemoBankNG' }] },
      officialApps: { android: ['ng.demobank.mobile'], ios: [] },
      alertEmails: ['fraud@demobank.ng'],
      technicalContact: { name: 'Ada Obi', email: 'ada@demobank.ng' },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().org).toMatchObject({ alertEmails: ['fraud@demobank.ng'], technicalContact: { name: 'Ada Obi' }, officialContacts: { phones: ['+2342019990000'] } });
    expect(h.sys.svc.tenant('demobank')!.alertEmails).toEqual(['fraud@demobank.ng']);
    const contact = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/contact', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` }, payload: { contact: '+2342019990000' } });
    expect(contact.json()).toMatchObject({ verdict: 'official', matches: [{ id: 'demobank' }] });
    const audit = (await as(h, token)('GET', '/v1/console/activity')).json().entries;
    expect(audit[0]).toMatchObject({ action: 'org.update', details: { fields: expect.arrayContaining(['officialContacts', 'alertEmails']) } });
  });

  it('CON-12: domains, sender IDs, name and features stay with Gaskiyya, and bad values or another organisation are refused', async () => {
    const { h, admin } = await setup();
    const { token } = (await signIn(h, await codeOf(admin, 'demobank'))).json();
    const patch = (payload: unknown, bearer = token) => h.sys.app.inject({ method: 'PATCH', url: '/v1/console/organisation', headers: { authorization: `Bearer ${bearer}` }, payload: payload as object });
    for (const locked of [{ domains: ['evil.example'] }, { senderIds: ['DemoBank'] }, { name: 'Other' }, { features: { calls: false } }, { bankCode: '999999' }]) {
      expect((await patch(locked)).statusCode, JSON.stringify(locked)).toBe(400);
    }
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ officialContacts: { phones: ['not a number'] } })).json()).toMatchObject({ code: 'invalid_organisation' });
    expect(h.sys.svc.tenant('demobank')!.domains).not.toContain('evil.example');
    expect((await patch({ alertEmails: ['x@y.ng'] }, 'gsc_not_a_session')).statusCode).toBe(401);
  });
});

describe('admin sign-in page', () => {
  it('ADM-FILL: fills in the local admin login on this machine only, never for staff stored as hashes', async () => {
    const { h } = await setup();
    const local = await h.sys.app.inject({ method: 'GET', url: '/v1/admin/login-hint' });
    expect(local.statusCode).toBe(200);
    expect(local.json()).toEqual({ username: 'admin', password: PASSWORD });
    expect(local.headers['cache-control']).toBe('no-store');
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/admin/login-hint', remoteAddress: '203.0.113.9' })).statusCode).toBe(404);
  });
});

describe('registry seeding and bank registration', () => {
  it('SEED-1: organisations configured in GASKIYA_TENANTS are stored in the registry once, with live settings left to the configuration', async () => {
    const { h, admin } = await setup();
    const stored = await h.sys.store.getOrg('demobank');
    expect(stored).toMatchObject({ id: 'demobank', source: 'env', status: 'active', notes: 'Seeded from GASKIYA_TENANTS' });
    expect(stored!.profile).toMatchObject({ name: 'DemoBank', domains: h.sys.svc.tenant('demobank')!.domains });
    for (const f of ['customerTokenUrl', 'demoInboxUrl', 'tokenKeysUrl', 'tokenKeys']) expect(stored!.profile).not.toHaveProperty(f);
    expect(h.sys.svc.tenant('demobank')!.tokenKeys).toBeTruthy();
    expect(await h.sys.store.getOrg('otherbank')).toMatchObject({ id: 'otherbank', source: 'env' });

    const before = stored!.updatedAt;
    expect(await h.sys.registry.seedEnvOrgs()).toEqual([]);
    expect((await h.sys.store.getOrg('demobank'))!.updatedAt).toBe(before);
    const audit = (await admin('GET', '/v1/admin/audit?org=demobank')).json().entries;
    expect(audit.filter((e: { action: string }) => e.action === 'org.seed')).toHaveLength(1);
  });

  it('REG-1: a bank registered in the admin dashboard can register messages, its customers can check them, and its staff can sign in', async () => {
    const { h, admin } = await setup();
    const { publicKey, privateKey } = await import('jose').then((j) => j.generateKeyPair('ES256'));
    const jwk = { ...(await import('jose').then((j) => j.exportJWK(publicKey))), kid: 'nb1', alg: 'ES256', use: 'sig' };
    const created = await admin('POST', '/v1/admin/orgs', {
      id: 'novabank',
      name: 'Nova Bank',
      legalName: 'Nova Bank Plc',
      kind: 'bank',
      bankCode: '999777',
      domains: ['novabank.example'],
      senderIds: ['NovaBank'],
      officialContacts: { phones: ['+2342017770000'], whatsapp: [], emails: ['care@novabank.example'], social: [] },
      officialApps: { android: [], ios: [] },
      alertEmails: ['fraud@novabank.example'],
      tokenKeys: { keys: [jwk] },
      customerTokenUrl: 'https://api.novabank.example/gaskiyya/customer-token',
      mode: 'live',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await h.sys.store.getOrg('novabank')).toMatchObject({ id: 'novabank', source: 'admin' });

    const client = await admin('POST', '/v1/admin/orgs/novabank/clients', { label: 'Notifications' });
    expect(client.statusCode, client.body).toBe(201);
    const { client: c, clientSecret } = client.json();
    const tok = await h.sys.app.inject({ method: 'POST', url: '/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: c.clientId, client_secret: clientSecret } });
    expect(tok.statusCode, tok.body).toBe(200);
    const bank = { authorization: `Bearer ${tok.json().access_token}` };

    const { contentDigest } = await import('@gaskiya/canonical');
    const text = 'NovaBank: your OTP is 482913. Do not share it.';
    const reg = await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: { recipient: ALICE, channel: 'sms', contentDigest: await contentDigest(text), category: 'otp', hasLink: false, linkDomains: [], asksCallback: false, sentAt: h.clock.now.toISOString() } });
    expect(reg.statusCode, reg.body).toBe(202);

    const { SignJWT } = await import('jose');
    const customer = await new SignJWT({ accts: [] }).setProtectedHeader({ alg: 'ES256', kid: 'nb1' }).setIssuer('novabank').setSubject(ALICE).setAudience('gaskiya').setIssuedAt().setExpirationTime('300s').sign(privateKey);
    const check = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: { authorization: `Bearer ${customer}` }, payload: { contentDigest: await contentDigest(text) } });
    expect(check.json().verdict).toBe('confirmed');

    const code = created.json().consoleCode as string;
    const session = (await signIn(h, code)).json();
    expect(session.org).toMatchObject({ id: 'novabank', name: 'Nova Bank' });
    expect((await as(h, session.token)('GET', '/v1/console/metrics')).json().registrations).toBe(1);
  });
});
