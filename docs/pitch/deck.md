# Gaskiyya pitch deck (Zecathon 6.0)

Ten slides for the semi-final (23 Oct 2026, Lagos) and the final (28 Oct 2026). Each slide has a title, the bullets that go on the slide, speaker notes, and an evidence line. The evidence line names the code, test or source behind every claim on that slide, so a judge's follow-up can be answered from the repository.

Rules this deck follows:

- Every figure carries a short source tag such as [S1] on the slide, and the full citation is in [Sources](#sources) at the end. "(press report)" marks a figure we saw only in the press, not in the issuing body's own document.
- Every product claim points at a file or a test ID in `tests/` or `apps/mobile/test/`. Every feature cited is merged into `main`.
- Zenith Bank is named only as the hackathon host and a possible pilot bank. No Zenith logo or trademark appears on any slide. The demo's second bank, "ZB Demo Bank (demo)", is fictional (`tests/demo-bank.test.ts`).
- The naira sign is written "N".

---

## Slide 1. Title

**On the slide**

- Gaskiyya: is it really your bank?
- A registry where banks record what they really sent, so customers can check any message or call
- "Gaskiyya" is Hausa for truth (say "gas-KEE-ya")
- Track: "Strengthening Trust in Digital Banking"
- [TEAM NAME], Zecathon 6.0. The demo uses only simulated bank systems: the bank sandbox console stands in for the bank; no live banking or production APIs

**Speaker notes**

Open with the question every Nigerian bank customer has asked: is this message really from my bank? Gaskiyya answers it with the bank's own records instead of a guess. A customer checks a message in an app, on WhatsApp or by USSD, and gets one of three answers: "Sent by your bank", "Not confirmed", or "Cannot check right now". Keep this slide up for no more than ten seconds.

Name the track as printed on the slide: Strengthening Trust in Digital Banking. Say early, and plainly, that everything in the demo runs against simulated bank systems: the bank sandbox console stands in for the bank's notification service, contact centre and login, and no live banking system or production API is involved.

**Evidence:** the three answers are fixed text in `packages/schemas/copy.json` (`verdict.confirmed.title`, `verdict.not_confirmed.title`, `verdict.cannot_check.title`); CH-4 checks that every verdict screen and bot reply takes its wording from that file. Pronunciation note from `video/VOICEOVER.md`.

---

## Slide 2. The problem: fraudsters pose as the bank

**On the slide**

- N17.67bn lost to fraud in 2023, up 23% on 2022; 80,658 customers defrauded [S1]
- 65.8% of 2023 fraud cases were social engineering (derived from NIBSS counts) [S1]
- 2025: N25.85bn lost; NIBSS calls social engineering "the most prevalent fraud technique" [S2]
- Mobile was the top fraud channel in 2023: 47,526 cases, N5.69bn lost [S1]
- Lagos: 48% of 2023 cases, 49% of losses [S1]

**Speaker notes**

These are the industry's own numbers. NIBSS's 2023 report counted 95,620 fraud cases and N17.67bn in actual losses. 62,901 of those cases were social engineering, which is 65.8%; that percentage is ours, worked out from the NIBSS counts, and it measures the share of reported cases, not of money. By value, social engineering was 45.4% of 2023 losses (N8.03bn of N17.67bn, also derived). The report calls social engineering "the dominant technique for fraud".

Be careful with two caveats if asked. First, only 60 of 163 institutions sent data for 2023, so these are reported figures, not complete ones. Second, the 2024 total in the press, N52.26bn across 70,111 cases (press report) [S3], was, in NIBSS's own later words, "largely driven by a single fraud incident of N31.1 billion involving one entity" [S2]. That is why we lead with 2023 and 2025 rather than 2024.

What no one publishes: an official share of fraud that is specifically a fake SMS, WhatsApp message or call in the bank's name. We looked and found none, and we do not claim one. What exists is regulators describing the pattern: the CBN's draft guideline on authorised push payment fraud describes fraudsters "posing as banks through fake calls, phishing texts, WhatsApp messages" (press report) [S14], and the CBN Deputy Governor named social engineering and SIM-swap among emerging risks in January 2026 (press report) [S15].

**Evidence:** [S1] NIBSS 2023 Annual Fraud Landscape (primary); [S2] NIBSS, 22 Jan 2026 (primary); [S3], [S14], [S15] press reports. Derived figures: 62,901 / 95,620 = 65.8%; 8,025.8 / 17,670 = 45.4%.

---

## Slide 3. Why today's fixes do not settle it

**On the slide**

- Caller ID can be faked, so "it showed the bank's number" proves nothing
- SMS sender names can be set by whoever sends, so "it came from the bank's name" proves nothing
- Awareness campaigns tell customers what banks never ask for [S10], but not how to tell a real message from a copy
- AI scam detectors guess from wording; a fraudster can copy the bank's wording exactly
- 51% of unknown calls to Nigerians in 2025 were flagged as spam or fraud (press report) [S5]

**Speaker notes**

Every check a customer can do today looks at something the fraudster controls: the number on the screen, the sender name, the wording. A careful fraudster copies all three. Gaskiyya never relies on caller ID or the sender name; the design says so explicitly (`apps/web/docs/DESIGN.md`, "The check never relies on caller ID, because caller ID can be spoofed").

The CBN has told customers since at least 2016 that it and banks "would [never] call bank customers or send e-mail/text messages requesting for passwords, card details or personal identification numbers (PIN)" [S10]. That advice is right, but it only helps once the fraudster asks for a PIN. Most lures start earlier, with a believable alert or a link.

AI classifiers have a different problem: they output a probability. A message that copies the bank's real template scores as genuine, and a real but unusual message scores as fake. We use AI too, but never to decide (slide 6). Our own test suite contains ten prompt-injection messages that tell the model to call the message genuine; none changes a verdict, because the model runs after the verdict is fixed (AI-2).

The Truecaller figure is a press report of Truecaller's own data, and it covers unknown calls in general, not only bank impersonation.

**Evidence:** `apps/web/docs/DESIGN.md` (Verifying a call); AI-2 in `tests/ai.test.ts`; [S5] press report; [S10] CBN 2016 press release (seen in a search excerpt of the CBN PDF, so near-primary).

---

## Slide 4. The fix: the bank registers what it sends; customers check against it

**On the slide**

- One extra API call as the bank sends: a keyed fingerprint, bound to the recipient's number
- Customer's check = exact match against that bank's records for that number only
- No match: "Not confirmed". Any error: "Cannot check right now", never "genuine"
- No message text and no phone numbers stored; HMAC-SHA-256 keys held per bank
- Calls too: the bank announces each call; the app and the agent show the same 4-digit code

**Speaker notes**

How it works. As the bank's notification service sends an SMS, it canonicalises the text, hashes it, and calls `POST /v1/messages` with the digest, the recipient's number, channel and category. The registry turns the number and the digest into keyed hashes with that bank's HMAC key and throws the plain number away. When a customer checks, the app canonicalises and hashes the text on the phone, so only the digest is sent, and the registry looks for that digest among the records for that customer's own number.

Four properties carry the whole idea. Exact match: change one character of a link and the digest changes, so nothing matches. Bound to the recipient: a genuine message forwarded to someone else does not verify for them. Fail closed: if the store is slow or down, the answer is "Cannot check right now". Nothing to steal: a breach of the registry reveals keyed hashes and a few labels, not message text or numbers.

On a "Not confirmed" result we also say what the bank really did send recently, from stored labels only, for example "two transaction alerts by SMS today, neither with a link".

For calls, the contact centre calls `POST /v1/calls` before dialling. The agent's screen and the customer's app show the same four-digit code for 180 seconds. If no call is open, the app says the bank is not calling.

The verdict is one pure function with no network or model calls: `apps/api/src/domain/verdict.ts`.

**Evidence:** REG-1 (confirmed for its recipient), REG-2 (another recipient: not confirmed), REG-3 (unregistered: not confirmed with recent activity), REG-6 (store down: cannot check), REG-7 (searchable within two seconds) in `tests/registry.test.ts`; CAN-1 to CAN-4 in `tests/canonical.test.ts` (TypeScript and Dart give identical digests on the shared vectors in `packages/test-vectors/`); CH-1 in `apps/mobile/test/client_test.dart` (the app's verify request carries a digest and no text); SEC-1 in `tests/security.test.ts` (no plain number or message text in the store after a full run); CALL-1 to CALL-4 and LINK-1, LINK-2 in `tests/calls-links.test.ts`.

---

## Slide 5. Live demo (90 seconds)

**On the slide**

- Bank sandbox console (left) and the customer's phone (right)
- Simulated bank systems only: no live banking or production APIs
- Genuine, one character changed, replayed to another person
- A bank call with its code, and a feature phone over USSD
- Scam reports become a campaign, then an advisory an analyst approves

**Speaker notes**

Say first: "Everything you are about to see runs against a simulated bank. The sandbox console plays the bank's notification service, contact centre, login and fraud desk. No live banking system or production API is involved." Then run the click path in `apps/web/docs/pitch/script.md` (section "Demo click path"). Narrate outcomes, not clicks: "the bank sent this, so it is confirmed"; "one hyphen added to the link, not confirmed"; "same message, other customer, not confirmed". Keep the console on the projector so the audience sees the bank side and the customer side at once (`apps/web/docs/DEMO.md`, section 4).

If anything fails, go straight to the recovery line for that step, and do not debug on stage. The fallbacks, in order, are the console's own simulated phone, the in-browser sandbox console (`pnpm --filter @gaskiya/web dev:sandbox`, no server or network), and the recording made the day before (`apps/web/docs/DEMO.md`, section 7).

**Evidence:** CH-3 and DEMO-3 in `tests/console.test.ts` (from the console an operator can send a message, send a tampered copy, open a call and view campaigns; the demo passes twice with a reset between); USSD-8 in `tests/console.test.ts` (the console feature phone dials the registry); AI-5 and AI-9 (campaign and briefing).

---

## Slide 6. AI that explains, but never decides

**On the slide**

- Screenshots are read on the phone: only digests leave the device, never the image (unless on-device reading fails)
- The verdict is fixed first; the model runs afterwards and cannot change it
- Explain guard: model text that calls a message "genuine", "safe" or "verified" is replaced with fixed text
- Sender warning: a screenshot whose sender is not one of the bank's sender IDs is flagged
- Fraud desk briefing from masked reports; advisories stay drafts until an analyst approves

**Speaker notes**

AI does four jobs here, and deciding authenticity is not one of them.

1. Explaining a "Not confirmed" result in plain words: urgency, a link to a non-bank domain, a callback number. Before the text goes to the model, every run of four or more digits is masked (AI-4). Output that fails the schema is replaced by a fixed explanation (AI-3), and so is any output that says the message is genuine, safe, verified, legitimate, authentic or from the bank (AI-7). Negated wording such as "not verified" passes through.
2. Reading screenshots, privately. This is a privacy point worth stating slowly. In the app on Android and iOS, Google ML Kit reads the screenshot on the phone (`ocr_mlkit.dart`), and `checkScreenshot` in `screenshot.dart` canonicalises and hashes up to three likely message texts on the device and checks each by exact digest. Only digests are sent; the image never leaves the phone. Only if on-device reading is unavailable (web) or fails, or finds no message-length text, is a shrunk copy of the image (1200 px, JPEG quality 75) sent to the model, and its reading is then matched exactly like pasted text. A registry error on any candidate gives "Cannot check right now".
3. Flagging senders. If a not-confirmed screenshot shows a sender that is not one of the bank's registered sender IDs, the answer carries an "unknown sender" warning. A matching sender ID never upgrades a verdict, because sender IDs can be faked (AI-8).
4. Briefing the fraud desk. The agent groups consented, masked reports deterministically (shared link domain, shared callback number or similar wording) and asks the model for a briefing: likely scam pattern, impersonated channel, draft advisory. Unsafe or invalid output falls back to a template. The agent has four tools and none of them sends or approves (AI-5, AI-9, decision 0009).

Be honest if asked: for a "Not confirmed" message, the digit-masked text is sent to the model to get the explanation. Without an AI key, every explanation uses fixed text and verdicts are unchanged (AI-1). Gemini is the default provider; OpenAI is one setting away; a self-hosted model is another class behind the same interface (decision 0002). `AI_PROVIDER=ollama` runs open-weights models locally, inside the bank, and offline for the demo (`pnpm demo:offline`; `apps/web/docs/decisions/0011-open-source-model.md`). It is tested against a stand-in for Ollama's HTTP API, not yet end to end with real models.

**Evidence:** AI-1 to AI-4, AI-7, AI-8 in `tests/ai.test.ts`; AI-5 in `tests/ai.test.ts`; AI-9 in `tests/briefing.test.ts`; Ollama option: `apps/api/src/ai/ollama.ts`, `tests/ollama.test.ts`, `tests/offline.test.ts`, decision 0011, `apps/web/docs/DEMO.md` section 8; on-device OCR in `apps/mobile/lib/src/core/ocr_mlkit.dart` and `screenshot.dart`, tested in `apps/mobile/test/screenshot_test.dart` ("the OCR path sends digests only, never the image"); `apps/web/docs/decisions/0002-model-provider.md`, `0009-campaign-briefing.md`. AI-6 (screenshot check with the real model) is a manual check, not an automated one.

---

## Slide 7. Impact: built for the customers fraud reaches first

**On the slide**

- 93% of Nigerian adults (103m) use a mobile phone; 26% (about 40m) are financially excluded [S7]
- At least 1 in 2 in priority excluded groups have only a basic phone [S7]
- USSD for feature phones: "Is my bank calling me?" and "What did my bank send me today?"
- WhatsApp, on 95% of smartphones in an urban study [S6]; five languages, pending native-speaker review
- Screen reader, large text and reduced motion support; several banks in one app

**Speaker notes**

Fraud by impersonation lands hardest on people with the least room to check: older customers, first-time account holders, people on basic phones. NIBSS found 42% of 2023's defrauded customers were aged 40 or over [S1].

Channels. The app is the primary route because the check sends only the fingerprint: the text leaves the phone only to explain a result that is not confirmed, once and with long numbers hidden. WhatsApp needs no install: paste a message and get the same verdict (CH-2). USSD works on any phone with no data: option 1 shows an open bank call and its code, option 2 lists today's messages by category, channel and time only, with no content, and ends with "A message from today that is not listed is not confirmed." This matters because the KPMG/Orange study's foreword says more than a third of mobile subscribers were still on 2G in May 2026, citing NCC data [S6], and NCC data puts 2G plus 3G at 41.08% of connections in June 2026 (press report) [S8].

Languages. English, Pidgin, Hausa, Yoruba and Igbo are built into the app (Settings language picker), the WhatsApp bot (`LANG HA`) and USSD (plain ASCII spellings). All four non-English languages were drafted without a native speaker and are marked as needing native-speaker review; our design rule is that a language is switched on for real customers only after that review (`apps/web/docs/DESIGN.md`, Languages). The recent-activity sentence is still in English. Pidgin alone has a speech community of over 75 million [S9]. EFInA ran its own survey in Hausa, Yoruba, Igbo and Pidgin [S7].

Accessibility. The call code reads as one screen-reader label digit by digit, the 3D art is hidden from screen readers, animations stop under reduced motion, and every main screen lays out at twice the text size (A11Y-1 to A11Y-4).

Caveat on [S6]: it covers 12 cities and urban smartphone users only, so it does not describe rural Nigeria.

**Evidence:** [S1], [S6], [S7], [S8], [S9]; CH-2 in `tests/whatsapp.test.ts`; USSD-1 to USSD-7 in `tests/ussd.test.ts` and USSD-8 in `tests/console.test.ts`, with `apps/web/docs/decisions/0007-ussd-channel.md` (not tried on a live short code); A11Y-1 to A11Y-4 in `apps/mobile/test/a11y_test.dart` and BANK-1 to BANK-5 in `apps/mobile/test/multibank_test.dart`, with `apps/web/docs/decisions/0010-accessibility-and-multibank.md`; LANG-1 to LANG-5 and LANG-7 in `tests/languages.test.ts`, LANG-6 in `apps/mobile/test/language_test.dart`, `apps/web/docs/decisions/0006-languages-and-app-copy.md` (translations need native-speaker review).

---

## Slide 8. Scalability, and how a bank such as Zenith would plug in

**On the slide**

- One API call at send time; the message itself, its sender ID and its length do not change
- Register where messages already leave: the notification service, or a copy at the SMS gateway
- Bank-hosted deployment for NDPA review and CBN data localisation [S11] [S12]
- One document read per check; sharded counters; shared rate limiter; key rotation with no downtime
- Laptop load test (memory store, not Firestore): about 5,700-8,500 registrations/s and 6,000-7,700 checks/s, p95 under 17 ms, no errors [PERFORMANCE.md]

**Speaker notes**

Integration. The bank adds one call, `POST /v1/messages` (or `/v1/messages/batch`), at the point of sending, authenticated with OAuth 2.0 client credentials. Registration must never block sending; the design asks for asynchronous registration with a retry queue (`apps/web/docs/DESIGN.md`, Rules for the registration path). Where the notification code cannot change, the same call can be made by the SMS gateway or aggregator that already sends the message, or from an existing outbound-message queue. Our demo simulator shows the inline pattern; the gateway and queue connectors are designed, not built. Calls need one more call, `POST /v1/calls`, from the dialler. Nothing touches core banking, balances or transactions.

Deployment. The server is one Docker image (`Dockerfile`) with storage behind a `Store` interface. Firestore is the production store today; a bank that must use its own database implements the same interface, and `pnpm test` runs the whole acceptance suite against both memory and Firestore, so a third store can be checked the same way (decision 0004). Bank-hosted is the likely pilot: it keeps data in the bank's environment for its data protection officer's review under the NDPA, whose data-minimisation (s.24(1)(c)) and pseudonymisation (s.39(2)(a)) provisions match what the registry stores [S12]. The CBN payments data-localisation circular, effective 1 Jan 2027 (press report), points the same way [S11].

Scale mechanics. A check is one Firestore document read, because the document id is a hash of bank, keyed recipient and keyed content (decision 0004). Dashboard counters are spread over shard documents so no single document takes every write. Rate limits are shared across server instances through the store (SEC-4). Keys rotate with versioned keys, and old records keep verifying until they expire (KEY-1 to KEY-3, decision 0008). The campaign agent runs as a separate scheduled job, so several replicas never run it twice (`pnpm agent:run`, decision 0009). Load test (`apps/web/docs/PERFORMANCE.md`, `pnpm load`): on an Apple M1 laptop, Node 22, memory store, client and server in one process on a busy machine, three runs gave single registration 5,728 to 8,476 requests/s with p95 9.1 to 16.7 ms; batch registration 373 to 629 requests/s, which is 37,000 to 63,000 messages/s, with p95 96 to 403 ms; verification 6,056 to 7,696 requests/s with p95 10.3 to 15.6 ms; no errors. Under that load the slowest registration-to-confirmed probe took 160 ms against the 2-second REG-7 target. Say clearly that these are laptop numbers on the memory store: Firestore and production have not been measured, and will be slower per request.

Abuse and coverage. A registration anomaly guard alerts the bank by email when a registration carries a link domain the bank has not declared, or when registration volume spikes above its trailing rate; it never blocks or fails the registration (`tests/guard.test.ts`). `GET /v1/metrics` reports registered versus verified counts, the not-confirmed rate and checks by channel (`tests/coverage.test.ts`).

Multi-bank. One deployment can serve several banks with separate keys and data, and the app already lists every enrolled bank from `GET /v1/banks`.

**Evidence:** REG-7, REG-8; SEC-4 in `tests/ratelimit.test.ts`; KEY-1 to KEY-3 in `tests/key-rotation.test.ts`; shard spreading in `tests/registry.test.ts`; `apps/web/docs/decisions/0004-firestore.md`, `0008-key-rotation.md`, `0009-campaign-briefing.md`; `apps/web/docs/CONFIGURATION.md`; `Dockerfile`; [S11] press report; [S12] NDPA 2023 (primary); `apps/web/docs/PERFORMANCE.md` (`scripts/load.ts`), `tests/guard.test.ts`, `tests/coverage.test.ts`.

---

## Appendix after slide 8. Technology used (open source)

The competition rules ask teams to identify every technology used and to use open-source tools. That slide is maintained separately: see [tech-stack.md](tech-stack.md) and [apps/web/docs/TECH_STACK.md](../TECH_STACK.md) (being written). Show it after slide 8 if time allows, or keep it as a backup slide for questions. Do not duplicate its table here.

---

## Slide 9. Business model (proposal) and pilot KPIs (targets)

**On the slide**

- Proposal: annual licence per bank, plus a fee per 1,000 registered messages [PRICE: to set]
- Customer checks are free on every channel; the bank's SMS bill does not change
- Pilot: one message type plus outbound calls, a limited customer group, bank-hosted
- KPIs to measure: registration coverage, checks per week, not-confirmed rate, report-to-advisory time, fraud losses in the pilot group
- These are targets to measure, not results

**Speaker notes**

This is a proposal, not a signed price. The bank pays because the bank gets the value: fewer impersonation losses and complaints, and a fraud desk that sees campaigns early. Pricing per registered message ties cost to use; a licence covers bank-hosted deployment and support. We have not set prices yet [PRICE: to set], and we have no customers.

Cost side. Gaskiyya sends no SMS, so the bank's messaging cost is unchanged; retail SMS is about N6 per message after the January 2025 tariff approval (press report) [S13]. Our cost per message is one API call, a small record that expires after 30 days by default, and one document read per check. We have not measured infrastructure cost per message. The only measurement is the laptop load test on the memory store (slide 8), which shows the code path is light; Firestore and production cost are not measured.

Pilot KPIs, all to be measured during the pilot, none achieved yet:

| KPI | What it measures | Why |
| --- | --- | --- |
| Registration coverage | Registered messages / messages sent, for the enrolled type | A genuine message that was never registered shows as "Not confirmed"; this is the main operational risk (`apps/web/docs/DESIGN.md`) |
| Checks per week | Verifications by channel (app, WhatsApp, USSD) | Adoption; `GET /v1/metrics` reports checks by channel (`tests/coverage.test.ts`) |
| Not-confirmed rate | Share of checks that do not match | Fake messages caught, plus a signal of coverage gaps |
| Report to advisory time | Time from first customer report to analyst-approved advisory | Speed of the fraud desk's response |
| Fraud losses in the pilot group | Impersonation-fraud losses among pilot customers vs a comparable group | The outcome that matters; needs the bank's own data |

Target values are for the bank and us to agree before the pilot [CONFIRM: pilot targets].

**Evidence:** `GET /v1/metrics` in `apps/api/src/app.ts`, extended with registered vs verified counts, the not-confirmed rate and checks by channel in `tests/coverage.test.ts`; note that true coverage (registered / sent) also needs the bank's own sent count; pilot shape in `apps/web/docs/DESIGN.md` (Build plan); [S13] press report. No pricing or KPI result exists in the repository.

---

## Slide 10. Team and ask

**On the slide**

- [TEAM NAME]
- [PHOTO] [NAME], [ROLE]; [PHOTO] [NAME], [ROLE]; [PHOTO] [NAME], [ROLE]
- Built and tested: [N] automated acceptance tests passing on `main` (231 on 20 Oct 2026, on both the memory store and the Firestore emulator), plus 94 Flutter and 78 Dart canonicalisation tests
- Ask: a pilot with one bank: one message type and outbound calls, bank-hosted, a limited customer group
- [CONTACT]

**Speaker notes**

Close on the ask. We want a bank's notification team, contact-centre team and fraud desk for a pilot of one message type plus outbound calls, in the bank's own environment, with its data protection officer reviewing the design. Everything a pilot needs from us exists today as code with tests; what we need from a bank is the integration point, its security review, and the assumptions in `apps/web/docs/DESIGN.md` (Assumptions to confirm) checked against its real systems. None of those has been checked with a bank yet.

Replace the test count with the figure from a fresh `npx vitest run` on the day [CONFIRM: test count], and add the Dart and Flutter counts from `pnpm test` if you want to quote them.

**Evidence:** `pnpm test` on `main` at commit f097011, 20 Oct 2026: 25 files and 231 tests passed on memory and on the Firestore emulator; 94 Flutter and 78 canonical_dart tests passed; `apps/web/docs/DESIGN.md` (Build plan, Assumptions to confirm).

---

## Sources

Short tags are used on the slides. PRIMARY: seen in the issuing body's own document. SECONDARY: seen only in press coverage, marked "(press report)" wherever used. DERIVED: computed by us from primary counts.

| Tag | Source | Type | Figures used |
| --- | --- | --- | --- |
| S1 | NIBSS, *2023 Annual Fraud Landscape*, April 2024. https://nibss-plc.com.ng/wp-content/uploads/2024/04/2023-Annual-Fraud-Landscape.pdf | PRIMARY (and DERIVED %) | N17.67bn actual loss 2023 (+23%); 95,620 cases; 80,658 customers defrauded; 42% aged 40+; Lagos 48% of count, 49% of loss; mobile channel 47,526 cases and N5,691.7m; social engineering 62,901 cases and N8,025.8m (65.8% of cases and 45.4% of loss, derived); "the dominant technique for fraud"; only 60 of 163 institutions reported |
| S2 | NIBSS, "Digital payment fraud drops 51% to N25.85b, Lagos accounts for 63%", 22 Jan 2026. https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/ | PRIMARY | 2025: N25.85bn lost (-51%), 67,518 incidents, Lagos 63.43%; social engineering "the most prevalent fraud technique"; 2024 spike "largely driven by a single fraud incident of N31.1 billion involving one entity" |
| S3 | Nairametrics, 26 Feb 2025 (also Blueprint), reporting NIBSS 2024 data | SECONDARY | 2024: N52.26bn lost, 70,111 cases |
| S5 | Vanguard, "Nigeria is Africa's most spammed country: report", 6 May 2026, reporting Truecaller 2025 data. https://www.vanguardngr.com/2026/05/nigeria-is-africas-most-spammed-country-report/ | SECONDARY | 51% of unknown calls to Nigerians flagged as spam or fraud |
| S6 | KPMG and Orange, *Nigeria Smartphone Study*, September 2026 (12 cities, urban only) | PRIMARY | WhatsApp on 95% of smartphones; smartphone ownership 75% (2025), 64% (2023); foreword: "More than a third of mobile subscribers were still on 2G as of May 2026" (citing NCC) |
| S7 | EFInA, *Access to Financial Services in Nigeria (A2F) 2023*, event-day presentation. https://a2f.ng/wp-content/uploads/2024/01/A2F-2023-Event-Day-Presentation.pdf | PRIMARY | 111m adults; 64% formally included; 26% excluded (about 40m); 93% of adults (103m) use a mobile phone; at least 1 in 2 of priority excluded groups have only a basic phone; survey administered in Hausa, Yoruba, Igbo and Pidgin |
| S8 | Techeconomy, 10 Sep 2026, reporting NCC data | SECONDARY | 195.11m active mobile subscriptions (July 2026); 2G plus 3G 41.08% of connections (June 2026) |
| S9 | APiCS Online, survey 17: Nigerian Pidgin. https://apics-online.info/surveys/17 | PRIMARY (academic) | Speech community "over 75 million" |
| S10 | Central Bank of Nigeria, press release, 2016 | Near-primary (CBN PDF seen in a search excerpt) | CBN and banks "would [never] call bank customers or send e-mail/text messages requesting for passwords, card details or personal identification numbers (PIN)" |
| S11 | CBN circular PSS/DIR/PUB/CIR/001/004, 15 Jun 2026, as reported by BusinessDay and the Aluko & Oyebode client alert (24 Jun 2026). https://aluko-oyebode.com/insights/cbn-issues-circular-on-market-structure-data-localisation-and-systemic-oversight-in-nigeria-payments/ . Circular text not found on cbn.gov.ng (checked 20 Oct 2026) | SECONDARY (press report) | Payment transaction data generated in Nigeria to be stored and managed in Nigeria, full compliance by 1 Jan 2027 |
| S12 | Nigeria Data Protection Act 2023, official gazette. https://ncc.gov.ng/media/801/view | PRIMARY | s.24(1)(c) data minimisation; s.39(2)(a) pseudonymisation as a security measure; s.40(2) 72-hour breach notice; s.41 cross-border transfer adequacy; s.48(3)(a) and (4) penalty up to the greater of N10m or 2% of annual gross revenue, for a controller or processor of major importance (checked against the gazette text, 20 Oct 2026) |
| S13 | Techeconomy and ThisDay, January 2025, on the NCC tariff approval of 20 Jan 2025 | SECONDARY | Retail SMS about N6 per message; GTBank SMS alert fee N4 to N6 from 1 May 2025 |
| S14 | Leadership, about November 2025, on the CBN draft guideline on authorised push payment fraud | SECONDARY | Fraudsters "posing as banks through fake calls, phishing texts, WhatsApp messages" |
| S15 | Leadership, January 2026, on remarks by CBN Deputy Governor Ikeazor | SECONDARY | Social engineering, SIM-swap, insider compromise and APP scams named as emerging risks |
| S16 | CBN press statement, 21 Apr 2026, signed by Hakama Sidi-Ali, Acting Director of Corporate Communications, as reported by BusinessDay ("CBN flags fake messages, warns public of cyber fraud attempts") and AllAfrica, 22 Apr 2026. https://businessday.ng/markets/article/cbn-flags-fake-messages-warns-public-of-cyber-fraud-attempts/ | SECONDARY | Fake messages and emails claiming to come from the CBN, prompting recipients to click links, "intended to hack personal accounts" |
| S17 | FRSC public alert, 16 Sep 2026, signed by Osondu Ohaeri, Corps Public Education Officer, as reported by Arbiterz, 17 Sep 2026. https://arbiterz.com/frsc-fake-traffic-fine-sms-scam/ | SECONDARY | Fake texts saying a traffic offence was recorded; one victim paid a N5 "fine" through the link and later found "millions of naira" allegedly taken (no exact figure published) |
| S18 | CBN, Exposure draft of the Guidelines for Handling Authorised Push Payment Fraud, Nov 2025. https://www.cbn.gov.ng/Out/2025/CCD/Exposure%20draft%20of%20the%20Guidelines%20for%20Handling%20Authorised%20Push%20Payment%20Fraud.pdf (summarised by BusinessDay, 2 Dec 2025) | DRAFT (primary URL; terms read via the press summary) | Equal sharing of reimbursement when neither institution is negligent; full liability for weak KYC or fraud controls; 72-hour reporting; 14 working days to investigate; refund within 48 hours |

(S4 is unused: the FITC Q1 2025 figures were not needed.)

**Derived figures used in the PowerPoint (2026 edition):** one reported digital payment fraud every 7.8 minutes in 2025 (525,600 minutes / 67,518 incidents, from S2); about N70.8m lost per day in 2025 (N25.85bn / 365, from S2). The illustrative SMS on the opening slide is invented for the slide and names no real bank.

**Data we looked for and did not find.** We use none of these and say so if asked: an official share of fraud that is specifically SMS, WhatsApp or call impersonation of a bank; an official social-engineering share for 2024 or 2025; an NCC figure on caller-ID or sender-ID spoofing; an EFCC figure; a current national USSD volume; speaker counts for Hausa, Yoruba and Igbo; a verified bulk A2P SMS price.
