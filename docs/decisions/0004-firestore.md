# 0004: Cloud Firestore as the registry store

**Status:** accepted

The registry runs on Cloud Firestore in Native mode, behind the existing `Store` interface. The in-memory store remains for tests and quick demos; production refuses it.

- **Verification is one document read.** A message's document id is a SHA-256 of (tenant, keyed recipient, keyed content), so `findMessage` is a direct `get`: no query and no index. A resend of identical content overwrites the same document.
- **Fail closed, fast.** Store reads have a 3-second timeout. A slow or unreachable Firestore gives "cannot check right now", never a hang and never "confirmed". The server opens its connection before taking traffic.
- **Expiry** uses Firestore TTL on an `expireAt` timestamp. TTL deletion can lag, so reads check `expiresAt` as well.
- **Counters** for the dashboard are sharded: each bank has `FIRESTORE_STATS_SHARDS` (default 10) stats documents, every write increments one at random and reads add them up, so no single document becomes a write hotspot. Registration counts are bumped just after the record's transaction commits, not inside it, so they are eventually consistent and may undercount if that write fails; the registration itself stays atomic and idempotent. They count registrations since the start, where the memory store counts records currently held.
- **Batch registration** writes up to 200 records per transaction (two writes each), not one transaction per record, with the same per-record idempotency rules as a single registration.
- **One composite index** (tenant, recipient, sent time) serves the recent-activity summary.
- **Privacy is unchanged:** documents hold only keyed hashes and descriptive fields.

A bank that must use its own database implements the same `Store` interface; `pnpm test` runs the whole acceptance suite against both stores, so a third one can be checked the same way.
