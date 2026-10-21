import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentDigest } from '@gaskiya/canonical';
import { configFromEnv, createSystem, StaticKeyService } from '../packages/api/src/index.ts';
import { buildSimulator, DEMO_BANKS, DEMO_CUSTOMERS, demoBank, tamper } from '../packages/api/src/simulator/index.ts';
import { BANK_CLIENT, TENANT, TOKEN_SECRET } from './helpers.ts';

const ZB = demoBank('zb');
const ZB_CLIENT = { clientId: 'zbdemo-sim', clientSecret: 'test-zb-client-secret-not-real-01', tenantId: ZB.tenant.id };
const PHONE = DEMO_CUSTOMERS[0]!.phone;
const OTHER = DEMO_CUSTOMERS[1]!.phone;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe('the ZB demo bank (DEMO_TENANT=zb)', () => {
  it('is plainly a fictional demo bank: no Zenith name, reserved test domains', () => {
    expect(ZB.tenant.name).toBe('ZB Demo Bank (demo)');
    expect(ZB.tenant.senderIds).toEqual(expect.arrayContaining(['ZBDEMO', 'ZBDemoBnk']));
    for (const d of [...ZB.tenant.domains, ZB.lookalikeDomain]) expect(d).toMatch(/\.(example|test)$/);
    expect(JSON.stringify([ZB.tenant, ZB.lookalikeDomain]).toLowerCase()).not.toContain('zenith');
    expect(readFileSync('packages/api/src/simulator/demo-banks.json', 'utf8')).toContain('DEMO ONLY');
    expect(DEMO_BANKS.demobank!.tenant).toEqual({ id: TENANT.id, name: TENANT.name, domains: TENANT.domains, senderIds: TENANT.senderIds, bankCode: TENANT.bankCode });
  });

  it('seeds beside DemoBank from configuration, and the app is offered the selected one', () => {
    const tenants = [
      { ...DEMO_BANKS.demobank!.tenant, tokenKeysUrl: 'http://127.0.0.1:5170/sim/.well-known/jwks.json' },
      { ...ZB.tenant, tokenKeysUrl: 'http://127.0.0.1:5170/sim/.well-known/jwks.json' },
    ];
    const key = () => randomBytes(32).toString('base64');
    const cfg = configFromEnv({
      GASKIYA_TOKEN_SECRET: TOKEN_SECRET,
      GASKIYA_TENANTS: JSON.stringify(tenants),
      GASKIYA_TENANT_KEYS: JSON.stringify({ demobank: key(), zbdemo: key() }),
      GASKIYA_BANK_CLIENTS: JSON.stringify([BANK_CLIENT, ZB_CLIENT]),
      SIM_ENABLED: 'true',
      SIM_DEMO_LOGIN: 'true',
      SIM_TENANT_ID: ZB.tenant.id,
      AI_PROVIDER: 'none',
    });
    expect(cfg.integrations.tenants).toEqual(['demobank', 'zbdemo']);
    expect(cfg.tenants.find((t) => t.id === 'zbdemo')).toMatchObject({ customerTokenUrl: '/sim/customer-token', demoInboxUrl: '/sim/inbox' });
    expect(cfg.tenants.find((t) => t.id === 'demobank')!.customerTokenUrl).toBeUndefined();
  });

  describe('with the simulator acting for it', () => {
    let sim: Awaited<ReturnType<typeof buildSimulator>>;
    let api: ReturnType<typeof createSystem>;
    let apiUrl = '';

    beforeAll(async () => {
      const simPort = await freePort();
      const sim0 = `http://127.0.0.1:${simPort}/sim`;
      api = createSystem({
        tenants: [
          { ...TENANT, tokenKeys: { keys: [] } },
          { ...ZB.tenant, tokenKeysUrl: `${sim0}/.well-known/jwks.json`, customerTokenUrl: `${sim0}/customer-token`, demoInboxUrl: `${sim0}/inbox` },
        ],
        keys: StaticKeyService.random([TENANT.id, ZB.tenant.id]),
        bankClients: [BANK_CLIENT, ZB_CLIENT],
        tokenSecret: TOKEN_SECRET,
        logger: false,
      });
      await api.app.listen({ port: 0, host: '127.0.0.1' });
      apiUrl = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
      sim = await buildSimulator({
        apiUrl,
        clientId: ZB_CLIENT.clientId,
        clientSecret: ZB_CLIENT.clientSecret,
        tenantId: ZB.tenant.id,
        bankName: ZB.tenant.name,
        domain: ZB.tenant.domains[0],
        lookalikeDomain: ZB.lookalikeDomain,
        demoLogin: true,
        logger: false,
      });
      await sim.app.listen({ port: simPort, host: '127.0.0.1' });
    });

    afterAll(async () => {
      await sim.app.close();
      await api.app.close();
    });

    const post = (url: string, payload: unknown) => sim.app.inject({ method: 'POST', url, payload: payload as object });
    const token = async (phone: string) => (await post('/sim/customer-token', { phone })).json().token as string;
    const call = async (path: string, phone: string, body: unknown) => {
      const r = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token(phone)}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await r.json()) as Record<string, unknown>;
    };

    it('is the bank the app lists', async () => {
      const { banks } = (await (await fetch(`${apiUrl}/v1/banks`)).json()) as { banks: { id: string; name: string }[] };
      expect(banks).toEqual([expect.objectContaining({ id: 'zbdemo', name: 'ZB Demo Bank (demo)' })]);
    });

    it('a message it registers verifies for its recipient only; a tampered copy does not', async () => {
      const sent = (await post('/sim/send', { phone: PHONE, category: 'service_update' })).json();
      expect(sent.item.text).toContain('ZB Demo Bank (demo):');
      expect(sent.item.text).toContain('https://www.zbdemo.example/app');
      expect(await call('/v1/verify/message', PHONE, { contentDigest: contentDigest(sent.item.text) })).toMatchObject({ verdict: 'confirmed' });
      expect(await call('/v1/verify/message', OTHER, { contentDigest: contentDigest(sent.item.text) })).toMatchObject({ verdict: 'not_confirmed' });
      expect(await call('/v1/verify/message', PHONE, { contentDigest: contentDigest(tamper(sent.item.text)) })).toMatchObject({ verdict: 'not_confirmed' });
    });

    it('its own domains belong to it; the scam lookalike does not', async () => {
      expect(await call('/v1/verify/link', PHONE, { url: 'https://www.zbdemo.example/app' })).toMatchObject({ verdict: 'belongs', bank: 'ZB Demo Bank (demo)' });
      expect(await call('/v1/verify/link', PHONE, { url: 'https://zbdemo-bank.test/help' })).toMatchObject({ verdict: 'belongs' });
      const fake = (await post('/sim/send-fake', { phone: PHONE, template: 0 })).json();
      expect(fake.item.text).toContain('https://zbdemo-restore.example');
      expect(await call('/v1/verify/link', PHONE, { url: 'https://zbdemo-restore.example' })).toMatchObject({ verdict: 'not_confirmed' });
    });
  });
});
