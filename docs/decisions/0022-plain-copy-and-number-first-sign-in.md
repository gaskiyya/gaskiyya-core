# 0022: Plain copy, and sign-in by number alone

**Status:** accepted (requested by owner, 2026-10-22)

## Copy

The app's text was reviewed against Apple's Human Interface Guidelines for writing: say each thing once, lead with what the person should do, and keep body text to one or two lines under a title.

- **No verdict title changed.** "Sent by your bank", "Not confirmed" and "Cannot check right now" keep their wording on every channel.
- **Bodies no longer repeat their title.** For example, `call.not_calling.body` was "There is no call from {bank} in progress. If someone on the phone says they are from your bank, hang up." It is now "If someone says they're from {bank}, hang up." The title already says the bank is not calling.
- **Every warning keeps its instruction** (don't click, call or share codes; hang up; don't pay; don't install), as decision 0006 requires. The phrases "does not confirm" (`link.belongs.body`, `licence.licensed.body`) are kept because tests F14 and LIC-10 check them.
- **Contractions** ("don't", "isn't", "can't") are used, with ASCII apostrophes. With a typographic apostrophe the secret-request check in SEC-5 cannot read "don't" as a negation.
- **Buttons, navigation titles and action rows use title-style capitalisation** ("Check Again", "Sign In", "Get Started"), as iOS does. Full sentences stay in sentence case.
- `call.calling.body` is no longer shown in the app's Calls tab, because the purpose is already printed under the caller's name. WhatsApp still sends it.
- "Unlink This Phone" is now "Sign Out", since Settings no longer lists organisations.

Placeholders are unchanged in every key, so the overlays still pass LANG-1's placeholder check. The overlays were **not** re-drafted. Pidgin, Hausa, Yoruba and Igbo still carry the longer wording with the same meaning, and need a pass to match.

## Sign-in by number alone

The app is for every organisation on the registry. Sign-in now asks only for a mobile number:

1. Once a valid Nigerian number is entered, the app sends it to every organisation in `GET /v1/banks`, in parallel, through each one's `customerTokenUrl`. Each organisation decides whether it knows the number; those that issue a token are found.
2. The found organisations are shown by their logos. The round proceed button links all of them (`AppState.discover`, then `adopt`). Nothing is saved before that.
3. On every launch the app asks again, so an organisation that joins the registry later is added without the customer doing anything.

The bank picker, the bank name and status dot on the Check tab, and the linked-banks list in Settings are removed. No screen says how many organisations are linked. Messages and links are checked against every linked organisation: a confirmation from any one of them wins, and otherwise the result names all of them ("DemoBank or Acme Bank has no record of sending this to you"). The demo inbox and the Activity tab gather every organisation.

### Logos

Organisations have a new optional `logoUrl` (https, or a path on this server). It is set in the admin dashboard, validated with the other profile fields, and returned by `GET /v1/banks`. The app shows it in a white rounded tile, or a monogram when there is none or it fails to load. The image must be PNG, JPEG or WebP; the app does not render SVG.

### Privacy

Discovery shows which organisations know a number to whoever types it. That is safe only if each organisation's `customerTokenUrl` authenticates the customer before it answers, as the admin form already requires. The demo simulator answers for any number, so in the demo every organisation is found for every number. A production rollout needs the number proved first (for example with a one-time code), so that a stranger's number cannot be used to learn where they bank.
