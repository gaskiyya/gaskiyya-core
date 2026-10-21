import { existsSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { Resend } from 'resend';
import { FcmPush } from '../packages/api/src/channels/fcm.ts';
import { testEmail } from '../packages/api/src/emails/templates.ts';
import { configFromEnv, FirestoreStore, GeminiProvider, OpenAIProvider } from '../packages/api/src/index.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const args = process.argv.slice(2);
const sendEmail = args.includes('--email');
const pushToken = args.includes('--push') ? args[args.indexOf('--push') + 1] : undefined;

let failures = 0;
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

console.log('\nGaskiya server check\n');
let cfg: ReturnType<typeof configFromEnv>;
try {
  cfg = configFromEnv(env);
  ok('Configuration', `${cfg.tenants.length} bank(s): ${cfg.integrations.tenants.join(', ')}`);
} catch (e) {
  bad('Configuration', `\n${(e as Error).message}`);
  process.exitCode = 1;
  throw new Error('fix the configuration above, then run pnpm check:server again', { cause: e });
}

console.log('\nStorage');
if (cfg.store instanceof FirestoreStore) {
  const db = cfg.store.db;
  await check(`Firestore read and write`, async () => {
    const ref = db.collection(`${env.FIRESTORE_COLLECTION_PREFIX || 'gaskiya'}_stats`).doc('_check_server');
    const t0 = Date.now();
    await ref.set({ at: new Date().toISOString() });
    const snap = await ref.get();
    await ref.delete();
    if (!snap.exists) throw new Error('wrote a document but could not read it back');
    return `${cfg.integrations.store}; round trip ${Date.now() - t0} ms`;
  });
} else skip('Storage', cfg.integrations.store);

console.log('\nBanks');
for (const t of cfg.tenants) {
  if (t.tokenKeysUrl) {
    await check(`${t.id}: customer token keys`, async () => {
      const r = await fetch(t.tokenKeysUrl!, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`${t.tokenKeysUrl} returned ${r.status}`);
      const keys = ((await r.json()) as { keys?: unknown[] }).keys ?? [];
      if (!keys.length) throw new Error(`${t.tokenKeysUrl} lists no keys`);
      return `${keys.length} key(s) at ${t.tokenKeysUrl}`;
    });
  }
}

console.log('\nAI');
if (cfg.model instanceof GeminiProvider) {
  const m = cfg.model;
  await check(`Gemini key and model ${m.model}`, async () => {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
    await ai.models.get({ model: m.model });
    await ai.models.get({ model: m.embeddingModel });
    return `embeddings: ${m.embeddingModel}`;
  });
} else if (cfg.model instanceof OpenAIProvider) {
  const m = cfg.model;
  await check(`OpenAI key and model ${m.model}`, async () => {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });
    await client.models.retrieve(m.model);
    await client.models.retrieve(m.embeddingModel);
    return `embeddings: ${m.embeddingModel}`;
  });
} else skip('AI', cfg.integrations.ai);

console.log('\nPush');
if (cfg.push instanceof FcmPush) {
  const p = cfg.push;
  await check('Firebase service account', async () => {
    await p.accessToken();
    return `access token minted for project ${p.projectId}`;
  });
  if (pushToken) {
    await check('Test call notice delivered to FCM', async () => {
      await p.send(pushToken, {
        type: 'call.opened',
        callId: 'call_doctor',
        bank: cfg.tenants[0]!.name,
        purpose: 'service_follow_up',
        code: '0000',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      return 'check the phone for "is calling you now" with code 0000';
    });
  } else skip('Test push', 'pass --push <device-token> to send one');
} else skip('Push', cfg.integrations.push);

console.log('\nEmail');
if (cfg.mailer) {
  const resend = new Resend(env.RESEND_API_KEY);
  const fromDomain = (env.EMAIL_FROM!.match(/@([^>\s]+)/)?.[1] ?? '').toLowerCase();
  await check(`Resend key and sending domain ${fromDomain}`, async () => {
    const { data, error } = await resend.domains.list();
    if (error) throw new Error(`Resend: ${error.message}`);
    const d = data?.data.find((x) => x.name.toLowerCase() === fromDomain);
    if (!d) throw new Error(`${fromDomain} is not added in Resend (Domains). Add it and its DNS records.`);
    if (d.status !== 'verified') throw new Error(`${fromDomain} is ${d.status} in Resend; finish DNS verification`);
    return 'domain verified';
  });
  for (const t of cfg.tenants) {
    if (!t.alertEmails?.length) skip(`${t.id}: campaign alerts`, 'no alertEmails on this tenant');
    else if (sendEmail) {
      await check(`${t.id}: test email to ${t.alertEmails.join(', ')}`, async () => {
        const mail = testEmail(t, { logoUrl: env.EMAIL_LOGO_URL || undefined });
        const r = await cfg.mailer!.send({ to: t.alertEmails!, subject: mail.subject, html: mail.html, text: mail.text, tags: [{ name: 'type', value: 'test' }] });
        return `Resend id ${r.id}`;
      });
    } else ok(`${t.id}: campaign alerts`, `to ${t.alertEmails.join(', ')} (pass --email to send a test)`);
  }
} else skip('Email', 'off: set RESEND_API_KEY and EMAIL_FROM');

console.log('\nWhatsApp');
if (cfg.whatsapp && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
  await check('WhatsApp Business number', async () => {
    const r = await fetch(`https://graph.facebook.com/v23.0/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`, {
      headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Graph API returned ${r.status}`);
    const j = (await r.json()) as { display_phone_number?: string; verified_name?: string };
    return `${j.verified_name ?? ''} ${j.display_phone_number ?? ''}`.trim();
  });
} else skip('WhatsApp', 'off');

console.log('\nUSSD');
if (cfg.ussd) {
  ok('USSD callback', `${cfg.integrations.ussd}; point Africa's Talking at https://<host>/webhooks/ussd?token=<USSD_WEBHOOK_TOKEN>`);
} else skip('USSD', 'off: set USSD_WEBHOOK_TOKEN');

console.log('\nLicence lists');
await check('Licence lists load and are fresh', async () => {
  const index = await cfg.licences.snapshot();
  const now = Date.now();
  const stale = index.sources.filter((s) => now - Date.parse(s.retrievedAt) > cfg.licenceMaxAgeDays * 24 * 3600_000);
  if (stale.length) throw new Error(`older than ${cfg.licenceMaxAgeDays} days, so licence answers are "cannot check": ${stale.map((s) => `${s.id} (${s.retrievedAt})`).join(', ')}. Run pnpm licences:import`);
  return `${cfg.licenceSummary}; ${index.sources.length} lists, ${[...index.entryCount.values()].reduce((a, b) => a + b, 0)} entries`;
});
console.log('\nSIM swap');
if (cfg.simSwap && env.SIM_SWAP_PROVIDER === 'camara') {
  await check('CAMARA SIM Swap token', async () => {
    const basic = Buffer.from(`${encodeURIComponent(env.SIM_SWAP_CLIENT_ID ?? '')}:${encodeURIComponent(env.SIM_SWAP_CLIENT_SECRET ?? '')}`).toString('base64');
    const r = await fetch(env.SIM_SWAP_TOKEN_URL!, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: env.SIM_SWAP_SCOPE || 'sim-swap:check sim-swap:retrieve-date' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`token endpoint returned ${r.status}`);
    return cfg.integrations.simSwap;
  });
} else if (cfg.simSwap) {
  ok('SIM swap', cfg.integrations.simSwap);
} else skip('SIM swap', 'off: set SIM_SWAP_PROVIDER=camara (decision 0017)');

console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n` : '\n\x1b[32mAll checks passed.\x1b[0m\n');
process.exitCode = failures ? 1 : 0;
