# 0014: Official contacts and official apps

**Status:** accepted (approved by owner, 2026-10-20)

Fraud gaps #7 and #10. Many scams never forge a message at all. They send the customer to a fake "customer care" WhatsApp number or social account, or to a fake app. This note extends the registry to cover both without weakening any principle.

## Decision

### Banks

- The Gaskiyya app links only banks. At sign-in it asks each bank on the registry whether it knows the number, through that bank's own customer-token endpoint.
- A tenant has a `kind`, which defaults to `bank`. Customer-facing text names the organisation through the existing `{bank}` placeholder; `copyForOrg(language, kind)` in `packages/schemas` and `Copy.tOrg` in the app return the normal copy for a bank.
- `GET /v1/organisations` lists every organisation with its kind, domains, sender IDs, official contacts and official apps. All of these are public by nature. `GET /v1/banks` keeps its shape and gains `kind`.

### Official contacts (#7)

- A tenant declares `officialContacts`: voice `phones`, `whatsapp` numbers, `emails`, and `social` accounts (`x`, `facebook`, `instagram`, `tiktok`, `telegram`). They are configuration, never stored data, and are validated at start-up.
- `POST /v1/verify/contact {contact, tenantId?}`. The customer pastes a number, email, @handle or profile link. Without `tenantId`, every organisation is checked.
- How a pasted contact is matched:
  - A phone number is normalised with `normalisePhone`; a local Nigerian `0` number is read as `+234`. It matches a voice or WhatsApp number.
  - A `wa.me` link matches only a WhatsApp number.
  - An email is lower-cased and must be the same address.
  - A profile link must be the same handle on the same platform.
  - A bare @handle matches that handle on any platform.
- Verdicts, decided in `decideContactVerdict` (verdict.ts):
  - `official`: only on an exact match. The answer names the organisation and the kind of contact.
  - `not_official`: anything else. It adds an `impersonation` reason when a handle, or an email's local part or domain, contains an organisation's brand skeleton (the same `skeleton()` as the link lookalike check). An unlisted address on the organisation's own domain is not an imitation.
  - `cannot_check`: when the registry's store does not answer (fail closed, as `/health` already treats a store outage).
- `official` is never `confirmed`. Caller ID and display names can be faked, so every official answer carries `official.contact.spoofNote`.
- The route is rate limited like the other checks. The contact itself is neither stored nor logged; only a count is kept (`contactChecks` in metrics).
- Channels:
  - **App:** a "Check a number or account" entry. Pasted text that is only a contact is routed to this check automatically.
  - **WhatsApp:** a message that is only a contact gets the contact answer.
  - **USSD:** option 3, "Is this number my bank's?", checks against that USSD organisation only.
  - **Console:** a Contacts page shows what each organisation declared and runs the "fake customer care" step.

### Official apps (#10)

- A tenant declares `officialApps`: Android package IDs and App Store IDs (or App Store URLs).
- A Play Store or App Store link returns the new link verdict `official_app`, but only on an exact ID match with no warning sign. Like `belongs`, it is never "confirmed".
- An APK download link always carries the `apk` and `fake_app` reasons, so it is never anything but `not_confirmed`, even on the organisation's own domain.
- A store page with an unregistered ID whose package or listing name contains the brand skeleton carries `fake_app`.
- The decision is in `decideLinkVerdict`. `link.ts` only gathers the facts.

## Copy keys added

These are additive only, all under the new top-level `official` namespace in `packages/schemas/copy.json`. No existing key changed. All are translated in `copy.pcm.json`, `copy.ha.json`, `copy.yo.json` and `copy.ig.json` (still marked "needs native-speaker review"), and synced to the app with `pnpm sync:copy`.

- `official.org.*` (texts that name the organisation instead of saying "your bank"):
  - `confirmedTitle`, `cannotCheckBody`
  - `notCallingTitle`, `notCallingBody`
  - `explainFallback`, `explainAction`
  - `otpAdvice`
  - `linkBelongsTitle`, `linkLookalike`
  - `reportPrompt`, `reportThanks`
  - `activityHeading`
  - `ussdMenu`, `ussdOption`
- `official.kinds.{bank,agency,company}`
- `official.contact.official.{title,body,short}`
- `official.contact.not_official.{title,body,bodyAny,short}`
- `official.contact.{cannotCheckBody,impersonation,spoofNote,notAContact}`
- `official.contact.kinds.{phone,whatsapp,email,social}`
- `official.contact.platforms.{x,facebook,instagram,tiktok,telegram}`
- `official.apps.{officialTitle,officialBody,short,apk,fakeApp}`
- `official.ussd.{option,enterNumber,official,notOfficial,badNumber}`
- `official.app.{checkContact,placeholder,contactCheck,appCheck,contact,organisation}`

Every USSD screen these keys make fits 160 plain ASCII characters in every language (LANG-7, OFF-9). No new text asks for a secret, and no warning reassures (LANG-2, OFF-11, SEC-5).

## Consequences

- USSD's menu gains option 3, so `3` is no longer an invalid menu choice. USSD-7 now uses `4` as its invalid input.
- The demo bank's preset keeps its identity fields unchanged. What it publishes sits beside them in `publishes`, and `demoTenant()` merges the two.
- Model prompts still describe the sender as a bank. The model never decides, and its output is checked as before. The fixed fallback text names the organisation.
- Requirements OFF-1 to OFF-12 (docs/DESIGN.md) cover this note.
