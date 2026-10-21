import { existsSync } from 'node:fs';
import { buildSystemFromEnv } from '../packages/api/src/index.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
process.env.LOG_LEVEL ||= 'warn';

let system: ReturnType<typeof buildSystemFromEnv>;
try {
  system = buildSystemFromEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

try {
  const { results, emails } = await system.runAgent();
  for (const r of results) console.log(`${r.tenantId}: ${r.campaignsTouched.length} campaign(s) updated, ${r.reportsAssigned} report(s) assigned`);
  console.log(`fraud-desk alert emails: ${emails.sent} sent, ${emails.failed} failed`);
  await system.app.close();
  process.exit(0);
} catch (err) {
  console.error(`campaign agent failed: ${(err as Error).message}`);
  process.exit(1);
}
