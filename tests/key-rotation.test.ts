import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { configFromEnv, MemoryStore, StaticKeyService, type Store } from '../packages/api/src/index.ts';
import { decideVerdict } from '../packages/api/src/domain/verdict.ts';
import { ALERT, ALICE, BOB, harness, LINK_MSG, TENANT, testStore } from './helpers.ts';

const OLD = randomBytes(32);
const NEW = randomBytes(32);
const before = () => new StaticKeyService({ [TENANT.id]: OLD });
const rotated = () => new StaticKeyService({ [TENANT.id]: { current: 2, keys: { 1: OLD, 2: NEW } } });
const oldRemoved = () => new StaticKeyService({ [TENANT.id]: { current: 2, keys: { 2: NEW } } });

async function afterRotation(keys: StaticKeyService, store: Store = testStore()) {
  const old = await harness({ store, keys: before() });
  expect((await old.register(ALICE, ALERT)).status).toBe(202);
  expect((await old.verify(ALICE, ALERT)).body.verdict).toBe('confirmed');
  return harness({ store, keys });
}

const keyVersions = async (store: Store) =>
  ((await store.dump()) as { messages: { keyVersion?: number }[] }).messages.map((m) => m.keyVersion ?? 1).sort();

describe('key rotation', () => {
  it('KEY-1: a record registered under the previous key still confirms after rotation', async () => {
    const h = await afterRotation(rotated());
    const r = await h.verify(ALICE, ALERT);
    expect(r.body).toMatchObject({ verdict: 'confirmed', channel: 'sms', category: 'transaction_alert', bank: 'DemoBank' });
  });

  it('KEY-1: after rotation new records are written and confirmed under the current key version', async () => {
    const store = testStore();
    const h = await afterRotation(rotated(), store);
    expect((await h.register(ALICE, LINK_MSG)).status).toBe(202);
    expect((await h.verify(ALICE, LINK_MSG)).body.verdict).toBe('confirmed');
    expect(await keyVersions(store)).toEqual([1, 2]);
  });

  it('KEY-1: the recent-activity summary still counts messages registered under the previous key', async () => {
    const h = await afterRotation(rotated());
    const r = await h.verify(ALICE, 'DemoBank: a message the bank never sent');
    expect(r.body.verdict).toBe('not_confirmed');
    expect(r.body.recentActivity).toEqual([{ category: 'transaction_alert', channel: 'sms', count: 1, anyWithLink: false }]);
  });

  it('KEY-2: once the previous key is removed, its records return not confirmed', async () => {
    const h = await afterRotation(oldRemoved());
    const r = await h.verify(ALICE, ALERT);
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('not_confirmed');
  });

  it('KEY-2: a lookup failure under a previous key fails the whole check closed', async () => {
    class FailsOnSecond extends MemoryStore {
      lookups = 0;
      broken = false;
      override async findMessage(...args: Parameters<MemoryStore['findMessage']>) {
        if (this.broken && ++this.lookups === 2) throw new Error('ECONNRESET');
        return super.findMessage(...args);
      }
    }
    const store = new FailsOnSecond();
    const h = await afterRotation(rotated(), store);
    store.broken = true;
    expect((await h.verify(ALICE, ALERT)).body).toEqual({ verdict: 'cannot_check' });
  });

  it('KEY-3: a record registered under either key never confirms for another recipient', async () => {
    const h = await afterRotation(rotated());
    await h.register(ALICE, LINK_MSG);
    expect((await h.verify(BOB, ALERT)).body.verdict).toBe('not_confirmed');
    expect((await h.verify(BOB, LINK_MSG)).body.verdict).toBe('not_confirmed');
  });

  it('KEY-3: the verdict function matches only a record of the same key version', () => {
    const base = { enrolled: true, recipientKey: 'r', contentKey: 'c', now: new Date('2026-10-20T00:00:00Z') };
    const rec = { recipientKey: 'r', contentKey: 'c', expiresAt: '2026-11-01T00:00:00Z' };
    expect(decideVerdict({ ...base, keyVersion: 2, lookup: { ok: true, record: { ...rec, keyVersion: 2 } } })).toBe('confirmed');
    expect(decideVerdict({ ...base, keyVersion: 2, lookup: { ok: true, record: { ...rec, keyVersion: 1 } } })).toBe('not_confirmed');
    expect(decideVerdict({ ...base, keyVersion: 1, lookup: { ok: true, record: { ...rec, keyVersion: 2 } } })).toBe('not_confirmed');
    expect(decideVerdict({ ...base, keyVersion: 1, lookup: { ok: true, record: rec } })).toBe('confirmed');
    expect(decideVerdict({ ...base, keyVersion: 2, lookup: { ok: true, record: rec } })).toBe('not_confirmed');
  });

  it('the key service keys with the current version and lists previous ones after it', () => {
    const k = new StaticKeyService({ b: { current: '3', keys: { 1: OLD, 3: NEW, 2: randomBytes(32) } } });
    expect(k.currentVersion('b')).toBe(3);
    expect(k.versions('b')).toEqual([3, 2, 1]);
    expect(k.keyed('b', 'content', 'x')).toBe(k.keyed('b', 'content', 'x', 3));
    expect(k.keyed('b', 'content', 'x', 1)).not.toBe(k.keyed('b', 'content', 'x', 3));
    expect(() => k.keyed('b', 'content', 'x', 9)).toThrow();
    expect(() => new StaticKeyService({ b: { current: 2, keys: { 1: OLD } } })).toThrow(/current key version/);
    expect(() => new StaticKeyService({ b: { current: 1, keys: { 1: randomBytes(16) } } })).toThrow(/at least 32 bytes/);
  });

  it('GASKIYA_TENANT_KEYS accepts a versioned key set and rejects one without its current key', () => {
    const env = (keys: unknown) => ({
      AI_PROVIDER: 'none',
      GASKIYA_TOKEN_SECRET: 'x'.repeat(40),
      GASKIYA_TENANTS: JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], senderIds: [], tokenKeysUrl: 'https://bank.example/jwks.json' }]),
      GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: keys }),
      GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'notify', clientSecret: 's'.repeat(32), tenantId: 'demobank' }]),
    });
    const b64 = (b: Buffer) => b.toString('base64');
    expect(() => configFromEnv(env({ current: 2, keys: { 1: b64(OLD), 2: b64(NEW) } }))).not.toThrow();
    expect(() => configFromEnv(env(b64(OLD)))).not.toThrow();
    expect(() => configFromEnv(env({ current: 3, keys: { 1: b64(OLD), 2: b64(NEW) } }))).toThrow(/current key version 3/);
    expect(() => configFromEnv(env({ current: 1, keys: { 1: b64(randomBytes(8)) } }))).toThrow(/at least 32 bytes/);
  });
});
