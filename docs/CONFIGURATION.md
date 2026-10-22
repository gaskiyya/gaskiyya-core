# Server configuration

Everything is set with environment variables (see `.env.example`). `pnpm dev` writes a working local `.env` on first run. For any other environment, set the variables below, then run:

```bash
pnpm check:server                     # checks config and every enabled integration, live
pnpm check:server --email             # also sends a test email to each bank's alertEmails
pnpm check:server --push <token>      # also sends a test call notice to one device
```

The server refuses to start on a bad configuration and lists every problem at once. On start it logs which integrations are on:

```json
"integrations": { "ai": "Gemini (gemini-3.8-flash)", "push": "Firebase Cloud Messaging (project my-proj)",
                  "email": "Resend, campaign alerts for demobank", "whatsapp": "off", "ussd": "on for demobank", "tenants": ["demobank"] }
```

## Required

| Variable | What it is | How to make it |
| --- | --- | --- |
| `GASKIYA_TOKEN_SECRET` | Signs the short-lived OAuth tokens issued to bank systems | `openssl rand -base64 48` |
| `GASKIYA_TENANTS` | JSON array, one entry per bank, agency or company (below) | |
| `GASKIYA_TENANT_KEYS` | JSON object: bank id to a base64 key of at least 32 bytes, used to hash numbers and messages, or to a versioned key set for rotation (below). In production this comes from a key management service | `openssl rand -base64 32` per bank. Do not edit a key in place: rotate it as described below |
| `GASKIYA_BANK_CLIENTS` | JSON array of `{ clientId, clientSecret, tenantId }` for the bank systems that register messages and calls | Secret of 24+ characters: `openssl rand -base64 32` |

Tenant entry:

```json
{
  "id": "demobank",
  "name": "DemoBank",
  "domains": ["demobank.ng", "demobank.com"],
  "senderIds": ["DemoBank"],
  "tokenKeysUrl": "https://api.demobank.ng/.well-known/jwks.json",
  "alertEmails": ["fraud-desk@demobank.ng"],
  "customerTokenUrl": "https://api.demobank.ng/gaskiyya/customer-token",
  "recordTtlDays": 30,
  "kind": "bank",
  "officialContacts": {
    "phones": ["+2342019000000"],
    "whatsapp": ["+2349060000000"],
    "emails": ["care@demobank.ng"],
    "social": [{ "platform": "x", "handle": "DemoBankNG" }, { "platform": "instagram", "handle": "demobank.ng" }]
  },
  "officialApps": { "android": ["ng.demobank.mobile"], "ios": ["1234567890"] },
  "bankCode": "999001"
}
```

- `domains`: the bank's own domains. Links on these (or their subdomains) are reported as belonging to the bank.
- `tokenKeysUrl`: the bank's published JSON Web Key Set. The bank's app backend signs customer tokens with `iss` = tenant id, `sub` = the customer's E.164 number, `aud` = `gaskiya`, ES256/RS256/EdDSA, valid for at most 15 minutes.
- `alertEmails`: optional; the fraud desk addresses for campaign alerts.
- `bankCode`: optional; the bank's 6-digit NIBSS (NIP) institution code, unique across tenants. Transfer receipts paid into this bank's accounts are registered and checked under it ([decision 0015](decisions/0015-transfer-receipts.md)). Without one, receipts paid to this bank's customers are not stored and its customers' receipt checks answer "cannot check". For customers to check receipts, the bank also adds an `accts` claim to its customer tokens: the 10-digit account numbers the customer holds with it.
- `customerTokenUrl`: optional; where the Gaskiyya app signs this bank's customers in. The app lists every bank that has one (`GET /v1/banks`) and links through it, so a single app build serves all enrolled banks. The endpoint answers `POST { "phone": "+234..." }` with `{ "token": "<customer JWT>", "expiresIn": 600 }` once the bank has authenticated the customer its own way. An absolute URL, or a path on the registry server. Banks without one are verified only inside their own app.
- `kind`: optional; `bank` (the default), `agency` or `company` ([decision 0014](decisions/0014-organisations-and-official-identities.md)). Agencies and companies register messages and calls exactly like banks; customer-facing text names them instead of saying "your bank".
- `officialContacts`: optional; the contacts the organisation publishes as its own, which customers can check with `POST /v1/verify/contact` (app, WhatsApp, USSD option 3). `phones` (voice) and `whatsapp` take E.164 numbers (a local `0` number is read as Nigerian); `emails` are matched case-insensitively; `social` entries are `{ "platform": "x" | "facebook" | "instagram" | "tiktok" | "telegram", "handle": "..." }` (a leading `@` is ignored). Only an exact match is "official". Every value is checked at start-up. They are public: `GET /v1/organisations` lists them.
- `officialApps`: optional; `android` package IDs and `ios` App Store IDs (`"1234567890"`, `"id1234567890"` or an `apps.apple.com` URL). A store link to one of them checks as `official_app`; an APK download never does.
- The server's own demo bank needs no `customerTokenUrl` while demo login is on (`SIM_DEMO_LOGIN=true`): with `SIM_ENABLED=true` (as under `pnpm dev`) it is `/sim/customer-token` on this server; a simulator on another host is named by `SIM_PUBLIC_URL`. With demo login off the demo bank is not offered to the app.

### Web pages

The server serves the built web UIs (`pnpm web:build`, read from `WEB_DIST_DIR`, default `dist`) beside the API:

| Path | What | When |
| --- | --- | --- |
| `/`, `/banks.html` | Landing page and bank integration guide | Always |
| `/console/` | Bank console: each registered organisation signs in with an access code issued in the admin dashboard ([decision 0021](decisions/0021-bank-console-access.md)). With `SIM_ENABLED=true` it opens on DemoBank and its demo tools | Always, unless `CONSOLE_ENABLED=false` |
| `/admin/` | Platform admin dashboard, staff only | A staff login is set (see [Admin dashboard](#admin-dashboard)) |

API routes (`/v1`, `/health`, `/webhooks`, `/sim`, `/internal`) are never shadowed by these pages. HTML is sent with `Cache-Control: no-cache`, hashed build assets as immutable.

### Demo login and the /sim routes

`SIM_DEMO_LOGIN` is off unless it is set to `true`. `pnpm dev` and `pnpm demo:offline` set it to `true` when `.env` leaves it empty, so the local demo works as before; set `SIM_DEMO_LOGIN=false` in `.env` to try the closed mode locally. A demo deployment that serves the simulator (`SIM_ENABLED=true`) and wants phones to sign in must set `SIM_DEMO_LOGIN=true` itself, and must never do so in a pilot ([decision 0003](decisions/0003-demo-identity.md)).

While demo login is on, `POST /sim/customer-token` issues a token for any valid number from the demo bank, so every number that signs in to the app becomes a demo bank customer. Any other organisation the simulator sends for (`SIM_ORGS`, `?tenant=<id>`) issues one only for the three demo numbers (+2348012345678, +2348098765432, +2348031112222) and answer 404 for any other number, which the app reads as "does not know this number". Each sign-in is kept in the store (`app_users` in Firestore) with its first and last time, and the console lists the demo bank's under *Customers* (`GET /sim/customers/recent`); they are the only people its demo tools offer as recipients.

While demo login is off:

- `POST /sim/customer-token` answers 404.
- Every `/sim` route that acts as the bank answers 403 unless the request comes from this machine: `/sim/send`, `/sim/send-tampered`, `/sim/send-fake`, `/sim/calls` (GET, POST, PATCH), `/sim/campaigns` and its actions, `/sim/agent/run`, `/sim/alerts`, `/sim/metrics`, `/sim/seed-reports`, `/sim/send-fake-care`, `/sim/ussd`, `/sim/reset` and `/sim/inbox/admin`. "This machine" is the TCP socket address (127.0.0.1 or ::1); `X-Forwarded-For` is not read, so a server behind a proxy refuses these routes to everyone, which is the intent.
- These stay reachable from anywhere: `/sim/.well-known/jwks.json` (public key), `/sim/config` (demo bank and organisations), `/sim/organisations` (what each organisation publishes), `/sim/inbox` (needs a customer token) and `/sim/registry/*` (the console phone's customer calls, which need a customer token).

### Rotating a bank's hashing key

Each bank's value in `GASKIYA_TENANT_KEYS` is either one base64 key (treated as version 1) or a versioned set:

```json
{ "demobank": { "current": 2, "keys": { "1": "<old base64 key>", "2": "<new base64 key>" } } }
```

New records are always written with the `current` key and store its version. A customer's check tries the current key, then each previous key, and confirms only an exact match on a record of that same version ([decision 0008](decisions/0008-key-rotation.md)). To rotate:

1. Generate a new key: `openssl rand -base64 32`.
2. Change the bank's entry to the versioned form, with the old key under its version (`1` if it was a single key) and the new key under the next number as `current`. Restart the server; `pnpm check:server` validates the set.
3. Keep the old key until every record written under it has expired: `recordTtlDays` (30 days by default) after the restart.
4. Remove the old version from `keys`. Records still keyed under it now return "not confirmed".

Replacing a key in place, without keeping the old one as a previous version, makes every live record return "not confirmed" at once. After a suspected key leak, rotate and remove the old version straight away and accept that cost. Each previous key held adds one store read to checks that find nothing.

With the admin dashboard on, you can rotate and retire keys there instead, with no restart (below). Once you have rotated a bank's key in the dashboard, do not also rotate it in `GASKIYA_TENANT_KEYS`.

### Demo banks

The demo banks are in `packages/api/src/simulator/demo-banks.json`. `demobank` (DemoBank) is the default. `zb` is a second bank for the Zecathon demo. It is **fictional and marked as a demo**. It carries no Zenith name, logo or trademark. Its domains use reserved test TLDs (RFC 2606) and its short code is made up:

```json
{
  "id": "zbdemo",
  "name": "ZB Demo Bank (demo)",
  "domains": ["zbdemo.example", "zbdemo-bank.test"],
  "senderIds": ["ZBDEMO", "ZBDemoBnk", "32999"]
}
```

Locally, run the demo as this bank:

```bash
DEMO_TENANT=zb pnpm dev
```

On first use, `pnpm dev` adds `zbdemo` to `.env` beside DemoBank (it does not replace it). The new entry gets its own hashing key and its own bank client, `zbdemo-sim`. The simulator and console then act for ZB Demo Bank, and the app is offered ZB Demo Bank. Plain `pnpm dev` goes back to DemoBank. Both banks stay configured, and each one's records stay valid.

On a demo deployment with `SIM_ENABLED=true`, add the entry above to `GASKIYA_TENANTS`, giving it `"tokenKeysUrl": "http://127.0.0.1:<PORT>/sim/.well-known/jwks.json"`. Then add a key for it to `GASKIYA_TENANT_KEYS` and a client for it to `GASKIYA_BANK_CLIENTS`, and set:

| Variable | Value |
| --- | --- |
| `SIM_TENANT_ID` | `zbdemo` |
| `SIM_BANK_NAME` | `ZB Demo Bank (demo)` |
| `SIM_BANK_DOMAIN` | `zbdemo.example` (the domain in the simulator's link messages) |
| `SIM_LOOKALIKE_DOMAIN` | `zbdemo-restore.example` (the scam domain in its fake messages) |
| `SIM_CLIENT_ID`, `SIM_CLIENT_SECRET` | the `zbdemo` bank client |

The in-browser sandbox console (the static build with no server) always uses DemoBank.

### What the demo banks publish

The demo banks' presets also say what each bank publishes (`publishes`: official contacts, official apps) and give a scam "customer care" number (`fakeCustomerCare`) for the fake customer care step. None of those numbers is in service. `pnpm dev` fills in what the bank publishes when an older `.env` lacks it.

| Variable | Value |
| --- | --- |
| `SIM_ORGS` | JSON array of `{ tenantId, name, kind, domain, clientId, clientSecret, sampleMessage }`: optional; other organisations the simulator also sends for. Set it yourself on a `SIM_ENABLED` deployment, with each organisation in `GASKIYA_TENANTS`, `GASKIYA_TENANT_KEYS` and `GASKIYA_BANK_CLIENTS` |
| `SIM_FAKE_CUSTOMER_CARE` | JSON `{ whatsapp, handle }`: the scam contact in the fake customer care step. `pnpm dev` sets it from the bank's preset |

## Admin dashboard

The registry serves a dashboard for Gaskiyya operations staff at `/admin/` (locally `http://localhost:8080/admin/`). It covers the whole bank onboarding cycle without editing the environment or restarting ([decision 0020](decisions/0020-admin-dashboard.md)):

- **Onboard** a bank, agency or company with a five-step form: organisation (ID, display and legal name, kind, NIBSS code), official identity (domains, sender IDs, official contacts and apps), integration (customer token JWKS URL or pasted JWKS, sign-in URL, alert emails, technical contact, record lifetime), access (sandbox or live, features, rate limits) and a review. Each step is checked on the server with the same checks the server applies to `GASKIYA_TENANTS` at start-up, and the review step shows every remaining problem before anything is created. The new organisation gets its own hashing key (version 1) and can use every bank API as soon as it has a client.
- **API clients**: create one per bank system. The secret is generated on the server, shown once, and stored only as a salted scrypt hash. Rotate (optionally keeping the old secret working for up to 24 hours) and revoke. A revoked client, and every token it holds, is refused at once. Clients in `GASKIYA_BANK_CLIENTS` are listed too and can be revoked and restored here; their secrets stay in the environment.
- **Hashing keys**: see each version and its state, rotate, and retire a previous version. Key material is never shown.
- **Suspend and reactivate** an organisation. While suspended its API calls answer `403 org_suspended` and its customers' checks answer "cannot check right now", never confirmed.
- **Edit** the profile, features, mode and limits of any organisation, including one from `GASKIYA_TENANTS` (the edited profile is stored in the registry and replaces the configured one until you reset it).
- **Alerts**: send a test email, and set a webhook that receives the same alerts as signed JSON.
- **Usage**: API calls per day, endpoint, status and client, the recent failed calls, message check coverage, and platform totals. Counts only.
- **Audit log** of every admin action and sign-in: who, what, when and from which address. Secrets are never written to it.

| Variable | What it is |
| --- | --- |
| `ADMIN_USERS` | JSON list of staff logins: `[{ "username": "ada", "passwordHash": "scrypt$..." }]`. Make each entry with `pnpm admin:hash ada` (it asks for the password). The dashboard is off unless this or `ADMIN_PASSWORD` is set |
| `ADMIN_PASSWORD` | Local use only: a plain password (12 or more characters) for the user `admin`. Refused when `NODE_ENV=production`. `pnpm dev` writes a random one to `.env` and prints it |
| `GASKIYA_MASTER_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts, with AES-256-GCM, the hashing keys and webhook signing secrets the dashboard stores. Without it the dashboard can manage organisations but cannot add new ones or rotate keys. Keep it in your secret manager: losing it makes every dashboard-made key unreadable, and those organisations' checks then answer "cannot check" |
| `ADMIN_SESSION_HOURS` | How long a staff sign-in lasts (default 8, at most 72) |
| `ADMIN_REFRESH_SECONDS` | How often each server instance reloads organisations, clients and keys from the store (default 30) |
| `ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE` | Sign-in attempts per address per minute (default 10) |
| `KEY_ACTIVATION_SECONDS` | Delay before a rotated hashing key becomes current, so every instance has it first. Default 0 on the memory store, twice `ADMIN_REFRESH_SECONDS` on Firestore |

Notes for running it:

- Sessions are random tokens; the store holds only their SHA-256. The dashboard keeps its session in an HttpOnly, `SameSite=Strict` cookie (`Secure` in production or over https), and API clients may send the same token as a bearer token. A change made with the cookie must carry the `X-Gaskiya-Admin: 1` header. Signing out ends the session on the server and clears the cookie.
- The dashboard is admin only: `/admin/` serves its files only to a request with a valid session. Without one, pages redirect to the sign-in page at `/admin/login` (a separate bundle with no dashboard code) and other dashboard files answer 401. With no staff login configured, every `/admin` path is 404.
- With more than one server instance, a change made on one reaches the others within `ADMIN_REFRESH_SECONDS`. Revocation and suspension take effect at once on the instance that made them and within that interval elsewhere. A new client for an existing organisation works at once everywhere, because an instance that does not know it yet looks it up in the store. A new organisation is served by the other instances after their next reload.
- The dashboard is built with the other web UIs (`pnpm web:build`). The Docker image includes it.
- New organisations start in sandbox: they can call every API, but are not listed in `GET /v1/organisations`, `GET /v1/banks` marks them `"sandbox": true`, and a contact check that matches one answers "cannot check". Switch to live when the go-live checklist on the organisation's page is complete.
- Features: `messages`, `calls`, `receipts`, `simSwap` and `advisories` gate the matching bank API calls (`403 feature_disabled`). `ussd` and `whatsapp` gate those channels for the organisation named in `USSD_TENANT_ID` and `WHATSAPP_TENANT_ID`.
- Alert webhooks are posted as JSON with `x-gaskiyya-event` and `x-gaskiyya-signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 of `<t>.<body>` with the signing secret shown once when the webhook is saved. Events: `registration_alert`, `campaign_alert`, `sim_swap` and `test`. They carry IDs, counts and domains, never message text or phone numbers.
- With the dashboard on, `GASKIYA_TENANTS` may be an empty list (`[]`); organisations can all be added in the dashboard.

## Storage (MongoDB)

The registry stores its records in MongoDB ([decision 0023](decisions/0023-mongodb.md)). MongoDB Atlas works, including the free M0 tier.

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | Setting it switches storage to MongoDB. Prefer Atlas's standard `mongodb://host1,host2,host3/?tls=true&replicaSet=...&authSource=admin` string over `mongodb+srv://`: some networks return DNS answers for the SRV lookup that Node cannot read |
| `MONGODB_DB` | Database name, default `gaskiyya` |
| `MONGODB_COLLECTION_PREFIX` | `gaskiya` in production. Use another prefix (or database) for local development, so a demo reset can never touch production data |
| `STORE` | `mongo`, `firestore` or `memory`. Only needed to override the choice `MONGODB_URI` makes |

**Atlas setup:** create a database user with read and write access, and add the server's public IP under *Network Access* (for the AWS box, `16.192.138.140`). On start the server pings the database and creates its indexes; it will not start if the database cannot be reached.

- **Expiry:** TTL indexes delete expired messages, call sessions, verification logs, idempotency keys, sessions, API usage and rate-limit windows (MongoDB checks about once a minute; reads check expiry themselves).
- **Counters:** each bank's dashboard numbers live in one document updated with atomic increments, and API usage in one document per bank per day, so the dashboard reads one document instead of many.
- **Transactions:** message and receipt registration with an idempotency key runs in a transaction, which needs a replica set. Atlas always has one; for a self-hosted server, run a one-node replica set.
- **Region:** put the cluster in the region nearest the server. A verification is one or two reads.
- **Tests:** `GASKIYA_TEST_STORE=mongo pnpm exec vitest run` runs the whole suite against a real MongoDB that the tests start themselves. CI runs it on every push.

Without `MONGODB_URI` (or `FIRESTORE_PROJECT_ID`), records are kept in memory and lost on restart; the server refuses this when `NODE_ENV=production`.

### Firestore (previous store)

The Firestore store is still built in. Set `STORE=firestore` and `FIRESTORE_PROJECT_ID` (plus `FIRESTORE_SERVICE_ACCOUNT_JSON`, and optionally `FIRESTORE_DATABASE_ID`, `FIRESTORE_COLLECTION_PREFIX` and `FIRESTORE_STATS_SHARDS`) to use it, and deploy the indexes, TTL policies and rules in `firestore.indexes.json` and `firestore.rules`. On the free Spark plan its daily read quota is easy to exhaust; see decision 0023.

## Optional

| Area | Variables | Notes |
| --- | --- | --- |
| Network | `PORT` (8080), `HOST`, `CORS_ORIGINS` (none), `TRUST_PROXY` (false) | Put mutual TLS and the bank's IP allowlist on the ingress or API gateway in front. `CORS_ORIGINS` is a comma-separated list of browser origins; empty allows none, `*` allows any and is refused in production. Set `TRUST_PROXY=true` behind Cloud Run or a load balancer so per-IP limits see the real client |
| Behaviour | `RECORD_TTL_DAYS` (30), `RECEIPT_TTL_DAYS` (30), `CALL_RING_SECONDS` (180), `REGISTER_MAX_FUTURE_SECONDS` (300), `LOG_LEVEL` | A registration whose `sentAt` is more than `REGISTER_MAX_FUTURE_SECONDS` ahead of server time is refused (400 `sent_at_in_future`), and so is one older than the TTL (400 `sent_at_expired`). `RECEIPT_TTL_DAYS` is how long a registered transfer receipt can be checked |
| Behaviour | `RECORD_TTL_DAYS` (30), `CALL_RING_SECONDS` (180), `REGISTER_MAX_FUTURE_SECONDS` (300), `ADVISORY_TTL_DAYS` (14), `LOG_LEVEL` | A registration whose `sentAt` is more than `REGISTER_MAX_FUTURE_SECONDS` ahead of server time is refused (400 `sent_at_in_future`), and so is one older than the TTL (400 `sent_at_expired`). An approved fraud advisory is shown to customers for `ADVISORY_TTL_DAYS` from approval unless withdrawn sooner ([decision 0018](decisions/0018-advisory-outreach.md)) |
| Rate limits | `VERIFY_RATE_LIMIT_PER_MINUTE` (30), `REPORT_RATE_LIMIT_PER_MINUTE` (10), `TOKEN_RATE_LIMIT_PER_MINUTE` (20), `RATE_LIMIT_STORE` | Checks and reports count per customer, `/v1/oauth/token` per client IP. `RATE_LIMIT_STORE` is `store` (counts shared by every instance through the database, in `<prefix>_ratelimits`, deleted by a TTL index) or `memory` (per instance); it defaults to `store` when a database is in use. If the database fails, each instance falls back to counting in memory |
| Campaign agent | `AGENT_IN_PROCESS` (`true`), `AGENT_INTERVAL_SECONDS` (60), `AGENT_JOB_TOKEN` | See below |
| Registration guard | `REG_SPIKE_WINDOW_MINUTES` (5), `REG_SPIKE_BASELINE_MINUTES` (60), `REG_SPIKE_FACTOR` (5), `REG_SPIKE_MIN_COUNT` (200) | Alerts the fraud desk (console, `/v1/registration-alerts`, email) when registrations in the window reach the minimum and exceed the factor times the trailing rate. Link domains outside the tenant's `domains` always alert. Never blocks |
| AI | `AI_PROVIDER` (`gemini` default, `openai`, `ollama`, `none`), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `OLLAMA_URL` (`http://127.0.0.1:11434`), `OLLAMA_MODEL` (`qwen3:4b-instruct`), `OLLAMA_VISION_MODEL` (`gemma3:4b`), `OLLAMA_EMBEDDING_MODEL` (`nomic-embed-text`), `AI_TIMEOUT_MS` (4000; 10000 with `ollama`) | No key: fixed fallback explanations. `ollama` runs open-weights models inside the bank's network and needs no key; if Ollama is unreachable or a model is not pulled, each call uses the fixed fallback. See [decision 0011](decisions/0011-open-source-model.md). Verdicts never depend on it. Hosted defaults (checked against the provider model lists on 2026-10-20): `gemini-3.8-flash` and `gemini-embedding-001`; `gpt-5.4-mini` and `text-embedding-3-small` |
| Campaign agent AI | `AGENT_AI_PROVIDER` (`ollama` default, `same`, `none`), `AGENT_OLLAMA_MODEL` (`qwen3:4b-instruct`), `AGENT_AI_TIMEOUT_MS` (`60000`) | The agent uses its model only to write the campaign briefing and the draft warning an analyst reviews. By default that is Qwen3 4B on the local Ollama at `OLLAMA_URL` (`ollama pull qwen3:4b-instruct`), so report text stays on the server. `same` uses `AI_PROVIDER`; `none` writes template briefings. If Ollama is unreachable or slow, the agent writes the template briefing and still groups the reports |
| Push | `FCM_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`, `FCM_PROJECT_ID` | See below |
| iPhone call ringing | `APNS_KEY_P8` or `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` (`false`) | See below |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `CONSOLE_URL` | See below |
| WhatsApp | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TENANT_ID` | All four or none. Webhook URL: `https://<host>/webhooks/whatsapp` |
| USSD | `USSD_WEBHOOK_TOKEN`, `USSD_TENANT_ID` | Empty token: route off. See below |
| Licence check | `LICENCE_DATA_DIR` (bundled lists), `LICENCE_MAX_AGE_DAYS` (120) | See [Licence lists](#licence-lists) below |
| SIM swap | `SIM_SWAP_PROVIDER` (`none`), `SIM_SWAP_API_URL`, `SIM_SWAP_TOKEN_URL`, `SIM_SWAP_CLIENT_ID`, `SIM_SWAP_CLIENT_SECRET`, `SIM_SWAP_SCOPE`, `SIM_SWAP_TIMEOUT_MS` (3000), `SIM_SWAP_WARN_HOURS` (72), `SIM_SWAP_WAIT_MS` (800), `SIM_SWAP_CACHE_SECONDS` (60), `SIM_SWAP_RATE_LIMIT_PER_MINUTE` (600) | Off by default. See below |
| Demo only | `ALLOW_DEMO_RESET` | Refused when `NODE_ENV=production` |
| Load test (`pnpm load` only) | `LOAD_URL`, `LOAD_CLIENT_ID`, `LOAD_CLIENT_SECRET`, `LOAD_CUSTOMER_TOKEN_URL`, `LOAD_DURATION` (10), `LOAD_CONNECTIONS` (50), `LOAD_BATCH_SIZE` (100), `LOAD_PHONES` (200) | Never read by the server. Without `LOAD_URL` the registry runs in-process on the memory store. See [PERFORMANCE.md](PERFORMANCE.md) |

## Licence lists

"Is this lender licensed?" (`POST /v1/verify/licence`, WhatsApp `LOAN <name>`, USSD option 4) answers from regulators' published licence lists ([decision 0016](decisions/0016-licence-registry.md)). Each list is one JSON data file in `packages/licences/data/`, written by an importer from the regulator's public page, with its source URL and retrieval date:

| File | Source | Read from |
| --- | --- | --- |
| `fccpc-digital-lenders.json` | FCCPC approved digital lenders (full approval, conditional approval, CBN waivers) | https://fccpc.gov.ng/registration-of-digital-money-lenders/approvals-of-dmls/ (HTML tables) |
| `cbn-*.json` | CBN commercial, merchant, non-interest, payment service, microfinance and primary mortgage banks, and finance companies | `https://www.cbn.gov.ng/Supervision/Inst-*.html`, through the JSON endpoints those pages load (`/api/GetDMBs` and so on) |
| `cbn-payment-service-providers.json` | CBN payment service providers (mobile money, switching, payment solutions, terminals, super-agents) | https://www.cbn.gov.ng/PaymentsSystem/PSPs.html (HTML tables) |

Refresh them with `pnpm licences:import` (or `licences:import:fccpc` / `licences:import:cbn`). To replay an import from saved downloads, set `LICENCE_SOURCE_DIR` (a directory holding `approvals-of-dmls.html`, `Get*.json` and `PSPs.html`) and `LICENCE_RETRIEVED_AT` (the download date); these two are read by the importers only, never by the server. An importer that parses implausibly few entries stops without writing.

The server uses the bundled files unless `LICENCE_DATA_DIR` names a directory of data files, which it re-reads every 10 minutes. In production, run the importers on a schedule (for example a weekly Cloud Scheduler job) that writes into that directory, or commit the refreshed files and redeploy. A failed re-read keeps the last good lists.

Freshness fails closed: once a list's retrieval date is more than `LICENCE_MAX_AGE_DAYS` old, an exact hit on that list and every "not listed" answer become "cannot check", because absence from an old list proves nothing. `GET /v1/metrics` reports each list's retrieval date, entry count and whether it is stale (`licenceData`), and counts licence checks by verdict (`licenceChecks`). The name asked about is never stored or logged.

## Campaign agent

The campaign agent groups scam reports into campaigns and writes a fraud-desk briefing for each one: the likely scam pattern, the channel the fraudsters impersonate, and a draft customer advisory. With an AI key the briefing is written by the model from masked report text; without one, or when the model's output fails validation, it is built from the campaign's own fields. Advisories are always drafts until an analyst approves them in the console, and the agent never sends anything ([decision 0009](decisions/0009-campaign-briefing.md)).

When a named analyst approves an advisory, the registry publishes it to that bank's app users ([decision 0018](decisions/0018-advisory-outreach.md)): it is listed by `GET /v1/advisories`, appears in the app's "Alerts from your bank" section and in the WhatsApp `ALERTS` reply, and each of the bank's registered app devices gets one push notice (on the Android channel `advisories`), the first time only. It stays up for `ADVISORY_TTL_DAYS` (14 by default) or until an analyst withdraws it (`POST /v1/campaigns/:id/withdraw`). The registry never sends an SMS: the bank sends the warning through its own gateway and registers each one with `POST /v1/messages` (category `security_notice`), so a customer who checks the warning sees it confirmed. In the demo, the console's **Send to customers** button does exactly that.

By default (`AGENT_IN_PROCESS=true`) the server runs one pass every `AGENT_INTERVAL_SECONDS`. That suits local development and a single replica. With several replicas every one of them would run it, so in production run it as a separate scheduled job instead:

1. Set `AGENT_IN_PROCESS=false` on the server.
2. Run one pass per tick with either:
   - **A job:** `pnpm agent:run` with the same environment as the server (for example a Cloud Run job triggered by Cloud Scheduler, or a Kubernetes CronJob). It runs one pass for every bank, sends the fraud-desk alert emails, prints counts only and exits non-zero on failure.
   - **An HTTP target:** set `AGENT_JOB_TOKEN` (at least 32 characters, `openssl rand -hex 32`) and point the scheduler at `POST https://<host>/internal/agent/run` with the header `Authorization: Bearer <AGENT_JOB_TOKEN>`. Without the token the route does not exist. For example:

```bash
gcloud scheduler jobs create http gaskiyya-campaign-agent \
  --schedule="* * * * *" --http-method=POST \
  --uri="https://<host>/internal/agent/run" \
  --headers="Authorization=Bearer <AGENT_JOB_TOKEN>"
```

Banks can still trigger a pass for their own tenant from the console (`POST /v1/agent/run`).

## USSD (Africa's Talking)

Customers without a smartphone or data dial the bank's USSD code. The menu offers "Is my bank calling me?" (the open call session's code and purpose, or advice to hang up) and "Messages my bank sent me today" (category, channel and time of each registered message, paged with 98). The number the mobile network supplies is the customer identity; nothing the customer types is stored.

1. Generate a secret of at least 24 random characters, for example `openssl rand -base64 32 | tr -d '/+='`, and set it as `USSD_WEBHOOK_TOKEN`. Set `USSD_TENANT_ID` to the bank the code answers for (default: the first tenant). Restart, and `pnpm check:server` shows USSD as on.
2. In the Africa's Talking dashboard, open USSD > Service codes and create (or request) a channel, for example `*347*123#`. Sandbox codes work for testing with the Africa's Talking simulator.
3. Set the channel's callback URL to `https://<host>/webhooks/ussd?token=<USSD_WEBHOOK_TOKEN>`. It must be HTTPS, so the secret travels encrypted. Africa's Talking does not sign USSD callbacks; the secret in the URL is what authenticates them, and the server never logs query strings. Rotate it by changing both places.
4. Africa's Talking posts `application/x-www-form-urlencoded` fields `sessionId`, `serviceCode`, `phoneNumber`, `networkCode` and `text` (the session's inputs joined with `*`). The server answers `text/plain` starting `CON ` or `END `, at most 160 plain ASCII characters per screen.
5. Optionally restrict the route at the ingress to Africa's Talking's published callback addresses.

Without the secret, or with the wrong one, the route answers 404 or 403. If the store cannot be reached the customer sees "cannot check right now", never a confirmation. Checks are rate limited per number with `VERIFY_RATE_LIMIT_PER_MINUTE`.

The bank console's USSD page has a feature phone that dials the code through the bank simulator, which adds the secret, so it never reaches the browser. `pnpm dev` generates a secret for it when `.env` has none.

## SIM swap (GSMA Open Gateway / CAMARA)

A fraudster who moves a customer's number to a new SIM receives their one-time codes. With a provider configured, the registry asks the mobile network when a number's SIM last changed ([decision 0017](decisions/0017-sim-swap.md)). It only ever adds a caution. It never changes or confirms a verdict.

1. Get API access to the operator's CAMARA **SIM Swap** API (v2; `POST /check` and `POST /retrieve-date`), directly or through an aggregator, with an OAuth 2.0 client-credentials client and the scopes `sim-swap:check sim-swap:retrieve-date`.
2. Set:
   - `SIM_SWAP_PROVIDER=camara`
   - `SIM_SWAP_API_URL`: the API root including the version, for example `https://api.operator.example/sim-swap/v2`
   - `SIM_SWAP_TOKEN_URL`
   - `SIM_SWAP_CLIENT_ID`, `SIM_SWAP_CLIENT_SECRET`, and `SIM_SWAP_SCOPE` if your scopes differ

   Both URLs must be HTTPS in production. Restart. `pnpm check:server` requests a token, which proves the URL and credentials without asking about any number.
3. Tune:
   - `SIM_SWAP_TIMEOUT_MS`: each HTTP request to the network.
   - `SIM_SWAP_WAIT_MS`: the most a customer's check or a one-time-code registration waits for the network. Past it, the verdict goes out without the SIM status.
   - `SIM_SWAP_WARN_HOURS`: how recent a change must be to warn the customer.
   - `SIM_SWAP_CACHE_SECONDS`: how long one answer is reused for the same number.
   - `SIM_SWAP_RATE_LIMIT_PER_MINUTE`: `POST /v1/sim-swap/check` calls per bank client.

What a bank gets:

- **`POST /v1/sim-swap/check`** `{phone, maxAgeHours}` returns `swapped`, `not_swapped` or `unknown`. When the network fails, times out or is not configured, the answer is `unknown`, never `not_swapped`, so treat `unknown` as risky (hold the code, or step up). The number goes in the body, never in a URL.
- **One-time-code registrations** (`category: "otp"`) return `simSwapWarning` and `simSwapStatus`, so the gateway can hold the code. The registration always succeeds.
- **Customer checks** from a recently swapped number carry `warnings: ["sim_swapped_recently"]` (app banner, WhatsApp, USSD). The fraud desk (`alertEmails`) gets one email per number and change, naming the customer by a keyed reference, never by number.
- **`/v1/metrics`** has a `simSwap` block of counts only.

`SIM_SWAP_PROVIDER=simulated` is the demo's in-memory network. The console's *SIM swap* card drives it through `POST /v1/admin/sim-swap`, which exists only with `ALLOW_DEMO_RESET=true` and the simulated network. It is refused when `NODE_ENV=production`. `pnpm dev` and the offline demo turn it on.

## Push notifications (Firebase Cloud Messaging)

Used for "your bank is calling" notices: high priority, with the call code, expiring with the session. A silent update clears the call when it ends. Also used once per approved fraud advisory: a normal-priority notice titled "Fraud warning from <bank>" on the Android channel `advisories`, carrying the advisory id only; the app reads the text from `GET /v1/advisories`. Tokens that Firebase reports as unregistered are deleted automatically.

1. In the Firebase project, register the Android app as `com.gaskiyya.app` and the iOS app as `com.gaskiya.app` (these must match `applicationId` in `mobile/android/app/build.gradle.kts` and the bundle id in Xcode).
2. **Server:** Firebase console > Project settings > Service accounts > *Generate new private key*. Put the JSON (raw or base64) in `FCM_SERVICE_ACCOUNT_JSON`, or its file path in `GOOGLE_APPLICATION_CREDENTIALS`. It must be the same Firebase project the app is built with (`FIREBASE_PROJECT_ID`): Firebase refuses tokens from another project. On the AWS server, save it as the `FCM_SERVICE_ACCOUNT_JSON` secret of the GitHub `production` environment and the deploy writes it into `prod.env` ([DEPLOYMENT.md](DEPLOYMENT.md)).
3. **App:** copy `mobile/firebase.example.json` to `mobile/firebase.json`, fill it from `google-services.json` and `GoogleService-Info.plist`, and build with `flutter run --dart-define-from-file=firebase.json`. Both files are gitignored; the Firebase app keys are never committed.
   - **Release builds (Codemagic):** create an environment group named `gaskiyya_app` with `API_URL` (required) and the seven `FIREBASE_*` values from `firebase.example.json`. `mobile/tool/write_config.mjs` writes them to `mobile/config/production.json` (gitignored) before `flutter build ... --dart-define-from-file=config/production.json`.
   - **Local release build:** copy `mobile/config/production.example.json` to `config/production.json` and fill it in.
   - In Google Cloud console, restrict each Firebase API key to its app (Android package + SHA-1, iOS bundle id). Keys committed before this change remain in git history, so restrict or rotate them.
4. **iOS only:** upload an APNs authentication key in Firebase (Project settings > Cloud Messaging), and enable the *Push Notifications* and *Background Modes > Remote notifications* capabilities in Xcode.
5. Find the device token with `flutter run` (the app registers it with `POST /v1/devices`), then `pnpm check:server --push <token>`.

Without push, call and advisory notices still reach an open app instantly over the live event stream.

## iPhone call ringing (CallKit and APNs VoIP)

On iPhone, a bank's announced call rings like a phone call: the iPhone incoming-call screen with the phone's own ringtone, on the lock screen too, with the caller shown as "DemoBank · Code 1234". Answering plays the same agent voice as the console's simulated phone ("Hello, good day. I am calling from DemoBank. Your code is" and the four digits), from the same clips in `assets/audio/agent`. Mute silences the voice, as on the console. An unanswered call stops ringing after 30 seconds, or when its code expires, and shows as a missed call in Recents. When the bank ends the session first, the app ends the call. The call screen labels it "Gaskiyya Audio": it is an internet call to the app, not a cellular call from the bank's number.

The app registers a VoIP token alongside its Firebase token (`POST /v1/devices` with `voipToken`). A phone with a VoIP token gets the VoIP push instead of the "is calling you" banner; if the VoIP push fails, it gets the banner. Android and phones without a VoIP token are unchanged. Without these settings the server logs `iosCalls: off` and iPhones get the banner only.

1. **Apple Developer account:** Certificates, Identifiers & Profiles > Keys > create a key with *Apple Push Notifications service (APNs)*. Download the `.p8` once. Note its Key ID and your Team ID.
2. **Server:** put the `.p8` contents (raw or base64) in `APNS_KEY_P8`, or its path in `APNS_KEY_FILE`, plus `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_BUNDLE_ID=com.gaskiya.app`. Pushes go to the topic `com.gaskiya.app.voip`. Builds run from Xcode use the APNs sandbox (the default); TestFlight and App Store builds need `APNS_PRODUCTION=true`.
3. **Xcode:** enable *Push Notifications*, and *Background Modes* > *Voice over IP*, *Audio* and *Remote notifications* (already in `Info.plist`).
4. **Phone:** a real iPhone (the Simulator cannot receive VoIP pushes), signed in with the number the console calls. Firebase must be set up for iOS as above, because the VoIP token is registered with the Firebase token. At sign-in the app asks for the microphone once, so no prompt appears during the first answered call; it never records.

## Email (Resend)

The server emails each bank's `alertEmails` when the campaign agent finds a **new scam campaign**, and again if it at least doubles (by at least 3 reports, and at least 30 minutes after the last alert). Emails carry the summary, indicators, domains and the draft advisory, never customer data. Each send has an idempotency key, and a failed send is retried on the next agent run.

1. In Resend, add and verify your sending domain (Domains > Add domain, then the DNS records).
2. Create an API key with *Sending access*. If you want `check:server` to confirm the domain is verified, use *Full access*.
3. Set `RESEND_API_KEY`, `EMAIL_FROM` (for example `Gaskiyya Alerts <alerts@yourdomain.com>`, on the verified domain), optionally `EMAIL_REPLY_TO`, and `CONSOLE_URL` for the button in the email.
4. Add `alertEmails` to each tenant, then run `pnpm check:server --email`.

Customers are not emailed. Gaskiyya stores no customer contact details by design (principle 4); customer-facing advisories, once approved, are sent through the bank's own channels.
