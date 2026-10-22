import { afterAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoStore, type MessageRecord } from '../packages/api/src/index.ts';

// Runs with GASKIYA_TEST_STORE=mongo, which starts a real MongoDB in tests/mongo-global.ts.
const uri = process.env.MONGODB_TEST_URI;
const client = uri ? new MongoClient(uri) : null;
afterAll(() => client?.close());

const record = (over: Partial<MessageRecord> = {}): MessageRecord => ({
  id: 'rec_1',
  tenantId: 'demobank',
  recipientKey: 'r1',
  contentKey: 'c1',
  keyVersion: 1,
  channel: 'sms',
  category: 'transaction_alert',
  sentAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  hasLink: false,
  linkDomains: [],
  asksCallback: false,
  registeredAt: new Date().toISOString(),
  ...over,
});

describe.skipIf(!client)('MongoDB store', () => {
  const store = () => new MongoStore({ client: client!, dbName: `m${Math.random().toString(36).slice(2, 10)}` });

  it('MONGO-1: ping creates TTL indexes for expiring data and the query indexes', async () => {
    const s = store();
    await s.ping();
    for (const name of ['messages', 'calls', 'idempotency', 'console_sessions', 'api_usage']) {
      const idx = await s.db.collection(`gaskiya_${name}`).indexes();
      expect(idx.find((i) => i.key.expireAt === 1)?.expireAfterSeconds, name).toBe(0);
    }
    const calls = await s.db.collection('gaskiya_calls').indexes();
    expect(calls.some((i) => i.key.tenantId === 1 && i.key.recipientKey === 1 && i.key.status === 1)).toBe(true);
    await s.ping();
  });

  it('MONGO-2: dashboard counters live in one document per bank, and keys with dots survive', async () => {
    const s = store();
    await s.putMessages([{ record: record() }, { record: record({ id: 'rec_2', contentKey: 'c2', channel: 'whatsapp' }) }]);
    await s.recordApiCall({ tenantId: 'demobank', clientId: 'demo.bank-sim', method: 'GET', route: '/v1/files/a.b', status: 200, code: null, at: new Date().toISOString() });
    const stats = await s.db.collection('gaskiya_stats').find().toArray();
    expect(stats.map((d) => d._id)).toEqual(['demobank']);
    expect((await s.metrics('demobank')).registrationsByChannel).toEqual({ sms: 1, whatsapp: 1 });
    const [day] = await s.apiUsage('demobank', [new Date().toISOString().slice(0, 10)]);
    expect(day).toMatchObject({ calls: 1, byRoute: { 'GET /v1/files/a.b': 1 }, byClient: { 'demo.bank-sim': 1 } });
  });

  it('MONGO-3: an idempotency key older than a day no longer returns its record', async () => {
    const s = store();
    const first = await s.putMessage(record(), 'idem-1');
    expect(first.created).toBe(true);
    expect((await s.putMessage(record({ id: 'rec_9' }), 'idem-1'))).toMatchObject({ created: false, record: { id: 'rec_1' } });
    await s.db.collection('gaskiya_idempotency').updateMany({}, { $set: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await s.putMessage(record({ id: 'rec_9' }), 'idem-1')).created).toBe(true);
  });

  it('MONGO-5: push devices are kept per number and token, updated in place, listed per bank and removed one by one', async () => {
    const s = store();
    const at = new Date().toISOString();
    await s.putDevice({ tenantId: 'demobank', recipientKey: 'r1', pushToken: 'tok-a', platform: 'android', updatedAt: at });
    await s.putDevice({ tenantId: 'demobank', recipientKey: 'r1', pushToken: 'tok-a', platform: 'ios', voipToken: 'ab'.repeat(32), updatedAt: at });
    await s.putDevice({ tenantId: 'demobank', recipientKey: 'r2', pushToken: 'tok-b', platform: 'android', updatedAt: at });
    await s.putDevice({ tenantId: 'otherbank', recipientKey: 'r1', pushToken: 'tok-a', platform: 'android', updatedAt: at });
    expect(await s.devices('demobank', 'r1')).toEqual([{ tenantId: 'demobank', recipientKey: 'r1', pushToken: 'tok-a', platform: 'ios', voipToken: 'ab'.repeat(32), updatedAt: at }]);
    expect((await s.tenantDevices('demobank')).map((d) => d.pushToken).sort()).toEqual(['tok-a', 'tok-b']);
    await s.removeDevice('demobank', 'r1', 'tok-a');
    expect(await s.devices('demobank', 'r1')).toEqual([]);
    expect(await s.devices('otherbank', 'r1')).toHaveLength(1);
  });

  it('MONGO-4: resetTenant removes one bank\'s data and leaves the others', async () => {
    const s = store();
    await s.putMessages([{ record: record() }, { record: record({ tenantId: 'otherbank', id: 'o1' }) }]);
    await s.resetTenant('demobank');
    expect(await s.findMessage('demobank', 'r1', 'c1', new Date())).toBeNull();
    expect(await s.findMessage('otherbank', 'r1', 'c1', new Date())).not.toBeNull();
    expect((await s.metrics('otherbank')).registrations).toBe(1);
  });
});
