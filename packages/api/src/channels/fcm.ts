import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';
import { copy } from '@gaskiya/schemas';
import { InvalidPushTokenError, type AdvisoryNotice, type CallNotice, type Notice, type PushProvider } from './channels.ts';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_BASE = 'https://fcm.googleapis.com';

export function serviceAccountFromEnv(env: NodeJS.ProcessEnv): ServiceAccount | null {
  let raw = env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw && env.GOOGLE_APPLICATION_CREDENTIALS) raw = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  if (!raw) return null;
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key || !(sa.project_id || env.FCM_PROJECT_ID)) {
    throw new Error('Firebase service account must include project_id, client_email and private_key');
  }
  return { project_id: env.FCM_PROJECT_ID || sa.project_id!, client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

export class FcmPush implements PushProvider {
  private token: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;
  readonly projectId: string;

  constructor(
    private sa: ServiceAccount,
    private opts: { fcmBaseUrl?: string } = {},
  ) {
    this.projectId = sa.project_id;
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) return this.token.value;
    this.pending ??= this.mint().finally(() => (this.pending = null));
    return this.pending;
  }

  private async mint(): Promise<string> {
    const tokenUri = this.sa.token_uri || GOOGLE_TOKEN_URI;
    const key = await importPKCS8(this.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.sa.client_email)
      .setSubject(this.sa.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Firebase token exchange failed with ${res.status}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  static message(token: string, n: Notice) {
    if ('advisoryId' in n) return FcmPush.advisoryMessage(token, n);
    return FcmPush.callMessage(token, n);
  }

  static advisoryMessage(token: string, n: AdvisoryNotice) {
    const data = { type: n.type, advisoryId: n.advisoryId, bank: n.bank, expiresAt: n.expiresAt };
    if (n.type === 'advisory.withdrawn') {
      return {
        token,
        data,
        android: { priority: 'NORMAL', ttl: '86400s' },
        apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } },
      };
    }
    const ttlSeconds = Math.max(1, Math.min(28 * 86400, Math.round((Date.parse(n.expiresAt) - Date.now()) / 1000)));
    return {
      token,
      data,
      notification: { title: n.title, body: copy.advisory.pushBody },
      android: { priority: 'NORMAL', ttl: `${ttlSeconds}s`, notification: { channel_id: 'advisories', tag: n.advisoryId } },
      apns: {
        headers: { 'apns-push-type': 'alert', 'apns-priority': '5', 'apns-collapse-id': n.advisoryId },
        payload: { aps: { sound: 'default' } },
      },
    };
  }

  static callMessage(token: string, n: CallNotice) {
    const data = { type: n.type, callId: n.callId, bank: n.bank, purpose: n.purpose, code: n.code ?? '', expiresAt: n.expiresAt };
    const ttlSeconds = Math.max(1, Math.round((Date.parse(n.expiresAt) - Date.now()) / 1000));
    if (n.type === 'call.closed') {
      return {
        token,
        data,
        android: { priority: 'HIGH', ttl: '60s' },
        apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } },
      };
    }
    return {
      token,
      data,
      notification: { title: `${n.bank} is calling you`, body: `Call code ${n.code}. Compare it with what the agent reads to you.` },
      android: {
        priority: 'HIGH',
        ttl: `${ttlSeconds}s`,
        notification: { channel_id: 'calls', tag: n.callId },
      },
      apns: {
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.parse(n.expiresAt) / 1000)),
          'apns-collapse-id': n.callId,
        },
        payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } },
      },
    };
  }

  async send(token: string, notice: Notice): Promise<void> {
    const res = await fetch(`${this.opts.fcmBaseUrl ?? FCM_BASE}/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: FcmPush.message(token, notice) }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
    const badToken = code === 'INVALID_ARGUMENT' && /registration token/i.test(body.error?.message ?? '');
    if (res.status === 404 || code === 'UNREGISTERED' || badToken) {
      throw new InvalidPushTokenError(`FCM rejected the token (${code ?? res.status})`);
    }
    throw new Error(`FCM send failed with ${res.status}${code ? ` (${code})` : ''}`);
  }
}
