import { createHmac } from 'node:crypto';

export interface WebhookEvent {
  type: 'registration_alert' | 'campaign_alert' | 'sim_swap' | 'test';
  tenantId: string;
  at: string;
  data: Record<string, unknown>;
}

export interface WebhookSender {
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }>;
}

export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  const mac = createHmac('sha256', secret).update(`${unixSeconds}.${body}`).digest('hex');
  return `t=${unixSeconds},v1=${mac}`;
}

export class HttpWebhookSender implements WebhookSender {
  constructor(private timeoutMs = 5000) {}

  async post(url: string, body: string, headers: Record<string, string>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Gaskiyya-Webhooks/1', ...headers },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    await res.body?.cancel();
    return { status: res.status };
  }
}

export class MemoryWebhookSender implements WebhookSender {
  sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  status = 200;

  async post(url: string, body: string, headers: Record<string, string>) {
    this.sent.push({ url, body, headers });
    return { status: this.status };
  }
}
