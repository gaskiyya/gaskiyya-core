import { readFileSync } from 'node:fs';
import { connect, type ClientHttp2Session } from 'node:http2';
import { importPKCS8, SignJWT, type CryptoKey } from 'jose';

// What the iPhone needs to ring: CallKit shows the bank and the code, and the
// app plays the same agent voice as the console's simulated phone (orgId picks the opening clip).
export interface VoipCall {
  callId: string;
  orgId: string;
  bank: string;
  code: string;
  expiresAt: string;
  // Answers or ends this one call from the phone, even with the app closed.
  token?: string;
  // 'unverified': the demo's fraud call. bank is the name the caller shows, code is empty, and no voice plays.
  kind?: 'bank' | 'unverified';
  number?: string;
}

export interface VoipPush {
  send(voipToken: string, call: VoipCall): Promise<void>;
}

export class MemoryVoipPush implements VoipPush {
  sent: { voipToken: string; call: VoipCall }[] = [];
  async send(voipToken: string, call: VoipCall) {
    this.sent.push({ voipToken, call });
  }
}

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  production: boolean;
}

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv): ApnsConfig | null {
  let key = env.APNS_KEY_P8?.trim();
  if (!key && env.APNS_KEY_FILE) key = readFileSync(env.APNS_KEY_FILE, 'utf8');
  if (!key) return null;
  if (!key.includes('BEGIN PRIVATE KEY')) key = Buffer.from(key, 'base64').toString('utf8');
  const missing = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`APNs needs ${missing.join(', ')}`);
  return { keyP8: key, keyId: env.APNS_KEY_ID!, teamId: env.APNS_TEAM_ID!, bundleId: env.APNS_BUNDLE_ID!, production: env.APNS_PRODUCTION === 'true' };
}

// VoIP pushes go straight to APNs over HTTP/2 with a token (.p8) key; FCM cannot send them.
export class ApnsVoipPush implements VoipPush {
  private key: Promise<CryptoKey> | null = null;
  private jwt: { value: string; issuedAt: number } | null = null;
  private session: ClientHttp2Session | null = null;
  readonly host: string;
  private readonly timeoutMs: number;

  constructor(
    private cfg: ApnsConfig,
    opts: { host?: string; timeoutMs?: number } = {},
  ) {
    this.host = opts.host ?? (cfg.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  get topic() {
    return `${this.cfg.bundleId}.voip`;
  }

  private async token(): Promise<string> {
    // Apple rejects tokens older than an hour and refreshes more often than every 20 minutes.
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.issuedAt < 40 * 60) return this.jwt.value;
    this.key ??= importPKCS8(this.cfg.keyP8, 'ES256');
    const value = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: this.cfg.keyId }).setIssuer(this.cfg.teamId).setIssuedAt(now).sign(await this.key);
    this.jwt = { value, issuedAt: now };
    return value;
  }

  private client(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const s = connect(this.host);
    s.on('error', () => s.destroy());
    s.on('goaway', () => s.close());
    s.setTimeout(5 * 60_000, () => s.close());
    s.unref();
    this.session = s;
    return s;
  }

  close() {
    this.session?.close();
    this.session = null;
  }

  async send(voipToken: string, call: VoipCall): Promise<void> {
    const jwt = await this.token();
    const body = JSON.stringify({ aps: {}, ...call });
    const expiration = Math.floor(Date.parse(call.expiresAt) / 1000);
    await new Promise<void>((resolve, reject) => {
      const req = this.client().request({
        ':method': 'POST',
        ':path': `/3/device/${voipToken}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': this.topic,
        'apns-push-type': 'voip',
        'apns-priority': '10',
        'apns-expiration': String(Number.isFinite(expiration) ? expiration : 0),
        'apns-collapse-id': call.callId.slice(0, 64),
        'content-type': 'application/json',
      });
      let status = 0;
      let text = '';
      req.setEncoding('utf8');
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', (d: string) => (text += d));
      req.on('end', () => {
        if (status === 200) return resolve();
        if (status === 0) return reject(new Error('APNs request timed out'));
        let reason: string;
        try {
          reason = (JSON.parse(text) as { reason?: string }).reason ?? '';
        } catch {
          reason = text.slice(0, 80);
        }
        reject(new Error(`APNs ${status} ${reason}`.trim()));
      });
      req.on('error', reject);
      // A closed stream may never emit 'end'.
      req.on('close', () => reject(new Error(status ? `APNs ${status} closed` : 'APNs request timed out')));
      req.setTimeout(this.timeoutMs, () => req.close());
      req.end(body);
    });
  }
}
