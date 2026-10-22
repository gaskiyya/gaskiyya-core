# 0019: Zero-click protection on Android (Gaskiyya Shield), sign-in and automatic language

**Status:** accepted, requested by owner, 2026-10-20

Until now a customer had to open Gaskiyya and paste, share or screenshot a message, or open the Calls tab, to check anything. Fraud happens in the seconds a call or message arrives, so the check now comes to the customer on Android, the way caller-ID apps work, without changing what decides an answer.

## What changes

1. **Gaskiyya Shield (Android only).** After a one-time setup (Gaskiyya as the caller ID and spam app, call redirection, display over other apps, notification access), the app reacts on its own:
   - **ZC-1 Call pop-up.** On an incoming call the phone asks the registry whether a linked bank has an open announced call to this customer. An open call shows "{bank} is really calling you" with the call code. No open call while the ringing number is one of the bank's official phones shows "{bank} is NOT calling you". An error shows "Cannot check this call right now". Any other number shows nothing.
   - **ZC-2 Automatic message check.** A new SMS or WhatsApp notification that looks like it comes from a linked bank is canonicalised and digested on the phone and checked with the existing `POST /v1/verify/message`; the answer appears as a notification.
   - **ZC-3 Fake credit alert, ZC-5 fake link, ZC-6 fake customer-care number, ZC-8 scam campaign match.** Warnings added to a message that is not confirmed.
   - **ZC-4 One-time code during a call.** A one-time code arriving while the phone is in a call no linked bank announced raises an alarm.
   - **ZC-7 Wrong number dialled.** Dialling a number Shield flagged in a message in the last 7 days, or that a scam campaign reported, shows a warning with the bank's real number. The call is never blocked.
2. **Two customer endpoints.** `GET /v1/official-contacts` lists the customer's bank's official phones, sender IDs and domains so the phone can match numbers locally, and `POST /v1/verify/indicators` matches a not-confirmed message's link domains and phone numbers against the bank's active scam campaigns.
3. **Sign-in.** The app's link screen becomes a sign-in screen: the customer chooses a bank and types their own mobile number. The list of demo customers is removed from the app. The bank sandbox console can send to any number that has signed in.
4. **ZC-9 Automatic language.** On first run the app takes its language from the phone's settings (Hausa, Yoruba, Igbo, Pidgin, otherwise English). A choice made in Settings always wins.
5. **Static 3D art.** The floating animation on the 3D icons is removed in the app and the console's simulated phone.

## Safety boundary

- **Principle 1.** Only a registry match (message) or an open registry call session (call) can produce "Sent by your bank" or "really calling". Every other Shield notice is a warning. Sender IDs and caller ID never upgrade an answer.
- **Principle 2.** A registry error gives "Cannot check right now", never a confirmation; a failed contacts refresh uses the last cached list and never confirms anything.
- **Principle 4.** Message text never leaves the phone: only digests, link addresses and phone numbers found in a suspicious message are sent. Incoming and dialled numbers are matched on the phone and are never sent. Campaign phone indicators are stored as keyed hashes, never as plain numbers. The phone keeps only a 7-day list of flagged numbers.
- **Principle 6.** No Shield screen or notice asks for anything; the setup screen only opens Android's own permission pages. Sign-in asks for the mobile number only, never a PIN, password or code.
- **Customer control.** Each permission is switched on by the customer in Settings and can be switched off in Android settings. iPhone users keep push notices for bank calls and warnings; iOS does not allow apps to read SMS or draw over calls.

## Copy

New keys under the top-level `shield` namespace of `copy.json`. Changed: `app.link.title` ("Sign in") and `app.link.intro`; removed: `app.link.demoCustomers` (also from the four overlays). Verdict wording is unchanged; Shield notices reuse the `verdict.*` titles. The new `shield` keys are not yet translated, so the overlays fall back to English for them.

## Tests

`tests/zeroclick.test.ts` (ZC-6 server, ZC-8), `mobile/test/shield_test.dart` (ZC-1 to ZC-8 decision rules), `mobile/test/language_test.dart` (ZC-9), and the console and sandbox tests for the simulated phone. The Android services themselves need a manual check on a real phone.
