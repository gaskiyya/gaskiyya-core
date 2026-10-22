# 0010: Accessibility in the app, and more than one linked bank

Status: accepted (new copy keys approved by owner as additive copy, 2026-10-20)

## Decision

The customer app is usable with a screen reader, at large text sizes and with
reduced motion:

- The call code is one screen-reader label that reads the digits one by one
  ("Call code 4 7 1 9"); the single digits are not announced separately.
- The rendered 3D art is decorative and hidden from screen readers.
- When the system asks for less motion (Android "Remove animations", iOS
  "Reduce Motion", both seen as `MediaQuery.disableAnimations`), the floating
  art, call pulse, shimmer, flip-in digits and screen transitions stand still
  or switch at once.
- Every main screen lays out at twice the default text size without overflow.

A customer can link more than one bank in the app:

- Each linked bank keeps its own customer token from that bank's sign-in,
  bound to the phone number the bank signed in. Recipient binding is unchanged:
  a check made through a link is answered for that bank and number only.
- A message check goes to one bank: the selected one. With two or more banks
  linked, the Check screen asks which bank the message claims to be from.
- The Calls screen asks every linked bank and shows each open call with its own
  code. The device registers for call notices with each linked bank.
- Settings lists the linked banks, removes one after confirming, and adds
  another from the registry's bank list.
- An install that saved a single `phone` and `bank` is migrated on first start
  to a one-bank `links` list; the old keys are removed.

The API needed no change: `GET /v1/banks` already lists the enrolled banks and
each customer token already names its bank and number.

## Copy keys added

Approved by owner as additive copy, 2026-10-20. No existing wording changed;
the new keys sit under new top-level namespaces only.

| Key | Text |
| --- | --- |
| `a11y.callCode` | Call code {digits} |
| `banks.heading` | Linked banks |
| `banks.pickerHeading` | Which bank is the message from? |
| `banks.add` | Add a bank |
| `banks.linked` | Linked |
| `banks.remove` | Remove |
| `banks.removeTitle` | Remove {bank}? |
| `banks.removeBody` | Gaskiyya will stop checking messages and calls from {bank} on this phone. You can add it again at any time. |
| `banks.cancel` | Cancel |
| `banks.or` | {first} or {last} |

## Consequences

No verdict wording, canonicalisation or principle changed. Widget tests cover
the call-code label, the hidden art, reduced motion and the 2x text size
(`mobile/test/a11y_test.dart`); Dart tests cover the upgrade migration,
adding and removing banks, and routing each check to the selected bank's
tenant and number (`mobile/test/multibank_test.dart`).
