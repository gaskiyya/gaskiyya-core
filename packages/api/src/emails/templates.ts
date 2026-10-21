import type { Campaign, RegistrationAlert, Tenant } from '../store/types.ts';
import { renderEmail, type Block, type EmailContent } from './layout.ts';

export type TemplateName = 'welcome' | 'campaign_new' | 'campaign_growing' | 'advisory_approved' | 'registration_alert' | 'sim_swap_alert' | 'activity_summary' | 'test';

export interface EmailOptions {
  consoleUrl?: string;
  logoUrl?: string;
  now?: Date;
}

export interface BuiltEmail {
  template: TemplateName;
  subject: string;
  html: string;
  text: string;
}

const INDICATOR_TEXT: Record<string, string> = {
  urgency_or_threat: 'Urgency or threat',
  credential_request: 'Asks for login details',
  non_bank_link: 'Link to a non-bank site',
  callback_number: 'Asks the customer to call a number',
  reward_or_refund: 'Promises a reward or refund',
};

const CATEGORY_TEXT: Record<string, string> = {
  otp: 'One-time codes',
  transaction_alert: 'Transaction alerts',
  security_notice: 'Security notices',
  service_update: 'Service updates',
  marketing: 'Promotions',
  call_follow_up: 'Call follow-ups',
};

export function lagosTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  return `${date}, ${time} WAT`;
}

function build(template: TemplateName, subject: string, content: EmailContent, o: EmailOptions): BuiltEmail {
  return { template, subject, ...renderEmail(content, o.logoUrl) };
}

const fmtN = (n: number) => n.toLocaleString('en-NG');

const consoleCta = (o: EmailOptions, label: string) => (o.consoleUrl ? { label, url: o.consoleUrl } : undefined);

export function welcomeEmail(tenant: Tenant, o: EmailOptions = {}): BuiltEmail {
  return build(
    'welcome',
    `Welcome to Gaskiya, ${tenant.name}`,
    {
      preheader: `Your team can now see scam campaigns targeting ${tenant.name} customers as they emerge.`,
      eyebrow: 'Welcome',
      title: `Welcome to Gaskiya, ${tenant.name}`,
      intro: `Your customers can now check whether a message or call really came from ${tenant.name}, and this address will hear about scam campaigns as soon as customers report them.`,
      blocks: [
        { kind: 'paragraph', text: 'Here is what this address will receive:' },
        {
          kind: 'list',
          items: [
            { title: 'Scam campaign alerts', meta: 'When reports from customers point to the same fake message, link or number' },
            { title: 'Advisory approvals', meta: 'A record each time an analyst approves a customer warning' },
            { title: 'Activity summaries', meta: 'Messages registered, customer checks and reports, on request' },
          ],
        },
        { kind: 'paragraph', text: 'To get the most from Gaskiya:' },
        {
          kind: 'steps',
          items: [
            { title: 'Register every outgoing message', text: 'One call from your notification service before each SMS. Coverage matters: an unregistered genuine message shows as not confirmed.' },
            { title: 'Announce outbound calls', text: 'Your dialler opens a session and the agent reads the four-digit code to the customer.' },
            { title: 'Review campaigns in the console', text: 'Approve or dismiss each drafted advisory. Nothing reaches customers without an analyst.' },
          ],
        },
        { kind: 'note', text: `Registered domains for ${tenant.name}: ${tenant.domains.join(', ')}. Links on any other domain are never confirmed.` },
      ],
      cta: consoleCta(o, 'Open the Gaskiya console'),
      reason: `You are receiving this because this address was added to ${tenant.name}'s Gaskiya alerts.`,
    },
    o,
  );
}

function campaignBlocks(c: Campaign): Block[] {
  const indicators = c.indicators.map((i) => INDICATOR_TEXT[i] ?? i);
  const blocks: Block[] = [
    {
      kind: 'stats',
      items: [
        { label: 'Customer reports', value: c.reportCount, tone: 'warning' },
        { label: 'Domains used', value: c.linkDomains.length },
        { label: 'Callback numbers', value: c.callbackKeyCount },
      ],
    },
  ];
  if (indicators.length) blocks.push({ kind: 'chips', items: indicators, tone: 'danger' });
  blocks.push({
    kind: 'facts',
    rows: [
      ['First seen', lagosTime(c.firstSeen)],
      ['Last seen', lagosTime(c.lastSeen)],
      ...(c.linkDomains.length ? ([['Fake domains', c.linkDomains.join(', ')]] as [string, string][]) : []),
    ],
  });
  blocks.push({ kind: 'quote', label: 'Draft advisory', status: c.advisory.status === 'approved' ? 'Approved' : c.advisory.status === 'withdrawn' ? 'Withdrawn' : 'Awaiting approval', text: c.advisory.text || 'Being drafted.' });
  return blocks;
}

export function campaignAlertEmail(tenant: Tenant, c: Campaign, kind: 'new' | 'growing', o: EmailOptions = {}): BuiltEmail {
  const isNew = kind === 'new';
  const subject = isNew ? `New scam campaign: ${c.reportCount} customer reports` : `Scam campaign growing: now ${c.reportCount} customer reports`;
  return build(
    isNew ? 'campaign_new' : 'campaign_growing',
    subject,
    {
      preheader: c.summary,
      eyebrow: `${tenant.name} fraud desk`,
      badge: isNew ? { text: 'New', tone: 'warning' } : { text: 'Growing', tone: 'danger' },
      title: isNew ? 'A new scam campaign is targeting your customers' : 'A scam campaign is spreading',
      intro: c.summary,
      blocks: [...campaignBlocks(c), { kind: 'note', tone: 'neutral', text: 'Nothing has been sent to customers. Review the advisory and approve it, edit it or dismiss the campaign in the console.' }],
      cta: consoleCta(o, 'Review in the fraud desk'),
      reason: `You are receiving this because you are on ${tenant.name}'s Gaskiya fraud alerts.`,
    },
    o,
  );
}

export function advisoryApprovedEmail(tenant: Tenant, c: Campaign, o: EmailOptions = {}): BuiltEmail {
  return build(
    'advisory_approved',
    `Advisory approved: ${c.linkDomains[0] ?? `${c.reportCount}-report campaign`}`,
    {
      preheader: `Approved by ${c.advisory.approvedBy ?? 'an analyst'}. Publish it through ${tenant.name}'s customer channels.`,
      eyebrow: `${tenant.name} fraud desk`,
      badge: { text: 'Approved', tone: 'brand' },
      title: 'A customer advisory was approved',
      intro: `${c.advisory.approvedBy ?? 'An analyst'} approved the advisory for this campaign${c.advisory.approvedAt ? ` on ${lagosTime(c.advisory.approvedAt)}` : ''}. It is ready to publish through your own customer channels.`,
      blocks: [
        { kind: 'quote', label: 'Approved advisory', text: c.advisory.text },
        { kind: 'list', title: 'Campaign', items: [{ title: c.summary, meta: `${c.reportCount.toLocaleString('en-NG')} customer reports \u00b7 approved by ${c.advisory.approvedBy ?? 'an analyst'}` }] },
        { kind: 'note', tone: 'neutral', text: 'Gaskiya does not send advisories to customers. This email is your record of the approval.' },
      ],
      cta: consoleCta(o, 'View the campaign'),
      reason: `You are receiving this because you are on ${tenant.name}'s Gaskiya fraud alerts.`,
    },
    o,
  );
}

const CHANNEL_TEXT: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email', push: 'Push' };

export function registrationAlertEmail(tenant: Tenant, a: RegistrationAlert, o: EmailOptions = {}): BuiltEmail {
  const domain = a.kind === 'unknown_link_domain';
  const subject = domain
    ? `Registration alert: a message linking to ${a.domain ?? 'an unknown domain'}`
    : `Registration alert: ${fmtN(a.count)} messages registered in ${a.windowMinutes ?? 0} minutes`;
  const facts: [string, string][] = domain
    ? [
        ['Link domain', a.domain ?? ''],
        ['Your registered domains', tenant.domains.join(', ')],
        ...(a.category ? ([['Message type', CATEGORY_TEXT[a.category] ?? a.category]] as [string, string][]) : []),
        ...(a.channel ? ([['Channel', CHANNEL_TEXT[a.channel] ?? a.channel]] as [string, string][]) : []),
      ]
    : [
        [`Registered in the last ${a.windowMinutes ?? 0} minutes`, fmtN(a.count)],
        ['Expected from the trailing rate', fmtN(a.expected ?? 0)],
      ];
  facts.push(['Bank client', a.clientId ?? 'unknown'], ['First seen', lagosTime(a.firstSeen)]);
  return build(
    'registration_alert',
    subject,
    {
      preheader: domain
        ? `A message registered as genuine links to ${a.domain}, which is not one of ${tenant.name}'s domains.`
        : `Registration volume is well above its recent rate.`,
      eyebrow: `${tenant.name} registry`,
      badge: { text: 'Check', tone: 'warning' },
      title: domain ? 'A registered message links outside your domains' : 'Registration volume jumped',
      intro: domain
        ? `Your systems registered a message that links to ${a.domain}. Customers who check it will see it confirmed as sent by ${tenant.name}. If this is a partner or a new domain of yours, add it to your registered domains; if not, a bank client credential may be in the wrong hands.`
        : `Your systems registered ${fmtN(a.count)} messages in ${a.windowMinutes ?? 0} minutes, against about ${fmtN(a.expected ?? 0)} expected from the recent rate. If no campaign or batch job explains it, a bank client credential may be in the wrong hands.`,
      blocks: [
        { kind: 'facts', rows: facts },
        {
          kind: 'steps',
          items: [
            { title: 'Confirm the source', text: 'Check with the team that owns the notification service that this traffic is theirs.' },
            { title: 'If it is not', text: 'Revoke the bank client named above and issue a new one. Records it registered expire on their own.' },
          ],
        },
        { kind: 'note', tone: 'neutral', text: 'The registration was not blocked. Gaskiya never sees message text, only the declared link domains and counts.' },
      ],
      cta: consoleCta(o, 'Review in the console'),
      reason: `You are receiving this because you are on ${tenant.name}'s Gaskiya alerts.`,
    },
    o,
  );
}

export interface ActivityMetrics {
  registrations: number;
  registrationsByCategory: Record<string, number>;
  verifications: Record<string, number>;
  links: Record<string, number>;
  callChecks: Record<string, number>;
  openCalls: number;
  reports: number;
}

export function activitySummaryEmail(tenant: Tenant, m: ActivityMetrics, campaigns: Campaign[], o: EmailOptions = {}): BuiltEmail {
  const checks = (m.verifications.confirmed ?? 0) + (m.verifications.not_confirmed ?? 0) + (m.verifications.cannot_check ?? 0);
  const active = campaigns.filter((c) => c.status !== 'dismissed');
  const byType = Object.entries(m.registrationsByCategory).sort((a, b) => b[1] - a[1]);
  const blocks: Block[] = [
    {
      kind: 'stats',
      items: [
        { label: 'Messages registered', value: m.registrations, tone: 'brand' },
        { label: 'Customer checks', value: checks },
        { label: 'Reports', value: m.reports, tone: m.reports ? 'warning' : undefined },
      ],
    },
    {
      kind: 'facts',
      rows: [
        ['Confirmed', fmtN(m.verifications.confirmed ?? 0)],
        ['Not confirmed', fmtN(m.verifications.not_confirmed ?? 0)],
        ['Could not check', fmtN(m.verifications.cannot_check ?? 0)],
        ['Links checked', fmtN(Object.values(m.links).reduce((a, b) => a + b, 0))],
        ['"Is my bank calling?" checks', fmtN(Object.values(m.callChecks).reduce((a, b) => a + b, 0))],
      ],
    },
  ];
  if (byType.length) blocks.push({ kind: 'list', title: 'Registered by type', items: byType.map(([k, n]) => ({ title: CATEGORY_TEXT[k] ?? k, meta: `${fmtN(n)} registered` })) });
  blocks.push(
    active.length
      ? { kind: 'list', title: 'Active scam campaigns', items: active.slice(0, 5).map((c) => ({ title: c.summary, meta: `${c.reportCount} reports \u00B7 advisory ${c.advisory.status === 'draft' ? 'awaiting approval' : c.advisory.status}` })) }
      : { kind: 'note', text: 'No active scam campaigns right now.' },
  );
  if ((m.verifications.cannot_check ?? 0) > 0) {
    blocks.push({ kind: 'note', tone: 'warning', text: 'Some checks could not be completed. If this persists, check the registry\u2019s availability.' });
  }
  return build(
    'activity_summary',
    `${tenant.name} on Gaskiya: ${fmtN(m.registrations)} registered, ${fmtN(checks)} checks`,
    {
      preheader: `${fmtN(checks)} customer checks and ${active.length} active campaign${active.length === 1 ? '' : 's'}.`,
      eyebrow: 'Activity summary',
      title: `How ${tenant.name}'s customers used Gaskiya`,
      intro: `Totals as of ${lagosTime(o.now ?? new Date())}. Counts only: Gaskiya never sees message text.`,
      blocks,
      cta: consoleCta(o, 'Open the console'),
      reason: `You are receiving this because you are on ${tenant.name}'s Gaskiya alerts.`,
    },
    o,
  );
}

export interface SimSwapNotice {
  reference: string;
  latestSimChange: string | null;
}

export function simSwapAlertEmail(tenant: Tenant, n: SimSwapNotice, o: EmailOptions = {}): BuiltEmail {
  const when = n.latestSimChange ? lagosTime(n.latestSimChange) : 'not given by the network';
  return build(
    'sim_swap_alert',
    `SIM swap: a customer's number moved to a new SIM`,
    {
      preheader: `A ${tenant.name} customer checked a message from a number whose SIM changed recently.`,
      eyebrow: `${tenant.name} SIM swap`,
      badge: { text: 'Check', tone: 'warning' },
      title: 'A checking number changed SIM recently',
      intro: `A customer checked a message or call with Gaskiya, and the mobile network reports that their number moved to a new SIM recently. Whoever holds the new SIM receives this customer's one-time codes. If the customer did not change SIM themselves, their account may be at risk.`,
      blocks: [
        { kind: 'facts', rows: [['Customer reference', n.reference], ['SIM changed', when], ['Reported', lagosTime(o.now ?? new Date())]] },
        {
          kind: 'steps',
          items: [
            { title: 'Hold one-time codes', text: 'Before sending a code or approving a large transfer to this customer, ask POST /v1/sim-swap/check and hold it if the SIM changed.' },
            { title: 'Reach the customer another way', text: 'Contact them through a channel that does not depend on the SIM, such as a branch or the email address on file.' },
          ],
        },
        { kind: 'note', tone: 'neutral', text: 'The reference is a keyed hash of the number; Gaskiya never sends phone numbers by email. Nothing was blocked and the customer\'s verdict was not changed.' },
      ],
      cta: consoleCta(o, 'Open the console'),
      reason: `You are receiving this because you are on ${tenant.name}'s Gaskiya alerts.`,
    },
    o,
  );
}

export function testEmail(tenant: Tenant, o: EmailOptions = {}): BuiltEmail {
  return build(
    'test',
    `Gaskiya test email for ${tenant.name}`,
    {
      preheader: 'Email delivery from the Gaskiya registry is working.',
      eyebrow: 'Test',
      badge: { text: 'Delivered', tone: 'brand' },
      title: 'Email delivery is working',
      intro: `This is a test from the Gaskiya registry. Campaign alerts and other emails for ${tenant.name} will arrive at this address.`,
      blocks: [{ kind: 'facts', rows: [['Bank', tenant.name], ['Sent', lagosTime(o.now ?? new Date())]] }],
      reason: `You are receiving this because someone ran an email test for ${tenant.name}'s Gaskiya alerts.`,
    },
    o,
  );
}
