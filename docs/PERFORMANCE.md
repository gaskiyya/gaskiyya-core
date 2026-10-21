# Performance

Load test for registration (single and batch) and verification, and the REG-7 check: a record is searchable within two seconds of its registration call.

```bash
pnpm load                                   # registry in-process, memory store
LOAD_DURATION=30 LOAD_CONNECTIONS=100 pnpm load
LOAD_URL=https://registry.example LOAD_CLIENT_ID=... LOAD_CLIENT_SECRET=... \
  LOAD_CUSTOMER_TOKEN_URL=https://registry.example/sim/customer-token pnpm load
```

The script is `scripts/load.ts` (autocannon). It gets the bank token the way a bank client does, with OAuth 2.0 client credentials at `POST /v1/oauth/token`, and a customer token per test phone: signed in-process, or fetched from the bank's customer-token endpoint (`LOAD_CUSTOMER_TOKEN_URL`) for a remote target. The settings are listed in `.env.example` and `apps/web/docs/CONFIGURATION.md`. It exits non-zero if REG-7 fails.

Scenarios, each run for `LOAD_DURATION` seconds over `LOAD_CONNECTIONS` connections:

1. **Single registration.** `POST /v1/messages`, each call a new message to a new recipient. The REG-7 probe runs alongside: it registers a message, checks it straight away as its recipient, and measures the time until the check says confirmed.
2. **Batch registration.** `POST /v1/messages/batch` with `LOAD_BATCH_SIZE` messages per call.
3. **Verification.** `POST /v1/verify/message` by `LOAD_PHONES` customers, each holding five registered messages. Half the checks are for one of those messages (confirmed), half for a message never registered (not confirmed, which also reads the customer's recent activity).

Latency percentiles are computed from every response time, not from a histogram.

## Results: Apple M1 MacBook Pro, Node 22, memory store

Measured on 20 Oct 2026 with `pnpm load` at its defaults: 10 s per scenario, 50 connections, 100 messages per batch, 200 checking customers.

**Read these numbers with their conditions:**

- **Memory store only.** No database round trip. Firestore and production numbers will be different, and much slower per request, and have **not been measured yet**.
- **One process.** The registry and the load generator share one Node.js process, so one core, and the client's own work (building bodies, hashing digests for batches) takes time from the server. The server alone would do better.
- **A busy machine.** Other work was running: the 1-minute load average was 12 to 25 on 8 cores during the runs. The spread between the three runs below is mostly that.
- **Rate limit raised.** The per-customer verify limit (`VERIFY_RATE_LIMIT_PER_MINUTE`, 30 by default) would cap each test phone at 30 checks a minute, so the in-process run raises it for the run. Against `LOAD_URL` the target's own limit applies.
- **Guard on, email off.** The registration anomaly guard runs on every registration. The load trips its volume-spike alert, as it should; no email is sent.

| Run | Scenario | Requests | Requests/s | Messages/s | p50 ms | p95 ms | p99 ms | max ms | Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Single registration | 80,576 | 8,042 | 8,042 | 5.6 | 9.7 | 14.9 | 133 | 0 |
| 1 | Batch registration (100 per call) | 6,133 | 584 | 58,410 | 75.3 | 131 | 398 | 868 | 0 |
| 1 | Verification (half confirmed) | 76,652 | 7,658 | 7,658 | 5.8 | 10.3 | 16.4 | 60.3 | 0 |
| 2 | Single registration | 57,396 | 5,728 | 5,728 | 7.1 | 16.7 | 30.8 | 150 | 0 |
| 2 | Batch registration (100 per call) | 3,987 | 373 | 37,297 | 78.2 | 403 | 1,044 | 1,084 | 0 |
| 2 | Verification (half confirmed) | 60,743 | 6,056 | 6,056 | 6.9 | 15.6 | 27.7 | 312 | 0 |
| 3 | Single registration | 84,843 | 8,476 | 8,476 | 5.4 | 9.1 | 13.4 | 94.4 | 0 |
| 3 | Batch registration (100 per call) | 6,439 | 629 | 62,881 | 70.9 | 96.0 | 399 | 759 | 0 |
| 3 | Verification (half confirmed) | 77,035 | 7,696 | 7,696 | 5.6 | 10.3 | 19.6 | 75.6 | 0 |

Errors counts non-2xx answers, socket errors and timeouts; there were none.

### REG-7: searchable within two seconds of registration

| Run | Probe samples | p50 ms | p99 ms | max ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 82 | 19.3 | 144 | 144 |
| 2 | 75 | 26.4 | 160 | 160 |
| 3 | 83 | 18.1 | 102 | 102 |

**REG-7: pass** on this machine with the memory store. Under about 6,000 to 8,500 single registrations a second, the slowest probe went from registration call to a confirmed check in 160 ms, against a target of 2,000 ms, and the slowest single registration took 150 ms. The automated REG-7 test (`tests/registry.test.ts`) checks the same property without load.

This does not show REG-7 holds on Firestore. That needs the same run against a Firestore-backed deployment with `LOAD_URL`.

## Not yet measured

- **Firestore.** Not yet measured. Registration is a Firestore transaction (idempotency read and record write), with batches written up to 200 records per transaction. The per-bank counters are sharded across `FIRESTORE_STATS_SHARDS` documents (default 10) and incremented outside the record transaction ([decision 0004](decisions/0004-firestore.md)), so no single document takes every write. Each check is a document read plus a logged write to one random shard. Expect Firestore round trips (tens of milliseconds) to dominate latency. Measure with `LOAD_URL` against a real project before a pilot.
- **Production.** Cloud Run instances, network latency from the bank, TLS and the API gateway in front all add latency that this run does not include.
