# 0006: Five languages, as overlays over the one copy file

**Status:** accepted (approved by owner as additive copy, 2026-10-20)

Gaskiyya speaks English (`en`), Nigerian Pidgin (`pcm`), Hausa (`ha`), Yoruba (`yo`) and Igbo (`ig`). English stays the single source of truth in `packages/schemas/copy.json`; each other language is an overlay file next to it.

## Decision

- **App text moved into the copy file.** The Flutter screens no longer write English inline: every screen string lives in `copy.json` under a new top-level `app` namespace and is read through the app's `Copy` loader. The moved strings keep their English wording.
- **Overlay format.** `packages/schemas/copy.<lang>.json` has the same key structure as `copy.json`, and may be partial. Its top level carries `"_review": "needs native-speaker review"`. Keys starting with `_` are markers, not text. Files are ASCII: non-ASCII letters (Hausa hooked letters, Yoruba and Igbo dotted vowels, typographic quotes) are written as `\uXXXX` escapes.
- **Fallback.** Overlays are merged over English at load time, key by key, on the server (`copyFor(lang)` in `@gaskiya/schemas`) and in the app (`Copy.t`). A key the overlay lacks shows its English text; an unknown language is English. Language names (`app.language.names.*`) are endonyms and live only in English.
- **Same meaning in every language.** A verdict means exactly the same in every language. "Not confirmed" is never softened into "probably fine", "cannot check" never suggests the message is genuine, and every warning keeps its instruction (do not click, call or share codes; hang up). Placeholders such as `{bank}` stay intact. Tests (LANG-1, LANG-2) check that overlay keys are a subset of English, that placeholders match per key, that every verdict, call, link, explanation, bot and app text is translated, and that no warning contains a word meaning genuine or safe.
- **Explanations.** The app sends its language to `POST /v1/explain`; the model is asked to answer in that language, and the fixed fallback comes from the overlay. Because the English-only secret-request check cannot read other languages, local-language model output that mentions a PIN, password, OTP or card number at all is replaced by the fixed text (fail safe).
- **App.** Settings has a language picker, saved with the other settings; changing it redraws every screen.
- **WhatsApp.** `LANG HA` (a code or a language name: `LANG hausa`, `language Yoruba`) sets the reply language for that number. It is stored keyed by the keyed hash of the number, like every other per-customer record, and holds no message content. `LANG` alone lists the choices. All bot replies use it.
- `pnpm sync:copy` copies `copy.json` and every overlay into the app's assets.

## Review status

All four translations were drafted without a native speaker and **need native-speaker review** before customers rely on them. Yoruba is written with underdots but without tone marks; Hausa month names and Igbo and Yoruba technical terms (link, domain, app, PIN) are deliberately left close to the English the customer sees on screen. Design section "Languages" (switch a language on after review) still applies to production use.

## Keys added (all under `app`, English wording)

- `app.common.*`: yourBank, cancel, continue, done, tryAgain
- `app.tabs.*`: check, calls, activity, settings
- `app.onboarding.*`: skip, getStarted, intro.title, intro.body, message.eyebrow, message.title, message.body, call.eyebrow, call.title, call.body, privacy.eyebrow, privacy.title, privacy.body
- `app.link.*`: title, intro, mobileNumber, demoCustomers, chooseBank, enterNumber, cannotReachBank, banksUnreachable, noBanks
- `app.check.*`: placeholder, paste, screenshot, checkLink, checkMessage, fingerprintNote, recentMessages, demoInbox, inboxEmpty
- `app.result.*`: linkCheck, messageCheck, checking, rateLimited, reportFake, screenshotText, address, from, channel, type, sent, months
- `app.calls.*`: checkAgain, howItWorks, validFor
- `app.activity.*`: last24h, by, withLink, footer
- `app.settings.*`: linked, privacy, textStays, numbersMasked, reportsConsent, about, showIntro, unlink, unlinkConfirm, unlinkBody, unlinkAction
- `app.language.*`: title, set, options, hint, names.en, names.pcm, names.ha, names.yo, names.ig

Also added, outside `app`, with owner approval:

- `indicators.unknown_sender`: "Sent from a name or number your bank does not use". The app shows it as an added caution under a result when the registry's screenshot response carries `warnings: ["unknown_sender"]` (never on a confirmed result, and never an input to the verdict).

No existing English key changed wording.

## Other namespaces translated

The overlays also translate `a11y.*` and `banks.*` (decision 0010) and `ussd.*` (decision 0007). The only English text left untranslated on purpose is the activity sentence parts (`activity.*` except `heading`) and the language names.

## USSD

USSD screens are GSM-7 plain ASCII and at most 160 characters. The `ussd.*` overlay text is written in ASCII spellings with no tone marks, underdots or hooked letters (Hausa "sako" for "saƙo", Yoruba "ifiranse" for "ifiranṣẹ"). Shared keys a USSD screen reuses (call, cannot check, purposes, categories) are folded to the same ASCII spellings when sent: tone marks and underdots are dropped and ɓ, ɗ, ƙ, ƴ become b, d, k, y. A USSD session answers in the language the number chose on WhatsApp with LANG (the preference is per keyed number, shared by both channels); there is no USSD language menu yet. LANG-7 checks every fixed screen fits 160 characters in every language.

## Consequences

- The recent-activity sentence (`activityText`) is still assembled in English on the server, because its grammar (number words, plurals) is English-specific; the rest of the not-confirmed reply is translated.
- Adding a language is one overlay file, one entry in `LANGUAGES` (TypeScript) and `Copy.languages` (Dart), and a native-speaker review.
