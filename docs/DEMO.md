# Demo runbook

How to run the live demo: a laptop running the registry and the bank sandbox console, and a phone running the Gaskiyya app. Every command below is run from the repository root unless it says otherwise.

## 1. The day before

```bash
pnpm setup          # JS dependencies, console build, flutter pub get
pnpm check          # typecheck and lint
npx vitest run      # acceptance tests on the memory store (about 15 s)
```

Needs Node 22+, pnpm 10, Flutter 3.38+ (see the README). Then:

1. Build the app onto the phone once at home (section 3), so the demo day only needs `flutter run` or an already-installed debug build.
2. Run the whole demo script (section 4) twice, with a **Reset** between runs (that is check DEMO-3).
3. Record a fallback video of one full run (section 7).
4. If you will show AI features, put the key in `.env` and run `pnpm check:server` (section 6).

## 2. Start everything

```bash
pnpm dev
```

[`scripts/dev.mjs`](../../../scripts/dev.mjs) does the following:

- On the first run it writes `.env` from `.env.example` with fresh local secrets, a demo bank (DemoBank), the console's bank client and `ALLOW_DEMO_RESET=true`. It never overwrites an existing `.env`.
- It builds the web UIs (`pnpm web:build`) if they are missing.
- It starts one server on `http://localhost:8080` (`packages/api/src/server.ts`) with the bank simulator on (`SIM_ENABLED=true`):
  - **Registry API** under `/v1`. The store is in memory, so all data is lost when it stops.
  - **Bank sandbox console** at `http://localhost:8080/console/`, backed by the simulator's `/sim` routes. Its inbox and call list are in memory too, and it makes a new customer-token signing key on every start.
  - The landing page at `/` and the admin dashboard at `/admin/`.
- It prints the exact `flutter run` command with this computer's LAN address.
- It adds an admin dashboard password (`ADMIN_PASSWORD`) and a master key (`GASKIYA_MASTER_KEY`) to `.env` if they are missing, and prints the dashboard address with the password: `http://localhost:8080/admin/`, user `admin`.

Check that it is up:

```bash
curl http://localhost:8080/health          # {"ok":true}  (503 means the store is unreachable)
curl http://localhost:8080/sim/config      # DemoBank, the three demo customers
```

Open `http://localhost:8080/console/` on the laptop and put it on the projector. The demo customers are Amina Bello (+2348012345678), Tunde Okafor (+2348098765432) and Chidinma Eze (+2348031112222).

Stop everything with Ctrl+C.

`pnpm dev` turns on demo login (`SIM_DEMO_LOGIN=true`) unless `.env` sets it to `false`. Outside `pnpm dev` and `pnpm demo:offline` it is off: the app is not offered the demo bank, and the console's bank routes (send, calls, campaigns, reset and the rest) work only from the laptop itself. See [CONFIGURATION.md](CONFIGURATION.md#demo-login-and-the-sim-routes).

To demo as the fictional "ZB Demo Bank (demo)" instead of DemoBank, start with `DEMO_TENANT=zb pnpm dev`. The first run adds it to `.env` beside DemoBank; plain `pnpm dev` returns to DemoBank. Its links use `zbdemo.example`, and the scam lookalike is `zbdemo-restore.example`. See [CONFIGURATION.md](CONFIGURATION.md#demo-banks).

## 3. Phone on the same network

The phone talks to one port on the laptop, 8080: the registry, the demo bank's sign-in at `/sim/customer-token` and the demo inbox at `/sim/inbox`.

### Pick a network

Venue Wi-Fi often blocks device-to-device traffic (client isolation). Use a hotspot:

- **Phone hotspot (most reliable).** Turn on the hotspot on the demo phone (or a second phone) and join it from the laptop. The laptop gets an address like `172.20.10.x` (iPhone) or `192.168.43.x` / `10.x.x.x` (Android).
- **macOS hotspot.** System Settings > General > Sharing > Internet Sharing, share from Ethernet or USB tethering to Wi-Fi, and join that network from the phone. The Mac is then usually `192.168.2.1` on interface `bridge100`.

Start (or restart) `pnpm dev` **after** joining the network. It reads the LAN address once at start-up and prints the `flutter run` command with it.

### Find the laptop's address

`pnpm dev` prints it. To check it yourself on macOS:

```bash
ipconfig getifaddr en0         # Wi-Fi
ipconfig getifaddr bridge100   # when the Mac is the hotspot
```

If `pnpm dev` picked the wrong interface (a VPN, Docker or the hotspot bridge), use the right address in `API_URL` yourself.

### Firewall

On macOS, when `node` first listens you get "Do you want the application node to accept incoming network connections?": choose **Allow**. If you missed it, check System Settings > Network > Firewall > Options, or:

```bash
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(which node)"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$(which node)"
```

Test from the **phone's browser** before opening the app: `http://<LAN-ip>:8080/health` should show `{"ok":true}`, and `http://<LAN-ip>:8080/sim/config` should show DemoBank.

### Run the app

```bash
cd mobile && flutter run --dart-define=API_URL=http://<LAN-ip>:8080
```

- Use a **debug** build (plain `flutter run`). Only the debug Android manifest allows plain `http://`; iOS allows it to local network addresses through `NSAllowsLocalNetworking`. On iOS, accept the "find devices on your local network" prompt.
- The Android emulator needs no flag (it uses `http://10.0.2.2:8080`).
- In the app: pick **DemoBank**, enter Amina's number (`8012345678` after `+234`).
- The app saves the bank's sign-in address when you link. **If the laptop's address changes** (new network, new hotspot), unlink in the app (Settings > *Unlink this phone*) and link again, and rebuild with the new `API_URL` if it changed too.
- Running the app as Flutter web (`flutter run -d chrome`) is the only case that needs CORS: add its origin to `CORS_ORIGINS` in `.env` (for example `CORS_ORIGINS=http://localhost:5555` with `--web-port 5555`) and restart. The console and the phone app need no CORS setting.

## 4. Demo script

The same steps as the README, in console terms:

1. **Messages**: *Send a genuine message* (transaction alert) to Amina. In the app, under *Recent messages* (Demo inbox), tap it: **Sent by your bank**.
2. **Tampered copy**: changes one character of the link. Check it in the app: **Not confirmed**, with what the bank really sent today and why it looks fake. *Fake message* sends a scam that was never registered.
3. **Calls**: *Announce and call*. The app shows the same four-digit code at once (live banner and the Calls tab). With no open session, the app says the bank is not calling.
4. **Fraud desk**: *Simulate 3 reports*, then *Run agent*. The three fakes appear as one campaign with a drafted advisory that waits for analyst approval. Type your name and *Approve advisory*: approve, and customers' phones show the warning (the app's Activity tab, *Alerts from your bank*, with the lookalike domain highlighted; a push notice too when Firebase is set up). Then *Send to customers*: the console, acting as the bank's SMS gateway, registers each warning and delivers it to the demo customers. In the app, tap the warning under *Recent messages*: **Sent by your bank**. The warning SMS itself verifies, so a fraudster cannot fake it. *Withdraw* takes it off every phone at once. On WhatsApp, `ALERTS` lists the active warnings.
5. **Fake customer care number**: on **Contacts**, press *Send the scam and check its number*. Amina gets a message pointing her to a WhatsApp "help desk" (`wa.me/2349015550199`) that DemoBank never registered. The check on the same page says **Not an official contact**. In the app, paste the number or the `wa.me` link (Check, *Check a number or account*): same answer. Paste DemoBank's real WhatsApp number, `+234 906 000 0000`, and the answer is **Official contact**, with the note that caller ID can be faked. `@demobank_care_desk` adds the warning that it imitates DemoBank's name. On WhatsApp, sending just the number gives the same answer. On USSD, option 3 asks for a number and answers on one screen.
6. **Is this loan app licensed?** In the app, tap *Is this lender licensed?* on the Check screen (the console's **Licence check** page asks the same way, with the three examples as buttons):
   - `FairMoney`: **On a licence list**, the FCCPC list of approved digital lenders, with the list date. Point out that it says this does not confirm a message or call comes from them.
   - `Fair Mony`: **Not on any licence list we hold**, with the warning that the name is very close to a listed firm. A near miss is never "licensed".
   - A made-up name such as `Moonbeam Quick Loans`: **Not on any licence list we hold**, the regulators to check, and "do not pay any upfront fee". There is no "fraud" answer: the registry only knows the name is absent.
   On WhatsApp the same check is `LOAN FairMoney`; on the console's feature phone dial `*347*123#`, choose 9 (*More*), then 4, and type the name; 0 on that page goes back, and 4 also works straight from the first menu.
7. **Not only banks** (optional): on **Messages**, *Send as* "Road Safety Agency (demo)". It registers like a bank, and its customers see **Sent by Road Safety Agency (demo)**, never "your bank". The Contacts page lists what each organisation declared, and its apps: a Play Store link to `example.roadsafety.demo` is the official app, and any `.apk` download link is not confirmed.
8. **Fake payment receipt** (Transfers): pick Tunde as payer and Amina as merchant, *Pay and register* NGN25,000. DemoBank, as the paying bank, registers the receipt; *Merchant checks this receipt*: **Payment received**, with the bank that registered it and when. Then *Same receipt, amount changed* (NGN250,000) and *Made-up session ID*: each is **Not confirmed**, telling the merchant to check their balance before releasing goods. In the app, signed in as Amina, *Check a payment receipt* gives the same answers: type the amount, session ID and date from the console's receipt, or read them from a screenshot of it (read on the phone, never uploaded).
9. **SIM swap: the bank holds the OTP**. On **Messages**, in the *SIM swap* card, press *Check SIM before OTP* for Amina: no SIM change reported. Press *Swap the SIM* (a fraudster has moved her number to a new SIM on the simulated network), then *Check SIM before OTP* again: **SIM changed recently: hold the one-time code**, with the registry's answer from `POST /v1/sim-swap/check`. Send a genuine *One-time code*: the toast says a real gateway would hold it (`simSwapWarning: true`). Check that message in the app: it is still **Sent by your bank**, with a red *Your SIM changed recently* banner beside it; the verdict never changes. *Restore SIM* puts it back; **Reset** also restores every SIM. Needs `SIM_SWAP_PROVIDER=simulated`, which `pnpm dev` sets.
10. **Overview**: *Live activity* shows each check from the app as it happens (counts only, never content).
11. **Onboarding a new bank** (admin dashboard, optional): open `http://localhost:8080/admin/` and sign in as `admin` with the password `pnpm dev` printed. See the next section.

### Admin dashboard

The dashboard is for Gaskiyya's own operations staff, not for a bank. A short path through it:

1. **Overview** shows every organisation (DemoBank and the two demo agencies come from `.env`), API calls per day, customer checks and recent admin activity.
2. **Onboard** a fictional bank, for example ID `firstcity`, name "First City Bank (demo)", kind Bank, NIBSS code `999123`, domain `firstcity.example`, sender ID `FirstCity`, a customer care number such as `+2342019990000`, and for the token keys the simulator's JWKS URL `http://127.0.0.1:8080/sim/.well-known/jwks.json`. Each *Continue* checks that step on the server; try a bad phone number or DemoBank's code `999001` to show the checks. The review step lists everything before *Create organisation*.
3. On its **API access** tab, *New API client*. The secret is shown once: copy it, tick the box, *Done*. The table now shows only a hint of it. The *Quick start* box has the curl commands with the client ID filled in. Paste the secret into them to register a message and announce a call from a terminal.
4. **Hashing keys**: *Rotate key*. Version 2 becomes current and version 1 stays as previous, so messages already registered still confirm.
5. *Suspend* the organisation with a reason. Its API calls now answer `403 org_suspended` and its customers' checks answer "cannot check right now". *Reactivate* brings it back.
6. **Audit log** lists everything you just did, with no secret in it.

## 5. Reset, restart and recovery

- **Between runs:** the **Reset** button in the console header (it asks for confirmation). It clears the console's inbox and calls and calls `POST /v1/admin/reset` on the registry, which clears that bank's records only (other banks are untouched) and exists only while `ALLOW_DEMO_RESET=true` (pnpm dev writes it; it is refused when `NODE_ENV=production`). The phone stays linked; its demo inbox fills again as you send messages.
- **There is no separate seed step.** Demo data is made by the script itself: send a message from **Messages** for step 1, and *Simulate 3 reports* (`POST /sim/seed-reports`, three reports from the three demo customers) for step 4.
- **After a crash or restart** of `pnpm dev`: everything was in memory, so the registry and the console start empty. Run `pnpm dev` again, wait for both URLs, check `/health`, then resend the step-1 message. The phone needs nothing unless the laptop's address changed (see section 3). The registry fetches the console's new signing key by itself; if the first check right after a restart says the app could not link, wait 30 seconds and try again.
- **If the console is wedged:** Ctrl+C and `pnpm dev`. If `.env` is broken, delete it and run `pnpm dev`, which writes a new one with new secrets. The phone keeps working, since it only holds the two addresses.

## 6. AI features (only with a key)

Verdicts never depend on a model. Without a key every explanation uses fixed fallback text, and the demo still passes. Set a key in `.env`, restart `pnpm dev`, and confirm:

```bash
# .env: Gemini is the default provider
GEMINI_API_KEY=...
# or OpenAI
AI_PROVIDER=openai
OPENAI_API_KEY=...
```

```bash
pnpm check:server   # validates the config and calls the model API with your key
```

The registry's start-up log line `Gaskiya registry ready` lists the integrations; `ai` shows `Gemini (<model>)` or `OpenAI (<model>)`, or `off: fixed fallback explanations`.

| Feature | With a key | Without a key |
| --- | --- | --- |
| "Why it looks fake" on a not-confirmed result (`/v1/explain`) | Explanation written for that message | Fixed fallback explanation |
| **Screenshot** check in the app (`/v1/verify/screenshot`) | The model reads the text, then it is matched exactly | Answers `unreadable`: no message text could be read. **Do not show it without a key** |
| WhatsApp screenshots (only if WhatsApp is configured) | Read and checked | Fixed "could not read" reply |
| Campaign grouping on the fraud desk | Model embeddings, plus shared links and numbers | Local embeddings, plus shared links and numbers: the 3 seeded reports still group |
| Drafted advisory | Written by the model, waits for approval | Fixed template, waits for approval |

So: show the screenshot check (requirement AI-6) only when `pnpm check:server` passed for the model. Everything in section 4 works without a key.

## 7. Fallbacks

### A recording of your own run (primary fallback)

Record one full run of section 4 the day before, with the console and the phone side by side:

- Laptop screen: Cmd+Shift+5 > *Record Entire Screen*.
- iPhone: connect by USB, QuickTime Player > File > New Movie Recording, pick the iPhone as the camera. Or Control Centre > Screen Recording on the phone.
- Android: `adb shell screenrecord /sdcard/demo.mp4` (stop with Ctrl+C, then `adb pull /sdcard/demo.mp4`), or `scrcpy --record demo.mp4`.

### The showcase film (one minute, no live system)

A one-minute film of checking a message, a call, a link and a payment on an iPhone. Download it from <https://gaskiyya-io.web.app/video/gaskiyya-showcase.mp4>; the landing page plays the same file.

### The in-browser sandbox console (no server, no network)

The console can run entirely in the browser, with the simulator and the registry inside the page:

```bash
pnpm --filter @gaskiya/web dev:sandbox   # http://localhost:5173
```

It runs the whole script, including the simulated phone, with nothing else running. Use it if the laptop cannot reach the phone at all.

### Where to keep the fallback files

Before the demo, copy the film and your own recording to one folder outside the repository, for example `~/Desktop/gaskiyya-demo/`, open each once to check it plays offline, and keep a second copy on a USB stick or the phone.

## 8. Offline demo mode

`pnpm demo:offline` runs the whole system on one laptop with no internet connection and no paid keys. It uses only open-source tools; no live banking or production API is called.

```bash
pnpm setup            # once, while online
pnpm demo:offline
```

It starts the registry and the bank sandbox console on :8080 like `pnpm dev`, with these overrides whatever `.env` says:

| Part | Offline | Instead of |
| --- | --- | --- |
| Registry store | In memory (`STORE=memory`), reset on restart | Firestore |
| The bank | Bank sandbox console: sends messages, places calls, issues customer sign-ins | A real bank |
| AI | Local Ollama if it answers on `OLLAMA_URL`, otherwise off (fixed fallback text) | Gemini or OpenAI |
| Call notices | Live in-app events | Firebase Cloud Messaging |
| Fraud-desk email | Off (the dashboard still shows campaigns) | Resend |
| WhatsApp bot | Off | WhatsApp Business Platform |

**What works offline:** registering and verifying messages (text, shared text and screenshots), recipient binding, the verified-call flow with its code, link and callback-number checks, reports, campaign detection and the fraud dashboard, and, with Ollama, model explanations, screenshot reading, embeddings and advisory drafts. Without Ollama every explanation is the fixed fallback text, screenshots cannot be read (paste the text instead) and campaigns group by link, number and the local embedding. Verdicts are the same either way: they come only from the registry.

### Models

Pull the default models once, while still online (sizes are approximate downloads):

```bash
ollama pull qwen3:4b-instruct  # explanations, advisories and agent briefings, 2.5 GB
ollama pull gemma3:4b          # screenshot reading, 3.3 GB
ollama pull nomic-embed-text   # campaign grouping, 274 MB
ollama serve                   # if the Ollama app is not already running
```

`pnpm demo:offline` checks Ollama before starting and prints which AI it chose and any `ollama pull` still needed. Other models can be named with `OLLAMA_MODEL`, `OLLAMA_VISION_MODEL` and `OLLAMA_EMBEDDING_MODEL`. The first request after start-up loads a model into memory and can take a while; the server preloads them when it starts. See [decision 0011](decisions/0011-open-source-model.md).

### The phone

The phone must be on the same network as the laptop: join the laptop's hotspot, or put both on one Wi-Fi network or LAN (no internet needed). Run the app with the laptop's address, which `pnpm demo:offline` prints:

```bash
cd mobile && flutter run --dart-define=API_URL=http://<laptop-ip>:8080
```
