import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type CollectionReference, type Firestore } from '@google-cloud/firestore';
import type { Collection, Db } from 'mongodb';

export interface RateLimiter {
  take(key: string, now?: number): Promise<boolean>;
}

export type RateLimiterFactory = (name: string, limit: number, windowMs?: number) => RateLimiter;

const WINDOW_MS = 60_000;

export class MemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private limit: number,
    private windowMs = WINDOW_MS,
  ) {}

  async take(key: string, now = Date.now()): Promise<boolean> {
    return this.takeSync(key, now);
  }

  takeSync(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs || now < w.start) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.prune(now);
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  private prune(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}

export const memoryRateLimiters: RateLimiterFactory = (_name, limit, windowMs) => new MemoryRateLimiter(limit, windowMs);

export interface FirestoreRateLimiterOptions {
  firestore: Firestore;
  collection: string;
  name: string;
  limit: number;
  windowMs?: number;
  timeoutMs?: number;
}

export class FirestoreRateLimiter implements RateLimiter {
  private col: CollectionReference;
  private windowMs: number;
  private local = new Map<string, { start: number; count: number }>();

  constructor(private o: FirestoreRateLimiterOptions) {
    this.col = o.firestore.collection(o.collection);
    this.windowMs = o.windowMs ?? WINDOW_MS;
  }

  async take(key: string, now = Date.now()): Promise<boolean> {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    const id = createHash('sha256').update(`${this.o.name}\u0000${key}\u0000${start}`).digest('hex');
    const mine = this.countLocally(id, start);
    if (mine > this.o.limit) return false;
    const ref = this.col.doc(id);
    const run = (async () => {
      await ref.set({ count: FieldValue.increment(1), expireAt: Timestamp.fromMillis(start + 2 * this.windowMs) }, { merge: true });
      return ((await ref.get()).get('count') as number | undefined) ?? mine;
    })();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Firestore did not respond in time')), this.o.timeoutMs ?? 3000);
    });
    try {
      return (await Promise.race([run, timeout])) <= this.o.limit;
    } catch {
      run.catch(() => {});
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  private countLocally(id: string, start: number): number {
    const w = this.local.get(id);
    if (w) return ++w.count;
    if (this.local.size > 50_000) for (const [k, v] of this.local) if (v.start < start) this.local.delete(k);
    this.local.set(id, { start, count: 1 });
    return 1;
  }
}

export function firestoreRateLimiters(firestore: Firestore, prefix: string): RateLimiterFactory {
  return (name, limit, windowMs) => new FirestoreRateLimiter({ firestore, collection: `${prefix}_ratelimits`, name, limit, windowMs });
}

export interface MongoRateLimiterOptions {
  db: Db;
  collection: string;
  name: string;
  limit: number;
  windowMs?: number;
  timeoutMs?: number;
}

// One atomic upsert per request; a TTL index on expireAt removes old windows.
export class MongoRateLimiter implements RateLimiter {
  private col: Collection<{ _id: string; count: number; expireAt: Date }>;
  private windowMs: number;
  private local = new Map<string, { start: number; count: number }>();

  constructor(private o: MongoRateLimiterOptions) {
    this.col = o.db.collection(o.collection);
    this.windowMs = o.windowMs ?? WINDOW_MS;
  }

  async take(key: string, now = Date.now()): Promise<boolean> {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    const id = createHash('sha256').update(`${this.o.name}\u0000${key}\u0000${start}`).digest('hex');
    const mine = this.countLocally(id, start);
    if (mine > this.o.limit) return false;
    const run = this.col
      .findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(start + 2 * this.windowMs) } }, { upsert: true, returnDocument: 'after' })
      .then((d) => d?.count ?? mine);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('MongoDB did not respond in time')), this.o.timeoutMs ?? 3000);
    });
    try {
      return (await Promise.race([run, timeout])) <= this.o.limit;
    } catch {
      run.catch(() => {});
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  private countLocally(id: string, start: number): number {
    const w = this.local.get(id);
    if (w) return ++w.count;
    if (this.local.size > 50_000) for (const [k, v] of this.local) if (v.start < start) this.local.delete(k);
    this.local.set(id, { start, count: 1 });
    return 1;
  }
}

export function mongoRateLimiters(db: Db, prefix: string): RateLimiterFactory {
  return (name, limit, windowMs) => new MongoRateLimiter({ db, collection: `${prefix}_ratelimits`, name, limit, windowMs });
}

