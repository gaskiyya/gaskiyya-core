# Pitch materials (Zecathon 6.0)

For the semi-final demo (23 Oct 2026, Lagos) and the final (28 Oct 2026). Judging criteria: Innovation and Creativity, Feasibility, Impact, Scalability, Presentation.

| File | What it is |
| --- | --- |
| [deck.md](deck.md) | Ten-slide outline: on-slide bullets, speaker notes and an evidence line per slide, plus the full **Sources** table for every figure |
| [script.md](script.md) | The timed three-minute spoken pitch, and the 90-second live demo click path with a recovery line per step |
| [qa.md](qa.md) | The fifteen hardest judge questions plus one on the rules ("Is anything live?"), with short answers and evidence pointers, plus what we cannot answer yet |
| [tech-stack.md](tech-stack.md) | The tech-stack slide required by the rules (written separately; see also `apps/web/docs/TECH_STACK.md`) |

Related: [apps/web/docs/DEMO.md](../DEMO.md) (demo runbook and fallbacks), [video/VOICEOVER.md](../../../../video/VOICEOVER.md) (the 30-second film), [apps/web/docs/DESIGN.md](../DESIGN.md), [apps/web/docs/qa/2026-10-20-qa-report.md](../qa/2026-10-20-qa-report.md).

## Ground rules

- Every figure on a slide carries a source tag, and the citation is in `deck.md`, Sources. Figures seen only in the press are marked "(press report)". The 65.8% social-engineering share is derived by us from NIBSS 2023 case counts, and NIBSS's 2023 data covers only 60 of 163 institutions.
- Every product claim names a file or a requirement ID (for example REG-6, AI-7, USSD-2). Every feature cited is merged into `main`.
- No Zenith logo or trademark. Zenith is named only as the host and a possible pilot bank.
- Nothing is claimed that is not built: no live bank integration, no real USSD short code or MNO agreement, no production deployment, no pilot results. The demo runs on simulated bank systems only, and the deck, script and Q&A say so.
- Load figures are laptop numbers on the memory store (`apps/web/docs/PERFORMANCE.md`); Firestore and production are not measured, and every mention says so.

## Placeholders the owner must fill

| Marker | Where | What to put |
| --- | --- | --- |
| `[TEAM NAME]` | deck.md slides 1 and 10 | Team name as registered with Zecathon |
| `[PHOTO]`, `[NAME]`, `[ROLE]` (three each) | deck.md slide 10 | Team members |
| `[CONTACT]` | deck.md slide 10 | Email or phone for follow-up |
| `[N]` | deck.md slide 10 | Test count from a fresh `npx vitest run` on the day (231 on `main` at f097011, 20 Oct 2026) |
| `[CONFIRM: test count]` | deck.md slide 10 notes | Same as above; add Dart and Flutter counts from `pnpm test` if quoted |
| `[PRICE: to set]` (twice) | deck.md slide 9 | Proposed licence and per-1,000-message price, or leave the slide without numbers |
| `[CONFIRM: pilot targets]` | deck.md slide 9 | KPI target values, if agreed with a bank |
| `[CONFIRM: slot length and whether the demo counts inside it]` | script.md, top | Pitch slot length from the organisers |
| `[CONFIRM: the Zecathon 6.0 build-period start date, ...]` | qa.md question 7 | The official build period, the organisers' rule on pre-event code, and the final wording. Git history starts 5 Oct 2026 |

Also confirm before presenting:

- USSD (USSD-1 to USSD-8), the Ollama provider and `pnpm demo:offline`, accessibility (A11Y-1 to A11Y-4), multi-bank (BANK-1 to BANK-5), the load test, anomaly guard and coverage metric, and the five languages are all on `main`. Re-run `npx vitest run` and `pnpm test` on the demo laptop the day before.
- Always describe the languages as "five languages, pending native-speaker review"; never as reviewed.
- The spoken-pitch word count (`script.md` gives the command) still fits 3:00 after any edits.
