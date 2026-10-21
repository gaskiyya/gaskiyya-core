import { execFileSync } from 'node:child_process';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { canonicalReceipt, lagosDate, parseAmountToKobo, receiptDigest, ReceiptFieldError, type ReceiptFields } from '@gaskiya/canonical';
import { vectors } from '@gaskiya/test-vectors';
import { configFromEnv, createSystem, MemoryStore, StaticKeyService, type Store } from '../packages/api/src/index.ts';
import { decideReceiptVerdict } from '../packages/api/src/domain/verdict.ts';
import { flutterBin } from '../scripts/flutter-bin.ts';
import { demoEnv, testRateLimiters, testStore } from './helpers.ts';

const MERCHANT = '+2348012345678';
const MERCHANT_ACCOUNT = '8012345678';
const MERCHANT_SAVINGS = '2012345678';
const OTHER = '+2348098765432';
const OTHER_ACCOUNT = '8098765432';
const DEMOBANK_CODE = '999001';
const PAYBANK_CODE = '999002';
const SESSION = '000013261020130211123456789012';

const PAYBANK_CLIENT = { clientId: 'paybank-transfers', clientSecret: 'test-client-secret-not-real-0002', tenantId: 'paybank' };
const DEMOBANK_CLIENT = { clientId: 'demobank-notify', clientSecret: 'test-client-secret-not-real-0001', tenantId: 'demobank' };

async function receiptHarness(opts: { store?: Store; receiptTtlDays?: number; demobankCode?: string | null; guard?: { spikeMinCount: number; spikeFactor: number } } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const clock = { now: new Date('2026-10-20T12:02:11.000Z') };
  const logs: string[] = [];
  const store = opts.store ?? testStore();
  const demobankCode = opts.demobankCode === undefined ? DEMOBANK_CODE : opts.demobankCode;
  const sys = createSystem({
    tenants: [
      { id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], senderIds: ['DemoBank'], tokenKeys: { keys: [jwk] }, ...(demobankCode ? { bankCode: demobankCode } : {}) },
      { id: 'paybank', name: 'PayBank', domains: ['paybank.ng'], senderIds: ['PayBank'], tokenKeys: { keys: [jwk] }, bankCode: PAYBANK_CODE },
    ],
    keys: StaticKeyService.random(['demobank', 'paybank']),
    bankClients: [DEMOBANK_CLIENT, PAYBANK_CLIENT],
    tokenSecret: 'test-token-secret-not-real-0123456789abcdef',
    store,
    rateLimiters: testRateLimiters(store),
    verifyRateLimitPerMinute: 1000,
    receiptTtlDays: opts.receiptTtlDays,
    guard: opts.guard,
    logStream: { write: (l: string) => void logs.push(l) },
    clock: () => clock.now,
  });
  const bankToken = async (c: typeof PAYBANK_CLIENT) =>
    (
      await sys.app.inject({
        method: 'POST',
        url: '/v1/oauth/token',
        payload: { grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret },
      })
    ).json().access_token as string;
  const payToken = await bankToken(PAYBANK_CLIENT);

  const customerToken = (phone: string, accts: string[] = [], iss = 'demobank') =>
    new SignJWT({ accts })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(iss)
      .setSubject(phone)
      .setAudience('gaskiya')
      .setIssuedAt()
      .setExpirationTime('300s')
      .sign(privateKey);

  const fields = (over: Partial<ReceiptFields> = {}): ReceiptFields => ({
    beneficiaryAccount: MERCHANT_ACCOUNT,
    beneficiaryBank: DEMOBANK_CODE,
    amountKobo: 2_500_000,
    reference: SESSION,
    valueDate: lagosDate(clock.now),
    ...over,
  });

  const register = async (f: ReceiptFields = fields(), idem?: string, token = payToken) => {
    const r = await sys.app.inject({
      method: 'POST',
      url: '/v1/receipts',
      headers: { authorization: `Bearer ${token}`, ...(idem ? { 'idempotency-key': idem } : {}) },
      payload: { receiptDigest: receiptDigest(f), beneficiaryAccount: String(f.beneficiaryAccount), beneficiaryBank: String(f.beneficiaryBank) },
    });
    return { status: r.statusCode, body: r.json() };
  };

  const check = async (payload: Record<string, unknown>, phone = MERCHANT, accts = [MERCHANT_ACCOUNT, MERCHANT_SAVINGS]) => {
    const r = await sys.app.inject({
      method: 'POST',
      url: '/v1/verify/receipt',
      headers: { authorization: `Bearer ${await customerToken(phone, accts)}` },
      payload,
    });
    return { status: r.statusCode, body: r.json() };
  };
  const checkFields = (f: Partial<ReceiptFields> = {}, phone?: string, accts?: string[]) => {
    const { beneficiaryBank: _b, ...rest } = fields(f);
    return check(rest, phone, accts);
  };

  return { sys, store, clock, logs, payToken, bankToken, customerToken, fields, register, check, checkFields };
}

describe('transfer receipts', () => {
  it('RCPT-1: a registered receipt checked by the beneficiary is received, naming the paying bank and when', async () => {
    const h = await receiptHarness();
    const reg = await h.register();
    expect(reg.status).toBe(202);
    expect(reg.body).toMatchObject({ receiptId: expect.stringMatching(/^rct_/), stored: true });

    const r = await h.checkFields();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ verdict: 'received', bank: 'DemoBank', paidFrom: 'PayBank', registeredAt: h.clock.now.toISOString() });

    const viaDigest = await h.check({ receiptDigest: receiptDigest(h.fields()), beneficiaryAccount: MERCHANT_ACCOUNT });
    expect(viaDigest.body.verdict).toBe('received');

    const typed = await h.checkFields({ reference: '000013 2610201302 1112345678 9012' });
    expect(typed.body.verdict).toBe('received');
  });

  it('RCPT-2: the same receipt for any other account is not confirmed, and an account the caller does not hold is refused', async () => {
    const h = await receiptHarness();
    await h.register();
    const savings = await h.checkFields({ beneficiaryAccount: MERCHANT_SAVINGS });
    expect(savings.body).toEqual({ verdict: 'not_confirmed', bank: 'DemoBank' });
    const replay = await h.checkFields({ beneficiaryAccount: OTHER_ACCOUNT }, OTHER, [OTHER_ACCOUNT]);
    expect(replay.body.verdict).toBe('not_confirmed');
    const notTheirs = await h.checkFields({}, OTHER, [OTHER_ACCOUNT]);
    expect(notTheirs.status).toBe(403);
    expect(notTheirs.body.code).toBe('account_not_linked');
    const notTheirsDigest = await h.check({ receiptDigest: receiptDigest(h.fields()), beneficiaryAccount: MERCHANT_ACCOUNT }, OTHER, [OTHER_ACCOUNT]);
    expect(notTheirsDigest.status).toBe(403);
    expect((await h.checkFields({}, MERCHANT, [])).status).toBe(403);
    const payCustomer = await h.sys.app.inject({
      method: 'POST',
      url: '/v1/verify/receipt',
      headers: { authorization: `Bearer ${await h.customerToken(MERCHANT, [MERCHANT_ACCOUNT], 'paybank')}` },
      payload: { receiptDigest: receiptDigest(h.fields()), beneficiaryAccount: MERCHANT_ACCOUNT },
    });
    expect(payCustomer.json().verdict).not.toBe('received');
    expect((await h.check({ ...h.fields(), beneficiaryBank: PAYBANK_CODE })).status).toBe(403);

    const record = { accountKey: 'a', receiptKey: 'r', expiresAt: '2099-01-01T00:00:00Z' };
    const base = { enrolled: true, lookup: { ok: true as const, record }, accountKey: 'a', receiptKey: 'r', now: new Date() };
    expect(decideReceiptVerdict({ ...base, accountBound: true })).toBe('received');
    expect(decideReceiptVerdict({ ...base, accountBound: false })).toBe('not_confirmed');
    expect(decideReceiptVerdict({ ...base, accountBound: true, accountKey: 'b' })).toBe('not_confirmed');
  });

  it('RCPT-3: the receipt with the amount changed by one kobo is not confirmed', async () => {
    const h = await receiptHarness();
    await h.register();
    expect((await h.checkFields({ amountKobo: 2_500_001 })).body.verdict).toBe('not_confirmed');
    expect((await h.checkFields({ amountKobo: 2_499_999 })).body.verdict).toBe('not_confirmed');
    expect((await h.checkFields({ amountKobo: 25_000_000 })).body.verdict).toBe('not_confirmed');
    expect((await h.checkFields()).body.verdict).toBe('received');
  });

  it('RCPT-4: a made-up reference or a different date is not confirmed', async () => {
    const h = await receiptHarness();
    await h.register();
    expect((await h.checkFields({ reference: `${SESSION.slice(0, 29)}3` })).body.verdict).toBe('not_confirmed');
    expect((await h.checkFields({ reference: '100004261020999999999999999999' })).body.verdict).toBe('not_confirmed');
    expect((await h.checkFields({ reference: 'FT26293ABC12' })).body.verdict).toBe('not_confirmed');
    expect((await h.checkFields({ valueDate: '2026-10-19' })).body.verdict).toBe('not_confirmed');
    const fresh = await receiptHarness();
    expect((await fresh.checkFields()).body).toEqual({ verdict: 'not_confirmed', bank: 'DemoBank' });
  });

  it('RCPT-5: when the store is unavailable the check is cannot check, never received', async () => {
    class BrokenStore extends MemoryStore {
      broken = false;
      override async findReceipt(...args: Parameters<MemoryStore['findReceipt']>) {
        if (this.broken) throw new Error('ECONNREFUSED');
        return super.findReceipt(...args);
      }
    }
    const store = new BrokenStore();
    const h = await receiptHarness({ store });
    await h.register();
    expect((await h.checkFields()).body.verdict).toBe('received');
    store.broken = true;
    const r = await h.checkFields();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ verdict: 'cannot_check' });

    const noCode = await receiptHarness({ demobankCode: null });
    expect((await noCode.checkFields()).body).toEqual({ verdict: 'cannot_check' });
    expect(decideReceiptVerdict({ enrolled: true, accountBound: true, lookup: { ok: false }, accountKey: 'a', receiptKey: 'r', now: new Date() })).toBe('cannot_check');
  });

  it('RCPT-6: the store holds no account number, amount, reference or plain digest, and logs none of them', async () => {
    process.env.LOG_LEVEL = 'trace';
    const h = await receiptHarness();
    const f = h.fields({ amountKobo: 9_876_543_210_123, reference: 'ZQXJ7RCPTMARKER42' });
    await h.register(f, 'idem-rcpt-6');
    await h.sys.app.inject({
      method: 'POST',
      url: '/v1/receipts/batch',
      headers: { authorization: `Bearer ${h.payToken}` },
      payload: { receipts: [{ receiptDigest: receiptDigest(h.fields({ beneficiaryAccount: OTHER_ACCOUNT })), beneficiaryAccount: OTHER_ACCOUNT, beneficiaryBank: DEMOBANK_CODE }] },
    });
    expect((await h.checkFields({ amountKobo: 9_876_543_210_123, reference: 'ZQXJ7RCPTMARKER42' })).body.verdict).toBe('received');
    await h.checkFields({ amountKobo: 1_357_924_680_135, reference: 'ZQXJ7FAKEMARKER43' });
    await h.check({ beneficiaryAccount: MERCHANT_ACCOUNT, amountKobo: 1, reference: 'ZQXJ/BAD/MARKER44', valueDate: '2026-10-20' });

    const dump = JSON.stringify(await h.store.dump());
    expect(dump).toContain('rct_');
    for (const plain of [MERCHANT_ACCOUNT, OTHER_ACCOUNT, MERCHANT_SAVINGS, '9876543210123', '98,765,432,101.23', '98765432101.23', '1357924680135', 'ZQXJ7RCPTMARKER42', 'ZQXJ7FAKEMARKER43', 'ZQXJ/BAD/MARKER44', SESSION, receiptDigest(f), canonicalReceipt(f), MERCHANT, MERCHANT.slice(1)]) {
      expect(dump, plain).not.toContain(plain);
    }
    const logText = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(3);
    for (const plain of [MERCHANT_ACCOUNT, OTHER_ACCOUNT, 'ZQXJ7RCPTMARKER42', 'ZQXJ7FAKEMARKER43', 'ZQXJ/BAD/MARKER44', receiptDigest(f), 'Bearer ']) {
      expect(logText, plain).not.toContain(plain);
    }
  });

  it('RCPT-7: a registration replayed with the same idempotency key creates one record', async () => {
    const h = await receiptHarness();
    const a = await h.register(h.fields(), 'transfer-0001');
    const b = await h.register(h.fields(), 'transfer-0001');
    expect(a.status).toBe(202);
    expect(b.status).toBe(200);
    expect(b.body.receiptId).toBe(a.body.receiptId);
    const batch = { receipts: [1, 2, 3].map((n) => ({ receiptDigest: receiptDigest(h.fields({ amountKobo: n * 100 })), beneficiaryAccount: MERCHANT_ACCOUNT, beneficiaryBank: DEMOBANK_CODE })) };
    const send = () => h.sys.app.inject({ method: 'POST', url: '/v1/receipts/batch', headers: { authorization: `Bearer ${h.payToken}`, 'idempotency-key': 'batch-0001' }, payload: batch });
    const first = (await send()).json().receipts.map((r: { receiptId: string }) => r.receiptId);
    const second = (await send()).json().receipts.map((r: { receiptId: string }) => r.receiptId);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(3);
    const metrics = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.payToken}` } })).json();
    expect(metrics.receiptsRegistered).toBe(4);
    for (const n of [1, 2, 3]) expect((await h.checkFields({ amountKobo: n * 100 })).body.verdict).toBe('received');
  });

  it('RCPT-8: the TypeScript and Dart receipt digests are identical for every shared receipt vector', () => {
    expect(vectors.receipts.length).toBeGreaterThanOrEqual(30);
    const byId = new Map(vectors.receipts.map((v) => [v.id, v]));
    for (const v of vectors.receipts) {
      if (v.error) {
        expect(() => canonicalReceipt(v.fields), v.id).toThrow(ReceiptFieldError);
        try {
          canonicalReceipt(v.fields);
        } catch (e) {
          expect((e as ReceiptFieldError).field, v.id).toBe(v.error);
        }
      } else {
        expect(canonicalReceipt(v.fields), v.id).toBe(v.canonical);
        expect(receiptDigest(v.fields), v.id).toBe(v.digest);
        expect(v.canonical, v.id).toMatch(/^GR1\|[0-9]{10}\|[0-9]{6}\|[1-9][0-9]*\|[A-Z0-9]{6,64}\|20[0-9]{2}-[0-9]{2}-[0-9]{2}$/);
      }
    }
    for (const group of vectors.receiptSameGroups) expect(new Set(group.map((id) => byId.get(id)!.digest)).size, group.join()).toBe(1);
    for (const [a, b] of vectors.receiptDifferentPairs) expect(byId.get(a!)!.digest, `${a} vs ${b}`).not.toBe(byId.get(b!)!.digest);
    for (const a of vectors.amounts) expect(parseAmountToKobo(a.input), a.input).toBe(a.kobo);
    for (const d of vectors.lagosDates) expect(lagosDate(new Date(d.instant)), d.instant).toBe(d.date);
    const receiptDigests = new Set(vectors.receipts.map((v) => v.digest).filter(Boolean));
    for (const v of vectors.vectors) expect(receiptDigests.has(v.digest), v.id).toBe(false);

    const dart = flutterBin('dart');
    if (!dart) throw new Error('Dart SDK not found: run `pnpm setup` or put flutter on PATH');
    const out = execFileSync(dart, ['test', '--reporter', 'compact', 'test/receipt_test.dart'], { cwd: 'packages/canonical_dart', encoding: 'utf8' });
    expect(out).toMatch(/All tests passed/);
  }, 120_000);

  it('RCPT-9: a receipt past RECEIPT_TTL_DAYS no longer matches', async () => {
    const h = await receiptHarness({ receiptTtlDays: 7 });
    const reg = await h.register();
    expect(Date.parse(reg.body.expiresAt) - h.clock.now.getTime()).toBe(7 * 24 * 3600_000);
    const valueDate = lagosDate(h.clock.now);
    h.clock.now = new Date(h.clock.now.getTime() + 7 * 24 * 3600_000 - 1000);
    expect((await h.checkFields({ valueDate })).body.verdict).toBe('received');
    h.clock.now = new Date(h.clock.now.getTime() + 2000);
    expect((await h.checkFields({ valueDate })).body.verdict).toBe('not_confirmed');
    expect(configFromEnv(demoEnv()).settings.receiptTtlDays).toBe(30);
    expect(configFromEnv(demoEnv({ RECEIPT_TTL_DAYS: '14' })).settings.receiptTtlDays).toBe(14);
    expect(() => configFromEnv(demoEnv({ RECEIPT_TTL_DAYS: '0' }))).toThrow(/RECEIPT_TTL_DAYS/);
  });

  it('RCPT-10: receipt routes need credentials and valid bodies; a receipt into a bank not enrolled is not stored', async () => {
    const h = await receiptHarness();
    const f = h.fields();
    const body = { receiptDigest: receiptDigest(f), beneficiaryAccount: MERCHANT_ACCOUNT, beneficiaryBank: DEMOBANK_CODE };
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/receipts', payload: body })).statusCode).toBe(401);
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/receipts/batch', payload: { receipts: [body] } })).statusCode).toBe(401);
    const asCustomer = await h.sys.app.inject({ method: 'POST', url: '/v1/receipts', headers: { authorization: `Bearer ${await h.customerToken(MERCHANT, [MERCHANT_ACCOUNT])}` }, payload: body });
    expect(asCustomer.statusCode).toBe(401);
    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/verify/receipt', payload: { receiptDigest: body.receiptDigest, beneficiaryAccount: MERCHANT_ACCOUNT } })).statusCode).toBe(401);
    const bad = async (payload: Record<string, unknown>) => (await h.sys.app.inject({ method: 'POST', url: '/v1/receipts', headers: { authorization: `Bearer ${h.payToken}` }, payload })).statusCode;
    expect(await bad({ ...body, amountKobo: 2_500_000 })).toBe(400);
    expect(await bad({ ...body, beneficiaryAccount: '012345678' })).toBe(400);
    expect(await bad({ ...body, beneficiaryBank: '058' })).toBe(400);
    expect(await bad({ ...body, receiptDigest: 'abc' })).toBe(400);
    const badRef = await h.check({ beneficiaryAccount: MERCHANT_ACCOUNT, amountKobo: 100, reference: 'FT/2629/3ABC', valueDate: '2026-10-20' });
    expect(badRef.status).toBe(400);
    expect(badRef.body.message).toBe('Invalid fields: reference');
    const badDate = await h.check({ beneficiaryAccount: MERCHANT_ACCOUNT, amountKobo: 100, reference: SESSION, valueDate: '2026-02-30' });
    expect(badDate.status).toBe(400);
    const elsewhere = await h.register(h.fields({ beneficiaryBank: '000013' }));
    expect(elsewhere.status).toBe(200);
    expect(elsewhere.body).toEqual({ receiptId: null, expiresAt: null, stored: false, reason: 'beneficiary_bank_not_enrolled' });
    const me = await h.sys.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${await h.customerToken(MERCHANT, [MERCHANT_ACCOUNT, 'not-an-account'])}` } });
    expect(me.json()).toMatchObject({ bank: { id: 'demobank', bankCode: DEMOBANK_CODE }, accounts: [MERCHANT_ACCOUNT] });
    const twoBanks = (codes: string[]) =>
      demoEnv({
        GASKIYA_TENANTS: JSON.stringify(codes.map((c, i) => ({ id: `b${i}`, name: `B${i}`, domains: ['b.ng'], tokenKeysUrl: 'http://127.0.0.1/jwks.json', bankCode: c }))),
        GASKIYA_TENANT_KEYS: JSON.stringify(Object.fromEntries(codes.map((_, i) => [`b${i}`, Buffer.alloc(32, 1).toString('base64')]))),
        GASKIYA_BANK_CLIENTS: '[]',
      });
    expect(() => configFromEnv(twoBanks(['999001', '999001']))).toThrow(/used by another tenant/);
    expect(() => configFromEnv(twoBanks(['58']))).toThrow(/6-digit NIBSS/);
    expect(() => configFromEnv(twoBanks(['999001', '999002']))).not.toThrow();
  });

  it('RCPT-11: the registration guard counts receipt volume with the bank\'s other registrations', async () => {
    const h = await receiptHarness({ guard: { spikeMinCount: 5, spikeFactor: 2 } });
    const receipts = Array.from({ length: 6 }, (_, n) => ({ receiptDigest: receiptDigest(h.fields({ amountKobo: n + 1 })), beneficiaryAccount: MERCHANT_ACCOUNT, beneficiaryBank: DEMOBANK_CODE }));
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/receipts/batch', headers: { authorization: `Bearer ${h.payToken}` }, payload: { receipts } });
    expect(r.statusCode).toBe(202);
    const alerts = (await h.sys.app.inject({ method: 'GET', url: '/v1/registration-alerts', headers: { authorization: `Bearer ${h.payToken}` } })).json().alerts;
    expect(alerts).toEqual([expect.objectContaining({ kind: 'volume_spike', count: 6, clientId: PAYBANK_CLIENT.clientId })]);
  });
});
