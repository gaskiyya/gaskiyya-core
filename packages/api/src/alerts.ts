import type { Mailer } from './channels/email.ts';
import { campaignAlertEmail, type EmailOptions } from './emails/templates.ts';
import type { Logger } from './service.ts';
import type { Campaign, Store, Tenant } from './store/types.ts';

const GROWTH_MIN_REPORTS = 3;
const GROWTH_MIN_INTERVAL_MS = 30 * 60 * 1000;

export function alertKind(c: Campaign, now: Date): 'new' | 'growing' | null {
  if (c.status === 'dismissed') return null;
  if (!c.alert) return 'new';
  const grownBy = c.reportCount - c.alert.lastCount;
  const enough = grownBy >= Math.max(GROWTH_MIN_REPORTS, c.alert.lastCount);
  const quiet = now.getTime() - Date.parse(c.alert.lastAt) >= GROWTH_MIN_INTERVAL_MS;
  return enough && quiet ? 'growing' : null;
}

export class CampaignAlerts {
  constructor(
    private store: Store,
    private mailer: Mailer | null,
    private tenants: Map<string, Tenant>,
    private log: Logger,
    private emailOptions: EmailOptions = {},
    private clock: () => Date = () => new Date(),
    private webhook: ((tenant: Tenant, c: Campaign, kind: 'new' | 'growing') => Promise<boolean>) | null = null,
  ) {}

  get enabled() {
    return this.mailer !== null;
  }

  async afterRun(results: { tenantId: string; campaignsTouched: string[] }[]): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const r of results) {
      const tenant = this.tenants.get(r.tenantId);
      if (!tenant) continue;
      const to = this.mailer ? (tenant.alertEmails?.filter(Boolean) ?? []) : [];
      const hook = this.webhook && tenant.webhookUrl ? this.webhook : null;
      if (to.length === 0 && !hook) continue;
      for (const id of r.campaignsTouched) {
        const c = await this.store.getCampaign(tenant.id, id);
        if (!c) continue;
        const now = this.clock();
        const kind = alertKind(c, now);
        if (!kind) continue;
        let delivered = false;
        if (this.mailer && to.length) {
          const mail = campaignAlertEmail(tenant, c, kind, this.emailOptions);
          try {
            await this.mailer.send({
              to,
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              idempotencyKey: `campaign-alert/${tenant.id}/${c.id}/${c.reportCount}`,
              tags: [{ name: 'type', value: mail.template }],
            });
            delivered = true;
            sent++;
          } catch (err) {
            failed++;
            this.log.warn({ err: (err as Error).message, campaignId: c.id }, 'campaign alert email failed');
          }
        }
        if (hook && (await hook(tenant, c, kind).catch(() => false))) delivered = true;
        if (delivered) {
          await this.store
            .putCampaign({ ...c, alert: { lastAt: now.toISOString(), lastCount: c.reportCount } })
            .catch((err: Error) => this.log.warn({ err: err.message, campaignId: c.id }, 'campaign alert state not saved'));
        }
      }
    }
    return { sent, failed };
  }
}
