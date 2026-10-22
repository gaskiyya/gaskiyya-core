import { EventEmitter } from 'node:events';

export interface CallNotice {
  // call.unverified: the demo's fraud call, ringing from a spoofed number. It has no code and no session.
  type: 'call.opened' | 'call.closed' | 'call.unverified';
  callId: string;
  bank: string;
  purpose: string;
  code: string | null;
  expiresAt: string;
  // call.opened and call.unverified: lets the phone answer or end this one call without the app running.
  token?: string;
  // call.closed: who ended it.
  endedBy?: 'agent' | 'customer';
  // call.unverified: the name and number the caller shows.
  caller?: string;
  number?: string;
}

export interface AdvisoryNotice {
  type: 'advisory.published' | 'advisory.withdrawn';
  advisoryId: string;
  bank: string;
  title: string;
  expiresAt: string;
}

/**
 * A demo message the bank console placed in a customer's demo inbox (simulator only). It plays the
 * part of the phone's own SMS or WhatsApp alert, so it carries the sender and a short preview. The
 * registry never stores it: the text lives only in the simulator's in-memory demo inbox.
 */
export interface MessageNotice {
  type: 'message.received';
  itemId: string;
  orgId: string;
  from: string;
  preview: string;
  channel: 'sms' | 'whatsapp';
}

/**
 * A demo payment alert (simulator only): a transfer the console made, or a fake receipt it sent.
 * "transfer.received" goes to the payee, who can check the receipt in the app; "transfer.sent" to
 * the payer. It never says whether the receipt is genuine: checking it is the point.
 */
export interface TransferNotice {
  type: 'transfer.received' | 'transfer.sent';
  transferId: string;
  orgId: string;
  from: string;
  amountKobo: number;
  // Last four digits only.
  accountLast4: string;
  reference: string;
  valueDate: string;
}

export type DemoNotice = MessageNotice | TransferNotice;

export type Notice = CallNotice | AdvisoryNotice | DemoNotice;

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
