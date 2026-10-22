import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { copy } from '@gaskiya/schemas';
import { MemoryStore } from '../packages/api/src/index.ts';
import { ALERT, ALICE, harness, LINK_MSG, seedSecondCall, TAMPERED_LINK_MSG, WA } from './helpers.ts';

export function waPayload(from: string, message: Record<string, unknown>) {
  return { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from, id: `wamid.${Math.random()}`, timestamp: '1', ...message }] } }] }] };
}

export function signed(body: unknown, secret = WA.appSecret) {
  const raw = JSON.stringify(body);
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
}

async function send(h: Awaited<ReturnType<typeof harness>>, text: string) {
  const { raw, signature } = signed(waPayload(ALICE.slice(1), { type: 'text', text: { body: text } }));
  const r = await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
  expect(r.statusCode).toBe(200);
  return h.messaging.sent.at(-1)!;
}

describe('WhatsApp route', () => {
  it('CH-2: completes the verification handshake', async () => {
    const h = await harness();
    const ok = await h.sys.app.inject({ method: 'GET', url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA.verifyToken}&hub.challenge=12345` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    const bad = await h.sys.app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1' });
    expect(bad.statusCode).toBe(403);
  });

  it('CH-2: rejects requests with an invalid or missing signature', async () => {
    const h = await harness();
    const body = waPayload(ALICE.slice(1), { type: 'text', text: { body: ALERT } });
    for (const sig of [undefined, 'sha256=00', signed(body, 'wrong-secret').signature]) {
      const r = await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, payload: JSON.stringify(body) });
      expect(r.statusCode).toBe(401);
    }
    expect(h.messaging.sent).toEqual([]);
  });

  it('CH-2: replies to pasted text with the correct verdict', async () => {
    const h = await harness();
    await h.register(ALICE, LINK_MSG);
    const ok = await send(h, LINK_MSG);
    expect(ok.to).toBe(ALICE);
    expect(ok.body).toContain(copy.verdict.confirmed.title);
    const bad = await send(h, TAMPERED_LINK_MSG);
    expect(bad.body).toContain(copy.verdict.not_confirmed.title);
    expect(bad.body).toContain('In the last 24 hours DemoBank sent you one transaction alert by SMS.');
    expect(bad.body).toContain(copy.explain.fallback);
  });

  it('CH-2: answers whether the bank is calling', async () => {
    const h = await harness();
    expect((await send(h, 'CALL')).body).toContain(copy.call.not_calling.title);
    const call = await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a1' } });
    const reply = await send(h, 'call');
    expect(reply.body).toContain('DemoBank is calling you');
    expect(reply.body).toContain(call.json().code);
  });

  it('F10 / CH-2: CALL lists every open call code when two sessions are open together', async () => {
    const h = await harness();
    const a = (await h.sys.app.inject({ method: 'POST', url: '/v1/calls', headers: { authorization: `Bearer ${h.bankToken}` }, payload: { recipient: ALICE, purpose: 'fraud_check', agentRef: 'a1' } })).json();
    const b = await seedSecondCall(h, a.id, 'card_activation', a.code === '1111' ? '2222' : '1111');
    const reply = (await send(h, 'CALL')).body;
    expect(reply).toContain(`${copy.call.calling.codeLabel}: ${a.code}`);
    expect(reply).toContain(`${copy.call.calling.codeLabel}: ${b.code}`);
    expect(reply).toContain(copy.purposes.fraud_check);
    expect(reply).toContain(copy.purposes.card_activation);
    expect(reply.indexOf(b.code)).toBeLessThan(reply.lastIndexOf(a.code));
    expect(reply.endsWith(copy.call.mismatchMany)).toBe(true);
    expect(reply).not.toContain(copy.call.mismatch);
  });

  it('F9 / REG-6: CALL gets the cannot-check text when the store errors, never silence or not calling', async () => {
    class BrokenStore extends MemoryStore {
      override async openCalls(): Promise<never> {
        throw new Error('ECONNREFUSED');
      }
    }
    const h = await harness({ store: new BrokenStore() });
    const reply = await send(h, 'CALL');
    expect(reply.to).toBe(ALICE);
    expect(reply.body).toBe(`${copy.verdict.cannot_check.title}\n${copy.verdict.cannot_check.body}`);
    expect(reply.body).not.toContain(copy.call.not_calling.title);
  });

  it('F9 / REG-6: any failure while answering still sends the cannot-check text', async () => {
    const h = await harness();
    h.sys.svc.verifyDigest = async () => {
      throw new Error('boom');
    };
    const reply = await send(h, ALERT);
    expect(reply.body).toBe(`${copy.verdict.cannot_check.title}\n${copy.verdict.cannot_check.body}`);
  });

  it('CH-2: screenshots are read and verified exactly; unreadable images get a fixed reply', async () => {
    const { localEmbed } = await import('../packages/api/src/index.ts');
    const model = {
      explain: async () => { throw new Error('off'); },
      extractText: async ({ imageBase64 }: { imageBase64: string }) => (imageBase64 === 'aW1hZ2UtZ2VudWluZQ==' ? { sender: 'DemoBank', text: ALERT } : imageBase64 === 'aW1hZ2UtdGFtcGVyZWQ=' ? { sender: 'DemoBank', text: ALERT.replace('5,000', '5,001') } : null),
      embed: async (t: string) => ({ model: 'local-hash-256', vector: localEmbed(t) }),
      draftAdvisory: async () => null,
    };
    const h = await harness({ model });
    await h.register(ALICE, ALERT);
    h.messaging.media.set('m1', { base64: 'aW1hZ2UtZ2VudWluZQ==', mediaType: 'image/jpeg' });
    h.messaging.media.set('m2', { base64: 'aW1hZ2UtdGFtcGVyZWQ=', mediaType: 'image/jpeg' });
    h.messaging.media.set('m3', { base64: 'bm90aGluZw==', mediaType: 'image/jpeg' });
    const sendImage = async (id: string) => {
      const { raw, signature } = signed(waPayload(ALICE.slice(1), { type: 'image', image: { id } }));
      await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
      return h.messaging.sent.at(-1)!.body;
    };
    expect(await sendImage('m1')).toContain(copy.verdict.confirmed.title);
    expect(await sendImage('m2')).toContain(copy.verdict.not_confirmed.title);
    expect(await sendImage('m3')).toBe(copy.bot.screenshotUnread);
  });
});
