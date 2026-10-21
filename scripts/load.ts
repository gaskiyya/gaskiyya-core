import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { cpus, loadavg } from 'node:os';
import autocannon from 'autocannon';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { contentDigest } from '@gaskiya/canonical';
import { createSystem, StaticKeyService } from '../packages/api/src/index.ts';

const env = process.env;
const DURATION = Number(env.LOAD_DURATION || 10);
const CONNECTIONS = Number(env.LOAD_CONNECTIONS || 50);
const BATCH = Number(env.LOAD_BATCH_SIZE || 100);
const PHONES = Number(env.LOAD_PHONES || 200);
const REMOTE = env.LOAD_URL?.replace(/\/+$/, '');

const SEEDED = 5;

interface Reply {
  status: number;
  json(): Promise<unknown>;
}
function post(url: string, headers: Record<string, string>, body: unknown): Promise<Reply> {
  const payload = JSON.stringify(body);
  const u = new URL(url);
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(u, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(text) as unknown });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });
}

const phone = (i: number) => `+23480${String(10_000_000 + (i % PHONES)).slice(-8)}`;
const regPhone = (i: number) => `+2347${String(i % 1_000_000_000).padStart(9, '0')}`;

interface Target {
  url: string;
  clientId: string;
  clientSecret: string;
  customerToken(phone: string): Promise<string>;
  close(): Promise<void>;
  describe: string;
}

async function inProcess(): Promise<Target> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'load', alg: 'ES256', use: 'sig' };
  const client = { clientId: 'loadbank-notify', clientSecret: 'load-test-client-secret-not-real', tenantId: 'loadbank' };
  const sys = createSystem({
    tenants: [{ id: 'loadbank', name: 'LoadBank', domains: ['loadbank.ng'], senderIds: ['LoadBank'], tokenKeys: { keys: [jwk] } }],
    keys: StaticKeyService.random(['loadbank']),
    bankClients: [client],
    tokenSecret: 'load-test-token-secret-not-real-0123456789',
    verifyRateLimitPerMinute: 1_000_000_000,
    mailer: null,
    logger: false,
  });
  await sys.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = sys.app.server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    ...client,
    customerToken: (p) =>
      new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'load' }).setIssuer('loadbank').setSubject(p).setAudience('gaskiya').setIssuedAt().setExpirationTime('1h').sign(privateKey),
    close: () => sys.app.close(),
    describe: 'in-process, memory store, verify rate limit raised for the run, guard on, email off',
  };
}

async function remote(url: string): Promise<Target> {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is required with LOAD_URL`);
    return v;
  };
  const tokenUrl = need('LOAD_CUSTOMER_TOKEN_URL');
  return {
    url,
    clientId: need('LOAD_CLIENT_ID'),
    clientSecret: need('LOAD_CLIENT_SECRET'),
    customerToken: async (p) => {
      const r = await post(tokenUrl, {}, { phone: p });
      if (r.status !== 200) throw new Error(`customer token endpoint answered ${r.status}`);
      return ((await r.json()) as { token: string }).token;
    },
    close: async () => {},
    describe: `remote ${url}; its own store and rate limits apply`,
  };
}

async function bankToken(t: Target): Promise<string> {
  const r = await post(`${t.url}/v1/oauth/token`, {}, { grant_type: 'client_credentials', client_id: t.clientId, client_secret: t.clientSecret });
  if (r.status !== 200) throw new Error(`token endpoint answered ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

const message = (p: string, text: string) => ({
  recipient: p,
  channel: 'sms',
  contentDigest: contentDigest(text),
  category: 'transaction_alert',
  hasLink: false,
  linkDomains: [],
  asksCallback: false,
  sentAt: new Date().toISOString(),
});

function pct(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

interface Row {
  scenario: string;
  requests: number;
  rps: number;
  itemsPerSec: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  non2xx: number;
  errors: number;
}

async function run(scenario: string, url: string, method: 'POST', path: string, next: () => { headers: Record<string, string>; body: string }, perRequest = 1): Promise<Row> {
  const latencies: number[] = [];
  const result = await new Promise<autocannon.Result>((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: CONNECTIONS,
        duration: DURATION,
        requests: [{ method, path, setupRequest: (req) => ({ ...req, ...next() }) }],
      },
      (err, r) => (err ? reject(err) : resolve(r)),
    );
    instance.on('response', (_client: unknown, _status: number, _bytes: number, responseTime: number) => latencies.push(responseTime));
  });
  latencies.sort((a, b) => a - b);
  const total = result.requests.total;
  const rps = total / (result.duration || DURATION);
  return {
    scenario,
    requests: total,
    rps,
    itemsPerSec: rps * perRequest,
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    max: latencies[latencies.length - 1] ?? 0,
    non2xx: result.non2xx,
    errors: result.errors + result.timeouts,
  };
}

async function reg7Probe(t: Target, bank: string, tokens: Map<string, string>, stopAt: number): Promise<number[]> {
  const samples: number[] = [];
  let i = 0;
  while (Date.now() < stopAt) {
    const p = phone(i);
    const text = `REG-7 probe ${i++} ${Date.now()}`;
    const t0 = performance.now();
    const reg = await post(`${t.url}/v1/messages`, { authorization: `Bearer ${bank}` }, message(p, text));
    if (reg.status !== 202) throw new Error(`probe registration answered ${reg.status}`);
    let confirmed = false;
    while (!confirmed && performance.now() - t0 < 10_000) {
      const v = await post(`${t.url}/v1/verify/message`, { authorization: `Bearer ${tokens.get(p)}` }, { contentDigest: contentDigest(text) });
      confirmed = v.status === 200 && ((await v.json()) as { verdict: string }).verdict === 'confirmed';
    }
    samples.push(confirmed ? performance.now() - t0 : Infinity);
    await new Promise((r) => setTimeout(r, 100));
  }
  return samples.sort((a, b) => a - b);
}

const f = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

async function main() {
  const t = REMOTE ? await remote(REMOTE) : await inProcess();
  console.log(`Target: ${t.describe}`);
  console.log(`Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'} x${cpus().length}, load average ${loadavg().map((l) => l.toFixed(1)).join(' ')}`);
  console.log(`${DURATION}s per scenario, ${CONNECTIONS} connections, batch of ${BATCH}, ${PHONES} recipients\n`);

  const bank = await bankToken(t);
  const tokens = new Map<string, string>();
  for (let i = 0; i < PHONES; i++) tokens.set(phone(i), await t.customerToken(phone(i)));
  const auth = { authorization: `Bearer ${bank}`, 'content-type': 'application/json' };
  const rows: Row[] = [];
  let n = 0;

  const probe = reg7Probe(t, bank, tokens, Date.now() + DURATION * 1000);
  rows.push(
    await run('POST /v1/messages (single)', t.url, 'POST', '/v1/messages', () => {
      const i = n++;
      return { headers: auth, body: JSON.stringify(message(regPhone(i), `load single ${i}`)) };
    }),
  );
  const reg7 = await probe;

  let b = 0;
  rows.push(
    await run(
      `POST /v1/messages/batch (${BATCH} per call)`,
      t.url,
      'POST',
      '/v1/messages/batch',
      () => {
        const k = b++;
        return { headers: auth, body: JSON.stringify({ messages: Array.from({ length: BATCH }, (_, j) => message(regPhone(1_000_000 + k * BATCH + j), `load batch ${k} ${j}`)) }) };
      },
      BATCH,
    ),
  );

  const seed = Array.from({ length: PHONES * SEEDED }, (_, k) => message(phone(Math.floor(k / SEEDED)), `seed ${Math.floor(k / SEEDED)} ${k % SEEDED}`));
  for (let k = 0; k < seed.length; k += 100) {
    const r = await post(`${t.url}/v1/messages/batch`, auth, { messages: seed.slice(k, k + 100) });
    if (r.status !== 202) throw new Error(`seeding answered ${r.status}: ${JSON.stringify(await r.json())}`);
  }
  const check = await post(`${t.url}/v1/verify/message`, { authorization: `Bearer ${tokens.get(phone(0))}` }, { contentDigest: contentDigest('seed 0 0') });
  if (((await check.json()) as { verdict?: string }).verdict !== 'confirmed') throw new Error('a seeded message did not verify; the check scenario would be meaningless');
  let v = 0;
  rows.push(
    await run('POST /v1/verify/message (half confirmed)', t.url, 'POST', '/v1/verify/message', () => {
      const k = v++;
      const i = (k * 7919) % PHONES;
      const text = k % 2 === 0 ? `seed ${i} ${k % SEEDED}` : `never registered ${k}`;
      return { headers: { authorization: `Bearer ${tokens.get(phone(i))}`, 'content-type': 'application/json' }, body: JSON.stringify({ contentDigest: contentDigest(text) }) };
    }),
  );

  console.log('| Scenario | Requests | Requests/s | Messages/s | p50 ms | p95 ms | p99 ms | max ms | non-2xx | errors |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    console.log(`| ${r.scenario} | ${r.requests} | ${f(r.rps)} | ${f(r.itemsPerSec)} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${f(r.max)} | ${r.non2xx} | ${r.errors} |`);
  }
  const worst = reg7[reg7.length - 1] ?? Infinity;
  console.log(`\nREG-7 probe (registration call to confirmed check, under registration load): ${reg7.length} samples, p50 ${f(pct(reg7, 50))} ms, p99 ${f(pct(reg7, 99))} ms, max ${f(worst)} ms`);
  const single = rows[0]!;
  const pass = worst < 2000 && single.p99 < 2000 && single.non2xx === 0 && single.errors === 0;
  console.log(`REG-7 (searchable within 2 s of the registration call): ${pass ? 'PASS' : 'FAIL'}`);
  await t.close();
  if (!pass) process.exitCode = 1;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
