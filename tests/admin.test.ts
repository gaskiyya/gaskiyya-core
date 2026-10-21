import { createHmac, randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { contentDigest, receiptDigest } from '@gaskiya/canonical';
import { configFromEnv, MemoryWebhookSender, SimulatedMno, type Store } from '../packages/api/src/index.ts';
import { ALERT, ALICE, BANK_CLIENT, BOB, demoEnv, harness, testStore, type Harness } from './helpers.ts';
const PASSWORD = 'test-admin-password-not-real';
const MASTER = Buffer.alloc(32, 7);
const NEW_ORG = 'firstcity';
const CODE = '999123';
const ACCOUNT = '0123456789';

type Inject = Harness['sys']['app']['inject'];
type Res = Awaited<ReturnType<Inject>>;

async function signIn(h: Harness, password = PASSWORD): Promise<string> {
  const r = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password } });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

function as(h: Harness, token: string) {
  return (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<Res> =>
    h.sys.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

interface OrgKeys {
  jwk: JWK;
  privateKey: CryptoKey;
}

async function orgKeys(): Promise<OrgKeys> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  return { jwk: { ...(await exportJWK(publicKey)), kid: 'fc1', alg: 'ES256', use: 'sig' }, privateKey };
}

function newOrg(keys: OrgKeys, extra: Record<string, unknown> = {}) {
  return {
    id: NEW_ORG,
    name: 'First City Bank',
    legalName: 'First City Bank Plc',
    kind: 'bank',
    bankCode: CODE,
    domains: ['firstcity.example'],
    senderIds: ['FirstCity'],
    officialContacts: { phones: ['+2342019990000'], whatsapp: ['+2349069990000'], emails: ['care@firstcity.example'], social: [{ platform: 'x', handle: '@FirstCityNG' }] },
    officialApps: { android: ['ng.firstcity.mobile'], ios: ['1234567890'] },
    alertEmails: ['fraud@firstcity.example'],
    tokenKeys: { keys: [keys.jwk] },
    customerTokenUrl: 'https://api.firstcity.example/gaskiyya/customer-token',
    technicalContact: { name: 'Ada Eze', email: 'ada@firstcity.example', phone: '+2348030000000' },
    mode: 'live',
    ...extra,
  };
}

const customerToken = (k: OrgKeys, phone: string, accts: string[] = []) =>
  new SignJWT({ accts }).setProtectedHeader({ alg: 'ES256', kid: 'fc1' }).setIssuer(NEW_ORG).setSubject(phone).setAudience('gaskiya').setIssuedAt().setExpirationTime('300s').sign(k.privateKey);

async function setup(opts: Parameters<typeof harness>[0] = {}) {
  const webhooks = new MemoryWebhookSender();
  const h = await harness({ admin: { password: PASSWORD, masterKey: MASTER, webhooks, keyActivationSeconds: 0 }, ...opts });
  const token = await signIn(h);
  return { h, admin: as(h, token), webhooks, token };
}

async function onboard(admin: ReturnType<typeof as>, keys: OrgKeys, extra: Record<string, unknown> = {}) {
  const created = await admin('POST', '/v1/admin/orgs', newOrg(keys, extra));
  expect(created.statusCode, created.body).toBe(201);
  const c = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/clients`, { label: 'Notification service' });
  expect(c.statusCode).toBe(201);
  return { clientId: c.json().client.clientId as string, clientSecret: c.json().clientSecret as string, created: created.json() };
}

async function bankToken(h: Harness, clientId: string, clientSecret: string): Promise<Res> {
  return h.sys.app.inject({ method: 'POST', url: '/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret } });
}

const message = (recipient: string, text: string, sentAt: string) => ({
  recipient,
  channel: 'sms',
  contentDigest: contentDigest(text),
  category: 'transaction_alert',
  hasLink: false,
  linkDomains: [],
  asksCallback: false,
  sentAt,
});

describe('admin dashboard (decision 0020)', () => {
  it('ADM-1: admin routes need a staff session; bank tokens, wrong passwords and no session are refused, and sign-in is rate limited', async () => {
    const h = await harness({ admin: { password: PASSWORD, masterKey: MASTER, loginRateLimit: 3 } });
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/admin/overview' })).statusCode).toBe(401);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/admin/orgs', headers: { authorization: `Bearer ${h.bankToken}` } })).statusCode).toBe(401);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/admin/orgs', headers: { authorization: 'Bearer gsa_forged' } })).statusCode).toBe(401);
    const wrong = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: 'wrong-password-123' } });
    expect(wrong.statusCode).toBe(401);
    const unknown = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'mallory', password: 'wrong-password-123' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
    const token = await signIn(h);
    const limited = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: PASSWORD } });
    expect(limited.statusCode).toBe(429);
    const admin = as(h, token);
    expect((await admin('GET', '/v1/admin/session')).json().username).toBe('admin');
    const audit = (await admin('GET', '/v1/admin/audit')).json().entries as { action: string; actor: string }[];
    expect(audit.filter((e) => e.action === 'admin.login_failed').map((e) => e.actor).sort()).toEqual(['admin', 'mallory']);
    expect((await admin('POST', '/v1/admin/session/logout', {})).statusCode).toBe(200);
    expect((await admin('GET', '/v1/admin/overview')).statusCode).toBe(401);
  });

  it('ADM-1: with no staff login configured the admin routes do not exist, and the existing demo admin routes are unchanged', async () => {
    const h = await harness();
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: PASSWORD } })).statusCode).toBe(404);
    const reset = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/reset', headers: { authorization: `Bearer ${h.bankToken}` } });
    expect(reset.statusCode).toBe(200);
  });

  it('ADM-2: the onboarding form is checked with the start-up validators, and nothing is created until every problem is fixed', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const bad = newOrg(keys, {
      officialContacts: { phones: ['12'], emails: ['not-an-email'] },
      bankCode: '999001',
      tokenKeys: undefined,
      technicalContact: { name: 'Ada', email: 'nope' },
    });
    const v = await admin('POST', '/v1/admin/orgs/validate', bad);
    expect(v.statusCode).toBe(200);
    const errors = v.json().errors as string[];
    expect(errors.some((e) => e.startsWith('officialContacts.phones'))).toBe(true);
    expect(errors.some((e) => e.startsWith('officialContacts.emails'))).toBe(true);
    expect(errors.some((e) => /bankCode 999001 is used by demobank/.test(e))).toBe(true);
    expect(errors.some((e) => /tokenKeysUrl or tokenKeys is required/.test(e))).toBe(true);
    expect(errors.some((e) => e.startsWith('technicalContact.email'))).toBe(true);
    const shape = await admin('POST', '/v1/admin/orgs/validate', { ...newOrg(keys), id: 'Bad Id', domains: [] });
    expect((shape.json().errors as string[]).some((e) => e.startsWith('id:'))).toBe(true);
    expect((shape.json().errors as string[]).some((e) => e.startsWith('domains:'))).toBe(true);
    expect((await admin('POST', '/v1/admin/orgs', bad)).statusCode).toBe(400);
    expect((await admin('POST', '/v1/admin/orgs', { ...newOrg(keys), id: 'demobank' })).statusCode).toBe(409);
    expect(h.sys.tenants.has(NEW_ORG)).toBe(false);
    expect((await admin('POST', '/v1/admin/orgs/validate', newOrg(keys))).json()).toEqual({ ok: true, errors: [] });
  });

  it('ADM-3: a client secret is generated on the server, shown once, and stored only as a scrypt hash; audit entries hold no secret', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    expect(clientSecret).toMatch(/^gsk_live_[A-Za-z0-9_-]{43}$/);
    const detail = await admin('GET', `/v1/admin/orgs/${NEW_ORG}`);
    expect(detail.body).not.toContain(clientSecret);
    expect(detail.json().clients[0]).toMatchObject({ clientId, status: 'active', source: 'admin', secretHint: `${clientSecret.slice(0, 13)}...${clientSecret.slice(-4)}` });
    const stored = await h.sys.store.getApiClient(clientId);
    expect(stored!.secretHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(JSON.stringify(stored)).not.toContain(clientSecret);
    const audit = await admin('GET', '/v1/admin/audit');
    expect(audit.body).not.toContain(clientSecret);
    expect(audit.body).not.toContain(PASSWORD);
    expect((audit.json().entries as { action: string }[]).map((e) => e.action)).toEqual(expect.arrayContaining(['org.create', 'client.create', 'admin.login']));
    expect(detail.json().keys).toEqual([expect.objectContaining({ version: 1, state: 'current', source: 'admin' })]);
    expect(JSON.stringify(detail.json().keys)).not.toMatch(/sealed|"data"|"iv"/);
    const keyRecord = (await h.sys.store.listTenantKeys()).find((k) => k.tenantId === NEW_ORG)!;
    expect(keyRecord.sealed).toBeTruthy();
  });

  it('ADM-4: an organisation created in the dashboard uses every documented bank API at once, and its customers verify against it, with no restart', async () => {
    const { h, admin } = await setup({ simSwap: new SimulatedMno() });
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    const tok = await bankToken(h, clientId, clientSecret);
    expect(tok.statusCode).toBe(200);
    const bank = { authorization: `Bearer ${tok.json().access_token}` };
    const now = h.clock.now.toISOString();
    const text = 'FirstCity: Debit NGN5,000.00 Acc ***6789';
    const reg = await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: message(ALICE, text, now) });
    expect(reg.statusCode).toBe(202);
    const batch = await h.sys.app.inject({ method: 'POST', url: '/v1/messages/batch', headers: bank, payload: { messages: [message(BOB, 'FirstCity: your card is ready', now)] } });
    expect(batch.statusCode).toBe(202);
    const alice = { authorization: `Bearer ${await customerToken(keys, ALICE, [ACCOUNT])}` };
    const me = await h.sys.app.inject({ method: 'GET', url: '/v1/me', headers: alice });
    expect(me.json().bank).toMatchObject({ id: NEW_ORG, name: 'First City Bank', bankCode: CODE });
    const check = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: alice, payload: { contentDigest: contentDigest(text) } });
    expect(check.json()).toMatchObject({ verdict: 'confirmed', bank: 'First City Bank', category: 'transaction_alert' });
    const bob = { authorization: `Bearer ${await customerToken(keys, BOB)}` };
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: bob, payload: { contentDigest: contentDigest(text) } })).json().verdict).toBe('not_confirmed');
    const call = await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: bank, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'agent-17' } });
    expect(call.statusCode).toBe(201);
    const open = await h.sys.app.inject({ method: 'GET', url: '/v1/calls/open', headers: alice });
    expect(open.json()).toMatchObject({ verdict: 'calling', call: { code: call.json().code } });
    const ended = await h.sys.app.inject({ method: 'PATCH', url: `/v1/calls/${call.json().id}`, headers: bank, payload: { status: 'ended' } });
    expect(ended.statusCode).toBe(200);
    const receipt = { amountKobo: 500_000, reference: 'FT2610210001', valueDate: '2026-10-21', beneficiaryAccount: ACCOUNT, beneficiaryBank: CODE };
    const digest = receiptDigest(receipt);
    const rr = await h.sys.app.inject({ method: 'POST', url: '/v1/receipts', headers: bank, payload: { receiptDigest: digest, beneficiaryAccount: ACCOUNT, beneficiaryBank: CODE } });
    expect(rr.json().stored).toBe(true);
    const rc = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/receipt', headers: alice, payload: { receiptDigest: digest, beneficiaryAccount: ACCOUNT } });
    expect(rc.json().verdict).toBe('received');
    const sim = await h.sys.app.inject({ method: 'POST', url: '/v1/sim-swap/check', headers: bank, payload: { phone: ALICE } });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().status).toBe('not_swapped');
    const contact = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/contact', headers: alice, payload: { contact: '+2342019990000' } });
    expect(contact.json()).toMatchObject({ verdict: 'official', matches: [expect.objectContaining({ id: NEW_ORG })] });
    const official = await h.sys.app.inject({ method: 'GET', url: '/v1/official-contacts', headers: alice });
    expect(official.json()).toMatchObject({ bankId: NEW_ORG, phones: expect.arrayContaining(['+2342019990000']) });
    const link = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: alice, payload: { url: 'https://www.firstcity.example/app' } });
    expect(link.json().verdict).toBe('belongs');
    const orgs = (await h.sys.app.inject({ method: 'GET', url: '/v1/organisations' })).json().organisations as { id: string }[];
    expect(orgs.map((o) => o.id)).toContain(NEW_ORG);
    const banks = (await h.sys.app.inject({ method: 'GET', url: '/v1/banks' })).json().banks as { id: string; customerTokenUrl: string }[];
    expect(banks.find((b) => b.id === NEW_ORG)?.customerTokenUrl).toBe('https://api.firstcity.example/gaskiyya/customer-token');
    for (const url of ['/v1/campaigns', '/v1/metrics', '/v1/registration-alerts']) {
      expect((await h.sys.app.inject({ method: 'GET', url, headers: bank })).statusCode, url).toBe(200);
    }
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: bank })).json().registrations).toBe(2);
  });

  it('ADM-5: a revoked client is refused at once, including tokens it already holds; rotation cuts off the old secret unless an overlap is given', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    const first = (await bankToken(h, clientId, clientSecret)).json().access_token as string;
    const reg = () => h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: { authorization: `Bearer ${first}` }, payload: message(ALICE, `hello ${randomBytes(4).toString('hex')}`, h.clock.now.toISOString()) });
    expect((await reg()).statusCode).toBe(202);
    const r1 = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/clients/${clientId}/rotate`, { graceMinutes: 60 });
    const second = r1.json().clientSecret as string;
    expect(second).not.toBe(clientSecret);
    expect((await bankToken(h, clientId, clientSecret)).statusCode).toBe(200);
    expect((await bankToken(h, clientId, second)).statusCode).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 61 * 60_000);
    expect((await bankToken(h, clientId, clientSecret)).statusCode).toBe(401);
    const before = (await bankToken(h, clientId, second)).json().access_token as string;
    h.clock.now = new Date(h.clock.now.getTime() + 2000);
    const r2 = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/clients/${clientId}/rotate`, { graceMinutes: 0 });
    const third = r2.json().clientSecret as string;
    expect((await bankToken(h, clientId, second)).statusCode).toBe(401);
    const stale = await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${before}` } });
    expect(stale.statusCode).toBe(401);
    h.clock.now = new Date(h.clock.now.getTime() + 2000);
    const fresh = (await bankToken(h, clientId, third)).json().access_token as string;
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${fresh}` } })).statusCode).toBe(200);
    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/clients/${clientId}/revoke`, {})).statusCode).toBe(200);
    expect((await bankToken(h, clientId, third)).statusCode).toBe(401);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${fresh}` } })).statusCode).toBe(401);
    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/clients/${clientId}/restore`, {})).statusCode).toBe(409);
  });

  it('ADM-6: a suspended organisation fails closed: checks answer cannot check, never confirmed, and its API calls are refused; reactivating restores both', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    const token = (await bankToken(h, clientId, clientSecret)).json().access_token as string;
    const bank = { authorization: `Bearer ${token}` };
    const text = 'FirstCity: Debit NGN1,000.00';
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: message(ALICE, text, h.clock.now.toISOString()) })).statusCode).toBe(202);
    await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: bank, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a1' } });
    const alice = { authorization: `Bearer ${await customerToken(keys, ALICE)}` };
    const verify = () => h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: alice, payload: { contentDigest: contentDigest(text) } });
    expect((await verify()).json().verdict).toBe('confirmed');

    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/suspend`, {})).statusCode).toBe(400);
    const s = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/suspend`, { reason: 'Contract under review' });
    expect(s.json().org.status).toBe('suspended');
    expect((await verify()).json()).toEqual({ verdict: 'cannot_check' });
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/calls/open', headers: alice })).json().verdict).toBe('cannot_check');
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/verify/contact', headers: alice, payload: { contact: '+2342019990000' } })).json().verdict).toBe('cannot_check');
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: alice, payload: { url: 'https://firstcity.example' } })).statusCode).toBe(503);
    expect((await h.sys.app.inject({ method: 'GET', url: '/v1/official-contacts', headers: alice })).statusCode).toBe(503);
    const blocked = await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: message(ALICE, 'more', h.clock.now.toISOString()) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('org_suspended');
    expect((await bankToken(h, clientId, clientSecret)).statusCode).toBe(403);
    expect(((await h.sys.app.inject({ method: 'GET', url: '/v1/banks' })).json().banks as { id: string }[]).map((b) => b.id)).not.toContain(NEW_ORG);
    expect((await h.register(ALICE, ALERT)).status).toBe(202);
    expect((await h.verify(ALICE, ALERT)).body.verdict).toBe('confirmed');

    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/reactivate`, {})).statusCode).toBe(200);
    expect((await verify()).json().verdict).toBe('confirmed');
    expect((await bankToken(h, clientId, clientSecret)).statusCode).toBe(200);
    const actions = ((await admin('GET', `/v1/admin/audit?org=${NEW_ORG}`)).json().entries as { action: string; details: Record<string, unknown> }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['org.suspend', 'org.reactivate']));
  });

  it('ADM-7: rotating a hashing key keeps old records confirming; retiring the old version makes them not confirmed, never confirmed', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    const bank = { authorization: `Bearer ${(await bankToken(h, clientId, clientSecret)).json().access_token}` };
    const alice = { authorization: `Bearer ${await customerToken(keys, ALICE)}` };
    const reg = (text: string) => h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: message(ALICE, text, h.clock.now.toISOString()) });
    const verify = async (text: string) => (await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: alice, payload: { contentDigest: contentDigest(text) } })).json().verdict;
    expect((await reg('under v1')).statusCode).toBe(202);
    const rotated = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/keys/rotate`, {});
    expect(rotated.json().keys.map((k: { version: number; state: string }) => [k.version, k.state])).toEqual([[2, 'current'], [1, 'previous']]);
    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/keys/rotate`, {})).json().keys[0].version).toBe(3);
    expect((await reg('under v3')).statusCode).toBe(202);
    expect(await verify('under v1')).toBe('confirmed');
    expect(await verify('under v3')).toBe('confirmed');
    const versions = ((await h.sys.store.dump()) as { messages: { tenantId: string; keyVersion: number }[] }).messages.filter((m) => m.tenantId === NEW_ORG).map((m) => m.keyVersion ?? 1);
    expect(versions.sort()).toEqual([1, 3]);
    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/keys/3/retire`, {})).statusCode).toBe(409);
    expect((await admin('POST', `/v1/admin/orgs/${NEW_ORG}/keys/1/retire`, {})).statusCode).toBe(200);
    expect(await verify('under v1')).toBe('not_confirmed');
    expect(await verify('under v3')).toBe('confirmed');
    expect((await h.register(ALICE, ALERT)).status).toBe(202);
    const env = await admin('POST', '/v1/admin/orgs/demobank/keys/rotate', {});
    expect(env.json().keys.map((k: { version: number; source: string }) => [k.version, k.source])).toEqual([[2, 'admin'], [1, 'env']]);
    expect((await h.verify(ALICE, ALERT)).body.verdict).toBe('confirmed');
  });

  it('ADM-7: a rotated key becomes current only after the activation delay, so every server has it first', async () => {
    const h = await harness({ admin: { password: PASSWORD, masterKey: MASTER, keyActivationSeconds: 60 } });
    const admin = as(h, await signIn(h));
    const r = await admin('POST', '/v1/admin/orgs/demobank/keys/rotate', {});
    expect(r.json().keys.map((k: { version: number; state: string }) => [k.version, k.state])).toEqual([[2, 'pending'], [1, 'current']]);
    expect(h.sys.keys.currentVersion('demobank')).toBe(1);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    expect(h.sys.keys.currentVersion('demobank')).toBe(2);
  });

  it('ADM-8: usage is counts only, by route and status, with recent errors; no message text or number is stored', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    const bank = { authorization: `Bearer ${(await bankToken(h, clientId, clientSecret)).json().access_token}` };
    const secretText = 'FirstCity: secret-marker-7731 debit';
    await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: message(ALICE, secretText, h.clock.now.toISOString()) });
    await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: { recipient: ALICE } });
    await h.sys.app.inject({ method: 'POST', url: `/v1/calls?note=${ALICE}`, headers: bank, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a' } });
    await new Promise((r) => setTimeout(r, 50));
    const d = (await admin('GET', `/v1/admin/orgs/${NEW_ORG}`)).json();
    const today = d.usage.at(-1);
    expect(today.calls).toBe(4);
    expect(today.errors).toBe(1);
    expect(today.byRoute).toMatchObject({ 'POST /v1/oauth/token': 1, 'POST /v1/messages': 2, 'POST /v1/calls': 1 });
    expect(today.byStatus).toMatchObject({ '400': 1, '202': 1 });
    expect(d.errors).toEqual([expect.objectContaining({ route: '/v1/messages', status: 400, code: 'invalid_request', clientId })]);
    expect(d.summary.usage.registrations).toBe(1);
    const overview = (await admin('GET', '/v1/admin/overview')).json();
    expect(overview.totals.apiCallsToday).toBeGreaterThanOrEqual(4);
    const everything = JSON.stringify([d, overview, await h.sys.store.dump(), await h.sys.store.apiErrors(NEW_ORG, 10), await h.sys.store.apiUsage(NEW_ORG, [today.day])]);
    expect(everything).not.toContain('secret-marker-7731');
    expect(everything).not.toContain(ALICE);
    expect(everything).not.toContain(ALICE.slice(1));
  });

  it('ADM-9: organisations from the environment can be suspended, and their configured clients revoked and restored', async () => {
    const { h, admin } = await setup();
    const list = (await admin('GET', '/v1/admin/orgs')).json().orgs as { id: string; source: string }[];
    expect(list).toEqual([expect.objectContaining({ id: 'demobank', source: 'env' })]);
    const revoke = await admin('POST', `/v1/admin/orgs/demobank/clients/${BANK_CLIENT.clientId}/revoke`, {});
    expect(revoke.json().client).toMatchObject({ source: 'env', status: 'revoked' });
    expect((await bankToken(h, BANK_CLIENT.clientId, BANK_CLIENT.clientSecret)).statusCode).toBe(401);
    expect((await h.register(ALICE, ALERT)).status).toBe(401);
    expect((await admin('POST', `/v1/admin/orgs/demobank/clients/${BANK_CLIENT.clientId}/rotate`, {})).statusCode).toBe(409);
    expect((await admin('POST', `/v1/admin/orgs/demobank/clients/${BANK_CLIENT.clientId}/restore`, {})).statusCode).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 2000);
    expect((await bankToken(h, BANK_CLIENT.clientId, BANK_CLIENT.clientSecret)).statusCode).toBe(200);
    const edit = await admin('PATCH', '/v1/admin/orgs/demobank', { alertEmails: ['desk@demobank.ng'], officialContacts: { phones: ['+2342010000000'] } });
    expect(edit.statusCode).toBe(200);
    expect(h.sys.tenants.get('demobank')!.alertEmails).toEqual(['desk@demobank.ng']);
    expect((await admin('POST', '/v1/admin/orgs/demobank/reset-profile', {})).json().org.alertEmails).toBeUndefined();
  });

  it('ADM-10: a switched-off feature answers 403 and an organisation rate limit answers 429', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys, { features: { calls: false }, limits: { bankApiPerMinute: 3 } });
    const bank = { authorization: `Bearer ${(await bankToken(h, clientId, clientSecret)).json().access_token}` };
    const call = await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: bank, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a' } });
    expect(call.statusCode).toBe(403);
    expect(call.json().code).toBe('feature_disabled');
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: bank })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
  });

  it('ADM-11: dashboard organisations, clients and keys survive a restart; without the master key their checks fail closed', async () => {
    const store: Store = testStore();
    const keys = await orgKeys();
    const text = 'FirstCity: kept across restarts';
    {
      const h = await harness({ store, admin: { password: PASSWORD, masterKey: MASTER } });
      const admin = as(h, await signIn(h));
      const { clientId, clientSecret } = await onboard(admin, keys);
      const bank = { authorization: `Bearer ${(await bankToken(h, clientId, clientSecret)).json().access_token}` };
      expect((await h.sys.app.inject({ method: 'POST', url: '/v1/messages', headers: bank, payload: message(ALICE, text, h.clock.now.toISOString()) })).statusCode).toBe(202);
      const again = await harness({ store, admin: { password: PASSWORD, masterKey: MASTER } });
      const alice = { authorization: `Bearer ${await customerToken(keys, ALICE)}` };
      expect((await again.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: alice, payload: { contentDigest: contentDigest(text) } })).json().verdict).toBe('confirmed');
      expect((await bankToken(again, clientId, clientSecret)).statusCode).toBe(200);
      const noKey = await harness({ store, admin: { password: PASSWORD, masterKey: null } });
      expect((await noKey.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: alice, payload: { contentDigest: contentDigest(text) } })).json().verdict).toBe('cannot_check');
      const noKeyAdmin = as(noKey, await signIn(noKey));
      const refused = await noKeyAdmin('POST', '/v1/admin/orgs', { ...newOrg(keys), id: 'secondbank', bankCode: undefined });
      expect(refused.statusCode).toBe(503);
      expect(refused.json().code).toBe('master_key_missing');
    }
  });

  it('ADM-12: an alert webhook gets a signing secret shown once, and each event is signed with it and carries no message content', async () => {
    const { h, admin, webhooks } = await setup();
    const keys = await orgKeys();
    await onboard(admin, keys);
    const set = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/webhook`, { url: 'https://hooks.firstcity.example/gaskiyya' });
    expect(set.statusCode).toBe(201);
    const secret = set.json().signingSecret as string;
    expect(secret).toMatch(/^whsec_/);
    expect((await admin('GET', `/v1/admin/orgs/${NEW_ORG}`)).body).not.toContain(secret);
    const test = await admin('POST', `/v1/admin/orgs/${NEW_ORG}/webhook/test`, {});
    expect(test.json()).toMatchObject({ ok: true, status: 200 });
    const sent = webhooks.sent.at(-1)!;
    const [t, v1] = sent.headers['x-gaskiyya-signature']!.split(',').map((p) => p.split('=')[1]!);
    expect(createHmac('sha256', secret).update(`${t}.${sent.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(sent.body)).toMatchObject({ type: 'test', tenantId: NEW_ORG });
    expect(JSON.stringify((await h.sys.store.getOrg(NEW_ORG))!.webhook)).not.toContain(secret);
  });

  it('ADM-13: no admin password, client secret or bearer token reaches the logs', async () => {
    const { h, admin } = await setup();
    const keys = await orgKeys();
    const { clientId, clientSecret } = await onboard(admin, keys);
    await bankToken(h, clientId, clientSecret);
    await h.sys.app.inject({ method: 'POST', url: '/v1/admin/session', payload: { username: 'admin', password: 'wrong-but-logged?' } });
    const logs = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(3);
    for (const s of [PASSWORD, clientSecret, 'wrong-but-logged?', 'Bearer ', 'gsa_']) expect(logs).not.toContain(s);
  });

  it('ADM-14: staff logins are configured safely: hashed in production, plain passwords for local use only, a 32-byte master key', async () => {
    const prod = { NODE_ENV: 'production', FIRESTORE_PROJECT_ID: 'p' };
    expect(() => configFromEnv(demoEnv({ ...prod, ADMIN_PASSWORD: 'long-enough-password' }))).toThrow(/ADMIN_PASSWORD is for local use/);
    expect(() => configFromEnv(demoEnv({ ADMIN_PASSWORD: 'short' }))).toThrow(/at least 12 characters/);
    expect(() => configFromEnv(demoEnv({ ADMIN_USERS: JSON.stringify([{ username: 'ada', passwordHash: 'plain' }]) }))).toThrow(/passwordHash must come from pnpm admin:hash/);
    expect(() => configFromEnv(demoEnv({ GASKIYA_MASTER_KEY: Buffer.alloc(16).toString('base64') }))).toThrow(/GASKIYA_MASTER_KEY must be 32 bytes/);
    const ok = configFromEnv(demoEnv({ ADMIN_PASSWORD: 'long-enough-password', GASKIYA_MASTER_KEY: MASTER.toString('base64') }));
    expect(ok.admin.plain?.username).toBe('admin');
    expect(ok.masterKey?.length).toBe(32);
    expect(configFromEnv(demoEnv()).adminSummary).toBe('off');
  });
});
