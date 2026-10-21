# 0007: USSD channel and its customer text

Status: accepted (approved by owner as additive copy, 2026-10-20)

## Decision

Customers can dial the bank's USSD code. The registry answers Africa's
Talking callbacks at `POST /webhooks/ussd` with a two-option menu: "Is my bank
calling me?" and "Messages my bank sent me today". The identity is the number
the mobile network supplies, normalised as for WhatsApp, so only calls and
records bound to that number are shown (principle 3). The message list shows
category, channel and time only; there is no content to show (principle 4).
Any store error ends the session with the existing "cannot check right now"
title and body (principle 2).

Africa's Talking does not sign USSD callbacks, so the callback URL carries a
shared secret, `USSD_WEBHOOK_TOKEN`, in its query string. Query strings are
never logged. Without the secret the route does not exist.

USSD screens hold about 160 characters, so the existing call text (title, body,
code label and mismatch line together) does not fit. New keys were added under
a new top-level `ussd` namespace in `packages/schemas/copy.json`. No existing
key or wording changed, and no verdict wording changed.

| Key | Text | Why |
| --- | --- | --- |
| `ussd.menu` | `{bank} check` / `1. Is my bank calling me?` / `2. Messages my bank sent me today` | The main menu |
| `ussd.neverAsks` | Gaskiyya never asks for your PIN or codes. | Principle 6 on the first screen; `safety.neverAsks` is too long to fit beside the menu |
| `ussd.calling` | `{bank} is calling you now.` / `Call code: {code}` / `Purpose: {purpose}` / `If the caller cannot read this code, hang up.` | The open-call screen in one page; the app's four call strings together exceed 160 characters |
| `ussd.todayHeading` | {bank} sent you today: | Heads the list of today's messages |
| `ussd.todayItem` | {time} {category} by {channel} | One message in the list: no content, by principle 4 |
| `ussd.todayNone` | {bank} has sent you no messages today. | Empty list |
| `ussd.todayNote` | A message from today that is not listed is not confirmed. | Ends the list, so the customer knows what an absence means |
| `ussd.more` | 98. More | Paging, using the usual USSD "98" convention |
| `ussd.menuOption` | 0. Menu | Back to the menu from a list page |
| `ussd.invalid` | Invalid choice. Please dial again. | Unrecognised input ends the session |
| `ussd.tooMany` | Too many checks. Try again in a minute. | Per-number rate limit |

Reused without change: `call.not_calling.title` and `.body` (no call open),
`verdict.cannot_check.title` and `.body` (fail closed), and the `categories`,
`channels` and `purposes` labels. The cannot-check screen deliberately reuses
the verdict wording rather than a USSD variant, so the fail-closed answer reads
the same on every channel.

## Consequences

Requirements USSD-1 to USSD-8 were added to the acceptance list in
`apps/web/docs/DESIGN.md`, with tests in `tests/ussd.test.ts`, `tests/console.test.ts`
and `tests/sandbox.test.ts`. The bank console gained a feature-phone simulator
that dials through the bank simulator, which holds the secret. "Today" is
counted from midnight Africa/Lagos time, the same zone the WhatsApp replies
use; a bank in another zone would need that made configurable.
