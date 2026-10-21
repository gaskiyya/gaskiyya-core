# 0008: Rotating a bank's hashing key

**Status:** accepted

Each bank had one HMAC key for the life of the registry, and changing it made every live record stop matching. A bank must be able to rotate it (a scheduled change, or a suspected leak) without a window in which genuine messages fail to verify.

- **Versioned keys.** A bank holds one *current* key and may hold *previous* keys, each with a whole-number version. `GASKIYA_TENANT_KEYS` takes either a single base64 key (version 1, as before) or `{ "current": 2, "keys": { "1": "...", "2": "..." } }`.
- **Records carry `keyVersion`.** Registration keys the number and the digest with the current key and stores its version. Records written before this change have no version and are treated as version 1.
- **Verification tries each key, exactly.** The check computes the keyed recipient and content under the current key, then under each previous key, and does one exact lookup per version. A record matches only under the version it was written with (`decideVerdict` compares the versions). Only the registry confirms (principle 1): there is no fuzzy or cross-version matching.
- **Recipient binding is unchanged** (principle 3). Under every version the recipient key is an HMAC of the checking customer's own number, so a replay to another number fails under all of them.
- **Fail closed** (principle 2). If any of the lookups errors, the whole check is "cannot check right now".
- **Removing a key retires its records.** Once a version is dropped from the configuration, its records return "not confirmed", never "confirmed". Keep a previous key until its records have expired (`recordTtlDays`, 30 days by default).
- **Canonicalisation does not change.** The canonical form and the bank's SHA-256 digest are exactly as before, in TypeScript and in Dart; only the server-side HMAC key that turns the digest into a stored key varies. Test vectors are unaffected.

Costs: while a previous key is held, a check that finds nothing does one store read per version (in parallel), and the recent-activity summary queries once per version. Call sessions, device registrations, rate limits, logs and report callback hashes use the current key only: a device registered before the rotation stops getting call notices until the app registers it again (it does on each launch), and campaign grouping by callback number does not link reports across a rotation.
