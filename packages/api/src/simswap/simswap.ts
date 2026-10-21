import { createHash, randomUUID } from 'node:crypto';

export interface SimSwapResult {
  swapped: boolean;
  latestSimChange?: string | null;
}

export interface SimSwapProvider {
  readonly name: string;
  check(phone: string, maxAgeHours: number, signal?: AbortSignal): Promise<SimSwapResult>;
}

export type SimSwapErrorCode = 'invalid_argument' | 'unauthorized' | 'not_found' | 'not_applicable' | 'rate_limited' | 'unavailable' | 'timeout' | 'bad_response';

export class SimSwapError extends Error {
  constructor(
    readonly code: SimSwapErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const MAX_AGE_MIN = 1;
export const MAX_AGE_MAX = 2400;

const HOUR_MS = 3600_000;
const numberKey = (phone: string) => createHash('sha256').update(`simswap:${phone}`).digest('hex');

export class SimulatedMno implements SimSwapProvider {
  readonly name: string = 'simulated mobile network';
  private changes = new Map<string, string>();

  constructor(private clock: () => Date = () => new Date()) {}

  swap(phone: string, at: Date = this.clock()): string {
    const iso = at.toISOString();
    this.changes.set(numberKey(phone), iso);
    return iso;
  }

  restore(phone: string): void {
    this.changes.delete(numberKey(phone));
  }

  reset(): void {
    this.changes.clear();
  }

  latest(phone: string): string | null {
    return this.changes.get(numberKey(phone)) ?? null;
  }

  async check(phone: string, maxAgeHours: number): Promise<SimSwapResult> {
    const latest = this.latest(phone);
    const swapped = latest !== null && Date.parse(latest) > this.clock().getTime() - maxAgeHours * HOUR_MS;
    return { swapped, latestSimChange: latest };
  }
}

export class MemorySimSwap extends SimulatedMno {
  override readonly name: string = 'memory';
  failWith: Error | null = null;
  delayMs = 0;
  calls = 0;

  override async check(phone: string, maxAgeHours: number, signal?: AbortSignal): Promise<SimSwapResult> {
    this.calls++;
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new SimSwapError('timeout', 'SIM swap check timed out'));
        });
      });
    }
    if (this.failWith) throw this.failWith;
    return super.check(phone, maxAgeHours);
  }
}

export interface CamaraOptions {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const CAMARA_CODE: Record<string, SimSwapErrorCode> = {
  INVALID_ARGUMENT: 'invalid_argument',
  OUT_OF_RANGE: 'invalid_argument',
  UNAUTHENTICATED: 'unauthorized',
  PERMISSION_DENIED: 'unauthorized',
  NOT_FOUND: 'not_found',
  IDENTIFIER_NOT_FOUND: 'not_found',
  SERVICE_NOT_APPLICABLE: 'not_applicable',
  MISSING_IDENTIFIER: 'invalid_argument',
  UNNECESSARY_IDENTIFIER: 'invalid_argument',
  QUOTA_EXCEEDED: 'rate_limited',
  TOO_MANY_REQUESTS: 'rate_limited',
};

function codeForStatus(status: number): SimSwapErrorCode {
  if (status === 400) return 'invalid_argument';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 422) return 'not_applicable';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

export class CamaraSimSwap implements SimSwapProvider {
  readonly name: string;
  private token: { value: string; exp: number } | null = null;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly base: string;

  constructor(private o: CamaraOptions) {
    this.fetch = o.fetch ?? globalThis.fetch;
    this.timeoutMs = o.timeoutMs ?? 3000;
    this.base = o.baseUrl.replace(/\/+$/, '');
    this.name = `CAMARA SIM Swap at ${new URL(this.base).host}`;
  }

  private signal(outer?: AbortSignal) {
    const t = AbortSignal.timeout(this.timeoutMs);
    return outer ? AbortSignal.any([outer, t]) : t;
  }

  private async request(url: string, init: RequestInit, outer?: AbortSignal): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: this.signal(outer) });
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new SimSwapError('timeout', 'SIM swap provider timed out');
      throw new SimSwapError('unavailable', 'SIM swap provider unreachable');
    }
  }

  private async accessToken(outer?: AbortSignal): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${encodeURIComponent(this.o.clientId)}:${encodeURIComponent(this.o.clientSecret)}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: this.o.scope ?? 'sim-swap:check sim-swap:retrieve-date' });
    const r = await this.request(this.o.tokenUrl, { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body }, outer);
    if (!r.ok) throw new SimSwapError(r.status === 400 || r.status === 401 ? 'unauthorized' : 'unavailable', `SIM swap token request failed (${r.status})`, r.status);
    const t = (await r.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!t || typeof t.access_token !== 'string' || !t.access_token) throw new SimSwapError('bad_response', 'SIM swap token response had no access_token');
    const ttl = typeof t.expires_in === 'number' && t.expires_in > 0 ? t.expires_in : 300;
    this.token = { value: t.access_token, exp: Date.now() + ttl * 1000 };
    return this.token.value;
  }

  private async call(path: '/check' | '/retrieve-date', payload: object, outer?: AbortSignal, retried = false): Promise<Record<string, unknown>> {
    const token = await this.accessToken(outer);
    const r = await this.request(
      `${this.base}${path}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', 'x-correlator': randomUUID() },
        body: JSON.stringify(payload),
      },
      outer,
    );
    if (r.status === 401 && !retried) {
      this.token = null;
      return this.call(path, payload, outer, true);
    }
    const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!r.ok) {
      const camara = typeof body?.code === 'string' ? body.code : '';
      throw new SimSwapError(CAMARA_CODE[camara] ?? codeForStatus(r.status), `SIM swap provider answered ${r.status}${camara ? ` ${camara}` : ''}`, r.status);
    }
    if (!body || typeof body !== 'object') throw new SimSwapError('bad_response', 'SIM swap provider answered with no JSON body');
    return body;
  }

  async check(phone: string, maxAgeHours: number, signal?: AbortSignal): Promise<SimSwapResult> {
    const maxAge = Math.min(MAX_AGE_MAX, Math.max(MAX_AGE_MIN, Math.round(maxAgeHours)));
    const body = await this.call('/check', { phoneNumber: phone, maxAge }, signal);
    if (typeof body.swapped !== 'boolean') throw new SimSwapError('bad_response', 'SIM swap check answer had no swapped flag');
    if (!body.swapped) return { swapped: false };
    const date = await this.call('/retrieve-date', { phoneNumber: phone }, signal).catch(() => null);
    const latest = date && typeof date.latestSimChange === 'string' && Number.isFinite(Date.parse(date.latestSimChange)) ? date.latestSimChange : null;
    return { swapped: true, latestSimChange: latest };
  }
}
