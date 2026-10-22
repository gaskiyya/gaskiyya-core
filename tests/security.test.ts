import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { configFromEnv, maskDigits } from '../packages/api/src/index.ts';
import { asksForSecret } from '../packages/api/src/ai/explain.ts';
import { ALERT, ALICE, BOB, harness, LINK_MSG } from './helpers.ts';
import { signed, waPayload } from './whatsapp.test.ts';

const FAKE_TEXT = 'Your DemoBank card is blocked. Call 08031234567 or visit https://demobank-help.com now.';

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

describe('security and privacy', () => {
  it('SEC-1 and SEC-2: after a full run the store holds no plain number or text, and logs hold no planted markers', async () => {
    process.env.LOG_LEVEL = 'trace';
    const h = await harness();
    const markers = Array.from({ length: 6 }, (_, i) => `MARKER${i}ZQXJ`);
    const customer = { authorization: `Bearer ${await h.customerToken(ALICE)}` };

    await h.register(ALICE, ALERT);
    await h.register(BOB, LINK_MSG);
    await h.verify(ALICE, ALERT);
    await h.verify(ALICE, `${FAKE_TEXT} ${markers[0]}`);
    await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: customer, payload: { contentDigest: contentDigest(markers[1]!), note: markers[1] } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: customer, payload: { contentDigest: markers[1] } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/explain', headers: customer, payload: { maskedText: `${FAKE_TEXT} ${markers[2]}`, language: 'en' } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/explain', headers: customer, payload: { maskedText: markers[2], language: 'xx' } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: customer, payload: { url: `https://${markers[3]}.example` } });
    const wa = signed(waPayload(ALICE.slice(1), { type: 'text', text: { body: `${FAKE_TEXT} ${markers[4]}` } }));
    await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': wa.signature }, payload: wa.raw });
    await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, payload: JSON.stringify({ text: markers[5] }) });
    await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a' } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/devices', headers: customer, payload: { pushToken: 'push-token-123456', platform: 'ios' } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/reports', headers: customer, payload: { maskedText: maskDigits(FAKE_TEXT), consent: true } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: { authorization: `Bearer ${h.bankToken}` } });

    const dump = (await h.sys.store.dump()) as Record<string, unknown>;
    const { reports, ...rest } = dump;
    const all = JSON.stringify(dump);
    const nonReports = JSON.stringify(rest);
    for (const phone of [ALICE, BOB]) {
      expect(all).not.toContain(phone);
      expect(all).not.toContain(phone.slice(1));
      expect(all).not.toContain(phone.slice(4));
    }
    for (const text of [ALERT, LINK_MSG, FAKE_TEXT, ...markers]) expect(nonReports).not.toContain(text);
    expect(all).not.toContain('08031234567');
    expect(all).not.toContain(contentDigest(ALERT));
    expect(JSON.stringify(reports)).toContain(maskDigits(FAKE_TEXT));

    expect(h.logs.length).toBeGreaterThan(5);
    const logText = h.logs.join('\n');
    for (const m of markers) expect(logText).not.toContain(m);
    for (const s of [ALICE, FAKE_TEXT, 'Bearer ']) expect(logText).not.toContain(s);
  });

  it('SEC-3: a secret scan of the repository passes', () => {
    const patterns: [string, RegExp][] = [
      ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
      ['OpenAI key', /sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
      ['AWS key', /AKIA[0-9A-Z]{16}/],
      ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
      ['private key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
      ['Slack token', /xox[baprs]-[0-9A-Za-z-]{10,}/],
      ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36}/],
      ['Meta token', /EAA[A-Za-z0-9]{100,}/],
      ['assigned secret', /(secret|password|api_?key|access_?token)\s*[:=]\s*['"][A-Za-z0-9+/_-]{24,}['"]/i],
    ];
    const findings: string[] = [];
    for (const f of trackedFiles()) {
      if (/\.(png|jpg|jpeg|webp|ico|ttf|otf|woff2?|glb|lock)$|pnpm-lock\.yaml$|pubspec\.lock$/.test(f)) continue;
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      for (const [name, re] of patterns) {
        const m = text.match(re);
        if (m && !/not-real|test-|example|placeholder/i.test(m[0])) findings.push(`${f}: ${name}`);
      }
    }
    expect(findings).toEqual([]);
    expect(trackedFiles()).not.toContain('.env');
  });

  it('SEC-3: all configuration comes from environment variables listed in .env.example', () => {
    const example = readFileSync('.env.example', 'utf8');
    const declared = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const used = new Set<string>();
    for (const f of trackedFiles().filter((f) => /^apps\/(api|console|agent)\/.*\.(ts|tsx|mjs)$/.test(f) || /^scripts\/.*\.mjs$/.test(f))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]|env\.([A-Z][A-Z0-9_]+)/g)) {
        used.add((m[1] ?? m[2] ?? m[3])!);
      }
    }
    const missing = [...used].filter((v) => !declared.has(v) && !['PATH', 'FLUTTER_ROOT', 'HOME', 'CI', 'NODE_ENV'].includes(v));
    expect(missing).toEqual([]);
  });

  it('SEC-4: verify endpoints are rate limited per customer', async () => {
    const h = await harness({ rateLimit: 5 });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await h.verify(ALICE, `msg ${i}`)).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    const limited = await h.verify(ALICE, 'again');
    expect(limited.body).toMatchObject({ code: 'rate_limited' });
    expect((await h.verify(BOB, 'other customer')).status).toBe(200);
    const link = await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` }, payload: { url: 'demobank.ng' } });
    expect(link.statusCode).toBe(429);
  });

  it('SEC-4: fraud reports are rate limited per customer', async () => {
    const h = await harness({ reportRateLimit: 2 });
    const report = async (phone: string) =>
      (
        await h.sys.app.inject({
          method: 'POST',
          url: '/v1/reports',
          headers: { authorization: `Bearer ${await h.customerToken(phone)}` },
          payload: { maskedText: maskDigits(FAKE_TEXT), consent: true },
        })
      ).statusCode;
    expect([await report(ALICE), await report(ALICE), await report(ALICE)]).toEqual([201, 201, 429]);
    expect(await report(BOB)).toBe(201);
  });

  it('SEC-4: bank token requests are rate limited per client address, before the secret is checked', async () => {
    const h = await harness({ tokenRateLimit: 3 });
    const token = async (secret: string, remoteAddress = '127.0.0.1') =>
      (
        await h.sys.app.inject({
          method: 'POST',
          url: '/v1/oauth/token',
          remoteAddress,
          payload: { grant_type: 'client_credentials', client_id: 'demobank-notify', client_secret: secret },
        })
      ).statusCode;
    expect(await token('wrong-secret-guess-000000000001')).toBe(401);
    expect(await token('wrong-secret-guess-000000000002')).toBe(401);
    const limited = await h.sys.app.inject({ method: 'POST', url: '/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: 'demobank-notify', client_secret: 'test-client-secret-not-real-0001' } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(await token('test-client-secret-not-real-0001', '10.1.2.3')).toBe(200);
  });

  it('CORS: browsers are refused by default and allowed only from listed origins', async () => {
    const preflight = (h: Awaited<ReturnType<typeof harness>>, origin: string) =>
      h.sys.app.inject({ method: 'OPTIONS', url: '/v1/verify/message', headers: { origin, 'access-control-request-method': 'POST' } });
    const closed = await harness();
    expect((await preflight(closed, 'https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    const listed = await harness({ corsOrigins: ['https://console.demobank.ng'] });
    expect((await preflight(listed, 'https://console.demobank.ng')).headers['access-control-allow-origin']).toBe('https://console.demobank.ng');
    expect((await preflight(listed, 'https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();

    const base = {
      GASKIYA_TOKEN_SECRET: 'x'.repeat(40),
      GASKIYA_TENANTS: JSON.stringify([{ id: 'demobank', name: 'DemoBank', domains: ['demobank.ng'], senderIds: [], tokenKeysUrl: 'https://bank.example/jwks.json' }]),
      GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: Buffer.alloc(32, 1).toString('base64') }),
      GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'notify', clientSecret: 's'.repeat(32), tenantId: 'demobank' }]),
      AI_PROVIDER: 'none',
    };
    expect(configFromEnv(base).corsOrigins).toBe(false);
    expect(configFromEnv({ ...base, CORS_ORIGINS: ' https://a.example , https://b.example ' }).corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(configFromEnv({ ...base, CORS_ORIGINS: '*' }).corsOrigins).toBe(true);
    expect(() => configFromEnv({ ...base, CORS_ORIGINS: '*', NODE_ENV: 'production', FIRESTORE_PROJECT_ID: 'p' })).toThrow(/CORS_ORIGINS=\* must not be used in production/);
    expect(() => configFromEnv({ ...base, RATE_LIMIT_STORE: 'firestore' })).toThrow(/RATE_LIMIT_STORE=firestore needs the Firestore store/);
  });

  it('SEC-5: no screen text, bot reply or prompt template asks for a PIN, password, card number or OTP', () => {
    const files = trackedFiles().filter(
      (f) =>
        f === 'packages/schemas/copy.json' ||
        /^mobile\/lib\/.*\.dart$/.test(f) ||
        /^console\/src\/.*\.(tsx?|html)$/.test(f) ||
        /^packages\/api\/src\/(ai|whatsapp|campaigns).*\.ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(5);
    const offending: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const strings = [...text.matchAll(/(["'`])((?:\\.|(?!\1).){8,}?)\1/gs)].map((m) => m[2]!);
      for (const s of strings) if (asksForSecret(s.replace(/\\n/g, ' '))) offending.push(`${f}: ${s.slice(0, 80)}`);
    }
    expect(offending).toEqual([]);
    expect(asksForSecret('Please enter your PIN to continue.')).toBe(true);
    expect(asksForSecret('Reply with your OTP.')).toBe(true);
    expect(asksForSecret('Never share your PIN with anyone.')).toBe(false);
  });

  it('F19: every API answer carries security headers and a strict CSP; a mounted console UI still loads', async () => {
    const h = await harness();
    const auth = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
    const answers = [
      await h.sys.app.inject({ method: 'GET', url: '/health' }),
      await h.sys.app.inject({ method: 'GET', url: '/v1/banks' }),
      await h.sys.app.inject({ method: 'GET', url: '/v1/nope' }),
      await h.sys.app.inject({ method: 'GET', url: '/v1/activity' }),
      await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: auth, payload: { contentDigest: 'bad' } }),
      await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: { ...auth, 'content-type': 'application/json' }, payload: '{not json' }),
      await h.sys.app.inject({ method: 'POST', url: '/v1/verify/message', headers: auth, payload: { contentDigest: contentDigest(ALERT) } }),
    ];
    for (const r of answers) {
      expect(r.headers['x-content-type-options'], r.body).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['content-security-policy']).toContain("default-src 'none'");
      expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(r.headers['cache-control']).toBe('no-store');
    }

    await h.sys.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const port = (h.sys.app.server.address() as { port: number }).port;
      const ac = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/v1/events`, { headers: auth, signal: ac.signal });
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      ac.abort();
    } finally {
      await h.sys.app.close();
    }

    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdirSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'gk-console-'));
    mkdirSync(join(dir, 'console'));
    writeFileSync(join(dir, 'console', 'index.html'), '<!doctype html><title>Console</title><script type="module" src="/app.js"></script>');
    const { registerSimulator } = await import('../packages/api/src/simulator/index.ts');
    const { registerWeb } = await import('../packages/api/src/web.ts');
    const { createSystem, StaticKeyService } = await import('../packages/api/src/index.ts');
    const { BANK_CLIENT, TENANT, TOKEN_SECRET } = await import('./helpers.ts');
    const sys = createSystem({ tenants: [{ ...TENANT, tokenKeys: { keys: [] } }], keys: StaticKeyService.random([TENANT.id]), bankClients: [BANK_CLIENT], tokenSecret: TOKEN_SECRET, logger: false });
    await sys.app.register(async (scope) => {
      await registerSimulator(scope, { apiUrl: 'http://127.0.0.1:9', clientId: 'x', clientSecret: 'y', tenantId: 'demobank', bankName: 'DemoBank', demoLogin: true, logger: false });
    });
    await registerWeb(sys.app, { dir, console: true, admin: null });
    const page = await sys.app.inject({ method: 'GET', url: '/console/index.html' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['content-security-policy']).toBeUndefined();
    expect(page.headers['x-content-type-options']).toBe('nosniff');
  });

  it("F12: the demo reset clears only the calling bank's records, and is refused in production", async () => {
    const h = await harness();
    await h.register(ALICE, ALERT);
    await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: ALICE, purpose: 'card_activation', agentRef: 'a1' } });
    const other = {
      id: 'rec_other',
      tenantId: 'otherbank',
      recipientKey: 'r'.repeat(64),
      contentKey: 'c'.repeat(64),
      keyVersion: 1,
      channel: 'sms' as const,
      category: 'otp' as const,
      hasLink: false,
      linkDomains: [],
      asksCallback: false,
      sentAt: h.clock.now.toISOString(),
      expiresAt: new Date(h.clock.now.getTime() + 86_400_000).toISOString(),
      registeredAt: h.clock.now.toISOString(),
    };
    await h.sys.store.putMessage(other, 'other-idem');
    await h.sys.store.putCall({ id: 'call_other', tenantId: 'otherbank', recipientKey: 'r'.repeat(64), purpose: 'fraud_check', agentRef: 'x', code: '1234', status: 'open', openedAt: other.sentAt, expiresAt: other.expiresAt });

    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/admin/reset', headers: { authorization: `Bearer ${h.bankToken}` } });
    expect(r.json()).toEqual({ ok: true });
    const dump = (await h.sys.store.dump()) as { messages: { tenantId: string }[]; calls: { tenantId: string }[]; idempotencyKeys: string[] };
    expect(dump.messages.map((m) => m.tenantId)).toEqual(['otherbank']);
    expect(dump.calls.map((c) => c.tenantId)).toEqual(['otherbank']);
    expect(dump.idempotencyKeys).toHaveLength(1);
    expect((await h.verify(ALICE, ALERT)).body.verdict).toBe('not_confirmed');

    expect((await h.sys.app.inject({ method: 'POST', url: '/v1/admin/reset' })).statusCode).toBe(401);
    expect(() => configFromEnv({ NODE_ENV: 'production', ALLOW_DEMO_RESET: 'true' })).toThrow(/ALLOW_DEMO_RESET must not be true in production/);
  });
});
