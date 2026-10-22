# 0023: MongoDB replaces Firestore as the registry store

**Status:** accepted (owner, 2026-10-22)

## Why

On 22 October 2026 the production server stopped. Firestore's free Spark plan allows 50,000 document reads a day, and the bank console used it up in under an hour with almost no data stored: each request read a session (2 documents), a rate-limit window (1) and the dashboard counters, which were sharded across 11 documents, plus 140 documents for 14 days of API usage on the Overview page, polled every few seconds. Once the quota ran out the server could not start, and every deploy rolled back to an equally broken image until the quota reset at midnight Pacific time. The owner chose not to depend on a daily quota.

## Decision

- `MongoStore` (`packages/api/src/store/mongo.ts`) implements the same `Store` interface. Setting `MONGODB_URI` selects it. Production uses MongoDB Atlas.
- Same document IDs and the same behaviour as the Firestore store. Expiring data has a TTL index on `expireAt`. Idempotent message and receipt registration runs in a transaction.
- Dashboard counters are one document per bank (atomic `$inc`), and API usage one document per bank per day. Counter keys are URI-encoded so a `.` or a leading `$` cannot become a field path.
- `MongoRateLimiter` keeps shared rate-limit windows with one atomic upsert per request and falls back to counting in memory if the database fails or hangs, as the Firestore limiter did.
- The console's dashboard endpoints share one result per bank for 5 seconds (metrics) and 15 seconds (overview). The console polls every 10 and 15 seconds and stops while its tab is hidden.
- The Firestore store stays available behind `STORE=firestore`.

## Consequences

- No daily read quota. The free M0 tier caps throughput (about 100 operations a second) and storage (512 MB), far above current use.
- The server must be allowed under Atlas *Network Access*, and the connection string is a secret: the `MONGODB_URI` GitHub secret, written into `prod.env` by the deploy job (`scripts/server-env.sh`).
- The full test suite runs against a real MongoDB in CI (`GASKIYA_TEST_STORE=mongo`, using `mongodb-memory-server`).
- Data in Firestore is not copied automatically; `scripts/migrate-firestore-to-mongo.ts` copies it once Firestore can be read again.
- Organisations configured in `GASKIYA_TENANTS` (DemoBank and the demo agencies) are written to the registry as organisation records when the server starts, once, if the database does not hold them yet (`AdminRegistry.seedEnvOrgs`, audited as `org.seed`). How the server runs stays with its configuration: the demo login (`customerTokenUrl`, `demoInboxUrl`) and customer token keys (`tokenKeysUrl`, `tokenKeys`) are never taken from the stored copy, so switching demo login off cannot be undone by a stale record.
