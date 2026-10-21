import { describe, expect, it } from 'vitest';
import { createSandbox } from '../console/src/sandbox/backend.ts';
import { contentDigest } from '../console/src/device/digest.ts';
import { tamper } from '../packages/api/src/simulator/demo-data.ts';

const PHONE = '+2348012345678';

describe('in-browser sandbox console', () => {
  const sb = createSandbox();
  const call = async (method: string, path: string, body?: unknown, token?: string) =>
    sb.handle(method, new URL(path, 'https://gaskiyya.test'), body, token ? `Bearer ${token}` : null) as Promise<{ status: number; body: any }>;

  it('registers what the bank sends, and the phone confirms only the exact message for its number', async () => {
    const sent = await call('POST', '/sim/send', { phone: PHONE, category: 'transaction_alert' });
    expect(sent.status).toBe(200);
    const { token } = (await call('POST', '/sim/customer-token', { phone: PHONE })).body;
    const verify = async (text: string, t = token) => (await call('POST', '/sim/registry/v1/verify/message', { contentDigest: await contentDigest(text) }, t)).body.verdict;
    expect(await verify(sent.body.item.text)).toBe('confirmed');
    expect(await verify(tamper(sent.body.item.text))).toBe('not_confirmed');
    const other = (await call('POST', '/sim/customer-token', { phone: '+2348098765432' })).body.token;
    expect(await verify(sent.body.item.text, other)).toBe('not_confirmed');
    expect((await call('POST', '/sim/registry/v1/verify/message', { contentDigest: 'x' }, token)).status).toBe(400);
    expect((await call('GET', '/sim/registry/v1/activity')).status).toBe(401);
  });

  it('RCPT-12: pays a merchant, registers the receipt, and shows fake receipts as not confirmed', async () => {
    const paid = (await call('POST', '/sim/transfers', { from: '+2348098765432', to: PHONE, amountKobo: 1_500_050 })).body.transfer;
    expect(paid).toMatchObject({ kind: 'genuine', registered: true, account: '8012345678' });
    const check = async (id: string) => (await call('POST', `/sim/transfers/${id}/check`)).body.transfer.check;
    expect(await check(paid.id)).toMatchObject({ verdict: 'received', paidFrom: 'DemoBank' });
    const fakeAmount = (await call('POST', '/sim/transfers/fake', { kind: 'fake_amount' })).body.transfer;
    expect(await check(fakeAmount.id)).toEqual({ verdict: 'not_confirmed', bank: 'DemoBank' });
    const fakeRef = (await call('POST', '/sim/transfers/fake', { kind: 'fake_reference' })).body.transfer;
    expect(await check(fakeRef.id)).toEqual({ verdict: 'not_confirmed', bank: 'DemoBank' });
    const { token } = (await call('POST', '/sim/customer-token', { phone: PHONE })).body;
    const fields = { beneficiaryAccount: paid.account, amountKobo: paid.amountKobo, reference: paid.reference, valueDate: paid.valueDate };
    expect((await call('POST', '/sim/registry/v1/verify/receipt', fields, token)).body.verdict).toBe('received');
    const other = (await call('POST', '/sim/customer-token', { phone: '+2348098765432' })).body.token;
    expect((await call('POST', '/sim/registry/v1/verify/receipt', fields, other)).status).toBe(403);
  });

  it('checks links against the bank domains', async () => {
    const { token } = (await call('POST', '/sim/customer-token', { phone: PHONE })).body;
    expect((await call('POST', '/sim/registry/v1/verify/link', { url: 'https://demobank.ng/app' }, token)).body.verdict).toBe('belongs');
    expect((await call('POST', '/sim/registry/v1/verify/link', { url: 'https://www.demo-bank.ng/app' }, token)).body).toMatchObject({ verdict: 'not_confirmed', reasons: ['lookalike', 'not_registered'] });
  });

  it('runs a call from announcement to hang-up', async () => {
    const { token } = (await call('POST', '/sim/customer-token', { phone: PHONE })).body;
    const c = (await call('POST', '/sim/calls', { phone: PHONE, purpose: 'card_activation' })).body;
    expect(c.code).toMatch(/^\d{4}$/);
    expect((await call('GET', '/sim/registry/v1/calls/open', undefined, token)).body).toMatchObject({ calling: true, call: { code: c.code } });
    expect((await call('PATCH', `/sim/calls/${c.id}`, { status: 'ended' })).status).toBe(200);
    expect((await call('GET', '/sim/registry/v1/calls/open', undefined, token)).body.calling).toBe(false);
  });

  it('USSD-8: the sandbox feature phone runs the registry\'s own USSD handler', async () => {
    expect((await call('GET', '/sim/config')).body.ussdCode).toBe('*347*123#');
    expect((await call('POST', '/sim/ussd', { phone: PHONE, text: '' })).body.screen).toMatch(/^CON /);
    const c = (await call('POST', '/sim/calls', { phone: PHONE, purpose: 'card_activation' })).body;
    expect((await call('POST', '/sim/ussd', { phone: PHONE, text: '1' })).body.screen).toContain(c.code);
    expect((await call('POST', '/sim/ussd', { phone: '+2348098765432', text: '1' })).body.screen).not.toContain(c.code);
    await call('PATCH', `/sim/calls/${c.id}`, { status: 'ended' });
    await call('POST', '/sim/send', { phone: PHONE, category: 'security_notice' });
    expect((await call('POST', '/sim/ussd', { phone: PHONE, text: '2' })).body.screen).toMatch(/^(CON|END) [\s\S]*security notice by SMS/);
    expect((await call('POST', '/sim/ussd', { phone: 'x', text: '' })).status).toBe(400);
  });

  it('groups reports into a campaign the fraud desk can approve, and resets', async () => {
    expect((await call('POST', '/sim/seed-reports')).body.reported).toBe(3);
    await call('POST', '/sim/agent/run');
    const [campaign] = (await call('GET', '/sim/campaigns')).body.campaigns;
    expect(campaign).toMatchObject({ reportCount: 3, linkDomains: ['demobank-restore.com'] });
    expect((await call('POST', `/sim/campaigns/${campaign.id}/approve`)).status).toBe(400);
    expect((await call('POST', `/sim/campaigns/${campaign.id}/approve`, { analyst: 'Aisha Bello' })).body.advisory).toMatchObject({ status: 'approved', approvedBy: 'Aisha Bello' });
    expect((await call('GET', '/sim/metrics')).body.registrations).toBeGreaterThan(0);

    const { token } = (await call('POST', '/sim/customer-token', { phone: PHONE })).body;
    expect((await call('GET', '/sim/registry/v1/advisories', undefined, token)).body.advisories.map((a: { id: string }) => a.id)).toEqual([campaign.id]);
    const sent = await call('POST', `/sim/campaigns/${campaign.id}/send`, {});
    expect(sent.body).toMatchObject({ sent: 3, channel: 'sms' });
    const verify = async (text: string, t: string) => (await call('POST', '/sim/registry/v1/verify/message', { contentDigest: await contentDigest(text) }, t)).body;
    expect(await verify(sent.body.text, token)).toMatchObject({ verdict: 'confirmed', category: 'security_notice' });
    const stranger = (await call('POST', '/sim/customer-token', { phone: '+2348000000001' })).body.token;
    expect((await verify(sent.body.text, stranger)).verdict).toBe('not_confirmed');
    expect((await call('POST', `/sim/campaigns/${campaign.id}/withdraw`, { analyst: 'Aisha Bello' })).body.advisory.status).toBe('withdrawn');
    expect((await call('GET', '/sim/registry/v1/advisories', undefined, token)).body.advisories).toEqual([]);
    expect((await call('POST', `/sim/campaigns/${campaign.id}/send`, {})).status).toBe(409);
    await call('POST', '/sim/reset');
    expect((await call('GET', '/sim/metrics')).body.registrations).toBe(0);
  });

  it('tracks signed-in numbers, rings a fraud call the registry never hears of, and sends a fake credit alert', async () => {
    const presenter = '+2348035550199';
    await call('POST', '/sim/customer-token', { phone: presenter });
    expect((await call('GET', '/sim/customers/recent')).body.customers[0].phone).toBe(presenter);
    const rung = await call('POST', '/sim/fraud-calls', { phone: presenter, from: '07003362265' });
    expect(rung.body).toMatchObject({ status: 'ringing', phone: presenter });
    expect((await call('GET', '/sim/fraud-calls')).body.calls[0].id).toBe(rung.body.id);
    const { token } = (await call('POST', '/sim/customer-token', { phone: presenter })).body;
    expect((await call('GET', '/sim/registry/v1/calls/open', undefined, token)).body).toMatchObject({ calling: false });
    expect((await call('PATCH', `/sim/fraud-calls/${rung.body.id}`, { status: 'answered' })).body.status).toBe('answered');
    expect((await call('PATCH', '/sim/fraud-calls/nope', { status: 'ended' })).status).toBe(404);
    const fake = (await call('POST', '/sim/send-fake', { phone: presenter, template: 'credit_alert' })).body.item;
    expect(fake.text).toMatch(/Credit/);
    expect((await call('POST', '/sim/registry/v1/verify/message', { contentDigest: await contentDigest(fake.text) }, token)).body.verdict).toBe('not_confirmed');
  });
});
