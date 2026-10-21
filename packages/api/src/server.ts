import { OllamaProvider, systemFromEnv } from './index.ts';
import { demoLoginFromEnv, registerSimulator, simOrgsFromEnv } from './simulator/index.ts';
import { registerWeb } from './web.ts';

let system: ReturnType<typeof systemFromEnv>;
try {
  system = systemFromEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const { app, integrations, licenceSummary, adminSummary } = system;
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

if (process.env.SIM_ENABLED === 'true') {
  const required = (name: string) => {
    const v = process.env[name];
    if (!v) {
      console.error(`${name} is required when SIM_ENABLED=true (see .env.example)`);
      process.exit(1);
    }
    return v;
  };
  const sim = {
    apiUrl: process.env.SIM_API_URL || `http://127.0.0.1:${port}`,
    clientId: required('SIM_CLIENT_ID'),
    clientSecret: required('SIM_CLIENT_SECRET'),
    tenantId: process.env.SIM_TENANT_ID || 'demobank',
    bankName: process.env.SIM_BANK_NAME || 'DemoBank',
    domain: process.env.SIM_BANK_DOMAIN || undefined,
    lookalikeDomain: process.env.SIM_LOOKALIKE_DOMAIN || undefined,
    demoLogin: demoLoginFromEnv(),
    ussdToken: process.env.USSD_WEBHOOK_TOKEN || undefined,
    ...simOrgsFromEnv(),
    bankCode: process.env.SIM_BANK_CODE || undefined,
  };
  await app.register(async (scope) => {
    await registerSimulator(scope, sim);
  });
}

const web = await registerWeb(app, { dir: process.env.WEB_DIST_DIR || undefined, console: process.env.SIM_ENABLED === 'true', admin: system.adminAuth ?? null });

system.store
  .ping()
  .then(() => app.listen({ port, host }))
  .then(() => {
    const agent = system.settings.agentInProcess ? `in-process every ${system.settings.agentIntervalSeconds}s` : 'scheduled job only';
    app.log.info({ integrations, licences: licenceSummary, admin: adminSummary + (system.adminAuth && !web.admin ? ' (admin UI files absent from WEB_DIST_DIR)' : ''), web, agent, simulator: process.env.SIM_ENABLED === 'true' }, 'Gaskiya registry ready');
    return warnIfOllamaUnready();
  }).catch((err: Error) => {
  app.log.error({ err: { message: err.message } }, 'failed to start');
  process.exit(1);
});

async function warnIfOllamaUnready() {
  const uses = new Map<OllamaProvider, string>();
  if (system.model instanceof OllamaProvider) uses.set(system.model, 'explanations use the fixed fallback text');
  if (system.agentModel instanceof OllamaProvider && !uses.has(system.agentModel)) uses.set(system.agentModel, 'the campaign agent writes template briefings');
  for (const [model, use] of uses) {
    const s = await model.status();
    if (!s.reachable) app.log.warn({ ollama: model.url }, `Ollama is not reachable: ${use} until it is`);
    else if (s.missing.length) app.log.warn({ missing: s.missing }, `Ollama models not pulled yet: run ${s.missing.map((m) => `ollama pull ${m}`).join(' && ')}`);
    else void model.warm();
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
