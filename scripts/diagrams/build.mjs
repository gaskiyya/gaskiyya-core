import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Diagram, sequence } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'apps', 'web', 'docs', 'diagrams');
mkdirSync(out, { recursive: true });

const diagrams = [];

{
  const d = new Diagram(
    'architecture',
    1200,
    790,
    'Gaskiyya system architecture',
    'Bank systems call the bank-facing API. Customer channels call the customer API. The bank delivers its messages exactly as before, outside Gaskiyya.',
  );
  const col = (i) => 30 + i * 232;
  const W = 212;
  d.lane(20, 20, 1160, 150, 'Bank systems', 'bank');
  d.rect(242, 200, 938, 420, 'lane lane-gk', 16);
  d.text(262, 312, 'Gaskiyya platform', 'lane-label gk', 'start');
  d.lane(20, 640, 1160, 130, 'Customer', 'cust');

  const gw = d.node(col(0), 60, W, 84, 'Message gateway', ['SMS and WhatsApp,', 'delivers with no change'], 'bank');
  const ns = d.node(col(1), 60, W, 84, 'Notification service', ['Composes alerts, OTPs', 'and notices'], 'bank');
  const cc = d.node(col(2), 60, W, 84, 'Contact centre', ['Dialler and', 'agent screen'], 'bank');
  const mb = d.node(col(3), 60, W, 84, 'Mobile banking backend', ['Signs customer tokens,', 'publishes its JWKS'], 'bank');
  const fd = d.node(col(4), 60, W, 84, 'Fraud desk', ['Console, API and', 'alert emails'], 'bank');

  const bankApi = d.node(col(1), 236, 908, 50, 'Bank-facing API', ['OAuth 2.0 client credentials, mutual TLS and IP allowlist at the gateway'], 'gk');
  const keys = d.node(col(1), 326, W, 92, 'Key service', ['HMAC-SHA-256,', 'one key per bank,', 'held apart from data'], 'gk');
  d.store(col(2), 326, W, 92, 'Registry store', ['Keyed hashes and', 'descriptive fields only']);
  d.node(col(3), 326, W, 92, 'Verdict engine', ['One pure function,', 'exact match only,', 'fails closed'], 'gk');
  d.node(col(4), 326, W, 92, 'Call sessions', ['Four-digit code,', '180 s to answer'], 'gk');
  d.node(col(1), 434, W, 92, 'Notice delivery', ['FCM push and', 'live event stream'], 'gk');
  d.node(col(2), 434, W, 92, 'Verification log', ['Verdict counts and', 'coverage metrics'], 'gk');
  d.node(col(3), 434, W, 92, 'AI service', ['Explains, reads screenshots,', 'never decides'], 'gk');
  d.node(col(4), 434, W, 92, 'Campaign agent', ['Groups reported fakes,', 'drafts advisories'], 'gk');
  const custApi = d.node(col(1), 548, 908, 50, 'Customer API', ['Bank-signed customer token, 30 checks per minute per customer'], 'gk');
  void keys;

  const inbox = d.node(col(0), 676, W, 76, 'Phone inbox', ['SMS and WhatsApp', 'messages arrive here'], 'cust');
  const app = d.node(col(1), 676, W, 76, 'Bank app or Gaskiyya app', ['Customer shares a message;', 'fingerprinted on the device'], 'cust');
  const wa = d.node(col(2), 676, W, 76, 'WhatsApp bot', ['Paste text or', 'send a screenshot'], 'cust');
  d.node(col(3), 676, W, 76, 'USSD menu', ['Planned: calls and', "today's activity"], 'cust muted');

  d.edge([ns.l, gw.r]);
  d.edge([gw.b, [gw.cx, inbox.t[1]]], { label: ['Delivered as normal.', 'Gaskiyya is not', 'in this path.'], kind: 'soft', dash: true });
  d.edge([inbox.r, app.l]);
  d.edge([ns.b, [ns.cx, bankApi.t[1]]], { label: '`POST /v1/messages', step: 1 });
  d.edge([cc.b, [cc.cx, bankApi.t[1]]], { label: '`POST /v1/calls', step: 2 });
  d.edge([[mb.cx, bankApi.t[1]], mb.b], { label: 'Fetches JWKS', dash: true, kind: 'soft' });
  d.edge([fd.b, [fd.cx, bankApi.t[1]]], { label: 'Campaigns', both: true });
  d.edge([app.t, [app.cx, custApi.b[1]]], { label: 'Digest and token', both: true, step: 3 });
  d.edge([wa.t, [wa.cx, custApi.b[1]]], { label: 'Webhook', both: true });
  diagrams.push(d);
}

{
  const d = new Diagram(
    'integration-workflow',
    1200,
    330,
    'Bank integration workflow',
    'Five stages take a bank from agreement to production: agree, set up, connect, test, then pilot and expand.',
  );
  const stages = [
    ['Agree', 'Review and scope', [['Data protection review', 'under the NDPA'], ['Bank-hosted or shared'], ['Choose the first', 'message type'], ['Data processing terms']]],
    ['Set up', 'Tenant and credentials', [['Tenant: id, name and', 'official domains'], ['Hashing key in your KMS'], ['OAuth client per system'], ['mTLS and IP allowlist'], ['Fraud desk email list']]],
    ['Connect', 'Four touchpoints', [['Register each message', 'before hand-off'], ['Announce calls before', 'dialling'], ['Sign customer tokens', 'and publish the JWKS'], ['Fraud desk on the API']]],
    ['Test', 'Before customers see it', [['Pass all 36 shared', 'test vectors'], ['Searchable within 2 s'], ['Retries reuse the', 'idempotency key'], ['A tampered copy is', 'not confirmed']]],
    ['Pilot and expand', 'Measure coverage', [['One message type and', 'a small customer group'], ['Track coverage in', '`/v1/metrics'], ['Expand once nearly every', 'message is registered'], ['Then calls and WhatsApp']]],
  ];
  const w = 208;
  const gap = 30;
  stages.forEach(([title, sub, items], i) => {
    const x = 20 + i * (w + gap);
    d.rect(x, 20, w, 290, 'lane lane-plain', 16);
    d.add(`<circle class="step" cx="${x + 30}" cy="54" r="15"/><text class="stepn" style="font-size:13px" x="${x + 30}" y="58.5" text-anchor="middle">${i + 1}</text>`);
    d.text(x + 54, 52, title, 't', 'start');
    d.text(x + 54, 69, sub, 'ts', 'start');
    d.add(`<line class="life" style="stroke-dasharray:none" x1="${x + 16}" y1="94" x2="${x + w - 16}" y2="94"/>`);
    let y = 124;
    for (const lines of items) {
      d.add(`<circle class="step" cx="${x + 24}" cy="${y - 4}" r="3"/>`);
      for (const line of lines) {
        d.text(x + 36, y, line, line.startsWith('`') ? 'tm' : 'ts', 'start');
        y += 16;
      }
      y += 14;
    }
    if (i < stages.length - 1) d.edge([[x + w + 4, 54], [x + w + gap - 4, 54]], { kind: 'gk' });
  });
  diagrams.push(d);
}

diagrams.push(
  sequence(
    'message-flow',
    'Message registration and verification',
    'The bank registers a fingerprint before sending. The customer later checks the same fingerprint, bound to their own number.',
    {
      width: 1200,
      participants: [
        { id: 'ns', label: 'Notification service', sub: 'Bank', kind: 'bank' },
        { id: 'gw', label: 'SMS gateway', sub: 'Bank', kind: 'bank' },
        { id: 'reg', label: 'Gaskiyya registry', sub: 'API, key service', kind: 'gk' },
        { id: 'st', label: 'Registry store', sub: 'Keyed hashes', kind: 'gk' },
        { id: 'app', label: 'Customer app', sub: 'Bank app or Gaskiyya', kind: 'cust' },
      ],
      messages: [
        { from: 'ns', self: true, label: ['Canonicalise the text,', 'SHA-256 to contentDigest'] },
        { from: 'ns', to: 'reg', label: ['`POST /v1/messages', 'recipient, contentDigest, category'] },
        { from: 'reg', self: true, label: ['HMAC the number and digest', 'with the bank key, drop both'] },
        { from: 'reg', to: 'st', label: 'Write record with expiry' },
        { from: 'reg', to: 'ns', reply: true, label: '202 recordId, expiresAt' },
        { from: 'ns', to: 'gw', label: 'Hand off the unchanged message' },
        { from: 'gw', to: 'app', label: 'SMS reaches the customer' },
        { gap: 'Later, when the customer doubts the message' },
        { from: 'app', self: true, label: ['Same canonicalisation', 'and SHA-256 on the phone'] },
        { from: 'app', to: 'reg', label: ['`POST /v1/verify/message', 'contentDigest + customer token'] },
        { from: 'reg', to: 'st', label: 'Exact lookup for this number' },
        { from: 'st', to: 'reg', reply: true, label: 'Record, none, or error' },
        { from: 'reg', to: 'app', kind: 'gk', label: 'confirmed, not_confirmed or cannot_check' },
      ],
      footer: 'The message text never leaves the bank or the phone. Only the 64-character digest travels.',
    },
  ),
);

diagrams.push(
  sequence(
    'call-flow',
    'Call verification',
    'The contact centre announces a call before dialling. The customer sees the same four-digit code the agent reads aloud.',
    {
      width: 1200,
      participants: [
        { id: 'cc', label: 'Contact centre', sub: 'Dialler and agent', kind: 'bank' },
        { id: 'reg', label: 'Gaskiyya registry', sub: 'Call sessions', kind: 'gk' },
        { id: 'app', label: 'Customer app', sub: 'Push and live events', kind: 'cust' },
        { id: 'cust', label: 'Customer', sub: 'On the phone', kind: 'cust' },
      ],
      messages: [
        { from: 'cc', to: 'reg', label: ['`POST /v1/calls', 'recipient, purpose, agentRef'] },
        { from: 'reg', self: true, label: ['Open session, random', 'four-digit code, 180 s'] },
        { from: 'reg', to: 'cc', reply: true, label: '201 id, code, expiresAt' },
        { from: 'reg', to: 'app', kind: 'gk', label: ['Notice: your bank is', 'calling, with the code'] },
        { from: 'cc', self: true, label: ['Agent screen shows', 'the same code'] },
        { from: 'cc', to: 'cust', dash: true, label: 'Phone call. Caller ID is not trusted.' },
        { from: 'cc', to: 'cust', label: 'Agent reads the code aloud' },
        { from: 'cust', self: true, label: ['Compares it with', 'the code in the app'] },
        { from: 'cc', to: 'reg', label: ['`PATCH /v1/calls/{id}', 'answered: kept up to 2 h'] },
        { from: 'cc', to: 'reg', label: ['`PATCH /v1/calls/{id}', 'ended: closed at once'] },
        { from: 'reg', to: 'app', kind: 'gk', label: 'Notice withdrawn' },
      ],
      footer: 'With no open session, the app tells the customer that their bank is not calling them.',
    },
  ),
);

diagrams.push(
  sequence(
    'identity-flow',
    'Customer identity',
    'The bank backend signs a short-lived token naming the customer. Gaskiyya checks it against the bank published keys and never sees a password.',
    {
      width: 1200,
      participants: [
        { id: 'app', label: 'Customer app', sub: 'Logged in', kind: 'cust' },
        { id: 'mb', label: 'Mobile banking backend', sub: 'Bank', kind: 'bank' },
        { id: 'gk', label: 'Gaskiyya customer API', sub: 'Token check', kind: 'gk' },
      ],
      messages: [
        { from: 'app', to: 'mb', label: "Customer signs in with the bank's own login" },
        { from: 'app', to: 'mb', label: 'Ask for a Gaskiyya token' },
        { from: 'mb', self: true, label: ['Sign a JWT: iss = bank id,', 'sub = E.164 number, aud = gaskiya,', 'ES256, RS256 or EdDSA, 15 min max'] },
        { from: 'mb', to: 'app', reply: true, label: 'Token' },
        { from: 'app', to: 'gk', label: 'API call with Authorization: Bearer token' },
        { from: 'gk', to: 'mb', dash: true, label: 'Fetch the JWKS from tokenKeysUrl (cached 10 min)' },
        { from: 'gk', self: true, label: ['Check signature, issuer,', 'audience, age and number'] },
        { from: 'gk', to: 'app', kind: 'gk', label: 'Result for this number only, or 401' },
      ],
      footer: 'Gaskiyya never receives a password, PIN or session cookie. The token is the only proof of identity.',
    },
  ),
);

{
  const d = new Diagram(
    'fingerprint',
    1200,
    470,
    'From message to stored record',
    'The text is canonicalised and hashed by the bank and by the phone. Gaskiyya keys the digest and the number with a per-bank secret and stores neither.',
  );
  d.lane(20, 20, 1160, 190, 'Bank connector and customer device: same library, same result', 'plain');
  d.lane(20, 230, 1160, 220, 'Gaskiyya registry: per-bank key', 'gk');
  const steps = [
    ['Message text', ['As sent or received'], ''],
    ['Remove', ['zero-width characters'], ''],
    ['NFKC', ['Unicode normalisation'], ''],
    ['Collapse', ['whitespace runs to', 'one space'], ''],
    ['Trim', ['both ends'], ''],
    ['SHA-256', ['of the UTF-8 bytes'], ''],
    ['contentDigest', ['`64 hex characters'], 'gk'],
  ];
  const w = 146;
  const g = 20;
  let prev = null;
  const boxes = steps.map(([t, s, k], i) => {
    const b = d.node(36 + i * (w + g), 66, w, 84, t, s, k);
    if (prev) d.edge([prev.r, b.l]);
    prev = b;
    return b;
  });
  d.text(600, 186, 'Case and punctuation are kept: one hyphen or dot is the difference between a real link and a fake one.', 'cap');
  const dig = boxes[6];

  const r1 = 278;
  const r2 = 366;
  const num = d.node(36, r2, 200, 66, 'Recipient number', ['From the request or token'], '');
  const h1 = d.node(300, r1, 250, 66, 'HMAC-SHA-256', ['bank key, "content:" + digest'], 'gk');
  const h2 = d.node(300, r2, 250, 66, 'HMAC-SHA-256', ['bank key, "recipient:" + number'], 'gk');
  const k1 = d.node(614, r1, 180, 66, 'contentKey', ['Stored'], 'gk');
  const k2 = d.node(614, r2, 180, 66, 'recipientKey', ['Stored'], 'gk');
  const rec = d.node(858, r1, 306, 154, 'Message record', ['recipientKey, contentKey,', 'channel, category, hasLink,', 'linkDomains, sentAt, expiresAt', '', 'No text. No phone number.'], 'good');
  d.edge([dig.b, [dig.cx, 250], [425, 250], h1.t], { label: 'Sent to the registry', at: 1 });
  d.edge([num.r, h2.l]);
  d.edge([h1.r, k1.l]);
  d.edge([h2.r, k2.l]);
  d.edge([k1.r, [rec.x, k1.cy]], {});
  d.edge([k2.r, [rec.x, k2.cy]]);
  diagrams.push(d);
}

{
  const d = new Diagram(
    'verdict',
    1000,
    800,
    'How a verdict is decided',
    'Each check passes the same gates in order. Only an exact, unexpired record for the checking number produces confirmed.',
  );
  const cx = 330;
  const top = d.node(cx - 150, 24, 300, 58, 'Customer check', ['Digest and bank-signed token'], 'cust');
  const gates = [
    ['Customer token valid?', 'no', 'Rejected', ['401 unauthorized'], 'bad'],
    ['Under 30 checks', 'in the last minute?', 'no', 'Rejected', ['429 rate_limited'], 'bad'],
    ['Bank enrolled?', 'no', 'Cannot check right now', ['Contact the bank through', 'its app or a branch'], 'warn'],
    ['Store answered?', '(3 s read timeout)', 'no', 'Cannot check right now', ['Never shown as genuine'], 'warn'],
    ['Record for this number', 'and this digest?', 'no', 'Not confirmed', ['Plus what the bank', 'really sent recently'], 'bad'],
    ['Record within', 'its expiry?', 'no', 'Not confirmed', ['Expired records', 'do not match'], 'bad'],
  ].map((g) => {
    const idx = g.indexOf('no');
    return { q: g.slice(0, idx), outcome: g[idx + 1], sub: g[idx + 2], kind: g[idx + 3] };
  });
  let y = 150;
  let prev = top.b;
  for (const g of gates) {
    const dm = d.diamond(cx, y, 300, 82, g.q);
    d.edge([prev, dm.t], prev === top.b ? {} : { label: 'yes' });
    const o = d.node(600, y - 34, 330, 68, g.outcome, g.sub, g.kind);
    d.edge([dm.r, o.l], { label: 'no' });
    prev = dm.b;
    y += 102;
  }
  const ok = d.node(cx - 150, y - 30, 300, 66, 'Confirmed', ['Sent by your bank, with channel,', 'date and time'], 'good');
  d.edge([prev, ok.t], { label: 'yes' });
  d.text(cx, y + 64, 'The AI explanation runs only after this point and cannot change the verdict.', 'cap');
  diagrams.push(d);
}

{
  const d = new Diagram(
    'registration-patterns',
    1200,
    400,
    'Three ways to register messages',
    'Inline call, gateway copy or event stream. Each registers asynchronously with retries and never delays sending.',
  );
  const panels = [
    ['1. Inline call', 'Most reliable. A small change in the notification service.'],
    ['2. Gateway copy', 'No change to bank apps. Depends on the gateway vendor.'],
    ['3. Event stream', 'Least intrusive where a message queue already exists.'],
  ];
  const pw = 372;
  panels.forEach(([t, note], i) => {
    const x = 20 + i * (pw + 22);
    d.rect(x, 20, pw, 330, 'lane lane-plain', 16);
    d.text(x + 20, 50, t, 't', 'start');
    d.text(x + pw / 2, 326, note, 'cap');
  });
  const bw = 140;
  const bh = 58;
  {
    const x = 20;
    const ns = d.node(x + 20, 90, bw, bh, 'Notification', ['service'], 'bank');
    const gk = d.node(x + 212, 90, bw, bh, 'Gaskiyya', ['registry'], 'gk');
    const gw = d.node(x + 20, 230, bw, bh, 'SMS gateway', [], 'bank');
    const ph = d.node(x + 212, 230, bw, bh, 'Customer', ['phone'], 'cust');
    d.edge([ns.r, gk.l], { label: 'register' });
    d.edge([ns.b, gw.t], { label: 'send', labelDx: 0 });
    d.edge([gw.r, ph.l]);
  }
  {
    const x = 20 + pw + 22;
    const ns = d.node(x + 20, 90, bw, bh, 'Notification', ['service'], 'bank');
    const gw = d.node(x + 20, 230, bw, bh, 'SMS gateway', ['or aggregator'], 'bank');
    const gk = d.node(x + 212, 90, bw, bh, 'Gaskiyya', ['registry'], 'gk');
    const ph = d.node(x + 212, 230, bw, bh, 'Customer', ['phone'], 'cust');
    d.edge([ns.b, gw.t], { label: 'send' });
    d.edge([[gw.r[0], gw.cy - 14], [x + 186, gw.cy - 14], [x + 186, gk.cy], gk.l], { label: 'copy', at: 1 });
    d.edge([[gw.r[0], gw.cy + 14], [ph.l[0], gw.cy + 14]]);
  }
  {
    const x = 20 + (pw + 22) * 2;
    const ns = d.node(x + 20, 90, bw, bh, 'Notification', ['service'], 'bank');
    const q = d.node(x + 212, 90, bw, bh, 'Message', ['queue'], 'bank');
    const gw = d.node(x + 212, 230, bw, bh, 'SMS gateway', [], 'bank');
    const gk = d.node(x + 20, 230, bw, bh, 'Gaskiyya', ['connector'], 'gk');
    d.edge([ns.r, q.l], { label: 'publish' });
    d.edge([q.b, gw.t], { label: 'consume' });
    d.edge([[q.x + 20, q.y + bh], [q.x + 20, 200], [gk.cx, 200], gk.t], { label: 'subscribe', at: 1 });
  }
  d.text(600, 382, 'In every pattern: register before or alongside hand-off, retry from a local queue, reuse the idempotency key.', 'ts');
  diagrams.push(d);
}

{
  const d = new Diagram(
    'campaigns',
    1200,
    362,
    'Campaign detection',
    'Reported fakes are grouped into campaigns by an agent with four tools. A fraud analyst approves every advisory. Nothing is sent to customers.',
  );
  const y = 20;
  const h = 132;
  const r = d.node(20, y, 200, h, 'Customer reports a fake', ['Opt-in each time', 'Digit runs masked', 'Callback numbers', 'sent as hashes'], 'cust');
  const st = d.node(254, y, 200, h, 'Report store', ['Masked text, embedding,', 'link domains, keyed', 'callback numbers'], 'gk');
  const ag = d.node(488, y, 236, h, 'Campaign agent', ['Every 60 s, four tools:', '1 fetch new reports', '2 find similar reports', '3 create or update campaign', '4 draft an advisory'], 'gk');
  const ca = d.node(758, y, 190, h, 'Campaign', ['status: new', 'summary, indicators,', 'report count'], 'gk');
  const fd = d.node(982, y, 198, h, 'Fraud desk', ['Alert email and', 'console review'], 'bank');
  d.edge([r.r, st.l]);
  d.edge([st.r, ag.l]);
  d.edge([ag.r, ca.l]);
  d.edge([ca.r, fd.l]);
  const ap = d.node(760, 210, 200, 76, 'Approve', ['status: confirmed,', 'advisory approved'], 'good');
  const di = d.node(982, 210, 198, 76, 'Dismiss', ['status: dismissed'], 'muted');
  d.edge([[fd.cx - 40, fd.b[1]], [fd.cx - 40, 188], [ap.cx, 188], ap.t]);
  d.edge([[fd.cx + 20, fd.b[1]], [fd.cx + 20, di.t[1]]]);
  d.node(20, 210, 704, 76, 'Grouping rule', ['Two reports belong together when they share a link domain or a callback number,', 'or their embeddings (same model) are at least 0.82 similar. Two reports start a campaign.'], 'muted');
  d.text(600, 340, "The agent has no tool that sends anything. Whether and how to publish an approved advisory is the bank's decision.", 'ts');
  diagrams.push(d);
}

{
  const d = new Diagram(
    'deployment',
    1200,
    470,
    'Deployment options',
    'Bank-hosted runs inside one bank environment. A shared service keeps a separate key and separate data for every bank.',
  );
  d.rect(20, 20, 570, 430, 'lane lane-plain', 16);
  d.text(40, 50, 'Bank-hosted', 't', 'start');
  d.text(40, 68, 'Simplest route through security review and data residency', 'ts', 'start');
  d.rect(40, 92, 530, 250, 'lane lane-bank', 14);
  d.text(58, 116, "Bank's cloud or data centre", 'lane-label bank', 'start');
  const gw1 = d.node(60, 136, 180, 62, 'API gateway', ['mTLS, IP allowlist'], 'bank');
  const api1 = d.node(370, 136, 180, 62, 'Gaskiyya', ['registry and APIs'], 'gk');
  d.store(370, 236, 180, 76, 'Registry store', ['bank database']);
  const kms1 = d.node(196, 244, 140, 62, 'Bank KMS', ['hashing key'], 'bank');
  d.edge([gw1.r, api1.l]);
  d.edge([api1.b, [api1.cx, 236]]);
  d.edge([[api1.x, api1.y + 48], [kms1.cx, api1.y + 48], kms1.t], { dash: true, kind: 'soft', label: 'HMAC', at: 1 });
  const bs = d.node(60, 362, 180, 62, 'Bank systems', ['notify, dial, sign'], 'bank');
  const cu = d.node(370, 362, 180, 62, 'Customers', ['app and WhatsApp'], 'cust');
  d.edge([[100, bs.y], [100, gw1.b[1]]]);
  d.edge([cu.t, [cu.cx, 312]], {});
  d.rect(610, 20, 570, 430, 'lane lane-plain', 16);
  d.text(630, 50, 'Shared service', 't', 'start');
  d.text(630, 68, 'One deployment serves several banks, kept apart by tenant', 'ts', 'start');
  d.rect(630, 92, 530, 250, 'lane lane-gk', 14);
  d.text(648, 116, 'Gaskiyya shared deployment', 'lane-label gk', 'start');
  const api2 = d.node(800, 132, 190, 56, 'Gaskiyya APIs', ['tenant from credentials'], 'gk');
  d.node(652, 214, 236, 108, 'Tenant: Bank A', ['own hashing key', 'own records', 'own OAuth clients'], 'gk');
  d.node(902, 214, 236, 108, 'Tenant: Bank B', ['own hashing key', 'own records', 'own OAuth clients'], 'gk');
  const ba = d.node(652, 362, 236, 62, 'Bank A and Bank B systems', ['each with its own client'], 'bank');
  const c2 = d.node(902, 362, 236, 62, 'Customers of any', ['enrolled bank'], 'cust');
  d.edge([[ba.cx, ba.y], [ba.cx, 342]]);
  d.edge([[c2.cx, c2.y], [c2.cx, 342]]);
  d.edge([[api2.cx - 40, api2.b[1]], [api2.cx - 40, 200], [770, 200], [770, 214]]);
  d.edge([[api2.cx + 40, api2.b[1]], [api2.cx + 40, 200], [1020, 200], [1020, 214]]);
  diagrams.push(d);
}

for (const d of diagrams) {
  writeFileSync(join(out, `${d.name}.svg`), d.svg());
}
console.log(`wrote ${diagrams.length} diagrams to docs/diagrams/`);
