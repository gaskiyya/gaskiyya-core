import { EventEmitter } from 'node:events';

export interface CallNotice {
  type: 'call.opened' | 'call.closed';
  callId: string;
  bank: string;
  purpose: string;
  code: string | null;
  expiresAt: string;
}

export interface AdvisoryNotice {
  type: 'advisory.published' | 'advisory.withdrawn';
  advisoryId: string;
  bank: string;
  title: string;
  expiresAt: string;
}

export type Notice = CallNotice | AdvisoryNotice;

export interface PushProvider {
  send(token: string, notice: Notice): Promise<void>;
}

export class InvalidPushTokenError extends Error {
  constructor(message = 'push token is no longer valid') {
    super(message);
    this.name = 'InvalidPushTokenError';
  }
}

export class MemoryPush implements PushProvider {
  sent: { token: string; notice: Notice }[] = [];
  dead = new Set<string>();
  async send(token: string, notice: Notice) {
    if (this.dead.has(token)) throw new InvalidPushTokenError();
    this.sent.push({ token, notice });
  }
}

export class EventHub {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(channel: string, notice: Notice) {
    this.emitter.emit(channel, notice);
  }
  subscribe(channel: string, fn: (n: Notice) => void): () => void {
    this.emitter.on(channel, fn);
    return () => this.emitter.off(channel, fn);
  }
}

export interface Messaging {
  sendText(to: string, body: string): Promise<void>;
  fetchMedia(mediaId: string): Promise<{ base64: string; mediaType: string } | null>;
}

export class MemoryMessaging implements Messaging {
  sent: { to: string; body: string }[] = [];
  media = new Map<string, { base64: string; mediaType: string }>();
  async sendText(to: string, body: string) {
    this.sent.push({ to, body });
  }
  async fetchMedia(id: string) {
    return this.media.get(id) ?? null;
  }
}

const GRAPH = 'https://graph.facebook.com/v23.0';

export class WhatsAppCloud implements Messaging {
  constructor(
    private phoneNumberId: string,
    private accessToken: string,
  ) {}

  async sendText(to: string, body: string) {
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body, preview_url: false } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed with ${res.status}`);
  }

  async fetchMedia(mediaId: string) {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!meta.ok) return null;
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const file = await fetch(url, { headers: { authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(15000) });
    if (!file.ok) return null;
    return { base64: Buffer.from(await file.arrayBuffer()).toString('base64'), mediaType: mime_type.split(';')[0]! };
  }
}
