// Copies the registry from Firestore to MongoDB with the same document IDs, so it can be re-run safely.
// Sharded counters and per-day usage are added up into the single documents MongoStore uses.
//   FIRESTORE_PROJECT_ID=... FIRESTORE_SERVICE_ACCOUNT_JSON=... MONGODB_URI=... npx tsx scripts/migrate-firestore-to-mongo.ts [--dry-run]
import { MongoClient, ObjectId, type AnyBulkWriteOperation, type Document } from 'mongodb';
import { FirestoreStore } from '../packages/api/src/index.ts';

const env = process.env;
const dryRun = process.argv.includes('--dry-run');
const fsPrefix = env.FIRESTORE_COLLECTION_PREFIX || 'gaskiya';
const mongoPrefix = env.MONGODB_COLLECTION_PREFIX || 'gaskiya';
if (!env.FIRESTORE_PROJECT_ID || !env.MONGODB_URI) throw new Error('set FIRESTORE_PROJECT_ID and MONGODB_URI');

let raw = env.FIRESTORE_SERVICE_ACCOUNT_JSON?.trim();
if (raw && !raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
const sa = raw ? (JSON.parse(raw) as { client_email: string; private_key: string }) : null;
const firestore = new FirestoreStore({ projectId: env.FIRESTORE_PROJECT_ID, prefix: fsPrefix, ...(sa ? { credentials: { client_email: sa.client_email, private_key: sa.private_key } } : {}) }).db;
const client = new MongoClient(env.MONGODB_URI);
const db = client.db(env.MONGODB_DB || 'gaskiyya');

const PLAIN = ['messages', 'idempotency', 'receipts', 'calls', 'verifications', 'devices', 'languages', 'reports', 'campaigns', 'alerts', 'admin_orgs', 'admin_clients', 'admin_keys', 'admin_sessions', 'console_codes', 'console_sessions', 'app_users', 'api_errors'];
const enc = (k: string) => encodeURIComponent(k).replace(/\./g, '%2E');

const isTimestamp = (v: unknown): v is { toDate(): Date } => !!v && typeof (v as { toDate?: unknown }).toDate === 'function';

function convert(v: unknown): unknown {
  if (isTimestamp(v)) return v.toDate();
  if (Array.isArray(v)) return v.map(convert);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, convert(x)]));
  return v;
}

// Adds counter documents together, re-encoding map keys for MongoDB field names.
function add(acc: Document, src: Document, decode = false) {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'number') acc[k] = ((acc[k] as number | undefined) ?? 0) + v;
    else if (v && typeof v === 'object' && !(v instanceof Date)) {
      const inner = (acc[k] as Document | undefined) ?? {};
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof iv !== 'number') continue;
        const key = enc(decode ? decodeURIComponent(ik) : ik);
        inner[key] = ((inner[key] as number | undefined) ?? 0) + iv;
      }
      acc[k] = inner;
    }
  }
  return acc;
}

async function write(name: string, docs: Document[]) {
  if (dryRun || docs.length === 0) return;
  const ops: AnyBulkWriteOperation<Document>[] = docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }));
  for (let i = 0; i < ops.length; i += 500) await db.collection(`${mongoPrefix}_${name}`).bulkWrite(ops.slice(i, i + 500), { ordered: false });
}

try {
  for (const name of PLAIN) {
    const snap = await firestore.collection(`${fsPrefix}_${name}`).get();
    await write(name, snap.docs.map((d) => ({ ...(convert(d.data()) as Document), _id: d.id })));
    console.log(`${name.padEnd(18)} ${snap.size}`);
  }

  const audit = await firestore.collection(`${fsPrefix}_admin_audit`).get();
  await write('admin_audit', audit.docs.map((d) => ({ ...(convert(d.data()) as Document), _id: d.id, seq: new ObjectId() })));
  console.log(`${'admin_audit'.padEnd(18)} ${audit.size}`);

  const stats = new Map<string, Document>();
  for (const d of (await firestore.collection(`${fsPrefix}_stats`).get()).docs) {
    if (d.id === '_ping') continue;
    const tenant = d.id.replace(/_\d+$/, '');
    stats.set(tenant, add(stats.get(tenant) ?? { _id: tenant }, d.data()));
  }
  await write('stats', [...stats.values()]);
  console.log(`${'stats'.padEnd(18)} ${stats.size} banks`);

  const usage = new Map<string, Document>();
  for (const d of (await firestore.collection(`${fsPrefix}_api_usage`).get()).docs) {
    const { tenantId, day, expireAt, ...counters } = d.data();
    const id = `${tenantId}_${day}`;
    const doc = usage.get(id) ?? { _id: id, tenantId, day, expireAt: convert(expireAt) };
    usage.set(id, add(doc, { calls: counters.calls ?? 0, errors: counters.errors ?? 0, byRoute: counters.byRoute ?? {}, byStatus: counters.byStatus ?? {}, byClient: counters.byClient ?? {} }, true));
  }
  await write('api_usage', [...usage.values()]);
  console.log(`${'api_usage'.padEnd(18)} ${usage.size} bank-days`);
  console.log(dryRun ? 'Dry run: nothing written.' : 'Copied. Start the server with MONGODB_URI set; it creates the indexes on start.');
} finally {
  await client.close();
  await firestore.terminate();
}
