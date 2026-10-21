# 0016: Licence check against regulators' published lists

**Status:** accepted (approved by owner, 2026-10-20)

Many frauds do not imitate a bank's message at all. They are unlicensed loan apps, fake investment schemes and fake "microfinance banks" that ask for an upfront fee or a "registration charge". The registry cannot confirm or refute these: they never pass through a bank. What a customer can usefully learn is whether the firm is on a licence list a regulator publishes. This decision adds that check: "Is this lender licensed?".

## What it answers

`POST /v1/verify/licence { query }` (customer token, rate limited with the other checks) takes a firm's name, website or Android package ID (or a Play Store link). The answer is one of three, decided in `decideLicenceVerdict` in `apps/api/src/domain/verdict.ts`:

| Verdict | When | What the customer is told |
| --- | --- | --- |
| `licensed` | The query matches a listed name, alias, website or app ID exactly after normalisation, and that list is fresh | The firm is on the named regulator's list as a given category, with the list's source and retrieval date. Being listed does not confirm that a message, call or offer comes from the firm |
| `not_listed` | No exact match, and every list is fresh | The name is not on any list we hold; licensed lenders are listed by the FCCPC, CBN or SEC (with links); do not pay any upfront fee |
| `cannot_check` | No list could be loaded, or a list the answer depends on is older than `LICENCE_MAX_AGE_DAYS` (default 120) | The lists are unavailable or out of date; check the regulator's own website before paying anything |

There is no "fraud", "unlicensed" or "illegal" verdict. The registry knows only that a name is absent from the lists it holds, and lists lag behind approvals, so absence is reported as exactly that.

## Matching

Exact only, after normalisation (`apps/api/src/domain/licence.ts`):

- **Names:** accents and punctuation are removed, "&" is read as "and", case and spacing are ignored (spaces are removed, so "Palm Credit" and "PalmCredit" match), and the trailing company words Ltd, Limited, Plc, Nigeria, Nig, NG, Inc, LLC and Co are dropped, as is a leading "The".
- **Websites:** the host, without scheme, "www.", port or path. A website matches only a listed website. A domain that merely contains a listed name (for example `palmcredit-ng.com`) is never a match: that is how look-alike domains work.
- **App IDs:** a lower-cased Android package ID, also read from a Play Store `?id=` link. It matches only a listed app ID.

**Look-alikes.** When there is no exact match, the nearest listed name is found by Levenshtein distance on the normalised keys, with look-alike characters (0 for o, 1 for l, rn for m) folded first. It counts as similar when the distance is within a limit set by the listed name's length (0 below 5 characters, 1 below 8, 2 below 12, otherwise 3), or when the query contains a listed name of six or more characters ("PalmCredit Loans"). The answer is then `not_listed` with `similarTo` naming the listed firm, plus a warning that fraudsters copy the names of licensed firms. The calculation is deterministic and the result is a warning only: it can never produce `licensed` (principle 1 applies in spirit: only an exact match on the record confirms anything, and here even that only says "listed").

## Freshness fails closed

Each list carries the date it was retrieved. An exact match on a list older than the limit, and every `not_listed` answer while any list is older than the limit, become `cannot_check` (principle 2): absence from an old list proves nothing, and presence on an old list may be out of date. A retrieval date more than a day in the future is treated as stale. `GET /v1/metrics` reports each list's date, entry count and staleness (`licenceData`).

## The data

The regulators publish their lists as public web pages. The importers in `scripts/licences/` read them without logging in and write one committed JSON file per list to `packages/licences/data/`, each with its source URL, retrieval date, format and note. Entries are what the regulator publishes; none is edited by hand. Retrieved 2026-10-20:

| File | Source | Format | Entries |
| --- | --- | --- | --- |
| `fccpc-digital-lenders.json` | FCCPC, approvals of digital money lenders under the Digital, Electronic, Online, or Non-Traditional Consumer Lending Regulations 2025: the "Approval", "conditional approval" and "waivers [ licensed by CBN ]" tables of https://fccpc.gov.ng/registration-of-digital-money-lenders/approvals-of-dmls/ | HTML tables (company name and app names; the app names become aliases) | 586 |
| `cbn-commercial-banks.json`, `cbn-merchant-banks.json`, `cbn-non-interest-banks.json`, `cbn-payment-service-banks.json`, `cbn-microfinance-banks.json`, `cbn-finance-companies.json`, `cbn-primary-mortgage-banks.json` | CBN, https://www.cbn.gov.ng/Supervision/Inst-*.html, read through the public JSON endpoints those pages load (`/api/GetDMBs` and so on) | JSON, names only | 28, 5, 6, 5, 786, 126, 33 |
| `cbn-payment-service-providers.json` | CBN, https://www.cbn.gov.ng/PaymentsSystem/PSPs.html (mobile money operators, switching, payment solution and terminal providers, super-agents) | HTML tables | 195 |

Limits of the sources, recorded so nobody over-reads an answer:

- No list shows an "as at" date. The FCCPC page's metadata date (2026-03-03) is not updated when its tables change, so `publishedAt` is null everywhere and freshness is measured from our retrieval date.
- The FCCPC list gives no websites or package IDs, so app checks match on app names. Website and app ID matching works for any list that gives them.
- The FCCPC watchlist and delisted tables are not imported. They are not licences, and reporting a firm as "on a watchlist" would be a stronger claim than this check makes.
- SEC registered capital market operators are not imported yet. The SEC directory (https://sec.gov.ng/for-investors/find-a-registered-operator/) is about 51 pages of HTML with no export, and it includes named individuals' contact details, which we do not want to copy. The SEC is still named in every answer so customers can check it themselves.
- CBN development finance institutions and bureaux de change are not imported (not consumer lenders, and the bureau de change endpoint answered 404).

The server reads the bundled files, or with `LICENCE_DATA_DIR` a directory it re-reads every 10 minutes, which a scheduled `pnpm licences:import` can refresh without a redeploy. A failed re-read keeps the last good lists, which keep ageing and so still fail closed. The lists sit behind the `LicenceRegistry` interface like every other external source.

## Privacy

The query is answered and dropped. Only the verdict is counted (`licenceChecks` in the metrics, logged as a verification of kind `licence` under the customer's keyed number). No name, website or app ID asked about is stored or logged (principle 4 in spirit; tested by LIC-6).

## Channels and copy

- **App:** an "Is this lender licensed?" card on the Check screen opens a sheet with a text field and a result in the existing result style. "Listed" uses its own neutral artwork and tag, never the confirmed ones.
- **WhatsApp:** `LOAN <name>` or `LICENCE <name>` (also `LICENSE`). LOAN takes at most four words and LICENCE eight, on one line, so a typical pasted message that starts with "Loan" is still checked as a message.
- **USSD:** option 4, then the name; the answer fits one 160-character screen in every language, shortening a long firm name with "..." if needed. Option 3 is the contact check (decision 0014). Option 4 is listed on a second menu page: the first page ends with "9. More", and 9 opens a page with "4. Is a lender licensed?" and "0. Back" (room for later options). 4 also works straight from the first page. On the first page the SIM caution, options 1 to 3 and the "never asks" line outrank "9. More", because existing screens promise that line and both do not fit beside a long name. "9. More" in turn outranks the organisation's full name. Measured over 5 languages, bank and agency, and names of 8, 16 and 24 characters: without a SIM caution "9. More" shows in 32 of 40 menus (every 8-character name, including "DemoBank"; it gives way mostly at 16 characters). With a SIM caution it never fits: the caution and options 1 to 3 fill the screen. The page-2 keys are `licence.ussd.moreOption`, `moreHeading` and `backOption`.
- **Console:** a "Licence check" page that asks as the customer app does.

All wording is new keys under one top-level `licence` namespace in `copy.json`, translated into the four overlays (still marked for native-speaker review). No existing key changed. The WhatsApp welcome reply appends `licence.bot.hint`, and the USSD menu lists `licence.ussd.menuOption` as an optional option after option 3, when it fits.

## Alternatives considered

- **Fuzzy matching as the answer.** A similarity score deciding "licensed" would let "PalmCredlt" pass for "PalmCredit". Similarity is used only to warn.
- **A "fraud" verdict from the FCCPC watchlist or delisted table.** Those tables have no company names and change without notice; calling a firm fraudulent on that basis would be wrong too often. Absence is all we report.
- **Live lookups against the regulators' sites on each check.** Their pages are slow, change layout, and would learn every name customers ask about. Periodic import keeps the query private and the check fast.
