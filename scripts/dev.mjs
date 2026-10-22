#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { describeAi } from './offline.mjs';

const ENV = '.env';
if (!existsSync(ENV)) {
  const simSecret = randomBytes(24).toString('base64url');
  const vars = {
    PORT: '8080',
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    GASKIYA_TOKEN_SECRET: randomBytes(32).toString('base64url'),
    GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: randomBytes(32).toString('base64') }),
    GASKIYA_BANK_CLIENTS: JSON.stringify([{ clientId: 'demobank-sim', clientSecret: simSecret, tenantId: 'demobank' }]),
    GASKIYA_TENANTS: JSON.stringify([
      { id: 'demobank', name: 'DemoBank', domains: ['demobank.ng', 'demobank.com'], senderIds: ['DemoBank'], bankCode: '999001', tokenKeysUrl: 'http://127.0.0.1:8080/sim/.well-known/jwks.json' },
    ]),
    ALLOW_DEMO_RESET: 'true',
    SIM_CLIENT_ID: 'demobank-sim',
    SIM_CLIENT_SECRET: simSecret,
    SIM_SWAP_PROVIDER: 'simulated',
  };
  writeFileSync(ENV, withVars(readFileSync('.env.example', 'utf8'), vars));
  console.log('Wrote .env with generated local secrets.');
}
process.loadEnvFile(ENV);
{
  const add = {};
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_USERS) add.ADMIN_PASSWORD = randomBytes(12).toString('base64url');
  if (!process.env.GASKIYA_MASTER_KEY) add.GASKIYA_MASTER_KEY = randomBytes(32).toString('base64');
  if (Object.keys(add).length) {
    writeFileSync(ENV, withVars(readFileSync(ENV, 'utf8'), add));
    Object.assign(process.env, add);
    console.log('Added the admin dashboard login and master key to .env.');
  }
}
process.env.SIM_ENABLED = 'true';
process.env.SIM_DEMO_LOGIN ||= 'true';
process.env.USSD_WEBHOOK_TOKEN ||= randomBytes(24).toString('base64url');
process.env.SIM_SWAP_PROVIDER ||= 'simulated';

function withVars(text, vars) {
  const seen = new Set();
  const quote = (v) => (v.includes(' ') || v.startsWith('{') || v.startsWith('[') ? `'${v}'` : v);
  const lines = text.split('\n').map((line) => {
    const m = line.match(/^([A-Z][A-Z0-9_]+)=/);
    if (!m || vars[m[1]] === undefined) return line;
    seen.add(m[1]);
    return `${m[1]}=${quote(vars[m[1]])}`;
  });
  for (const [k, v] of Object.entries(vars)) if (!seen.has(k)) lines.push(`${k}=${quote(v)}`);
  return lines.join('\n');
}

{
  const presets = Object.values(JSON.parse(readFileSync('packages/api/src/simulator/demo-banks.json', 'utf8')));
  const tenants = JSON.parse(process.env.GASKIYA_TENANTS || '[]');
  let changed = false;
  for (const t of tenants) {
    const p = presets.find((x) => x.tenant.id === t.id);
    if (p?.tenant.bankCode && !t.bankCode) {
      t.bankCode = p.tenant.bankCode;
      changed = true;
    }
  }
  if (changed) process.env.GASKIYA_TENANTS = JSON.stringify(tenants);
}
const jwksUrl = `http://127.0.0.1:${process.env.PORT || 8080}/sim/.well-known/jwks.json`;
{
  const tenants = JSON.parse(process.env.GASKIYA_TENANTS || '[]');
  let moved = false;
  for (const t of tenants) {
    if (typeof t.tokenKeysUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/sim\/\.well-known\/jwks\.json$/.test(t.tokenKeysUrl) && t.tokenKeysUrl !== jwksUrl) {
      t.tokenKeysUrl = jwksUrl;
      moved = true;
    }
  }
  if (moved) {
    const vars = { GASKIYA_TENANTS: JSON.stringify(tenants) };
    writeFileSync(ENV, withVars(readFileSync(ENV, 'utf8'), vars));
    Object.assign(process.env, vars);
  }
}
const bankPresets = JSON.parse(readFileSync('packages/api/src/simulator/demo-banks.json', 'utf8'));

function enrol(preset) {
  const t = { ...preset.tenant, ...preset.publishes };
  const tenants = JSON.parse(process.env.GASKIYA_TENANTS || '[]');
  const keys = JSON.parse(process.env.GASKIYA_TENANT_KEYS || '{}');
  const clients = JSON.parse(process.env.GASKIYA_BANK_CLIENTS || '[]');
  const clientId = `${t.id}-sim`;
  let client = clients.find((c) => c.tenantId === t.id && c.clientId === (t.id === 'demobank' ? 'demobank-sim' : clientId)) ?? clients.find((c) => c.tenantId === t.id);
  let tenant = tenants.find((x) => x.id === t.id);
  let changed = false;
  if (!tenant) {
    tenants.push((tenant = { ...t, tokenKeysUrl: jwksUrl }));
    changed = true;
  }
  for (const k of ['kind', 'officialContacts', 'officialApps']) {
    if (t[k] !== undefined && tenant[k] === undefined) {
      tenant[k] = t[k];
      changed = true;
    }
  }
  if (!keys[t.id]) {
    keys[t.id] = randomBytes(32).toString('base64');
    changed = true;
  }
  if (!client) {
    clients.push((client = { clientId, clientSecret: randomBytes(24).toString('base64url'), tenantId: t.id }));
    changed = true;
  }
  if (changed) {
    const vars = { GASKIYA_TENANTS: JSON.stringify(tenants), GASKIYA_TENANT_KEYS: JSON.stringify(keys), GASKIYA_BANK_CLIENTS: JSON.stringify(clients) };
    writeFileSync(ENV, withVars(readFileSync(ENV, 'utf8'), vars));
    Object.assign(process.env, vars);
    console.log(`Enrolled the demo organisation "${t.name}" in .env.`);
  }
  return client;
}

const demoTenant = process.env.DEMO_TENANT || 'demobank';
const bankPreset = bankPresets[demoTenant];
if (!bankPreset) {
  console.error(`DEMO_TENANT=${demoTenant} is not in packages/api/src/simulator/demo-banks.json`);
  process.exit(1);
}
enrol(bankPresets.demobank);
if (demoTenant !== 'demobank') {
  const t = bankPreset.tenant;
  const client = enrol(bankPreset);
  Object.assign(process.env, {
    SIM_TENANT_ID: t.id,
    SIM_BANK_NAME: t.name,
    SIM_BANK_DOMAIN: t.domains[0],
    SIM_LOOKALIKE_DOMAIN: bankPreset.lookalikeDomain,
    SIM_BANK_CODE: t.bankCode ?? '',
    SIM_CLIENT_ID: client.clientId,
    SIM_CLIENT_SECRET: client.clientSecret,
  });
}
if (bankPreset.fakeCustomerCare) process.env.SIM_FAKE_CUSTOMER_CARE ||= JSON.stringify(bankPreset.fakeCustomerCare);

const WEB = process.env.WEB_DIST_DIR || 'dist';
if (!['site', 'console', 'admin', 'admin-login'].every((d) => existsSync(`${WEB}/${d}/index.html`))) {
  console.log('Building the web UIs...');
  const r = spawnSync('pnpm', ['web:build'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

const api = spawn('npx', ['tsx', 'packages/api/src/server.ts'], { stdio: 'inherit', env: process.env });
api.on('exit', (code) => process.exit(code ?? 0));

setTimeout(async () => {
  const ai = await describeAi(process.env);
  console.log(`
  Gaskiya is running
    Registry API          http://localhost:${process.env.PORT}
    Landing page          http://localhost:${process.env.PORT}/
    Bank sandbox console  http://localhost:${process.env.PORT}/console/
    Admin dashboard       http://localhost:${process.env.PORT}/admin/${process.env.ADMIN_PASSWORD ? `  (user admin, password ${process.env.ADMIN_PASSWORD})` : ''}
    ${ai.join('\n    ')}

  Mobile app (in another terminal):
    cd mobile && flutter run --dart-define=API_URL=http://${lan}:${process.env.PORT}
`);
}, 1500);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => api.kill(sig));
