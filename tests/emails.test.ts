import { describe, expect, it } from 'vitest';
import { MemoryMailer } from '../packages/api/src/channels/email.ts';
import { DEFAULT_LOGO_URL } from '../packages/api/src/emails/layout.ts';
import { activitySummaryEmail, advisoryApprovedEmail, campaignAlertEmail, registrationAlertEmail, simSwapAlertEmail, testEmail, welcomeEmail, type BuiltEmail } from '../packages/api/src/emails/templates.ts';
import type { Campaign, RegistrationAlert, Tenant } from '../packages/api/src/store/types.ts';
import { asksForSecret } from '../packages/api/src/ai/explain.ts';
import { ALICE, harness } from './helpers.ts';

const tenant: Tenant = { id: 't', name: 'Demo<script>Bank', domains: ['demobank.ng'], senderIds: [], alertEmails: ['fraud@demobank.test'] };
const campaign: Campaign = {
  id: 'cmp_1',
  tenantId: 't',
  summary: '3 customer reports of the same fake message, pointing to demobank-restore.com.',
  indicators: ['non_bank_link'],
  linkDomains: ['demobank-restore.com'],
  callbackKeyCount: 1,
  firstSeen: '2026-10-20T08:00:00Z',
  lastSeen: '2026-10-20T09:00:00Z',
  reportCount: 3,
  status: 'new',
  advisory: { text: 'Do not click <a href=x>links</a>.', status: 'approved', approvedBy: 'analyst-1', approvedAt: '2026-10-20T10:00:00Z' },
};
const metrics = { registrations: 18452, registrationsByCategory: { otp: 3 }, verifications: { confirmed: 1204 }, links: {}, callChecks: {}, openCalls: 0, reports: 2 };
const domainAlert: RegistrationAlert = {
  id: 'ral_1',
  tenantId: 't',
  kind: 'unknown_link_domain',
  domain: 'demobank-<b>restore.com',
  category: 'security_notice',
  channel: 'sms',
  clientId: 'demobank-notify',
  count: 1,
  expected: null,
  windowMinutes: null,
  firstSeen: '2026-10-20T08:00:00Z',
  lastSeen: '2026-10-20T08:00:00Z',
};
const spikeAlert: RegistrationAlert = { ...domainAlert, id: 'ral_2', kind: 'volume_spike', domain: null, category: null, channel: null, count: 4210, expected: 310.5, windowMinutes: 5 };
const all = (o = {}): BuiltEmail[] => [
  welcomeEmail(tenant, o),
  campaignAlertEmail(tenant, campaign, 'new', o),
  campaignAlertEmail(tenant, campaign, 'growing', o),
  advisoryApprovedEmail(tenant, campaign, o),
  registrationAlertEmail(tenant, domainAlert, o),
  registrationAlertEmail(tenant, spikeAlert, o),
  simSwapAlertEmail(tenant, { reference: '3f9a1c7e5b2d8a40', latestSimChange: '2026-10-20T07:15:00Z' }, o),
  activitySummaryEmail(tenant, metrics, [campaign], o),
  testEmail(tenant, o),
];

describe('email templates', () => {
  it('every template has a subject, HTML and a plain-text part, with the PNG logo', () => {
    const emails = all({ consoleUrl: 'https://console.example' });
    expect(new Set(emails.map((e) => e.template)).size).toBe(8);
    for (const e of emails) {
      expect(e.subject.length, e.template).toBeGreaterThan(5);
      expect(e.html).toMatch(/^<!doctype html>/);
      expect(e.html).toContain(`src="${DEFAULT_LOGO_URL}"`);
      expect(DEFAULT_LOGO_URL).toMatch(/\.png$/);
      expect(e.html).toContain('alt="Gaskiya"');
      expect(e.text.length).toBeGreaterThan(80);
      expect(e.html).toContain('name="color-scheme"');
    }
  });

  it('escapes everything it renders', () => {
    for (const e of all()) {
      expect(e.html, e.template).not.toContain('<script>');
      expect(e.html).not.toContain('<a href=x>');
    }
    expect(advisoryApprovedEmail(tenant, campaign).html).toContain('&lt;a href=x&gt;');
    expect(registrationAlertEmail(tenant, domainAlert).html).not.toContain('<b>restore');
  });

  it('formats numbers for readers and uses Lagos time', () => {
    const e = activitySummaryEmail(tenant, metrics, [], { now: new Date('2026-10-20T12:02:00Z') });
    expect(e.html).toContain('18,452');
    expect(e.subject).toContain('18,452');
    expect(e.html).toContain('20 Oct 2026, 13:02 WAT');
  });

  it('links to the console when it is configured, and uses an override logo', () => {
    expect(welcomeEmail(tenant, { consoleUrl: 'https://console.example' }).html).toContain('href="https://console.example"');
    expect(welcomeEmail(tenant).html).not.toContain('href=');
    expect(testEmail(tenant, { logoUrl: 'https://cdn.example/logo.png' }).html).toContain('src="https://cdn.example/logo.png"');
  });

  it('never asks for secrets (SEC-5)', () => {
    for (const e of all()) {
      for (const sentence of e.text.split('\n')) expect(asksForSecret(sentence), sentence).toBe(false);
    }
  });

  it('F24: the footer does not overstate what is stored: consented reports are kept, masked', () => {
    for (const e of all()) {
      for (const part of [e.text, e.html]) {
        expect(part).not.toContain('never stores message text');
        expect(part).toContain('customer fraud reports, sent with consent, are kept masked');
      }
    }
  });
});

describe('email routes', () => {
  it('welcome goes to the bank alertEmails by default, or to given addresses', async () => {
    const mailer = new MemoryMailer();
    const h = await harness({ mailer, alertEmails: ['fraud@demobank.test'] });
    const auth = { authorization: `Bearer ${h.bankToken}` };
    const a = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/welcome', headers: auth, payload: {} });
    expect(a.json()).toMatchObject({ ok: true, to: ['fraud@demobank.test'] });
    const b = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/welcome', headers: auth, payload: { emails: ['new.analyst@demobank.test'] } });
    expect(b.json().to).toEqual(['new.analyst@demobank.test']);
    expect(mailer.sent.map((m) => m.subject)).toEqual(['Welcome to Gaskiya, DemoBank', 'Welcome to Gaskiya, DemoBank']);
    expect(mailer.sent[0]!.tags).toEqual([{ name: 'type', value: 'welcome' }]);
    const bad = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/welcome', headers: auth, payload: { emails: ['not-an-email'] } });
    expect(bad.statusCode).toBe(400);
  });

  it('approving an advisory emails the approval record; a mail failure never blocks it', async () => {
    const mailer = new MemoryMailer();
    const h = await harness({ mailer, alertEmails: ['fraud@demobank.test'] });
    const customer = { authorization: `Bearer ${await h.customerToken(ALICE)}` };
    const bank = { authorization: `Bearer ${h.bankToken}` };
    for (let i = 0; i < 3; i++) await h.sys.app.inject({ method: 'POST', url: '/v1/reports', headers: customer, payload: { maskedText: `Restore at https://demobank-restore.com/${i}`, consent: true } });
    await h.sys.app.inject({ method: 'POST', url: '/v1/agent/run', headers: bank });
    const [c] = (await h.sys.app.inject({ method: 'GET', url: '/v1/campaigns', headers: bank })).json().campaigns;
    mailer.sent = [];
    mailer.failing = true;
    const failed = await h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c.id}/approve`, headers: bank, payload: { analyst: 'Aisha Bello' } });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().advisory.status).toBe('approved');
    mailer.failing = false;
    await h.sys.app.inject({ method: 'POST', url: `/v1/campaigns/${c.id}/approve`, headers: bank, payload: { analyst: 'Aisha Bello' } });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toBe('Advisory approved: demobank-restore.com');
    expect(mailer.sent[0]!.idempotencyKey).toBe(`advisory-approved/demobank/${c.id}`);
  });

  it('the activity summary is sent on request', async () => {
    const mailer = new MemoryMailer();
    const h = await harness({ mailer, alertEmails: ['ops@demobank.test'] });
    await h.register(ALICE, 'hello');
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/summary', headers: { authorization: `Bearer ${h.bankToken}` } });
    expect(r.json()).toMatchObject({ ok: true, to: ['ops@demobank.test'] });
    expect(mailer.sent[0]!.subject).toBe('DemoBank on Gaskiya: 1 registered, 0 checks');
  });

  it('reports clearly when email is off', async () => {
    const h = await harness({ mailer: null });
    const r = await h.sys.app.inject({ method: 'POST', url: '/v1/notifications/welcome', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { emails: ['a@b.test'] } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain('Email is off');
  });
});
