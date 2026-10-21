# 0017: SIM-swap signal (GSMA Open Gateway / CAMARA SIM Swap)

**Status:** accepted (approved by owner, 2026-10-20). The copy is additive: new keys only, under a new top-level `simswap` namespace. No existing key changed, and the six principles are unchanged.

## Context

In a SIM swap, a fraudster gets the mobile network to move a customer's number onto a SIM the fraudster holds. From then on the fraudster receives the customer's one-time codes, and a genuine OTP that Gaskiyya confirms is going to the wrong person. Mobile networks can say when a number's SIM last changed. The GSMA Open Gateway programme exposes this as the CAMARA **SIM Swap** API:

- Repository: https://github.com/camaraproject/SimSwap. Latest public release r3.3; API `sim-swap` v2.1.0, spec at `code/API_definitions/sim-swap.yaml`, base path `{apiRoot}/sim-swap/v2`.
- `POST /check` `{phoneNumber, maxAge}` returns `{swapped: boolean}`. `maxAge` is in hours, from 1 to 2400, with a default of 240.
- `POST /retrieve-date` `{phoneNumber}` returns `{latestSimChange: RFC 3339 | null, monitoredPeriod?}`.
- Security is OpenID Connect with scopes `sim-swap:check` and `sim-swap:retrieve-date`. With a two-legged (client-credentials) token, `phoneNumber` must be sent. With a three-legged token it must not be sent (`422 UNNECESSARY_IDENTIFIER`). There is an optional `x-correlator` header.
- Errors: 400 `INVALID_ARGUMENT`/`OUT_OF_RANGE`, 401 `UNAUTHENTICATED`, 403 `PERMISSION_DENIED`, 404 `IDENTIFIER_NOT_FOUND`, 422 `SERVICE_NOT_APPLICABLE`/`MISSING_IDENTIFIER`/`UNNECESSARY_IDENTIFIER`, 429 `QUOTA_EXCEEDED`/`TOO_MANY_REQUESTS`.

Availability in Africa (checked 2026-10-20):

- **South Africa:** MTN, Cell C and Telkom announced Number Verification and SIM Swap under GSMA Open Gateway on 22 February 2024. Source: https://www.gsma.com/newsroom/press-release/south-african-mobile-operators-announce-new-services-to-combat-fraud-as-part-of-gsma-open-gateway-initiative/
- **Kenya:** the aggregator NetAPI Telecom is a GSMA Open Gateway channel partner whose certified APIs include SIM Swap. Source: https://www.gsma.com/solutions-and-impact/gsma-open-gateway/netapi-telecom-gsma-open-gateway-channel-partner-africa/
- **Nigeria (MTN, Airtel, Glo, 9mobile):** unknown. No public source was found for a SIM Swap API from a Nigerian operator. A pilot bank should ask its operators, or an aggregator, directly.

## Decision

1. **A caution, never a verdict.** The pure functions in `apps/api/src/domain/verdict.ts` (`decideSimSwapWarnings`, `decideSimSwapStatus`, `decideOtpHold`) take a verdict as input and return warnings or a flag. They never return a verdict. A SIM-swap answer cannot confirm, upgrade or downgrade anything (principle 1).
2. **Fail closed.** If the provider errors or times out, the probe is `{ ok: false }`. The bank's answer is then `status: "unknown"`, never `"not_swapped"`. No customer screen ever says "no swap" or "SIM fine".
3. **Behind an interface.** `SimSwapProvider.check(phone, maxAgeHours)` has these implementations:
   - `CamaraSimSwap`: HTTP, OAuth 2.0 client credentials, configurable timeout. Every non-2xx answer, malformed body or timeout throws `SimSwapError`.
   - `SimulatedMno`: used by the demo and the console sandbox, and refused in production.
   - `MemorySimSwap`: used by tests, and can fail or answer slowly on demand.

   `SIM_SWAP_PROVIDER=none` (the default) switches the whole feature off. Registration and verify responses are then unchanged.
4. **Bank API (the main use).** `POST /v1/sim-swap/check` `{phone, maxAgeHours}` (bank OAuth) returns `{status: swapped | not_swapped, swapped, latestSimChange, maxAgeHours, checkedAt}` or `{status: "unknown", reason}`. It has no GET form, so the number never sits in a URL. It is rate limited per bank client (`SIM_SWAP_RATE_LIMIT_PER_MINUTE`, 600). Counts appear in `/v1/metrics` as `simSwap` (`bank_swapped`, `bank_not_swapped`, `bank_unknown`, ...), with no number, key or time. Banks should treat `unknown` as risky.
5. **Customer checks.** On a message check (app, screenshot, WhatsApp) or a call check (app, WhatsApp, USSD), the registry asks about the customer's own number for the last `SIM_SWAP_WARN_HOURS` (72):
   - **Wait bound.** The probe runs beside the registry lookup. The answer waits for it at most `SIM_SWAP_WAIT_MS` (800 ms) from the start of the check. After that the verdict goes out without it, and a late answer still reaches the cache and the bank notice.
   - **Swap reported.** The answer carries `warnings: ["sim_swapped_recently"]`.
   - **Provider failed.** `sim_status_unknown` is added **only on a confirmed one-time code** (`category: otp`). That is the one answer where the SIM status changes what the customer should do. On every other answer an outage adds nothing, so a network outage does not fill every reply with noise. This is the "only where useful" rule. No warning never means "no swap".
   - **Cache.** Answers are cached for `SIM_SWAP_CACHE_SECONDS` (60), keyed by the keyed recipient. Failures are not cached.
6. **Bank notice.** When a customer's check finds a recent swap, the fraud desk (`alertEmails`) gets one `sim_swap_alert` email per number and SIM change. The email names the customer by the first 16 hex characters of the keyed recipient, never by number. It goes to the bank only: Gaskiyya holds no customer contact details.
7. **Registration.** For `category: "otp"` only, the registration response adds `simSwapWarning` (true when the SIM changed within the warning window) and `simSwapStatus`, so the bank's gateway can hold the code. The registration always succeeds, and nothing the customer receives changes (principle 5). Other categories are not looked up, and their responses are unchanged.
8. **Privacy.** Numbers are passed to the provider and then dropped:
   - Logs carry only the error code and HTTP status of a failed check.
   - The store holds only counters.
   - The simulator keys numbers by SHA-256.

   Tests SIM-6 check logs, store and email.

## Copy (additive, `simswap.*`, translated into pcm/ha/yo/ig with the native-speaker review marker kept)

| Key | English |
| --- | --- |
| `simswap.title` | Your SIM changed recently |
| `simswap.body` | Your mobile network says this number moved to a new SIM recently. If you did not do this, someone else may be getting your codes. Contact your bank through its app or at a branch now. |
| `simswap.unknownTitle` | SIM status not checked |
| `simswap.unknownBody` | We could not check with your mobile network whether this number moved to a new SIM. Do not share this code with anyone. |
| `simswap.ussd` | Warning: your SIM changed recently. Not you? Contact your bank now. |
| `simswap.a11y` | Warning. Your SIM changed recently. |

Where each surface shows it:

- **App:** the result sheet shows a banner in the existing warning style (triangle icon, card) beside any verdict. It is announced as one live region that starts with `simswap.a11y`.
- **WhatsApp:** the title and body are added after the verdict reply and after the `CALL` reply.
- **USSD:** `simswap.ussd` comes first on the menu screen. The "never asks" line gives way if all three would not fit 160 characters. It is also added to the option 1 screen when it fits. Every screen in every language is tested at 160 plain ASCII characters or fewer.

## Consequences

- A bank with a CAMARA contract gets a SIM-swap check through the same credential it already uses for Gaskiyya.
- Verification latency is bounded by `SIM_SWAP_WAIT_MS`, whatever the network does.
- A customer whose number was taken over and who checks from the app (over Wi-Fi) learns about it.
- **Open:** the bank cannot map the email's keyed reference back to a customer without the hashing key. A per-bank lookup endpoint could close that gap. Three-legged (CIBA) tokens are not supported. Translations need native-speaker review like the rest of the overlays.
