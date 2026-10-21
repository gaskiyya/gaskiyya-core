# 0003: Customer identity in the standalone demo app

**Status:** accepted for the hackathon build only

Inside a bank's app the logged-in session supplies a short-lived signed token (iss = bank, sub = phone number). The standalone demo has no bank login, so the bank simulator (`apps/api/src/simulator`) signs that token when the user picks a number.

We did not add SMS one-time-code phone verification. It would put a screen in front of the customer that asks for a one-time code, which conflicts with principle 6 and teaches exactly the behaviour fraudsters exploit. The demo login endpoint is off unless `SIM_DEMO_LOGIN=true` (only `pnpm dev` and `pnpm demo:offline` set it, since the 2026-10-20 QA fix F22) and must never be enabled in a pilot. While it is off, the simulator routes that act as the bank answer only on the machine it runs on.
