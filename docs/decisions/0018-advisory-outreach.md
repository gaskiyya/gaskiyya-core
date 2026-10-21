# 0018: Approved fraud warnings reach customers, and are themselves verifiable

**Status:** accepted, approved by owner, 2026-10-20

Until now an approved advisory stayed on the fraud desk: approval recorded the analyst and sent nothing ([decision 0009](0009-campaign-briefing.md)). The bank had to publish it through its own channels, slowly, and a warning SMS was itself something a fraudster could imitate. This decision closes both gaps.

## What changes

1. **Approval publishes to the bank's app users.** When a named analyst approves an advisory (`POST /v1/campaigns/:id/approve`, unchanged), the registry:
   - lists it in `GET /v1/advisories` for every customer of that bank (customer token; the bank's id, title, approved text, `approvedAt`, `expiresAt`, the campaign's indicators and lookalike link domains, and whether the fakes ask for a callback; nothing about any customer, report or analyst);
   - publishes one live event (`advisory.published`) on the bank's advisory channel of `GET /v1/events`, and sends one push notice to each of the bank's registered app devices. The notice carries the bank and advisory id only, never the text. It goes out the first time an advisory is approved and never again for that advisory (`advisory.notifiedAt`), whatever the number of re-approvals or polls.
2. **Advisories expire and can be withdrawn.** An approved advisory is shown until `approvedAt + ADVISORY_TTL_DAYS` (14 by default). A named analyst can withdraw it (`POST /v1/campaigns/:id/withdraw`, body `{ "analyst": "..." }`); it leaves every app at once (`advisory.withdrawn` live event) and the WhatsApp reply. The agent never rewrites an approved or withdrawn advisory.
3. **The warning SMS is registered like any other bank message.** The registry still sends no SMS or WhatsApp message to customers. The bank sends the approved text through its own gateway and registers each copy with `POST /v1/messages` (category `security_notice`, an existing category). A customer who checks the warning sees it confirmed as sent by the bank; the same text sent to anyone else, or an edited copy, is not confirmed (principles 1 and 3). In the demo, the bank sandbox console's **Send to customers** button acts as the bank: it registers each warning, then delivers it to the demo customers' inboxes.
4. **Channels.** The app shows an "Alerts from your bank" section on the Activity tab, per linked bank, with the lookalike domain highlighted and never tappable; a push or live notice opens it. WhatsApp answers `ALERTS` with the active advisories, framed in the customer's language, with lookalike domains defanged (`demobank-restore[.]com`) so WhatsApp does not turn them into links. USSD is unchanged: the menu has no room for a further option within 160 characters in every language once options 3 and 4 are added.

## Safety boundary

- **Only a named analyst publishes.** The campaign agent keeps exactly four tools; none sends, approves, publishes or withdraws, and no agent code path reaches the publishing code (tests ADV-5, AI-5, AI-9).
- **Principle 6.** The approved text must pass the same gate as every drafted advisory (`guardAdvisory`: no request for a secret, no claim that anything is genuine or verified, no long digit run). Text that fails is refused with 422 `unsafe_advisory` and never approved; `GET /v1/advisories` applies the gate again, so text altered in the store afterwards is not shown. The fixed words around a warning (copy `advisory.*`) never ask for a secret in any language.
- **Principle 2.** If the store cannot be read, `GET /v1/advisories` answers 503 `cannot_check` and WhatsApp `ALERTS` answers "cannot check", never an empty list.
- **Principle 4.** Nothing about a customer is stored or returned. The advisory list is the same for every customer of a bank.
- **Principle 5.** The bank's normal messages are unchanged. The warning SMS is a new message the bank chooses to send, registered with the one existing call.
- **Tenant isolation.** A bank's advisories are listed only for its own customers, and only its own clients can approve or withdraw them.

## Copy

New keys only, under the top-level `advisory` namespace of `copy.json`, translated in the four overlays (each still marked for native-speaker review). No existing key changed. The advisory text itself is the bank's approved wording and is shown as written.

## Tests

`tests/advisories.test.ts` (ADV-1 to ADV-9), the console and sandbox send-to-customers tests (ADV-10), and the app's alerts tests (`apps/mobile/test/advisories_test.dart`, ADV-11).
