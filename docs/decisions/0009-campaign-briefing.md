# 0009: The campaign agent writes briefings; it never approves or sends

**Status:** accepted

The campaign agent now uses the model for one more step. After the deterministic grouping (shared link domain, shared callback number, or embedding similarity, joined with union-find), it asks the model for a fraud-desk briefing per campaign: the likely scam pattern, the channel the fraudsters impersonate (`sms`, `whatsapp`, `call`, `email`, `social` or `unknown`), and a suggested customer advisory. The briefing and the draft appear on the console's campaign view.

The grouping itself stays deterministic. The model never decides which reports belong together, and it never produces a verdict (principle 1).

The safety boundary:

- **Masked input only.** The model sees the campaign's fields (counts, indicators, link domains, how many callback numbers) and up to five report texts, masked again with the same `maskDigits` used by explain. It never sees account numbers, phone numbers, keyed hashes, registry records or customer identity.
- **Validated output.** The output must match a strict zod schema (`BriefingOutput` in `apps/api/src/ai/briefing.ts`); an extra field such as `status` or `verdict` is a rejection. Output is also rejected when it calls anything genuine, verified, authentic, legitimate, confirmed, trusted or approved, when it tells customers to hand over a secret (principle 6), or when it contains a run of four or more digits. Any rejection, error or timeout gives a template briefing built from the campaign's fields, which is also what runs with no AI key.
- **No acting tools.** The agent has exactly four tools: fetch new reports, find similar reports, create or update a campaign, and draft the briefing and advisory. None sends, publishes or approves. Whatever the model writes is stored as text; it cannot change the advisory's status.
- **Drafts until an analyst approves.** Every advisory is saved with status `draft`. Only an authenticated console user approves it (`POST /v1/campaigns/:id/approve` with bank credentials), and approval records who approved it and when. Approval sends nothing to customers by SMS; the bank publishes the advisory through its own channels. The agent never rewrites an approved advisory. (Since [decision 0018](0018-advisory-outreach.md), approval also lists the advisory in the bank's customers' Gaskiyya app, with one push notice per device.)

Tests: `tests/briefing.test.ts` (AI-9) covers a model briefing from masked input, rejection of invalid or unsafe output in favour of the template, the template with no model, and that the agent cannot approve or send even when the model's text tells it to.

The agent can also run as a scheduled job (`pnpm agent:run`, or `POST /internal/agent/run` with `AGENT_JOB_TOKEN`) with `AGENT_IN_PROCESS=false`, so several server replicas never run it at once. See [CONFIGURATION.md](../CONFIGURATION.md#campaign-agent).
