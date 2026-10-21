# Technology stack

Every technology Gaskiyya uses, what it does here, and its licence. Licences were read from the installed package (see the [appendix](#appendix-how-each-licence-was-verified)), not taken from memory.

Category key:

- **open source**: an OSI-approved licence (MIT, Apache-2.0, BSD, OFL and so on).
- **open weights**: model weights published for download and local use under a custom licence that is not OSI open source.
- **source-available**: source is public, but the licence restricts some users or uses.
- **proprietary-public**: a closed product or hosted API that anyone can sign up for and use under public terms. Every one of these is optional in Gaskiyya.

## How the hackathon rules are met

- **Open-source core.** Everything that decides a verdict runs on open-source code: Node.js, TypeScript, Fastify, zod, the canonicalisation packages, Node's own HMAC-SHA-256, and Flutter/Dart in the app. The verdict function (`apps/api/src/domain/verdict.ts`) uses no AI and no hosted service.
- **Every proprietary service is optional and has an open or offline alternative.** The offline demo runs with `pnpm dev`: the in-memory store, no AI key (fixed fallback explanations) or a local Ollama model, and the live event stream instead of push. The table below says, for each hosted service, whether the offline demo needs it. None of them is needed.

  | Proprietary service | Open or offline alternative already in the repo |
  | --- | --- |
  | Cloud Firestore | In-memory store, `apps/api/src/store/memory.ts` (same `Store` interface, same acceptance tests) |
  | Gemini API / OpenAI API | Ollama with open-weights models (`AI_PROVIDER=ollama`), or no model at all (`AI_PROVIDER=none`) |
  | Firebase Cloud Messaging | Server-sent event stream to the open app (`GET /v1/events`) |
  | Resend | Alerts stay in the fraud dashboard; email is skipped |
  | WhatsApp Cloud API | The app and the console's device preview do the same checks |
  | Africa's Talking USSD | The console's feature-phone simulator posts the same callbacks |
  | Google ML Kit (on-device OCR) | Paste or share the text; screenshot reading through the AI provider |
  | Codemagic / Cloud Run | `flutter build` and `docker build` / `docker run` locally |

- **No live banking or production APIs.** The bank is simulated. The bank sandbox console (`apps/web/console`) plays the bank's notification service, contact centre, mobile-banking login (it issues its own signed tokens and serves its own JWKS) and fraud desk. Demo banks and customers are fictional (`apps/api/src/simulator/demo-banks.json`). Gaskiyya never connects to a core banking system, payment rail or real bank API.

## Mobile app (`apps/mobile`)

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| Flutter SDK + Dart | Cross-platform UI toolkit and language | BSD-3-Clause | open source | The whole customer app, one codebase for Android and iOS (`apps/mobile/lib/`) | One codebase, native performance, strong offline tooling |
| `gaskiya_canonical` (ours) | Dart port of the canonicaliser | project code | open source | Normalises and hashes a message on the phone so only the digest leaves it (`packages/canonical_dart/lib/gaskiya_canonical.dart`) | Must match the TypeScript version byte for byte; shared test vectors prove it |
| `unorm_dart` 0.3.3 | Unicode normalisation (NFC/NFKC) | MIT | open source | Unicode normalisation inside canonicalisation (`packages/canonical_dart/lib/gaskiya_canonical.dart`) | Dart has no built-in NFKC |
| `crypto` 3.0.7 | Dart hash functions | BSD-3-Clause | open source | SHA-256 for the on-device digest (`apps/mobile/lib/src/core/text_tools.dart`, canonical_dart) | Official Dart team package |
| `http` 1.6.0 | HTTP client | BSD-3-Clause | open source | Calls the registry API (`apps/mobile/lib/src/core/api.dart`, `session.dart`) | Official, small |
| `shared_preferences` 2.5.5 | Key-value storage | BSD-3-Clause | open source | Remembers the linked bank and settings (`apps/mobile/lib/src/core/session.dart`) | Official Flutter plugin |
| `flutter_secure_storage` 11.2.0 | Keychain/Keystore wrapper | BSD-3-Clause | open source | Declared in `apps/mobile/pubspec.yaml` for token storage; not imported by `lib/` at present | Platform secure storage |
| `receive_sharing_intent` 1.9.0 | Share-sheet receiver | Apache-2.0 | open source | Lets a customer share a suspicious SMS straight into the app (`apps/mobile/lib/src/ui/screens/home.dart`) | Checking from the share sheet is the fastest path |
| `image_picker` 1.2.3 | Gallery/camera picker | BSD-3-Clause | open source | Picks a screenshot to check (`apps/mobile/lib/src/ui/screens/check_screen.dart`) | Official Flutter plugin |
| `image` 4.12.0 | Pure-Dart image codec | MIT | open source | Downscales screenshots before OCR (`apps/mobile/lib/src/core/screenshot.dart`) | Pure Dart, no native code |
| `google_mlkit_text_recognition` 0.17.1 (+ `google_mlkit_commons` 0.13.0) | Flutter plugin for Google ML Kit text recognition | MIT (plugin); the ML Kit SDK it pulls in (`com.google.mlkit:text-recognition`) is closed-source Google software, free to use | open source plugin over a proprietary-public SDK | Reads the text of a screenshot **on the phone**, so the image never leaves it (`apps/mobile/lib/src/core/ocr_mlkit.dart`) | Offline, private OCR; works without any AI key |
| `firebase_core` 4.15.0, `firebase_messaging` 16.7.0 | FlutterFire plugins | BSD-3-Clause | open source (client for a proprietary service) | Receives push call notices (`apps/mobile/lib/src/core/push.dart`) | FCM is the standard Android/iOS push route |
| `flutter_animate` 4.5.2 | Animation helpers | BSD-3-Clause | open source | Declared in `apps/mobile/pubspec.yaml`; not imported by `lib/` at present | - |
| `cupertino_icons` 1.0.9 | iOS icon font | MIT | open source | iOS-style icons (`apps/mobile/lib/src/ui/screens/check_screen.dart`) | Matches the iOS design language |
| Inter / Inter Display fonts | Typeface | OFL-1.1 | open source | App typography (`apps/mobile/assets/fonts/`) | Very legible at small sizes |
| `flutter_lints`, `flutter_launcher_icons`, `flutter_native_splash` | Dev tools | BSD-3-Clause, MIT, MIT | open source | Lints, launcher icons from `brand/`, splash screen | Standard Flutter tooling |
| Three.js 0.186.1 | WebGL 3D library | MIT | open source | Renders the app's 3D icons to PNG at build time (`apps/mobile/art/scenes.js`, `render.mjs`) | Custom art, no stock assets |
| Playwright (`playwright-core` 1.63.0) + Chromium | Headless browser driver | Apache-2.0 (Chromium: BSD-3-Clause) | open source | Drives headless Chromium for the 3D renders, launcher icons and the whitepaper PDF (`apps/mobile/art/render.mjs`, `scripts/render-icons.mjs`, `scripts/whitepaper.mjs`) | Repeatable rendering from code |
| edge-tts 7.3.1, voice en-NG-EzinneNeural | Text to speech | LGPL-3.0 (edge-tts); voice by Microsoft | free service | Records the bank agent on the console's simulated call, a Nigerian English female voice, at build time (`scripts/voice/render.py`); the clips are committed, so the demo runs offline | A Nigerian voice that reads codes clearly |
| Whisper medium.en (`openai/whisper-medium.en`, Transformers 4.47.1) | Speech recognition | MIT | open source | Listens to every assembled call while rendering; nothing is written unless every digit is heard correctly | A check on the recorded codes |

## Registry API (`apps/api`)

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| Node.js 22+ (24 in the image) | JavaScript runtime | MIT | open source | Runs the registry, console server and agent | Mature, built-in crypto |
| TypeScript 5.9.3 | Typed JavaScript | Apache-2.0 | open source | Every server, console and shared package | Type safety across the workspace |
| `tsx` 4.23.15 | TypeScript runner | MIT | open source | Runs `.ts` directly, including in the production image (`Dockerfile`) | No build step on the server |
| Fastify 5.12.5 | HTTP framework | MIT | open source | Bank API, customer API, calls, reports, webhooks, event stream (`apps/api/src/app.ts`) | Fast, schema-friendly, good plugin model |
| `@fastify/cors` 11.3.0 | CORS plugin | MIT | open source | Browser origin allowlist (`apps/api/src/app.ts`) | Official plugin |
| zod 4.6.5 | Schema validation | MIT | open source | Validates every request (`packages/schemas/src/index.ts`) and AI output | One schema for types and runtime checks |
| `jose` 6.2.12 | JWT/JWK library | MIT | open source | Verifies the bank's customer login tokens against its JWKS (`apps/api/src/auth/auth.ts`) | Standards-complete, no native deps |
| `@gaskiya/canonical` (ours) | Canonicaliser and digest | project code | open source | Same canonicalisation as the app (`packages/canonical/src/index.ts`) | Shared vectors in `packages/test-vectors/` |

## AI layer (`apps/api/src/ai`)

The model only explains a result after the registry has decided it, or reads a screenshot. It never produces a verdict (principle 1).

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen | Needed for offline demo? |
| --- | --- | --- | --- | --- | --- | --- |
| Ollama | Local model server | MIT | open source | Serves open-weights models over a local HTTP API, `AI_PROVIDER=ollama` (`apps/api/src/ai/ollama.ts`, `tests/ollama.test.ts`, decision 0011; tested against a stand-in for Ollama's API, not yet with real models) | Fully offline, no message text leaves the machine | Optional (the offline AI choice) |
| `nomic-embed-text` (default embedding model; see `apps/api/src/ai/ollama.ts`) | Text embedding model | Apache-2.0 | open source (open weights under an OSI licence) | Embeds masked reports so the agent can group similar scams | Small, fast, permissive | Optional |
| Default chat model (`llama3.1:8b` at time of writing; see `apps/api/src/ai/ollama.ts`) | Meta Llama 3.1 8B | Llama 3.1 Community License (custom) | open weights, custom licence (not OSI) | Writes plain-language explanations and fraud-desk briefings | Runs on a laptop | Optional |
| Default vision model (`gemma3:4b` at time of writing; see `apps/api/src/ai/ollama.ts`) | Google Gemma 3 4B | Gemma Terms of Use (custom) | open weights, custom licence (not OSI) | Reads text from a screenshot when sent to the server | Small multimodal model | Optional |
| Gemini API (`@google/genai` 2.27.0 SDK) | Google's hosted models | SDK Apache-2.0; service under Google terms | proprietary-public (SDK open source) | Default hosted provider for explanations, OCR and embeddings (`apps/api/src/ai/gemini.ts`) | Good quality and price; free tier | No |
| OpenAI API (`openai` 7.28.0 SDK) | OpenAI's hosted models | SDK Apache-2.0; service under OpenAI terms | proprietary-public (SDK open source) | Alternative provider, `AI_PROVIDER=openai` (`apps/api/src/ai/openai.ts`) | Swap-in without code changes (decision 0002) | No |
| `NoModelProvider` (ours) | Fixed fallback | project code | open source | Fixed explanation text and a local embedding when no model is configured (`apps/api/src/ai/provider.ts`) | Fail-closed, always available | Used by default when no key is set |

## Campaign agent (`apps/agent`)

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| Agent loop (ours, TypeScript) | Four-tool campaign detector | project code | open source | Groups masked, consented reports into campaigns and drafts advisories; has no tool that sends anything (`apps/agent/src/index.ts`, wired in `apps/api/src/campaigns.ts`) | Small and auditable; no agent framework needed |
| Embeddings | From the configured AI provider (Ollama, Gemini, OpenAI) or the local fallback | as above | as above | Similarity between reports | Works with or without a hosted model |

## Bank sandbox (`apps/web/console`)

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| React 19.3.0 + React DOM | UI library | MIT | open source | Fraud dashboard, message/call simulator, device preview (`apps/web/console/src/App.tsx`) | Familiar, fast to build |
| Vite 8.3.2 + `@vitejs/plugin-react` 6.1.2 | Build tool | MIT | open source | Builds the landing site, console and admin dashboard (`apps/web/vite.config.ts`) | Fast dev server |
| `@fastify/static` 10.1.5 | Static file plugin | MIT | open source | Serves every built web UI (landing site, console, admin dashboard) from the server (`apps/api/src/web.ts`) | Official plugin |
| `jose` 6.2.12 | JWT/JWK library | MIT | open source | The simulated bank signs customer login tokens and publishes its JWKS (`apps/api/src/simulator/index.ts`) | Same library as the verifier |
| `motion` 12.23.12 | Animation library | MIT | open source | Console UI transitions (`apps/web/console/src/device/Device.tsx`) | Small, React-friendly |
| `thinking-orbs` 0.3.2 | Animated loader | MIT | open source | "Working" indicators in the console and landing site | Visual polish |

## Crypto

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| Node.js `node:crypto` | Built-in crypto (OpenSSL) | MIT (Node), Apache-2.0 (OpenSSL 3) | open source | HMAC-SHA-256 keyed fingerprints, one key per bank (`apps/api/src/keys/keys.ts`); SHA-256 digest (`packages/canonical/src/index.ts`) | Standard, audited, no extra dependency |
| `@noble/hashes` 1.8.0 | Audited pure-JS hashes | MIT | open source | HMAC/SHA-256 in the in-browser sandbox, where `node:crypto` is unavailable (`apps/web/console/src/sandbox/node-crypto.ts`) | Audited, zero dependencies |
| Dart `crypto` 3.0.7 | See mobile app | BSD-3-Clause | open source | On-device digest | - |

## Storage

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen | Needed for offline demo? |
| --- | --- | --- | --- | --- | --- | --- |
| In-memory store (ours) | `Store` implementation | project code | open source | Tests and the offline demo (`apps/api/src/store/memory.ts`) | Zero setup | Yes (this is the offline store) |
| Cloud Firestore (`@google-cloud/firestore` 9.3.1 SDK) | Google's managed document database | SDK Apache-2.0; service under Google Cloud terms | proprietary-public (SDK open source) | Production store: keyed hashes and labels, never message text (`apps/api/src/store/firestore.ts`, `firestore.rules`, decision 0004) | Serverless, scales to zero | No |
| Firestore emulator (downloaded by `firebase-tools`) | Local Firestore | closed-source Google binary, free to use | proprietary-public | Runs the acceptance suite against Firestore (`pnpm test:firestore`) | Same tests on both stores | No |
| Java 21+ (OpenJDK) | JVM | GPL-2.0-only WITH Classpath-exception-2.0 | open source | Only to run the Firestore emulator | Required by the emulator | No |

## Delivery and channels

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen | Needed for offline demo? |
| --- | --- | --- | --- | --- | --- | --- |
| Server-sent events (ours) | HTTP event stream | project code | open source | Call notices to an open app with no polling (`apps/api/src/app.ts`) | Works without any push service | Yes |
| Firebase Cloud Messaging | Google's push service | Google terms | proprietary-public | Push call notices to a closed app (`apps/api/src/channels/fcm.ts`) | Only reliable way to wake a phone | No |
| Resend (`resend` 6.32.0 SDK) | Hosted email API | SDK MIT; service under Resend terms | proprietary-public (SDK open source) | Fraud-desk campaign alerts (`apps/api/src/channels/email.ts`, templates in `apps/api/src/emails/`) | Simple API, good deliverability | No |
| WhatsApp Cloud API (Meta) | Hosted WhatsApp Business Platform | Meta terms | proprietary-public | Customers forward a message to a WhatsApp number to check it (`apps/api/src/whatsapp.ts`) | Where Nigerian customers already are | No |
| Africa's Talking USSD | Hosted USSD gateway | Africa's Talking terms | proprietary-public | Feature-phone menu: "Is my bank calling me?" and today's messages (`apps/api/src/ussd.ts`, `tests/ussd.test.ts`, decision 0007; not tried on a live short code) | Reaches customers without a smartphone or data | No (the console's feature-phone simulator posts the same callbacks) |
| Firebase Hosting + `firebase-tools` 15.32.1 | Static hosting and CLI | CLI MIT; hosting under Google terms | proprietary-public (CLI open source) | Hosts the landing site; deploys Firestore rules and indexes (`firebase.json`) | Free tier, one CLI for both | No |
| Docker (`node:24-slim` base) | Container image | Apache-2.0 (Docker Engine); Debian + Node in the image | open source | Builds the server image (`Dockerfile`) | Runs the same anywhere | No (`pnpm dev` runs without it) |
| Google Cloud Run | Managed container runtime | Google terms | proprietary-public | Suggested host for the server image and the agent job (`apps/web/docs/CONFIGURATION.md`) | Scales to zero, HTTPS by default | No |
| Codemagic | Hosted CI for Flutter | Codemagic terms | proprietary-public | Builds the Android APK/AAB and iOS TestFlight builds (`codemagic.yaml`) | macOS builders for iOS | No (`flutter build` locally) |
| pnpm 10 | Package manager | MIT | open source | Workspace installs and scripts (`pnpm-workspace.yaml`) | Fast, strict workspaces | Yes |

## Quality and tooling

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| Vitest 5.0.3 | Test runner | MIT | open source | Acceptance tests named by requirement ID (`tests/`, `vitest.config.ts`) | Fast, TypeScript-native |
| ESLint 10.12.0 + `typescript-eslint` 8.71.0 + `@eslint/js` + `globals` | Linter | MIT | open source | `pnpm check` (`eslint.config.js`) | Standard |
| Dart `test`, `lints` | Dart test and lint packages | BSD-3-Clause | open source | Canonicaliser tests (`packages/canonical_dart/test/`) | Official |

## Video and pitch (`video/`)

| Technology | What it is | Licence | Category | What it does in Gaskiyya | Why chosen |
| --- | --- | --- | --- | --- | --- |
| Remotion 4.0.533 (`remotion`, `@remotion/cli`) | Video made with React | Remotion License (free for individuals, non-profits and companies up to 3 employees; company licence above that) | source-available | Renders the walkthrough video (`video/src/Walkthrough.tsx`) | Video as code, re-renderable when the UI changes |
| `@remotion/transitions` 4.0.533 | Remotion transitions | `UNLICENSED` in package.json, no licence file; part of the Remotion monorepo, so taken as the Remotion License | source-available (unclear) | Scene transitions (`video/src/`) | Ships with Remotion |
| `@remotion/fonts` 4.0.533 | Font loading | MIT | open source | Loads Inter in the video (`video/src/fonts.ts`) | - |
| Soundtrack synthesiser (ours) | TypeScript audio synthesis | project code | open source | Generates the music bed and effects; no samples or licensed music (`video/scripts/soundtrack.ts`) | No third-party audio rights |
| ffmpeg | Media encoder | LGPL-2.1-or-later (GPL-2.0-or-later for some builds) | open source (copyleft, used as a separate tool) | Re-encodes the rendered video for the web (README) | Standard; not linked into Gaskiyya |

## Appendix: how each licence was verified

npm packages: the `license` field in `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/package.json` and the first lines of its `LICENSE` file, after `pnpm install` on this commit. Video packages: `video/node_modules/<pkg>/` after `npm install` in `video/`. Dart packages: `LICENSE` in `~/.pub-cache/hosted/pub.dev/<pkg>-<ver>/`, located through `apps/mobile/.dart_tool/package_config.json` after `flutter pub get`.

| Item | File read | Result |
| --- | --- | --- |
| fastify 5.12.5 | `node_modules/.pnpm/fastify@5.12.5/node_modules/fastify/LICENSE` | MIT |
| @fastify/cors 11.3.0, @fastify/static 10.1.5 | `node_modules/.pnpm/@fastify+cors@11.3.0/.../LICENSE`, `@fastify+static@10.1.5/.../LICENSE` | MIT |
| zod 4.6.5 | `node_modules/.pnpm/zod@4.6.5/node_modules/zod/LICENSE` | MIT |
| jose 6.2.12 | `node_modules/.pnpm/jose@6.2.12/node_modules/jose/LICENSE.md` | MIT |
| @noble/hashes 1.8.0 | `node_modules/.pnpm/@noble+hashes@1.8.0/.../LICENSE` | MIT |
| typescript 5.9.3 | `node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/LICENSE.txt` | Apache-2.0 |
| tsx 4.23.15 | `node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/LICENSE` | MIT |
| @google/genai 2.27.0 | `node_modules/.pnpm/@google+genai@2.27.0_.../node_modules/@google/genai/LICENSE` | Apache-2.0 |
| openai 7.28.0 | `node_modules/.pnpm/openai@7.28.0_.../node_modules/openai/LICENSE` | Apache-2.0 |
| @google-cloud/firestore 9.3.1 | `node_modules/.pnpm/@google-cloud+firestore@9.3.1/.../LICENSE` | Apache-2.0 |
| resend 6.32.0 | `node_modules/.pnpm/resend@6.32.0/node_modules/resend/LICENSE` | MIT |
| firebase-tools 15.32.1 | `node_modules/.pnpm/firebase-tools@15.32.1_.../LICENSE` | MIT |
| Firestore emulator v1.22.0 | `~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar` (contains only a third-party `FIRESTORE_EMULATOR_LICENSES` list, no open licence for the emulator itself) | Closed-source Google binary |
| three 0.186.1 | `node_modules/.pnpm/three@0.186.1/node_modules/three/LICENSE` | MIT |
| playwright-core 1.63.0 | `node_modules/.pnpm/playwright-core@1.63.0/.../LICENSE` | Apache-2.0 |
| react 19.3.0, react-dom 19.3.0 | `node_modules/.pnpm/react@19.3.0/.../LICENSE`, `react-dom@19.3.0_.../LICENSE` | MIT |
| vite 8.3.2, @vitejs/plugin-react 6.1.2 | `node_modules/.pnpm/vite@8.3.2_.../LICENSE.md`, `@vitejs+plugin-react@6.1.2_.../LICENSE` | MIT |
| motion 12.23.12 | `node_modules/.pnpm/motion@12.23.12_.../LICENSE.md` | MIT |
| thinking-orbs 0.3.2 | `node_modules/.pnpm/thinking-orbs@0.3.2_.../LICENSE` | MIT |
| vitest 5.0.3 | `node_modules/.pnpm/vitest@5.0.3_.../LICENSE.md` | MIT |
| eslint 10.12.0, @eslint/js 10.0.1, typescript-eslint 8.71.0, globals 17.13.0 | respective `LICENSE` / `license` files under `node_modules/.pnpm/` | MIT |
| remotion 4.0.533, @remotion/cli 4.0.533 | `video/node_modules/remotion/LICENSE.md`, `video/node_modules/@remotion/cli/LICENSE.md`; package.json says `SEE LICENSE IN LICENSE.md` | Remotion License (free tier / company tier) |
| @remotion/fonts 4.0.533 | `video/node_modules/@remotion/fonts/package.json` | MIT (no LICENSE file) |
| @remotion/transitions 4.0.533 | `video/node_modules/@remotion/transitions/package.json` | `UNLICENSED`, no LICENSE file |
| react 19.3.0 (video) | `video/node_modules/react/package.json` | MIT |
| http 1.6.0, crypto 3.0.7, lints 6.1.0, test 1.32.0 | `~/.pub-cache/hosted/pub.dev/<pkg>-<ver>/LICENSE` ("Copyright ... the Dart project authors", BSD 3-clause text) | BSD-3-Clause |
| shared_preferences 2.5.5, image_picker 1.2.3, flutter_lints 6.0.0 | `~/.pub-cache/hosted/pub.dev/<pkg>-<ver>/LICENSE` ("The Flutter Authors", BSD 3-clause text) | BSD-3-Clause |
| firebase_core 4.15.0, firebase_messaging 16.7.0 | `~/.pub-cache/hosted/pub.dev/<pkg>-<ver>/LICENSE` ("The Chromium Authors", BSD 3-clause text) | BSD-3-Clause |
| flutter_secure_storage 11.2.0 | `~/.pub-cache/hosted/pub.dev/flutter_secure_storage-11.2.0/LICENSE` | BSD-3-Clause |
| flutter_animate 4.5.2 | `~/.pub-cache/hosted/pub.dev/flutter_animate-4.5.2/LICENSE` | BSD-3-Clause |
| receive_sharing_intent 1.9.0 | `~/.pub-cache/hosted/pub.dev/receive_sharing_intent-1.9.0/LICENSE` | Apache-2.0 |
| google_mlkit_text_recognition 0.17.1, google_mlkit_commons 0.13.0 | `~/.pub-cache/hosted/pub.dev/<pkg>-<ver>/LICENSE`; native SDK from `android/build.gradle` (`com.google.mlkit:text-recognition:16.0.1`) | MIT plugin; ML Kit SDK is closed source (Google ML Kit terms) |
| image 4.12.0 | `~/.pub-cache/hosted/pub.dev/image-4.12.0/LICENSE` | MIT |
| cupertino_icons 1.0.9, flutter_launcher_icons 0.14.4, flutter_native_splash 2.4.8, unorm_dart 0.3.3 | `~/.pub-cache/hosted/pub.dev/<pkg>-<ver>/LICENSE` | MIT |
| Flutter SDK | `/opt/homebrew/share/flutter/packages/flutter/LICENSE` | BSD-3-Clause |
| Inter fonts | `apps/mobile/assets/fonts/Inter-LICENSE.txt` | OFL-1.1 |
| Ollama | github.com/ollama/ollama `LICENSE` | MIT |
| nomic-embed-text | Hugging Face model card `nomic-ai/nomic-embed-text-v1.5` (linked from ollama.com/library/nomic-embed-text) | Apache-2.0 |
| llama3.1 | Hugging Face model card `meta-llama/Llama-3.1-8B-Instruct` (licence: `llama3.1`) | Llama 3.1 Community License, not OSI |
| gemma3 | ollama.com/library/gemma3 (links ai.google.dev/gemma/terms) | Gemma Terms of Use, not OSI |
| Node.js, OpenJDK, Docker Engine, pnpm, Chromium, ffmpeg | Project licence pages (not installed as packages here) | as stated in the tables |
| Hosted services (Gemini, OpenAI, Firestore, FCM, Firebase Hosting, Resend, WhatsApp Cloud API, Africa's Talking, Cloud Run, Codemagic) | Provider terms of service | Proprietary; public sign-up; all optional |
