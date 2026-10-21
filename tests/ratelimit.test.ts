import type { Firestore } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import { FirestoreRateLimiter, FirestoreStore } from '../packages/api/src/index.ts';
import { testRateLimiters, testStore } from './helpers.ts';

const T0 = 30_000_000 * 60_000;

describe('rate limiter', () => {
  it('SEC-4: the limiter for the store under test counts per name and key within a fixed window', async () => {
    const store = testStore();
    const make = testRateLimiters(store);
    expect(make('verify', 1) instanceof FirestoreRateLimiter).toBe(store instanceof FirestoreStore);
    const verify = make('verify', 3, 60_000);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await verify.take('cust-a', T0 + i * 1000));
    expect(results).toEqual([true, true, true, false, false]);
    expect(await verify.take('cust-b', T0 + 5000)).toBe(true);
    expect(await make('reports', 3, 60_000).take('cust-a', T0 + 5000)).toBe(true);
    expect(await verify.take('cust-a', T0 + 59_999)).toBe(false);
    expect(await verify.take('cust-a', T0 + 60_000)).toBe(true);

    if (store instanceof FirestoreStore) {
      const other = testRateLimiters(store)('verify', 3, 60_000);
      expect(await other.take('cust-b', T0 + 6000)).toBe(true);
      expect(await other.take('cust-b', T0 + 7000)).toBe(true);
      expect(await verify.take('cust-b', T0 + 8000)).toBe(false);
      const docs = (await store.db.collection(`${store.prefix}_ratelimits`).get()).docs;
      expect(docs.length).toBeGreaterThan(0);
      for (const d of docs) {
        expect(d.id).toMatch(/^[0-9a-f]{64}$/);
        expect(Object.keys(d.data()).sort()).toEqual(['count', 'expireAt']);
      }
    }
  });

  it('SEC-4: the Firestore limiter still limits, in memory, when Firestore fails or hangs', async () => {
    const fake = (op: () => Promise<never>) => ({ collection: () => ({ doc: () => ({ set: op, get: op }) }) }) as unknown as Firestore;
    const failing = fake(() => Promise.reject(new Error('UNAVAILABLE')));
    const hanging = fake(() => new Promise<never>(() => {}));
    for (const firestore of [failing, hanging]) {
      const l = new FirestoreRateLimiter({ firestore, collection: 'x_ratelimits', name: 'verify', limit: 2, timeoutMs: 50 });
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await l.take('cust-a', T0 + i));
      expect(results).toEqual([true, true, false]);
    }
  });
});
