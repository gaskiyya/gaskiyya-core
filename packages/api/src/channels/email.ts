import { Resend } from 'resend';

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
}

export interface Mailer {
  send(message: EmailMessage): Promise<{ id: string }>;
}

export class MemoryMailer implements Mailer {
  sent: EmailMessage[] = [];
  failing = false;
  async send(m: EmailMessage) {
    if (this.failing) throw new Error('mailer unavailable');
    this.sent.push(m);
    return { id: `mem_${this.sent.length}` };
  }
}

export class ResendMailer implements Mailer {
  private client: Resend;

  constructor(private o: { apiKey: string; from: string; replyTo?: string; baseUrl?: string }) {
    this.client = new Resend(o.apiKey, o.baseUrl ? { baseUrl: o.baseUrl } : undefined);
  }

  async send(m: EmailMessage) {
    const { data, error } = await this.client.emails.send(
      {
        from: this.o.from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(this.o.replyTo ? { replyTo: this.o.replyTo } : {}),
        ...(m.tags ? { tags: m.tags } : {}),
      },
      m.idempotencyKey ? { idempotencyKey: m.idempotencyKey } : undefined,
    );
    if (error || !data) throw new Error(`Resend rejected the email: ${error?.name ?? 'unknown error'}`);
    return { id: data.id };
  }
}
