# 0012: Copy wording fixes from the QA pass (F10, F11, F14)

**Status:** accepted (approved by owner, 2026-10-20: "fix all")

The QA report of 20 October 2026 (`apps/web/docs/qa/2026-10-20-qa-report.md`) found three places where fixed customer text said more, or less, than the product does. The owner approved the wording below. No `verdict.*` text changed.

## Decision

### F10: a plural mismatch line for several open calls

When more than one agent from a bank is calling the same customer, every code is shown, but the line under them said "this exact code".

- **Added** `call.mismatchMany`: "If the caller cannot read one of these codes exactly, hang up."
- `call.mismatch` ("If the caller cannot read this exact code, hang up.") is unchanged and is still used whenever exactly one code is shown.
- Used for more than one code in: the app's Calls tab (per bank), the WhatsApp `CALL` reply (`callReply` in `apps/api/src/whatsapp.ts`), the console's phone view, and USSD option 1 (`callingMany` in `apps/api/src/ussd.ts`). On USSD the codes share one line ("Call code: 4821, 9031, 1442") so three codes and the plural line fit one 160-character screen in every language (LANG-7 checks it); if a screen would still overflow, the oldest codes are left off.

### F14: a link on the bank's domain has its own tag

A link whose host is a registered bank domain is not a confirmation that a message is genuine (an open redirect on that domain would still pass).

- **Added** `link.belongs.short`: "Bank domain". The app's result sheet and the console's phone view show it as the tag on a bank-domain link, in a neutral colour; the "Confirmed" tag is never used for a link.
- **Changed** `link.belongs.body`:
  - Old: "{domain} is registered by {bank}."
  - New: "{domain} is registered by {bank}. This does not confirm that a message is genuine."

### F11: privacy wording matches what the app sends

A message that is not confirmed is explained by sending its text, with long numbers hidden (`maskDigits`), to `POST /v1/explain`. The text is not stored. The old wording said only the fingerprint ever leaves the phone.

- `app.check.fingerprintNote` (Check screen)
  - Old: "The message is fingerprinted on this phone. Only the fingerprint is sent."
  - New: "The message is fingerprinted on this phone. Only the fingerprint is sent to check the message. If it is not confirmed, the text, with long numbers hidden, is sent to explain why."
- `app.settings.textStays` (Settings, Privacy)
  - Old: "Message text stays on this phone"
  - New: "Message text is not stored. To explain a result, the text is sent once with long numbers hidden."
- `app.onboarding.privacy.body` (introduction, privacy slide)
  - Old: "Message text is fingerprinted on your phone. Only the fingerprint is checked, never the words."
  - New: "Message text is fingerprinted on your phone. Only the fingerprint decides the result, never the words. To explain a result that is not confirmed, the text is sent once with long numbers hidden."
- `app.onboarding.message.body` (introduction, message slide), which left out the third answer:
  - Old: "Share an SMS, WhatsApp message or link to Gaskiyya. Your bank either confirms it sent it to you, or it didn't."
  - New: "Share an SMS, WhatsApp message or link to Gaskiyya. Your bank either confirms it sent it to you or it didn't, or Gaskiyya tells you it cannot check right now."

The first sentence of the Check note and of the privacy slide is kept; only the overstated sentence is replaced. The key name `textStays` is kept so that overlays and tests need no rename. The Settings privacy rows now wrap instead of being cut to one line.

The same claim was corrected outside `copy.json`: the marketing site (`apps/web/index.html`, step 02), `apps/web/docs/DESIGN.md` (verification flow, step 2), `apps/web/docs/whitepaper/whitepaper.html` and `apps/web/docs/pitch/deck.md` (Channels). The whitepaper PDF is rebuilt with `pnpm whitepaper`.

## Translations

All four overlays (`copy.pcm.json`, `copy.ha.json`, `copy.yo.json`, `copy.ig.json`) carry the new and changed keys, ASCII with `\uXXXX` escapes. Like every overlay text they were drafted without a native speaker and keep the `_review` marker (decision 0006). `pnpm sync:copy` copied them into the app.

## Consequences

- The privacy rows describe the explanation step accurately. Asking before sending text for an explanation (a consent toggle) would let the wording become stricter again; it is not part of this decision.
- Screenshot checks that fall back to the server upload the image; that path is described in `apps/web/docs/DESIGN.md` and is not covered by these lines.
