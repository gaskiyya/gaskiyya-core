# 0011: An open-weights model, run inside the bank

**Status:** accepted

A third adapter, `OllamaProvider` (`apps/api/src/ai/ollama.ts`), runs open-weights models through [Ollama](https://ollama.com)'s local HTTP API. It is selected with `AI_PROVIDER=ollama` and needs no key. Gemini and OpenAI remain available; a bank chooses.

| Use | Default model | Approx. download |
| --- | --- | --- |
| Explanations, advisory drafts (`OLLAMA_MODEL`) | `llama3.1:8b` | 4.9 GB |
| Screenshot reading (`OLLAMA_VISION_MODEL`) | `gemma3:4b` | 3.3 GB |
| Campaign-grouping embeddings (`OLLAMA_EMBEDDING_MODEL`) | `nomic-embed-text` | 274 MB |

All three are among the most pulled models in the [Ollama library](https://ollama.com/library) and run on a laptop. Any other Ollama model can be named instead.

## Why

- **The hackathon rule.** Zenith Zecathon 6.0 requires open-source tools and publicly available resources, with no live banking or production APIs. With Ollama, the in-memory store and the bank sandbox console, the whole demo runs on one laptop with no paid key and no internet (`pnpm demo:offline`, see [DEMO.md](../DEMO.md)).
- **Data residency.** The Nigeria Data Protection Act 2023 (official gazette, https://ncc.gov.ng/media/801/view) allows personal data to leave Nigeria only on the grounds in s.41(1): adequate protection for the recipient (assessed under s.42), or one of the conditions in s.43, such as consent or contract. Section 24(1)(c) requires personal data to be "adequate, relevant, and limited to the minimum necessary" for its purposes. Message text a customer submits is personal data, even with digits masked. A model served inside the bank's network sends nothing abroad, so no s.41 transfer arises for explanations, screenshot reading or embeddings.
- **CBN data localisation.** CBN circular PSS/DIR/PUB/CIR/001/004 of 15 June 2026 requires payment transaction data generated in Nigeria to be stored and managed in Nigeria, with full compliance by 1 January 2027 (press report: BusinessDay; Aluko & Oyebode client alert, 24 June 2026, https://aluko-oyebode.com/insights/cbn-issues-circular-on-market-structure-data-localisation-and-systemic-oversight-in-nigeria-payments/). The circular text was not found on cbn.gov.ng when this was checked on 20 October 2026. Gaskiyya's registry already holds only keyed hashes (principle 4); a local model keeps the remaining model traffic in the country too. Banks should confirm the circular text with their compliance teams.
- **No message text leaves the bank's network.** Ollama runs on the same host as the registry, or on a GPU server inside the bank. `OLLAMA_URL` points at it; nothing else is contacted.

## What does not change

- **Same prompts, same validation.** The adapter uses the shared prompts and JSON schemas in `prompts.ts` (passed to Ollama as `format`), and its output goes through the same `explain()` checks: the strict `ExplanationSchema` (no extra fields such as a verdict), the secret-request filter, and digit masking before the call. The model never produces "confirmed" and cannot change a verdict (principle 1).
- **Fail to the fallback.** If Ollama is unreachable, times out, has not pulled a model (404) or returns text that is not valid JSON, that call behaves exactly as with no model: fixed fallback text, no screenshot text, the local hashing embedding, the advisory template. The server logs a warning at start-up when Ollama is down or a model is missing, and loads the models into memory when they are present.
- **Embeddings.** Vectors carry their model name, and the campaign agent compares only vectors from the same model (`nomic-embed-text` gives 768 dimensions), so switching provider can never compare vectors of different sizes.

## Trade-offs

- A small local model is slower and writes less fluent Hausa, Yoruba, Igbo and Pidgin than a large hosted one. Local-language output stays behind native-speaker review, as for every provider (0002). On a laptop, `AI_TIMEOUT_MS` should be around 10 seconds; the app waits 12.
- Screenshot reading with a 4B vision model misreads characters more often. A misread simply fails to match, which is safe (principle 1), but gives a worse experience; a bank can name a larger vision model.
