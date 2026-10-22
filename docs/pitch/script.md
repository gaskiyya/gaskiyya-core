# Gaskiyya pitch script

Two parts: a timed three-minute spoken pitch, and the 90-second live demo click path with a recovery line for each step. Figures and their sources are in [deck.md](deck.md#sources); the tags below ([S1] and so on) are not read aloud.

The spoken pitch runs 3:00 on its own. The live demo is a separate 90-second block, cued at 1:20. With the demo the whole slot is 4:30 [CONFIRM: slot length and whether the demo counts inside it]. If the slot is 3:00 in total, play the one-minute showcase film in place of the live demo (`docs/DEMO.md`, section 7) and cut the block marked *(cut if short)*.

Pronunciation: Gaskiyya is "gas-KEE-ya", stress on the middle syllable.

## Part 1. Spoken pitch (3:00, about 420 words)

Pace is about 140 words a minute, which leaves a few seconds of slack for pauses. Each block lists its slide.

**[0:00-0:20] Slide 1. Hook**

Say the track name: "Strengthening Trust in Digital Banking".

> We entered the track Strengthening Trust in Digital Banking. "Your account has been restricted. Click here to restore it." It came from your bank's name. It used your bank's wording. Is it really your bank? Today, no customer can be sure. Gaskiyya, Hausa for truth, lets them check.

**[0:20-0:50] Slide 2. Problem**

> In 2023, NIBSS counted seventeen point six seven billion naira lost to fraud, and eighty thousand customers defrauded. Working from NIBSS's own counts, about two in three of those cases were social engineering: someone pretending to be someone they are not. In 2025 NIBSS again named social engineering the most prevalent technique. The fraudster's best costume is your bank.

**[0:50-1:20] Slide 3 and 4. Why fixes fail, and our fix**

> Caller ID can be faked. SMS sender names can be faked. AI detectors guess, and a careful fraudster copies the bank's exact words. So we stopped guessing. With Gaskiyya, the bank registers a keyed fingerprint of every message as it sends it, bound to the number it sent it to. One extra API call. The customer's check is an exact match against those records. Let me show you, on a simulated bank: no live banking systems.

**[1:20] Slide 5. Live demo (90 s, Part 2 below). Then resume.**

**[1:20-1:50] Slide 4, back. What you just saw**

> Exact match: change one character and it fails. Bound to the recipient: forward a real message to someone else and it fails. Fail closed: if our system is down, the answer is "cannot check right now", never "genuine". And nothing to steal: no message text and no phone numbers are stored, only keyed hashes.

**[1:50-2:15] Slide 6. AI**

> We do use AI, but it never decides. The verdict is fixed first. Then a model explains a fake in plain words, and if it ever says a message is genuine, we replace its words with fixed text. On the phone, screenshots are read on the device. For the fraud desk, an agent groups reports into scam campaigns and drafts an advisory, which waits for a human analyst.

**[2:15-2:35] Slide 7. Impact**

> Ninety-three percent of Nigerian adults use a mobile phone, and among the groups that most need inclusion, at least one in two have only a basic phone. So Gaskiyya works by USSD and on WhatsApp as well as in an app, in five languages pending native-speaker review, and with a screen reader.

**[2:35-2:50] Slide 8 and 9. Scale and model** *(cut if short)*

> For a bank, the change is one API call where messages already leave. Customers see no difference. It can run inside the bank, for data protection and data localisation. Banks pay a licence and per registered message; checks are free.

**[2:50-3:00] Slide 10. Ask**

> We are asking for one thing: a pilot. One message type and outbound calls, inside one bank. Let us prove it is really your bank.

Word count check: run `sed -n '/^## Part 1/,/^## Part 2/p' docs/pitch/script.md | grep '^>' | wc -w` before rehearsal.

Spoken figures and where they come from: "seventeen point six seven billion naira" and "eighty thousand customers" are NIBSS 2023 [S1]; "about two in three" is our 65.8%, derived from NIBSS 2023 case counts [S1]; "most prevalent technique" is NIBSS, 22 Jan 2026 [S2]; "ninety-three percent" and "at least one in two" are EFInA A2F 2023 [S7].

## Part 2. Demo click path (90 s)

Open the demo with one sentence: "This is a simulated bank. The sandbox console plays the bank's systems; no live banking or production APIs are involved."

Set-up before going on stage (`docs/DEMO.md`, sections 1 to 3):

- `pnpm dev` running on the laptop; `curl http://localhost:8080/health` returns `{"ok":true}`.
- The console at `http://localhost:8080/console/` on the projector. Press **Reset** in the console header once.
- The phone on the same hotspot, running the app (`flutter run --dart-define=API_URL=http://<LAN-ip>:8080`), signed in to DemoBank with Amina's number (`8012345678` after `+234`), so the console lists it. From the phone's browser, `http://<LAN-ip>:8080/health` shows `{"ok":true}`.
- For step (e), nothing extra: `pnpm dev` sets `USSD_WEBHOOK_TOKEN` for the registry and the console when `.env` lacks one (`scripts/dev.mjs`), and the console's **USSD** page posts Africa's Talking-style callbacks for the demo code `*347*123#` through the console server, which holds the token. If the page says "USSD is off", the token is missing: stop and restart `pnpm dev`.
- The fallback recording and the showcase film copied to `~/Desktop/gaskiyya-demo/` and opened once (`docs/DEMO.md`, section 7).

Demo numbers: Amina +2348012345678 (the phone), Tunde +2348098765432 (typed into the console in step c). The console lists only numbers that have signed in to the app.

### (a) A genuine SMS shows "Sent by your bank" (0:00-0:15)

1. Console, **Messages**. Under *Recipient*, click **+234 801 234 5678** (picked already if the phone signed in last).
2. Under *Send a genuine message*, click the **Transaction alert** chip. Before sending, click in the text box and press **Cmd+A, Cmd+C** (you need this text in step c).
3. Click **Send**. The console shows "Searchable in N ms".
4. Phone: under *Recent messages*, tap the new alert. Result: **Sent by your bank**, with channel, date and time.

Say: "The bank registered it as it sent it. Exact match, for Amina's number: confirmed."

*If it breaks:* if the phone shows "Cannot check right now" just after a restart, wait 30 seconds and tap again (`docs/DEMO.md`, section 5). If the phone cannot reach the laptop, use the simulated iPhone on the right of the console's Messages page: tap the message, choose **Check with Gaskiyya**. If the server is gone, run `pnpm --filter @gaskiya/web dev:sandbox` and continue at `http://localhost:5171` (`docs/DEMO.md`, section 7).

### (b) One changed character shows "Not confirmed" (0:15-0:30)

1. Console, **Messages**, *Play the fraudster*: click **Tampered copy**. It changes one character of the link, for example `demobank.ng` becomes `demo-bank.ng`.
2. Phone: tap the tampered message under *Recent messages*. Result: **Not confirmed**, with what the bank really sent today, and why it looks fake.

Say: "One hyphen. Different fingerprint. Not confirmed, and it tells Amina what her bank really sent her today."

*If it breaks:* without an AI key the "why it looks fake" card shows fixed fallback text; that is expected and the verdict is the same (`docs/DEMO.md`, section 6). If the tampered message does not arrive, use **Fake message** instead, which sends a scam that was never registered. Same simulated-phone and sandbox fallbacks as step (a).

### (c) The same message replayed to another number shows "Not confirmed" (0:30-0:45)

1. Console, **Messages**, *Recipient*: type `0809 876 5432` and click **Use**. The simulated iPhone on the right is now Tunde's phone.
2. On the simulated iPhone, open the **Gaskiyya** app. In *Check a message*, click the text box and press **Cmd+V** (Amina's genuine alert from step a). Click **Check**.
3. Result: **Not confirmed**.

Say: "Word for word the bank's real message. But the bank sent it to Amina, not to Tunde. A fraudster who forwards a real message gets nothing."

*If it breaks:* if the clipboard is empty, type a short custom message in the text box for Amina in step (a) instead of the template, so it is quick to retype here. As a last resort, run `npx vitest run tests/registry.test.ts -t "REG-2"` on the projector: the test registers a message for one number and checks it from another.

### (d) A bank call with its code (0:45-0:58)

1. Console, **Calls**. Recipient: **+234 801 234 5678**. Pick a purpose chip, then click **Announce and call**. The *Agent screen* shows four digits and a 3:00 countdown.
2. Phone: the call banner and the **Calls** tab show the same four digits.
3. Click **End call** in the console. On the phone's Calls tab, tap **Check again**: "Your bank is not calling you".

Say: "Caller ID can be faked. This code cannot. If the caller cannot read it, hang up."

*If it breaks:* if the phone does not show the code, pull down to refresh the Calls tab or tap **Check again** (live events can miss; known issue F2 in `docs/qa/2026-10-20-qa-report.md`). If it still fails, show the code on the console's simulated iPhone, which rings on **Announce and call**.

### (e) USSD from the console's feature phone (0:58-1:12)

1. Leave a call open: click **Announce and call** again for Amina.
2. Console, **USSD**. Recipient: **+234 801 234 5678**. On the feature phone, key in `*347*123#` (the demo code, not a real short code) and press the green call key. The menu appears: "1. Is my bank calling me?", "2. Messages my bank sent me today".
3. Key **1**, press **Send**: "DemoBank is calling you now. Call code: ..." with the same code as the agent screen.
4. Hang up, dial again, key **2**, **Send**: today's messages as time, category and channel only, ending "A message from today that is not listed is not confirmed."

Say: "No smartphone, no data. Same registry, same answer."

*If it breaks:* if the screen says "USSD is off", `USSD_WEBHOOK_TOKEN` is not set: restart `pnpm dev`, which sets it. Otherwise skip the step and say "USSD is covered by eight acceptance tests", pointing at USSD-1 to USSD-7 in `tests/ussd.test.ts` and USSD-8 in `tests/console.test.ts`.

### (f) Scam reports become a campaign, a briefing, and an approved advisory (1:12-1:30)

1. Console, **Fraud desk**. Click **Simulate 3 reports**, then **Run agent**.
2. One campaign appears: the report count, indicator tags, the shared link domain, a **Briefing** (scam pattern and impersonated channel) and a **Suggested advisory (draft)**. The tag says "Written by AI, check before use" with a model key, or "Built from report data" without one.
3. Click **Approve advisory**. The card now reads "Approved by ... at ...".

Say: "Three customers reported fakes. The agent grouped them and drafted a warning. Nothing reaches customers until an analyst approves it, and even then the bank sends it through its own channels."

*If it breaks:* if no campaign appears, click **Run agent** once more (the agent also runs every 60 seconds by default). Without an AI key the grouping and the template briefing still work (`docs/DEMO.md`, section 6). If the console is wedged, Ctrl+C and `pnpm dev`, then use the recording.

### After the demo

Click **Overview** for one second: *Live activity* shows every check made in the demo, as counts only, never content. Then back to slide 4 at 1:20 of the spoken pitch.

Before the next run, press **Reset** (`docs/DEMO.md`, section 5).
