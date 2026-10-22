import { MongoMemoryReplSet } from 'mongodb-memory-server';

// GASKIYA_TEST_STORE=mongo runs the suite against a real MongoDB: a one-node replica set, so transactions work.
let server: MongoMemoryReplSet | null = null;

export async function setup() {
  if (process.env.GASKIYA_TEST_STORE !== 'mongo' || process.env.MONGODB_TEST_URI) return;
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_TEST_URI = server.getUri();
}

export async function teardown() {
  await server?.stop();
}
