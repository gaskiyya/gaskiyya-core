# Slide: Tech stack

## Built on open source. Every paid service is optional.

- **Core is open source:** Node.js, TypeScript, Fastify, zod, Flutter/Dart; HMAC-SHA-256 from Node's own crypto
- **Verdicts need no AI and no cloud:** one pure function, an exact registry match, fail closed
- **AI can run fully local:** Ollama with open-weights models (nomic-embed-text is Apache-2.0; the Llama and Gemma models are open weights under custom licences), or no model at all
- **Private on the phone:** the digest is computed on the device; screenshot text is read on the device (ML Kit)
- **Hosted services are swap-ins, not dependencies:** Firestore, Gemini/OpenAI, FCM, Resend, WhatsApp and Africa's Talking each have an offline alternative in the repo
- **No real bank:** the bank sandbox console simulates the bank, its login and its fraud desk

### Speaker notes

Everything that decides whether a message is genuine runs on open-source code: a Fastify registry in TypeScript on Node, the same canonicaliser in Dart on the phone, and Node's built-in HMAC-SHA-256. No model and no hosted service is in that path.

The whole demo runs offline with `pnpm dev`: the in-memory store instead of Firestore, the live event stream instead of push, and either no AI or a local Ollama model. Ollama itself is MIT; the embedding model, nomic-embed-text, is Apache-2.0; the chat and vision models are open weights under Meta's and Google's own licences, and we label them that way rather than calling them open source.

In production, each hosted service (Gemini or OpenAI, Firestore, Firebase Cloud Messaging, Resend, WhatsApp Cloud API and Africa's Talking USSD) sits behind an interface and has an open or offline stand-in in the repo. The one source-available tool is Remotion, used only to render the pitch video.

There is no live banking API anywhere. The bank sandbox console plays the bank: it registers messages, announces calls, issues the customer's login token and runs the fraud desk. The full list, with every licence checked against the installed package, is in docs/TECH_STACK.md.
