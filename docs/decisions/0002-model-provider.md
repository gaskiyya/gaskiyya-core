# 0002: One model interface; provider is a deployment choice

**Status:** accepted

All model calls go through `ModelProvider` (`apps/api/src/ai/provider.ts`): explain, extract text from an image, embed, draft an advisory. The verdict never depends on any of them (principle 1), and every call has a timeout and a fixed fallback, so the system works with no model configured at all.

Three adapters ship, chosen by `AI_PROVIDER`:

| Provider | Default models | Notes |
| --- | --- | --- |
| `gemini` (default) | `gemini-3.8-flash`, `gemini-embedding-001` | JSON schema output, low thinking level, inline image input |
| `openai` | `gpt-5.4-mini`, `text-embedding-3-small` | Responses API, strict JSON schema, low reasoning effort, `store: false` |
| `ollama` | `qwen3:4b-instruct`, `gemma3:4b` (vision), `nomic-embed-text` | Open-weights models served inside the bank's network, no key; see [0011](0011-open-source-model.md) |
| `none` | | Fixed fallback text only |

Every model name can be overridden with an environment variable. All adapters share one set of prompts and schemas (`apps/api/src/ai/prompts.ts`), so switching provider never changes what the model is asked. Embeddings carry their model name, and the campaign agent only compares vectors from the same model; if an embedding call fails, the local hashing embedding is used instead. A self-hosted model is another class implementing the same four methods.

Choose per bank on:

- **Data residency.** A bank may require customer-submitted text to stay in Nigeria or in its own cloud. That usually decides the provider, or forces a self-hosted model.
- **Character-exact screenshot reading.** A misread character simply fails to match, which is safe, but it gives a worse experience. Test each candidate on real screenshots (AI-6).
- **Local-language quality.** Pidgin, Hausa, Yoruba and Igbo stay off until a native speaker has reviewed a test set from the chosen model.
- **Embeddings.** Both providers' embedding APIs are used for campaign grouping, with the local hashing embedding as the fallback.
