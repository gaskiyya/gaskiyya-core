import { describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { coverage } from '../packages/api/src/domain/coverage.ts';
import { createSandbox } from '../console/src/sandbox/backend.ts';
import { ALERT, ALICE, BOB, harness } from './helpers.ts';

describe('registration coverage metric', () => {
  it('is computed from counts only', () => {
    const c = coverage({
      registrations: 10,
      registrationsByChannel: { sms: 8, whatsapp: 2 },
      verifications: { confirmed: 6, not_confirmed: 3, cannot_check: 1 },
      messageChecksByChannel: { app: 9, whatsapp: 1 },
    });
    expect(c).toEqual({
      registered: 10,
      checked: 10,
      confirmed: 6,
      notConfirmed: 3,
      cannotCheck: 1,
      notConfirmedRate: 0.3,
      cannotCheckRate: 0.1,
      checksByChannel: { app: 9, whatsapp: 1 },
      registeredByChannel: { sms: 8, whatsapp: 2 },
    });
    expect(coverage({ registrations: 0, registrationsByChannel: {}, verifications: {}, messageChecksByChannel: {} })).toMatchObject({ checked: 0, notConfirmedRate: null, cannotCheckRate: null });
  });

  it('GET /v1/metrics reports registered vs verified, the not-confirmed rate and checks by channel', async () => {
    const h = await harness();
    await h.register(ALICE, ALERT);
    await h.register(BOB, 'DemoBank: your statement is ready', { channel: 'email' });
    expect((await h.verify(ALICE, ALERT)).body.verdict).toBe('confirmed');
    expect((await h.verify(ALICE, `${ALERT}!`)).body.verdict).toBe('not_confirmed');
    expect((await h.verify(BOB, ALERT)).body.verdict).toBe('not_confirmed');
    await h.sys.app.inject({ method: 'POST', url: '/v1/verify/link', headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` }, payload: { url: 'https://demobank.ng' } });

    const r = await h.sys.app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: `Bearer ${h.bankToken}` } });
    expect(r.statusCode).toBe(200);
    const m = r.json();
    expect(m.registrationsByChannel).toEqual({ sms: 1, email: 1 });
    expect(m.messageChecksByChannel).toEqual({ app: 3 });
    expect(m.coverage).toEqual({
      registered: 2,
      checked: 3,
      confirmed: 1,
      notConfirmed: 2,
      cannotCheck: 0,
      notConfirmedRate: 0.6667,
      cannotCheckRate: 0,
      checksByChannel: { app: 3 },
      registeredByChannel: { sms: 1, email: 1 },
    });
    const body = JSON.stringify(m);
    for (const secret of [ALICE, BOB, ALERT, contentDigest(ALERT)]) expect(body).not.toContain(secret);
  });

  it('the in-browser sandbox reports the same coverage', async () => {
    const sb = createSandbox();
    await sb.handle('POST', new URL('https://x.test/sim/send'), { phone: ALICE, category: 'transaction_alert' }, null);
    const m = (await sb.handle('GET', new URL('https://x.test/sim/metrics'), undefined, null)).body as { coverage: { registered: number; checked: number } };
    expect(m.coverage).toMatchObject({ registered: 1, checked: 0 });
  });
});
