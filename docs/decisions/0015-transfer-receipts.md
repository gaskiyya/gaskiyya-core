# 0015: Transfer receipts

**Status:** accepted (approved by owner, 2026-10-20)

Merchants, POS agents and small sellers release goods when a buyer shows a transfer receipt or a credit alert on their phone. Fake receipt apps and edited screenshots make "I have paid you" free to fake. Gaskiyya already lets a customer check that a message came from their bank; this note adds the same check for a payment: **did this transfer really reach my account?**

## Canonical receipt

A receipt is reduced to five fields and one version-prefixed string:

```text
GR1|<beneficiaryAccount>|<beneficiaryBank>|<amountKobo>|<reference>|<valueDate>
```

| Field | Rule |
| --- | --- |
| beneficiaryAccount | The 10-digit NUBAN the money was paid into. ASCII digits only. |
| beneficiaryBank | The beneficiary bank's 6-digit NIBSS (NIP) institution code. The 3-digit CBN code is refused, so the two sides cannot disagree on which code to use. |
| amountKobo | The amount in kobo: a whole number from 1, at most 15 digits, no leading zero. |
| reference | The NIP session ID (30 digits) or the bank's transfer reference: 6 to 64 ASCII letters and digits, upper-cased. |
| valueDate | The value date in Africa/Lagos time (UTC+1 all year), written YYYY-MM-DD, a real calendar date from 2000 to 2099. |

Space, tab, line feed, carriage return, no-break space and hyphen are removed from the account number, bank code and reference, and the reference's ASCII letters are upper-cased, because receipts print session IDs in groups and people type references in either case. Nothing else is cleaned: a full-width digit, a letter O for a zero, a slash or any other character makes the field invalid (`ReceiptFieldError` naming the field, never its value). A receipt field is either read exactly or not at all; there is no approximate match (principle 1).

The digest is SHA-256 of the canonical string's UTF-8 bytes, as 64 lowercase hex characters (`receiptDigest`). The `GR1` prefix keeps receipt digests apart from message digests and lets a later form (`GR2`) coexist.

Two helpers sit beside it, so that the app and the bank read amounts and dates the same way: `parseAmountToKobo` reads an amount as printed ("NGN25,000.00", "N1,500" or the naira sign, "2500.5"; commas must group thousands, at most two decimals) and `lagosDate` gives the Lagos calendar date of an instant.

The TypeScript (`packages/canonical/src/receipt.ts`, `@gaskiya/canonical/receipt`) and Dart (`packages/canonical_dart/lib/src/receipt.dart`) implementations are checked against the same vectors in `packages/test-vectors/vectors.json`: 33 receipt cases (16 valid, 17 that must be refused, each with the field it fails on), groups that must share a digest, pairs that must differ (one kobo, one digit of the session ID, the account, the bank, the date), 20 amount readings and 6 Lagos dates.

**The message canonicalisation does not change.** The 73 message vectors give the same canonical text and digest as before; the receipt vectors are new keys in the same file.

## Registration: the paying bank

The paying bank (or a switch acting for it) calls `POST /v1/receipts`, or `POST /v1/receipts/batch` with up to 500, with bank OAuth and an optional `Idempotency-Key`, as for messages:

```json
{ "receiptDigest": "<64 hex>", "beneficiaryAccount": "0123456789", "beneficiaryBank": "999001" }
```

Amount, reference and date travel only inside the digest. The registry finds the enrolled bank whose `bankCode` (a new tenant field) is the beneficiary bank, and stores a receipt record under **that** bank, keyed with **that** bank's hashing key:

| Field | Content |
| --- | --- |
| tenantId | The beneficiary's bank |
| payerTenantId | The bank that registered it |
| accountKey | HMAC of the beneficiary account number (purpose `account`) |
| receiptKey | HMAC of the receipt digest (purpose `receipt`) |
| keyVersion, currency (`NGN`), registeredAt, expiresAt | Descriptive fields |

No account number, amount, reference, date, name or plain digest is stored (principle 4); the plain account number is discarded after keying. Records expire after `RECEIPT_TTL_DAYS` (30 by default). A transfer into a bank that is not enrolled is answered `stored: false, reason: beneficiary_bank_not_enrolled` and nothing is kept, since nobody could check it. Key rotation (0008) applies unchanged: the record carries its key version and the check tries every version held.

Keying under the beneficiary's bank, rather than a registry-wide key, means a leaked key exposes only one bank's accounts to guessing, and the merchant's check needs only their own bank's key.

The registration anomaly guard counts receipt registrations towards the paying bank's volume (`volume_spike`); receipts carry no link domains.

## Verification: bound to the beneficiary

`POST /v1/verify/receipt`, with a customer token, takes either the fields (the server canonicalises them; the bank code is the customer's bank's own `bankCode`) or the digest the app computed on the phone:

```json
{ "beneficiaryAccount": "0123456789", "amountKobo": 2500000, "reference": "000013...", "valueDate": "2026-10-20" }
{ "beneficiaryAccount": "0123456789", "receiptDigest": "<64 hex>" }
```

**Who may check which account.** We chose the simplest design that cannot confirm a receipt to someone who does not own the account: the merchant's bank says which accounts the customer holds, inside the customer token it already signs. The token gains an optional `accts` claim, an array of 10-digit account numbers. The check is refused (403 `account_not_linked`) unless the account named is in that claim, and `decideReceiptVerdict` also returns "not confirmed", never "received", for an unbound account. Gaskiya stores no account-to-phone mapping, and needs no new registration call from the merchant's bank. `GET /v1/me` returns the claim's accounts so the app can offer them in a picker. A bank that does not add `accts` simply gets no receipt checks for its customers.

We rejected binding receipts to the merchant's phone number: the paying bank does not know it, and a merchant often takes payments into an account that is not tied to the phone in their hand.

Verdicts (`decideReceiptVerdict` in `verdict.ts`, pure):

| Verdict | When | Says |
| --- | --- | --- |
| received | The bank is set up for receipts, the account is in the token, and an exact, unexpired record matches the keyed account and keyed digest under the same key version | Which bank registered the transfer and when |
| not_confirmed | No such record (wrong amount, reference, date or account), or the account is not bound | Check your own account balance or banking app before releasing goods |
| cannot_check | The store errors, or the bank has no `bankCode` | Cannot check right now; never "received" (principle 2) |

Receipt checks are rate limited with the customer's other checks, logged as `kind: receipt` with the keyed phone number only, and counted in a separate metrics bucket (`receiptChecks`), so message coverage figures are unchanged.

## Channels

- **App.** "Check a payment receipt": pick one of your accounts, then type the amount, reference and date, or read them from a screenshot of the receipt. The screenshot is read on the phone with ML Kit; the app finds the amount, the 30-digit session ID and the date with fixed patterns and shows them to the customer to confirm or correct before checking. The image never leaves the phone, and the app sends only the receipt digest and the account number.
- **Bank sandbox console.** A Transfers panel: a DemoBank customer pays a merchant (the simulator registers the receipt as the paying bank), then the merchant checks the genuine receipt (received), the same receipt with the amount changed (not confirmed), and a receipt with a made-up session ID (not confirmed). The demo derives each customer's account number from their phone number, as many Nigerian banks do.
- **WhatsApp and USSD.** Not offered. Those channels identify a phone number only, with no bank-signed list of accounts, so they cannot bind a check to the account it paid into.

## Copy

New fixed text lives only under a new top-level `receipt` namespace in `copy.json`, translated into the four overlays. No existing key changes.

## Tests

`tests/receipts.test.ts` (RCPT-1 to RCPT-11) and `packages/canonical_dart/test/receipt_test.dart` cover: received for the beneficiary; not confirmed for any other account and refused for an account the caller does not hold; one kobo changed; a made-up reference or date; store errors; nothing plain stored or logged; idempotent replay; identical TypeScript and Dart digests for every vector; expiry; credentials and validation; and guard volume. The app's field reader and check flow have Dart tests with a fake text reader.
