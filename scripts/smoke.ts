// End-to-end check of a running registry over HTTP, the way the mobile app, the console and the admin dashboard use it.
// Usage: pnpm smoke [url]   (default http://localhost:8080)
// Optional: SMOKE_ADMIN_USER + SMOKE_ADMIN_PASSWORD (admin dashboard API), SMOKE_CLIENT_ID + SMOKE_CLIENT_SECRET (bank API),
// AGENT_JOB_TOKEN (scheduled agent route). Customer and simulator checks need a demo deployment (SIM_ENABLED + SIM_DEMO_LOGIN).
import { contentDigest, receiptDigest } from '../packages/canonical/src/index.ts';

const base = (process.argv[2] || process.env.SMOKE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const env = process.env;
const PHONE = '+2348099990001';

let failures = 0;
let consoleToken = '';
const ok = (name: string, detail = '') => console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
const bad = (name: string, detail: string) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${name}  ${detail}`);
};
const skip = (name: string, detail: string) => console.log(`  \x1b[2m- ${name}  ${detail}\x1b[0m`);

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    ok(name, (await fn()) ?? '');
  } catch (e) {
    bad(name, (e as Error).message);
  }
}

// Responses are checked field by field below, so they stay loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; data: any; headers: Headers };
async function call(method: string, path: string, o: { body?: unknown; token?: string; form?: boolean; redirect?: RequestRedirect } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  else if (consoleToken && path.startsWith('/sim/')) headers.authorization = `Bearer ${consoleToken}`;
  if (o.body !== undefined) headers['content-type'] = o.form ? 'application/x-www-form-urlencoded' : 'application/json';
  const r = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : o.form ? new URLSearchParams(o.body as Record<string, string>).toString() : JSON.stringify(o.body),
    redirect: o.redirect ?? 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let data: Res['data'] = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: keep the text (HTML pages, USSD screens).
  }
  return { status: r.status, data, headers: r.headers };
}

function expect(r: Res, status: number | number[], what: string) {
  const want = Array.isArray(status) ? status : [status];
  if (!want.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

console.log(`\nGaskiya smoke test: ${base}\n`);

console.log('Server and web pages');
await check('GET /health', async () => {
  const d = expect(await call('GET', '/health'), 200, 'health');
  if (d.ok !== true) throw new Error(`unexpected body ${JSON.stringify(d)}`);
});
await check('GET /admin/login (admin sign-in page)', async () => {
  const r = await call('GET', '/admin/login');
  expect(r, 200, 'admin login');
  if (!String(r.data).includes('<html')) throw new Error('not an HTML page');
});
await check('GET /admin/ without a session redirects to sign-in', async () => {
  const r = await call('GET', '/admin/', { redirect: 'manual' });
  if (r.status !== 302 || !r.headers.get('location')?.endsWith('/admin/login')) throw new Error(`HTTP ${r.status} location ${r.headers.get('location')}`);
});

console.log('\nPublic registry API');
let banks: { id: string; name: string; customerTokenUrl?: string; demoInboxUrl?: string | null }[] = [];
await check('GET /v1/banks', async () => {
  banks = expect(await call('GET', '/v1/banks'), 200, 'banks').banks ?? [];
  if (!banks.length) throw new Error('no banks listed: the app has nothing to sign in to');
  return banks.map((b) => b.id).join(', ');
});
await check('GET /v1/organisations', async () => {
  const d = expect(await call('GET', '/v1/organisations'), 200, 'organisations');
  return `${(d.organisations ?? []).length} organisation(s)`;
});

const sim = (await call('GET', '/sim/config').catch(() => null))?.status === 200;
let token = '';
let bankCode = '';
if (!sim) {
  skip('Customer, console and simulator checks', 'the simulator is off (not a demo deployment)');
} else {
  console.log('\nBank sandbox console (simulator)');
  await check('GET /console/', async () => {
    const r = await call('GET', '/console/');
    expect(r, 200, 'console');
    if (!String(r.data).includes('<html')) throw new Error('not an HTML page');
  });
  await check('GET /sim/config', async () => {
    const d = expect(await call('GET', '/sim/config'), 200, 'config');
    bankCode = d.bank?.bankCode ?? '';
    return `${d.bank?.name}, ${d.orgs?.length ?? 0} org(s), bank code ${bankCode || 'none'}`;
  });
  await check('Bank console: the demo bank signs in with the code on its sign-in page', async () => {
    const demo = expect(await call('GET', '/v1/console/demo'), 200, 'demo code');
    const s = expect(await call('POST', '/v1/console/session', { body: { code: demo.code } }), 200, 'console sign-in');
    consoleToken = s.token;
    return `${s.org?.name} (${String(demo.code).length}-character code)`;
  });
  await check('GET /sim/.well-known/jwks.json', async () => {
    const d = expect(await call('GET', '/sim/.well-known/jwks.json'), 200, 'jwks');
    if (!d.keys?.length) throw new Error('no keys');
  });
  await check('GET /sim/organisations', async () => void expect(await call('GET', '/sim/organisations'), 200, 'organisations'));

  console.log('\nMobile app: sign-in');
  const demo = banks.find((b) => b.customerTokenUrl);
  await check(`Customer token from ${demo?.name ?? '(no bank with demo login)'}`, async () => {
    if (!demo?.customerTokenUrl) throw new Error('no bank offers a customerTokenUrl');
    const url = new URL(demo.customerTokenUrl, `${base}/`).toString();
    const d = expect(await call('POST', url, { body: { phone: PHONE } }), 200, 'customer token');
    token = d.token;
    if (!token) throw new Error('no token in response');
    return `via ${new URL(url).pathname}`;
  });
  await check('GET /v1/me', async () => {
    const d = expect(await call('GET', '/v1/me', { token }), 200, 'me');
    return JSON.stringify(d).slice(0, 80);
  });
  await check('POST /v1/devices (push registration)', async () => {
    expect(await call('POST', '/v1/devices', { token, body: { pushToken: 'smoke-test-token', platform: 'android' } }), [200, 201, 204], 'devices');
  });

  console.log('\nMobile app: message checks');
  await check('Genuine bank SMS is confirmed (POST /sim/send, GET /sim/inbox, POST /v1/verify/message)', async () => {
    const sent = expect(await call('POST', '/sim/send', { body: { phone: PHONE } }), 200, 'send');
    const inbox = expect(await call('GET', '/sim/inbox', { token }), 200, 'inbox');
    if (!inbox.items?.some((i: { id: string }) => i.id === sent.item.id)) throw new Error('message not in the customer inbox');
    const v = expect(await call('POST', '/v1/verify/message', { token, body: { contentDigest: contentDigest(sent.item.text) } }), 200, 'verify');
    if (v.verdict !== 'confirmed') throw new Error(`verdict ${v.verdict}, expected confirmed`);
    return `registered in ${sent.registrationMs} ms`;
  });
  await check('Fake SMS is not confirmed (POST /sim/send-fake)', async () => {
    const fake = expect(await call('POST', '/sim/send-fake', { body: { phone: PHONE } }), 200, 'send fake');
    const v = expect(await call('POST', '/v1/verify/message', { token, body: { contentDigest: contentDigest(fake.item.text) } }), 200, 'verify');
    if (v.verdict === 'confirmed') throw new Error('a fake message was confirmed');
    return `verdict ${v.verdict}`;
  });
  await check('POST /v1/verify/link', async () => {
    const d = expect(await call('POST', '/v1/verify/link', { token, body: { url: 'https://demobank.ng/login' } }), 200, 'link');
    return `demobank.ng: ${d.verdict ?? JSON.stringify(d).slice(0, 60)}`;
  });
  await check('POST /v1/verify/contact', async () => {
    const d = expect(await call('POST', '/v1/verify/contact', { token, body: { contact: '+2342019000000' } }), 200, 'contact');
    return `${d.verdict ?? JSON.stringify(d).slice(0, 60)}`;
  });
  await check('POST /v1/verify/indicators', async () => {
    const d = expect(await call('POST', '/v1/verify/indicators', { token, body: { domains: ['demobank.ng'], phones: ['+2342019000000'] } }), 200, 'indicators');
    return JSON.stringify(d).slice(0, 80);
  });
  await check('POST /v1/verify/licence', async () => {
    const d = expect(await call('POST', '/v1/verify/licence', { token, body: { query: 'DemoBank' } }), 200, 'licence');
    return `${d.verdict ?? d.status ?? JSON.stringify(d).slice(0, 60)}`;
  });
  await check('POST /v1/verify/screenshot', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const r = await call('POST', '/v1/verify/screenshot', { token, body: { imageBase64: png, mediaType: 'image/png' } });
    expect(r, [200, 422, 503], 'screenshot');
    return r.status === 200 ? `verdict ${r.data.verdict}` : `${r.status} ${r.data.code} (no AI provider to read images)`;
  });
  await check('POST /v1/explain', async () => {
    const d = expect(await call('POST', '/v1/explain', { token, body: { maskedText: 'Your account is blocked. Call 0801****** now to restore it.', language: 'en' } }), 200, 'explain');
    return `${String(d.summary ?? d.text ?? JSON.stringify(d)).slice(0, 60)}`;
  });
  await check('POST /v1/reports', async () => {
    expect(await call('POST', '/v1/reports', { token, body: { maskedText: 'Smoke test report: your account is blocked, click http://demobank-restore.example', consent: true, indicators: [], callbackDigests: [] } }), [200, 201, 202], 'report');
  });
  await check('GET /v1/activity', async () => void expect(await call('GET', '/v1/activity', { token }), 200, 'activity'));
  await check('GET /v1/advisories', async () => void expect(await call('GET', '/v1/advisories', { token }), 200, 'advisories'));
  await check('GET /v1/official-contacts', async () => void expect(await call('GET', '/v1/official-contacts', { token }), 200, 'official contacts'));

  console.log('\nMobile app: calls, receipts, SIM swap, live events');
  await check('Bank call is shown as genuine (POST /sim/calls, GET /v1/calls/open, PATCH /sim/calls/:id)', async () => {
    const c = expect(await call('POST', '/sim/calls', { body: { phone: PHONE } }), 200, 'open call');
    const open = expect(await call('GET', '/v1/calls/open', { token }), 200, 'calls open');
    if (!JSON.stringify(open).includes(c.code)) throw new Error(`the app does not see call code ${c.code}: ${JSON.stringify(open).slice(0, 120)}`);
    expect(await call('PATCH', `/sim/calls/${c.id}`, { body: { status: 'ended' } }), 200, 'end call');
  });
  await check('Transfer receipt is confirmed (POST /sim/transfers, /sim/transfers/:id/check)', async () => {
    const t = expect(await call('POST', '/sim/transfers', { body: { from: '+2348012345678', to: PHONE, amountKobo: 150_000 } }), 200, 'transfer').transfer;
    if (!t.registered) throw new Error('the bank did not register the receipt');
    const c = expect(await call('POST', `/sim/transfers/${t.id}/check`), 200, 'check').transfer.check;
    if (c?.verdict !== 'received') throw new Error(`verdict ${c?.verdict}, expected received`);
    if (bankCode) {
      const digest = receiptDigest({ beneficiaryAccount: t.account, beneficiaryBank: bankCode, amountKobo: t.amountKobo + 100, reference: t.reference, valueDate: t.valueDate });
      const f = expect(await call('POST', '/v1/verify/receipt', { token, body: { receiptDigest: digest, beneficiaryAccount: t.account } }), 200, 'fake receipt');
      if (f.verdict === 'received') throw new Error('a receipt with a changed amount was confirmed');
    }
  });
  await check('POST /sim/sim-swap/check', async () => {
    const d = expect(await call('POST', '/sim/sim-swap/check', { body: { phone: PHONE } }), 200, 'sim swap');
    return JSON.stringify(d).slice(0, 80);
  });
  await check('GET /v1/events (live updates stream)', async () => {
    const ac = new AbortController();
    const r = await fetch(`${base}/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
    const type = r.headers.get('content-type') ?? '';
    ac.abort();
    if (r.status !== 200 || !type.includes('text/event-stream')) throw new Error(`HTTP ${r.status} ${type}`);
  });

  console.log('\nConsole: USSD, fraud desk, campaigns');
  await check('POST /sim/ussd', async () => {
    const d = expect(await call('POST', '/sim/ussd', { body: { phone: PHONE, text: '' } }), 200, 'ussd');
    return String(d.screen).split('\n')[0];
  });
  await check('POST + GET /sim/fraud-calls', async () => {
    expect(await call('POST', '/sim/fraud-calls', { body: { phone: PHONE, from: '+2349060000001' } }), 200, 'fraud call');
    expect(await call('GET', '/sim/fraud-calls'), 200, 'fraud calls');
  });
  for (const p of ['/sim/calls', '/sim/transfers', '/sim/customers/recent', '/sim/campaigns', '/sim/alerts', '/sim/metrics']) {
    await check(`GET ${p}`, async () => void expect(await call('GET', p), 200, p));
  }
}

console.log('\nBank API');
if (env.SMOKE_CLIENT_ID && env.SMOKE_CLIENT_SECRET) {
  let bank = '';
  await check('POST /v1/oauth/token', async () => {
    bank = expect(await call('POST', '/v1/oauth/token', { body: { grant_type: 'client_credentials', client_id: env.SMOKE_CLIENT_ID, client_secret: env.SMOKE_CLIENT_SECRET } }), 200, 'token').access_token;
  });
  for (const p of ['/v1/metrics', '/v1/campaigns', '/v1/registration-alerts']) {
    await check(`GET ${p}`, async () => void expect(await call('GET', p, { token: bank }), 200, p));
  }
} else skip('Bank API with a client secret', 'set SMOKE_CLIENT_ID and SMOKE_CLIENT_SECRET (the simulator checks above already go through it)');

console.log('\nAdmin dashboard API');
if (env.SMOKE_ADMIN_USER && env.SMOKE_ADMIN_PASSWORD) {
  let admin = '';
  await check('POST /v1/admin/session (sign in)', async () => {
    admin = expect(await call('POST', '/v1/admin/session', { body: { username: env.SMOKE_ADMIN_USER, password: env.SMOKE_ADMIN_PASSWORD } }), 200, 'login').token;
  });
  for (const p of ['/v1/admin/session', '/v1/admin/overview', '/v1/admin/orgs', '/v1/admin/audit', '/v1/admin/settings']) {
    await check(`GET ${p}`, async () => void expect(await call('GET', p, { token: admin }), 200, p));
  }
  await check('GET /admin/ with a session', async () => {
    const r = await fetch(`${base}/admin/`, { headers: { cookie: `gaskiyya_admin=${admin}` }, redirect: 'manual' });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  });
  await check('POST /v1/admin/session/logout', async () => void expect(await call('POST', '/v1/admin/session/logout', { token: admin, body: {} }), 200, 'logout'));
} else skip('Admin dashboard API', 'set SMOKE_ADMIN_USER and SMOKE_ADMIN_PASSWORD');

console.log('\nScheduled agent');
if (env.AGENT_JOB_TOKEN) {
  await check('POST /internal/agent/run', async () => void expect(await call('POST', '/internal/agent/run', { token: env.AGENT_JOB_TOKEN, body: {} }), 200, 'agent run'));
} else skip('POST /internal/agent/run', 'set AGENT_JOB_TOKEN');

console.log(failures ? `\n\x1b[31m${failures} check(s) failed\x1b[0m\n` : '\n\x1b[32mAll checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
