import { describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { MemoryMailer } from '../packages/api/src/channels/email.ts';
import { bankDomain, DEFAULT_GUARD, isSpike } from '../packages/api/src/guard.ts';
import { MemoryStore } from '../packages/api/src/index.ts';
import { createSandbox } from '../console/src/sandbox/backend.ts';
import { ALICE, BANK_CLIENT, BOB, harness } from './helpers.ts';

const FAKE = 'DemoBank: your account is on hold. Restore it at https://demobank-restore.com/now';
const OWN = 'DemoBank: update your app at https://app.demobank.ng/get';

describe('registration anomaly guard', () => {
  it('recognises the bank\'s own domains and their subdomains only', () => {
    expect(bankDomain('demobank.ng', ['demobank.ng'])).toBe(true);
    expect(bankDomain('app.DemoBank.ng', ['demobank.ng'])).toBe(true);
    expect(bankDomain('demobank-restore.com', ['demobank.ng'])).toBe(false);
    expect(bankDomain('demobank.ng.evil.com', ['demobank.ng'])).toBe(false);
    expect(bankDomain('xdemobank.ng', ['demobank.ng'])).toBe(false);
  });

  it('a spike needs both the minimum count and K times the trailing rate', () => {
    const cfg = { ...DEFAULT_GUARD, spikeWindowMinutes: 5, spikeBaselineMinutes: 60, spikeFactor: 5, spikeMinCount: 100 };
    expect(isSpike(499, 1200, cfg)).toEqual({ spike: false, expected: 100 });
    expect(isSpike(501, 1200, cfg)).toEqual({ spike: true, expected: 100 });
    expect(isSpike(99, 0, cfg).spike).toBe(false);
    expect(isSpike(100, 0, cfg).spike).toBe(true);
  });

  it('alerts on a link domain outside tenant.domains, by email, and still registers the message', async () => {
    const mailer = new MemoryMailer();
    const h = await harness({ mailer, alertEmails: ['fraud@demobank.test'] });
    const bank = { authorization: `Bearer ${h.bankToken}` };

    expect((await h.register(ALICE, OWN, { linkDomains: ['app.demobank.ng'] })).status).toBe(202);
    const r = await h.register(ALICE, FAKE, { linkDomains: ['demobank-restore.com'], category: 'security_notice' });
    expect(r.status).toBe(202);
    expect((await h.verify(ALICE, FAKE)).body.verdict).toBe('confirmed');
    await h.sys.guard.idle();

    const list = (await h.sys.app.inject({ method: 'GET', url: '/v1/registration-alerts', headers: bank })).json().alerts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'unknown_link_domain', domain: 'demobank-restore.com', category: 'security_notice', channel: 'sms', clientId: BANK_CLIENT.clientId, count: 1 });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: ['fraud@demobank.test'],
      subject: 'Registration alert: a message linking to demobank-restore.com',
      idempotencyKey: `registration-alert/demobank/${list[0].id}`,
      tags: [{ name: 'type', value: 'registration_alert' }],
    });

    await h.register(BOB, `${FAKE}?b`, { linkDomains: ['demobank-restore.com'] });
    await h.sys.guard.idle();
    const again = (await h.sys.app.inject({ method: 'GET', url: '/v1/registration-alerts', headers: bank })).json().alerts;
    expect(again).toHaveLength(1);
    expect(again[0].count).toBe(2);
    expect(mailer.sent).toHaveLength(1);

    const m = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: bank })).json();
    expect(m.registrationAlerts).toEqual({ unknown_link_domain: 1 });

    const stored = JSON.stringify(await h.sys.store.dump());
    for (const s of [FAKE, contentDigest(FAKE), ALICE, BOB]) expect(stored).not.toContain(s);
  });

  it('alerts once per window when registration volume spikes over the trailing rate', async () => {
    const mailer = new MemoryMailer();
    const h = await harness({ mailer, alertEmails: ['fraud@demobank.test'], guard: { spikeWindowMinutes: 5, spikeBaselineMinutes: 60, spikeFactor: 5, spikeMinCount: 20 } });
    const bank = { authorization: `Bearer ${h.bankToken}` };
    const batch = async (n: number, tag: string) =>
      h.sys.app.inject({
        method: 'POST',
        url: '/v1/messages/batch',
        headers: bank,
        payload: {
          messages: Array.from({ length: n }, (_, i) => ({
            recipient: ALICE,
            channel: 'sms',
            contentDigest: contentDigest(`${tag} ${i}`),
            category: 'otp',
            hasLink: false,
            sentAt: h.clock.now.toISOString(),
          })),
        },
      });

    const start = h.clock.now.getTime();
    for (let i = 0; i < 12; i++) {
      h.clock.now = new Date(start + i * 5 * 60_000);
      expect((await h.register(ALICE, `steady ${i}`)).status).toBe(202);
    }
    h.clock.now = new Date(start + 62 * 60_000);
    expect((await batch(15, 'small')).statusCode).toBe(202);
    await h.sys.guard.idle();
    expect(mailer.sent).toHaveLength(0);

    expect((await batch(30, 'burst')).statusCode).toBe(202);
    await h.sys.guard.idle();
    expect((await batch(30, 'more')).statusCode).toBe(202);
    await h.sys.guard.idle();

    const alerts = (await h.sys.app.inject({ method: 'GET', url: '/v1/registration-alerts', headers: bank })).json().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'volume_spike', count: 45, windowMinutes: 5, clientId: BANK_CLIENT.clientId });
    expect(alerts[0].expected).toBeLessThan(2);
    expect(mailer.sent.map((m) => m.subject)).toEqual(['Registration alert: 45 messages registered in 5 minutes']);

    h.clock.now = new Date(start + 68 * 60_000);
    await batch(30, 'later');
    await h.sys.guard.idle();
    expect((await h.sys.store.listAlerts('demobank'))).toHaveLength(1);
    await batch(30, 'later again');
    await h.sys.guard.idle();
    const m = (await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: bank })).json();
    expect(m.registrationAlerts).toEqual({ volume_spike: 2 });
  });

  it('an idempotent replay is not counted again', async () => {
    const h = await harness({ guard: { spikeMinCount: 2, spikeFactor: 1 } });
    for (let i = 0; i < 3; i++) await h.register(ALICE, FAKE, { idem: 'same-key', linkDomains: ['demobank-restore.com'] });
    const [alert] = await h.sys.store.listAlerts('demobank');
    expect(alert).toMatchObject({ kind: 'unknown_link_domain', count: 1 });
    expect((await h.sys.store.listAlerts('demobank')).filter((a) => a.kind === 'volume_spike')).toHaveLength(0);
  });

  it('a guard failure never fails the registration', async () => {
    const store = new MemoryStore();
    store.putAlert = async () => {
      throw new Error('alerts unavailable');
    };
    const h = await harness({ store });
    expect((await h.register(ALICE, FAKE, { linkDomains: ['demobank-restore.com'] })).status).toBe(202);
    expect((await h.verify(ALICE, FAKE)).body.verdict).toBe('confirmed');
  });

  it('a failed alert email does not fail the registration', async () => {
    const mailer = new MemoryMailer();
    mailer.failing = true;
    const h = await harness({ mailer, alertEmails: ['fraud@demobank.test'] });
    expect((await h.register(ALICE, FAKE, { linkDomains: ['demobank-restore.com'] })).status).toBe(202);
    await h.sys.guard.idle();
    expect(await h.sys.store.listAlerts('demobank')).toHaveLength(1);
  });

  it('the console lists alerts (in-browser sandbox)', async () => {
    const sb = createSandbox();
    const call = (method: string, path: string, body?: unknown) => sb.handle(method, new URL(path, 'https://x.test'), body, null) as Promise<{ status: number; body: any }>;
    await call('POST', '/sim/send', { phone: ALICE, category: 'service_update', text: 'DemoBank: see https://www.demobank.ng/app' });
    expect((await call('GET', '/sim/alerts')).body.alerts).toEqual([]);
    await call('POST', '/sim/send', { phone: ALICE, category: 'service_update', text: 'DemoBank: see https://partner-rewards.example/app' });
    const { alerts } = (await call('GET', '/sim/alerts')).body;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'unknown_link_domain', domain: 'partner-rewards.example' });
    expect((await call('GET', '/sim/metrics')).body.registrationAlerts).toEqual({ unknown_link_domain: 1 });
  });
});
