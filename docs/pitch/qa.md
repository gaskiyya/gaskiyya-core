# Judge questions and answers

The sixteen hardest questions we expect (the fifteen hardest, plus one on the competition rules), with short answers to give out loud and an evidence pointer for each follow-up. Source tags ([S1] and so on) refer to [deck.md](deck.md#sources). Every feature cited below is merged into `main` and covered by the tests named.

Answer in the order written: the direct answer first, then the reason, then the limit. Do not claim anything past the evidence line.

---

### 1. What if the registry is down?

The customer gets "Cannot check right now. Contact your bank through its app or at a branch." It is never "genuine": fail closed is principle 2, and the verdict function returns "cannot check" for any store error. Store reads time out after 3 seconds, so a slow database gives the same answer instead of a hang, and `/health` returns 503 so a load balancer can take the instance out. The bank's messages still go out, because registration never sits in the sending path. The call check fails closed the same way on every channel: the API, WhatsApp, USSD, the console and the app all answer "cannot check" on a store error, and the app's Calls tab shows "cannot check" for any bank it has not heard from (finding F9 in the 20 Oct QA review, now fixed).

*Evidence:* REG-6 in `tests/registry.test.ts` (four tests, including the pure verdict function and `/health`); KEY-2 ("a lookup failure under a previous key fails the whole check closed") in `tests/key-rotation.test.ts`; USSD-5 in `tests/ussd.test.ts`; the "F9 / REG-6" tests in `tests/calls-links.test.ts`, `tests/whatsapp.test.ts` and `tests/console.test.ts`, and `apps/mobile/test/fail_closed_test.dart`; 3-second timeout in `apps/web/docs/decisions/0004-firestore.md`; F9 status in `apps/web/docs/qa/2026-10-20-qa-report.md`.

### 2. Why not just use AI to spot scams?

Because a model guesses, and a fraudster can copy the bank's exact wording, so a good fake scores as genuine and an unusual real message scores as fake. Only the bank knows what it sent, so only the bank's own record can confirm a message (principle 1). We still use AI where a guess is safe: explaining why a message looks fake, reading screenshots, and grouping scam reports for the fraud desk. The model runs after the verdict is fixed; ten prompt-injection messages telling it to call a message genuine change nothing, and any model text that says "genuine", "safe" or "verified" is replaced with fixed text.

If a bank wants no hosted model at all, `AI_PROVIDER=ollama` runs open-weights models inside the bank (tested against a stubbed Ollama server, not yet end to end with real models); with no model at all, explanations use fixed text and verdicts are unchanged.

*Evidence:* `apps/api/src/domain/verdict.ts` (pure, no I/O); AI-1, AI-2, AI-3, AI-7 in `tests/ai.test.ts`; `apps/web/docs/decisions/0002-model-provider.md`; `apps/api/src/ai/ollama.ts`, `tests/ollama.test.ts` and `apps/web/docs/decisions/0011-open-source-model.md`.

### 3. What does a bank have to change?

One API call where it already sends: the notification service calls `POST /v1/messages` with a digest of the message, the recipient's number, channel and category, using OAuth client credentials. The message's wording, sender ID and length do not change (principle 5), and nothing touches core banking, balances or transactions. For calls, the dialler calls `POST /v1/calls` and shows the agent a four-digit code. Where the notification code cannot be changed, the same call can come from the SMS gateway that already sends, or from an outbound-message queue; those two connectors are designed but not built, and our simulator demonstrates the inline call.

*Evidence:* `apps/web/docs/DESIGN.md` (Integration with existing bank systems, Three ways to register messages); `apps/api/src/simulator/` (the bank simulator registers, then hands the message to the gateway); REG-8 in `tests/registry.test.ts` (bank endpoints need bank credentials).

### 4. What about data protection and the NDPA?

The registry stores no message text and no phone numbers: only HMAC-SHA-256 keyed hashes, plus a few labels such as channel, category and whether there was a link (principle 4). That is data minimisation and pseudonymisation, which the NDPA names in s.24(1)(c) and s.39(2)(a) [S12], and a test checks the store holds no plain number or message text after a full run. Two flows do carry text, and we say so: a customer's consented scam report is stored after the server masks every run of four or more digits, and on a "Not confirmed" result the digit-masked text is sent to the AI model for an explanation. For a pilot, we propose a bank-hosted deployment reviewed by the bank's data protection officer, which also fits the CBN payments data-localisation circular effective 1 Jan 2027 (press report) [S11]. Any model hosted outside Nigeria needs that officer's review under s.41 [S12]; the alternative is a self-hosted open-weights model behind the same interface (the `AI_PROVIDER=ollama` option, `apps/api/src/ai/ollama.ts`, decision 0011).

*Evidence:* SEC-1 and SEC-2 in `tests/security.test.ts`; AI-4 in `tests/ai.test.ts`; server-side report masking (commit 9025979, "Reports: mask report text on the server before storing it"); `apps/web/docs/DESIGN.md` (Data handling, Model provider).

### 5. What does it cost per message?

The bank's SMS cost is unchanged, because Gaskiyya sends no SMS; retail SMS is about N6 per message (press report) [S13]. Our side is one HTTPS call per message, one small record that expires after 30 days by default, and one database read per customer check. We have not measured infrastructure cost per message. The one measurement is a laptop load test on the in-memory store (Apple M1, Node 22, client and server in one process): 5,728 to 8,476 single registrations a second and 6,056 to 7,696 checks a second, p95 under 17 ms, no errors. Firestore and production were not measured, and will be slower per request. Pricing to banks is a proposal (licence plus a fee per registered message) and is not yet set.

*Evidence:* `apps/web/docs/decisions/0004-firestore.md` (verification is one document read; batch registration writes up to 200 records per transaction); `RECORD_TTL_DAYS` in `apps/web/docs/CONFIGURATION.md`; `apps/web/docs/PERFORMANCE.md` (`pnpm load`); deck slide 9.

### 6. Why would Zenith, or any bank, adopt this?

Because the losses are large and mostly start with someone posing as someone else: NIBSS counted N17.67bn lost in 2023, and 65.8% of cases were social engineering, derived from its counts [S1]; in 2025 it named social engineering the most prevalent technique [S2]. Gaskiyya gives the bank's own customers a way to check its messages and calls against its own records, changes nothing customers see, needs no core-banking access, and runs inside the bank. The fraud desk also gets campaigns grouped from customer reports, with draft advisories, so it can respond before a scam spreads. We have not discussed this with Zenith or any bank; that is the ask.

*Evidence:* [S1], [S2]; `apps/web/docs/DESIGN.md` (Deployment options, Campaign detection); AI-5 and AI-9.

### 7. Was this built at the hackathon?

Here is what the git history shows: the first commit is dated 5 Oct 2026 ("Add registry API, canonicalisation libraries, schemas, campaign agent and acceptance tests"), the Flutter app and console followed the same day, and there are 60 commits on `main` up to 20 Oct 2026. The design document is dated 5 Oct 2026 and records that we asked whether code written before the event may be used. We built it against acceptance tests written first, and we read the tests for the verdict, registry and AI groups ourselves. [CONFIRM: the Zecathon 6.0 build-period start date, the organisers' answer on pre-event code, and how to phrase this answer.]

*Evidence:* `git log --reverse --format='%ad %s' | head`; `apps/web/docs/DESIGN.md` (Before the hackathon, Engineering).

### 8. What if a bank's hashing key is stolen?

A stolen key alone cannot make a fake message confirm: a message confirms only if the bank registered it, and registering needs the bank's OAuth credentials. The real exposure is that someone holding both the key and a copy of the store could try to recover phone numbers by brute force, so keys are held per bank, apart from the data, and can be rotated. Rotation is versioned: after a planned rotation old records keep verifying until they expire, and after a suspected leak the old key is dropped at once, so its records return "not confirmed" (never "confirmed"). In production the keys should come from a key management service; today they are loaded from environment configuration, and a KMS integration is not built.

*Evidence:* KEY-1 to KEY-3 in `tests/key-rotation.test.ts`; `apps/web/docs/decisions/0008-key-rotation.md`; `apps/web/docs/CONFIGURATION.md` (Rotating a bank's hashing key); `apps/api/src/keys/keys.ts`.

### 9. Can a scammer register their own messages as genuine?

No. Registration endpoints accept only a bank's own client credentials, and each record belongs to that bank, so a scammer cannot write into a bank's records. The remaining risk is a stolen bank credential. Our design adds mutual TLS and an IP allowlist at the bank's API gateway, plus alerts on unusual volume or new link domains and an audit log. The gateway controls sit outside our service by design. The anomaly guard is built: it emails the bank's fraud desk when a registration carries a link domain the bank has not declared, or when registration volume spikes above its trailing rate, and it never blocks sending. A full audit log is designed but not built.

*Evidence:* REG-8 in `tests/registry.test.ts`; `apps/api/src/guard.ts` and `tests/guard.test.ts`; `apps/web/docs/DESIGN.md` (Threats and controls); README (Status and known gaps: "Mutual TLS and network allowlisting for bank endpoints belong at the ingress or API gateway").

### 10. Can a fraudster just forward a real bank message?

It will not verify. Every record is keyed to the number the bank sent it to, and the check uses the checking customer's own number from their bank-signed session or their WhatsApp number, so the same message checked by anyone else is "not confirmed" (principle 3). This holds under every key version during a rotation, and on WhatsApp and USSD as well as in the app. We show it live in the demo, step (c).

*Evidence:* REG-2 in `tests/registry.test.ts`; KEY-3 in `tests/key-rotation.test.ts`; USSD-2 and USSD-4 in `tests/ussd.test.ts`; `apps/web/docs/pitch/script.md` step (c).

### 11. What if fraudsters send from the bank's real sender ID, by spoofing or a SIM box?

Then the message looks perfect on the phone, and Gaskiyya still says "not confirmed", because the bank never registered that message for that number. We never trust the sender ID or caller ID: a matching sender ID cannot upgrade a verdict, and a screenshot from an unknown sender gets an extra warning. For calls, the four-digit code comes from the bank's own system and appears in the customer's app, so a spoofed caller ID does not help the fraudster.

*Evidence:* AI-8 in `tests/ai.test.ts` ("a matching sender ID never changes a verdict"); CALL-2 and CALL-4 in `tests/calls-links.test.ts`; `apps/web/docs/DESIGN.md` (Verifying a call).

### 12. What about customers on feature phones, and what does USSD cost?

They dial the bank's USSD code: option 1 shows whether the bank is calling them now and the call code, option 2 lists what the bank sent them today by time, category and channel, with no content. It cannot check message text, since there is no way to paste it on a basic phone, so it says plainly that a message not on today's list is not confirmed. This matters: EFInA found at least one in two people in priority excluded groups have only a basic phone [S7]. On cost: we use Africa's Talking's callback format, and the bank would add the options to the USSD menu it already runs; we have not priced USSD sessions, the demo code `*347*123#` is not a real assigned short code, and we have no MNO agreement.

*Evidence:* USSD-1 to USSD-7 in `tests/ussd.test.ts` and `apps/web/docs/decisions/0007-ussd-channel.md`; USSD-8 in `tests/console.test.ts` and `tests/sandbox.test.ts` (the console's feature phone); `apps/api/src/ussd.ts`; [S7]. Tested against Africa's Talking's documented callback format, not on a live short code.

### 13. How good are the translations?

English is the source text. Pidgin, Hausa, Yoruba and Igbo are built into the app (a language picker in Settings), the WhatsApp bot (`LANG HA`) and USSD, but every one was drafted without a native speaker and is marked as needing native-speaker review. Our rule is that a language goes live for real customers only after that review. Tests check that every translation keeps each placeholder, that no warning contains a word meaning genuine or safe, and that every USSD screen fits 160 characters. The verdict lines themselves are fixed text, not model output, so a weak translation cannot turn a fake into "confirmed". We need native-speaker reviewers, ideally from the pilot bank's own customer-service teams.

*Evidence:* `apps/web/docs/DESIGN.md` (Languages; Risks: "Explanation quality in local languages"); `apps/web/docs/decisions/0002-model-provider.md` (local-language quality); `apps/web/docs/decisions/0006-languages-and-app-copy.md`; LANG-1 to LANG-5 and LANG-7 in `tests/languages.test.ts`; LANG-3 and LANG-6 in `apps/mobile/test/language_test.dart`. The recent-activity sentence is still assembled in English.

### 14. Doesn't this create a false sense of security? What about genuine messages the bank forgot to register, or fakes about things the bank never sends?

"Not confirmed" means "there is no record of your bank sending this to this number", and the advice is not to click, call or share codes, which is the right advice for an unknown message either way. The bigger risk is the other direction: a genuine message the bank failed to register shows as "not confirmed" and hurts trust. So a pilot enrols one message type at a time and measures registration coverage before adding the next (`GET /v1/metrics` reports registered versus verified counts and the not-confirmed rate; the bank supplies its sent count), and every "not confirmed" result shows what the bank really sent recently. The system never says "confirmed" for anything it did not match exactly.

*Evidence:* `verdict.not_confirmed.body` in `packages/schemas/copy.json`; REG-3 in `tests/registry.test.ts` (recent activity on not confirmed); `apps/web/docs/DESIGN.md` (Risks and trade-offs: incomplete registration coverage); `GET /v1/metrics`, `apps/api/src/domain/coverage.ts` and `tests/coverage.test.ts`.

### 15. Customers won't use it until every bank is in, and banks won't join until customers use it. How do you break that?

One bank is enough to start. In the bank-hosted model the check sits inside that bank's own app, WhatsApp number and USSD menu, for that bank's own customers, so it needs no other bank. The fraud desk gets campaign intelligence from day one. When more banks join, the same registry serves them with separate keys and data, and the customer app can already link several banks and route each check to the right one.

*Evidence:* `apps/web/docs/DESIGN.md` (Deployment options; Integration on the customer's device); `GET /v1/banks`; BANK-1 to BANK-5 in `apps/mobile/test/multibank_test.dart`; `apps/web/docs/decisions/0010-accessibility-and-multibank.md`.

### 16. Is anything live? Which track is this, and what technology does it use?

Nothing in the demo touches a real bank. The bank sandbox console stands in for the bank's notification service, contact centre, mobile-banking login and fraud desk; the banks are DemoBank and the fictional "ZB Demo Bank (demo)"; there are no live banking systems, no production APIs and no real customers. What is real is the software: the registry, the app, the WhatsApp webhook, the USSD callback and the campaign agent are running code with automated acceptance tests, and the in-browser sandbox runs the same flow with no server at all. We entered the track "Strengthening Trust in Digital Banking". The full list of technologies, and their licences, is on the tech-stack slide.

*Evidence:* `apps/api/src/simulator/` (bank simulator); `apps/api/src/simulator/demo-banks.json` and `tests/demo-bank.test.ts` (fictional demo bank, no Zenith name); `apps/web/docs/DEMO.md` section 7 (sandbox); [tech-stack.md](tech-stack.md) and `apps/web/docs/TECH_STACK.md`.

---

## Questions we cannot fully answer yet

Say so plainly if asked:

- Real-world numbers: we have no pilot, no bank integration, no production customers and no fraud-reduction result.
- An official figure for the share of fraud that is SMS, WhatsApp or call impersonation of a bank: we looked and found none (deck, Sources).
- Performance and cost on Firestore and in production: not measured. Only the laptop, memory-store load test exists (`apps/web/docs/PERFORMANCE.md`).
- The 20 Oct QA review: all 25 findings (F1 to F25) are fixed on `main`, the code fixes with tests; the copy and canonicalisation changes are recorded in decisions 0012 and 0013. Not yet done from the review's wider notes: a consent toggle before text is sent for an explanation. See the status section of `apps/web/docs/qa/2026-10-20-qa-report.md`.
