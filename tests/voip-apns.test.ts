import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Http2Server, type IncomingHttpHeaders, type ServerHttp2Stream } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ApnsVoipPush } from '../packages/api/src/channels/voip.ts';

const keyP8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CALL = { callId: 'call_1', orgId: 'demobank', bank: 'DemoBank', code: '4821', expiresAt: new Date(Date.now() + 180_000).toISOString() };

let server: Http2Server | null = null;
afterEach(() => server?.close());

async function apns(handle: (stream: ServerHttp2Stream, headers: IncomingHttpHeaders, body: string) => void) {
  server = createServer();
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (d: string) => (body += d));
    stream.on('end', () => handle(stream, headers, body));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return new ApnsVoipPush({ keyP8, keyId: 'KEY123', teamId: 'TEAM123', bundleId: 'com.gaskiya.app', production: false }, { host: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 300 });
}

describe('VoIP pushes to APNs', () => {
  it('VOIP-1: sends the call over HTTP/2 to the .voip topic with a signed token, and resolves on 200', async () => {
    let seen: { headers: IncomingHttpHeaders; body: string } | null = null;
    const push = await apns((stream, headers, body) => {
      seen = { headers, body };
      stream.respond({ ':status': 200 });
      stream.end();
    });
    await push.send('abc123', CALL);
    push.close();
    expect(seen!.headers).toMatchObject({ ':path': '/3/device/abc123', 'apns-topic': 'com.gaskiya.app.voip', 'apns-push-type': 'voip', 'apns-priority': '10' });
    expect(String(seen!.headers.authorization)).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(seen!.body)).toMatchObject({ aps: {}, callId: 'call_1', code: '4821', bank: 'DemoBank' });
  });

  it('VOIP-2: an APNs refusal rejects with its reason, so the server falls back to the banner', async () => {
    const push = await apns((stream) => {
      stream.respond({ ':status': 400, 'content-type': 'application/json' });
      stream.end(JSON.stringify({ reason: 'BadDeviceToken' }));
    });
    await expect(push.send('abc123', CALL)).rejects.toThrow('APNs 400 BadDeviceToken');
    push.close();
  });

  it('VOIP-3: a request APNs never answers rejects after the timeout instead of hanging the call', async () => {
    const push = await apns(() => {});
    const started = Date.now();
    await expect(push.send('abc123', CALL)).rejects.toThrow(/timed out|closed/);
    expect(Date.now() - started).toBeLessThan(3000);
    push.close();
  });
});
