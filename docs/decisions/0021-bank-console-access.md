# 0021: Bank console access codes

**Status:** accepted (requested by owner, 2026-10-22)

The bank console was a demo tool: every screen called the `/sim` routes, which act as DemoBank's own systems, so a registered bank had no way to see its own data. The console is now a dashboard each organisation gets once it is registered, and DemoBank stays its default.

## Sign-in codes

Revised the same day at the owner's request: one short code per organisation, issued automatically, and no console without it.

- **One code per organisation, issued on registration.** Every organisation gets its code when it is onboarded in the admin dashboard, and every organisation already configured (including DemoBank) gets one when the server starts. Staff see it, copy it and regenerate it on the organisation's *Bank console* tab.
- **Six characters, signed with the organisation's key.** The code is `HMAC(organisation hashing key, "console:<org>:<generation>")`, encoded as six Crockford base32 characters (no I, L, O or U). People can type it in any case, with spaces, and with O or I for 0 or 1.
- **Unique and owned.** It is found by `HMAC(GASKIYA_TOKEN_SECRET, code)`, so it maps to exactly one organisation, and a copy of the store alone cannot be searched for codes. If a new code would collide with any code ever issued, the next generation is used.
- **Regenerate.** A new generation replaces the code; the old one stops working and every session it opened ends.
- **Guessing.** Six characters is about a billion codes. Sign-in is limited per address (`ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE`, default 10) and to 300 failed attempts a minute across all addresses, after which sign-in pauses for a minute.
- **Sessions and audit.** Signing in returns a `gsc_` bearer token for 12 hours (stored as a hash). Code issue and regeneration, sign-ins, approvals, withdrawals and dismissals are in the audit log; the organisation sees its own entries without IP addresses under *Activity*.

## What a bank sees

`/v1/console/*`, scoped to the session's organisation only: overview (coverage, check outcomes, 14-day API traffic, things needing attention), fraud desk (campaigns, approving and withdrawing advisories with the analyst's name, registration alerts), integration (API clients without secrets, hashing key state, webhook, usage, recent errors, go-live checklist), organisation profile (read-only; changes go through Gaskiyya) and activity. Approving an advisory from the console sends the same alert email as `POST /v1/campaigns/:id/approve`.

## DemoBank

The console always opens on the sign-in page. A demo server (`SIM_ENABLED=true` with `SIM_DEMO_LOGIN=true`) shows the demo bank's code at the foot of that page (`GET /v1/console/demo`), and signing in with it opens DemoBank's workspace with the demo tools (messages, calls, transfers, USSD, contacts, licence check). The simulator routes that act as the bank (`/sim/send`, `/sim/calls` and the rest) now need that DemoBank console session; the routes the phone app uses (`/sim/customer-token`, `/sim/inbox`, `/sim/config`, keys) stay open.

Anyone who signs in to the Gaskiyya app with their number on a demo server becomes a DemoBank customer, and only that: the app offers the number to each organisation, DemoBank's demo login accepts any number, and the demo agencies accept only the demo customers (404 for anyone else). Each sign-in is kept in the store with its first and last time (per organisation; demo data only, so the number is kept in the clear as the bank would keep it, and a demo reset does not clear it). The console's *Customers* page lists DemoBank's newest 200, with Call (announces the call, which rings the app through push and, on an iPhone, CallKit), Text (a registered message), a scam test and a SIM check for each; the same numbers are offered as recipients on the demo tool pages.

In the in-browser sandbox the demo code is derived in the browser and shown the same way; other codes are sent to the live registry's console (`REGISTRY_CONSOLE_URL` at build time).

## Not done

- One code per organisation, not per person; the analyst's name is typed when approving. Personal accounts with roles would replace codes if a bank asks for them.
- Profile changes, API clients and keys stay with Gaskiyya staff.
