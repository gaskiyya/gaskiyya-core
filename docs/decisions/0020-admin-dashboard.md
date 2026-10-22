# 0020: Platform admin dashboard for bank onboarding

**Status:** accepted, requested by owner, 2026-10-21

Every bank, agency or company used to be added by editing three JSON environment variables (`GASKIYA_TENANTS`, `GASKIYA_TENANT_KEYS`, `GASKIYA_BANK_CLIENTS`) and restarting the registry. Client secrets were chosen by whoever edited the file and sat in plain text in the environment. Nothing recorded who changed what. That does not scale past a pilot, so the registry now has an admin dashboard for Gaskiyya operations staff at `/admin/`, backed by `/v1/admin/*` routes.

## What changes

1. **Staff sign-in.** Off unless `ADMIN_USERS` (usernames with scrypt password hashes, made with `pnpm admin:hash`) or, locally only, `ADMIN_PASSWORD` is set. A session is a random bearer token; the store keeps only its SHA-256. Sign-in is rate limited per address, and an unknown username costs the same time as a wrong password.
2. **Organisations live in the store.** The dashboard adds organisations with every field `GASKIYA_TENANTS` takes, plus a legal name and a technical contact. They are checked with the same function the start-up configuration uses (`profileErrors` in `packages/api/src/orgs.ts`), and the form's review step runs those checks before anything is created. Organisations from the environment keep working and can be edited; an edited profile is stored and replaces the configured one until it is reset.
3. **Status, mode, features and limits.** Each organisation is active or suspended, sandbox or live, has features switched on or off (messages, calls, receipts, SIM swap, advisories, USSD, WhatsApp) and can have its own bank API rate limit and customer check limit.
4. **API clients made on the server.** The dashboard generates each client secret (32 random bytes), shows it once and stores a salted scrypt hash. Rotation can keep the old secret valid for up to 24 hours. Bank tokens carry a generation number: revoking a client, or rotating it with no overlap, raises the number and every token issued before stops working at once. Clients from `GASKIYA_BANK_CLIENTS` can be revoked and restored here.
5. **Hashing keys made and rotated on the server.** A new organisation gets a random 32-byte key, version 1. Rotation adds the next version and retiring removes an old one, exactly as decision 0008 describes for the environment. Keys made here are encrypted with AES-256-GCM under `GASKIYA_MASTER_KEY` before they are stored, and are never shown. A rotated key becomes current only after `KEY_ACTIVATION_SECONDS`, so every server instance has loaded it before any of them writes records with it.
6. **Alert webhooks.** Besides alert emails, an organisation can receive registration, campaign and SIM swap alerts as JSON signed with HMAC-SHA256. The signing secret is shown once and stored encrypted.
7. **Usage and audit.** The registry counts bank API calls per organisation, day, route, status and client, and keeps the last failed calls (route, status and error code). Every admin action and sign-in is written to an audit log with who, what, when and from where.

## Safety boundary

- **Principle 1.** Nothing in the dashboard can confirm a message. Confirmation is still only an exact match on a registered record, keyed with the organisation's own key.
- **Principle 2.** A suspended organisation is not enrolled: its customers' checks answer "cannot check right now", never confirmed, and its contacts, links and announced calls are not vouched for meanwhile. A key that cannot be decrypted (missing or wrong master key) leaves the organisation without a key, so its checks also answer "cannot check". A contact check that matches a sandbox or suspended organisation answers "cannot check".
- **Principle 3.** Unchanged: records stay keyed to the recipient's number under the organisation's key.
- **Principle 4.** Usage counts hold route patterns, status codes and client IDs only. No request body, query string, number or message text is stored or logged. Audit entries hold field names and hints such as the first characters of a client secret, never a secret.
- **Principle 5.** Banks change nothing customers see. A new organisation integrates with the same one call per message.
- **Principle 6.** The dashboard is for staff and asks staff for their own password; no customer screen changes.

## Costs and limits

- With several server instances, each reloads organisations, clients and keys every `ADMIN_REFRESH_SECONDS` (30 by default). Revocation and suspension apply at once on the instance that made them and within that interval on the others.
- `GASKIYA_MASTER_KEY` becomes as important as the hashing keys: losing it makes every key the dashboard made unreadable. Keep it in the secret manager next to `GASKIYA_TOKEN_SECRET`.
- The dashboard does not replace the data protection review and contract steps of onboarding; it records the result of them.
