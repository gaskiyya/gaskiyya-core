import { mkdirSync, writeFileSync } from 'node:fs';
import type { Campaign, RegistrationAlert, Tenant } from '../packages/api/src/store/types.ts';
import { activitySummaryEmail, advisoryApprovedEmail, campaignAlertEmail, registrationAlertEmail, simSwapAlertEmail, testEmail, welcomeEmail, type BuiltEmail } from '../packages/api/src/emails/templates.ts';

const args = process.argv.slice(2);
const logoUrl = args.includes('--logo') ? args[args.indexOf('--logo') + 1] : undefined;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1]! : 'docs/emails';
const now = new Date('2026-10-20T12:02:00Z');
const o = { consoleUrl: 'https://console.gaskiya.ng', logoUrl, now };

const tenant: Tenant = { id: 'demobank', name: 'DemoBank', domains: ['demobank.ng', 'demobank.com'], senderIds: ['DemoBank'], alertEmails: ['fraud@demobank.ng'] };
const campaign: Campaign = {
  id: 'cmp_sample',
  tenantId: 'demobank',
  summary: '3 customer reports of the same fake message, pointing to demobank-restore.com. Uses links to non-bank sites, urgent threats.',
  indicators: ['non_bank_link', 'urgency_or_threat', 'credential_request'],
  linkDomains: ['demobank-restore.com'],
  callbackKeyCount: 1,
  firstSeen: '2026-10-20T08:14:00Z',
  lastSeen: '2026-10-20T11:47:00Z',
  reportCount: 3,
  status: 'new',
  advisory: {
    text: 'DemoBank is aware of fake messages linking to demobank-restore.com. We will never ask for your PIN, password, card number or one-time code. Do not click the link; check any message in the DemoBank app.',
    status: 'draft',
    approvedBy: null,
    approvedAt: null,
  },
};
const approved: Campaign = { ...campaign, status: 'confirmed', advisory: { ...campaign.advisory, status: 'approved', approvedBy: 'Aisha Bello (fraud analyst)', approvedAt: '2026-10-20T12:01:00Z' } };

const domainAlert: RegistrationAlert = {
  id: 'ral_sample',
  tenantId: 'demobank',
  kind: 'unknown_link_domain',
  domain: 'demobank-verify.com',
  category: 'security_notice',
  channel: 'sms',
  clientId: 'demobank-notify',
  count: 1,
  expected: null,
  windowMinutes: null,
  firstSeen: '2026-10-20T10:12:00Z',
  lastSeen: '2026-10-20T10:12:00Z',
};
const spikeAlert: RegistrationAlert = { ...domainAlert, id: 'ral_spike', kind: 'volume_spike', domain: null, category: null, channel: null, count: 4210, expected: 310.5, windowMinutes: 5 };

const emails: BuiltEmail[] = [
  welcomeEmail(tenant, o),
  campaignAlertEmail(tenant, campaign, 'new', o),
  campaignAlertEmail(tenant, { ...campaign, summary: '9 customer reports of the same fake message, pointing to demobank-restore.com, sharing 2 callback numbers. Uses links to non-bank sites, urgent threats.', reportCount: 9, callbackKeyCount: 2, lastSeen: '2026-10-20T15:30:00Z' }, 'growing', o),
  advisoryApprovedEmail(tenant, approved, o),
  registrationAlertEmail(tenant, domainAlert, o),
  registrationAlertEmail(tenant, spikeAlert, o),
  simSwapAlertEmail(tenant, { reference: '3f9a1c7e5b2d8a40', latestSimChange: '2026-10-20T07:15:00Z' }, o),
  activitySummaryEmail(
    tenant,
    {
      registrations: 18452,
      registrationsByCategory: { transaction_alert: 14210, otp: 3120, security_notice: 822, service_update: 300 },
      verifications: { confirmed: 1204, not_confirmed: 311, cannot_check: 2 },
      links: { belongs: 88, not_confirmed: 146 },
      callChecks: { calling: 61, not_calling: 23 },
      openCalls: 2,
      reports: 47,
    },
    [approved, { ...campaign, id: 'cmp_2', summary: '4 customer reports of the same fake message, sharing one callback number. Uses promised rewards or refunds.', linkDomains: [], reportCount: 4 }],
    o,
  ),
  testEmail(tenant, o),
];

mkdirSync(out, { recursive: true });
const index: string[] = [];
emails.forEach((e, i) => {
  const file = `${String(i + 1).padStart(2, '0')}_${e.template}`;
  writeFileSync(`${out}/${file}.html`, e.html);
  writeFileSync(`${out}/${file}.txt`, `Subject: ${e.subject}\n\n${e.text}\n`);
  index.push(`- [${e.subject}](${file}.html) (\`${e.template}\`)`);
});
writeFileSync(`${out}/README.md`, `# Email templates\n\nRendered by \`pnpm emails:preview\` with sample data. Templates: \`packages/api/src/emails/\`.\n\n${index.join('\n')}\n`);
console.log(`wrote ${emails.length} emails to ${out}/`);
