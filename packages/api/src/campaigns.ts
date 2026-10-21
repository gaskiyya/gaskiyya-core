import { randomUUID } from 'node:crypto';
import { runCampaignAgent, similarity, type AgentTools } from '@gaskiya/agent';
import { briefCampaign, briefingInput, guardAdvisory, templateAdvisory } from './ai/briefing.ts';
import type { ModelProvider } from './ai/provider.ts';
import type { Campaign, Store, Tenant } from './store/types.ts';

export interface AgentOptions {
  now?: () => Date;
  briefingTimeoutMs?: number;
}

export function agentTools(store: Store, model: ModelProvider, tenant: Tenant, opts: AgentOptions = {}): AgentTools {
  const now = opts.now ?? (() => new Date());
  return {
    fetchNewReports: () => store.listReports(tenant.id, { unassigned: true }),

    async findSimilar(report) {
      const past = (await store.listReports(tenant.id)).filter((r) => r.campaignId && r.id !== report.id);
      return past
        .map((p) => ({ report: p, score: similarity(report, p) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
    },

    async upsertCampaign(draft) {
      const existing = draft.id ? await store.getCampaign(tenant.id, draft.id) : null;
      const id = existing?.id ?? `cmp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const campaign: Campaign = {
        id,
        tenantId: tenant.id,
        summary: draft.summary,
        indicators: draft.indicators,
        linkDomains: draft.linkDomains,
        callbackKeyCount: draft.callbackKeyCount,
        firstSeen: existing && existing.firstSeen < draft.firstSeen ? existing.firstSeen : draft.firstSeen,
        lastSeen: draft.lastSeen,
        reportCount: draft.reportIds.length,
        status: existing?.status ?? 'new',
        advisory: existing?.advisory ?? { text: '', status: 'draft', approvedBy: null, approvedAt: null },
        alert: existing?.alert ?? null,
        briefing: existing?.briefing ?? null,
      };
      await store.putCampaign(campaign);
      for (const rid of draft.reportIds) await store.updateReport(rid, { campaignId: id });
      return id;
    },

    async draftAdvisory(campaignId, draft) {
      const c = await store.getCampaign(tenant.id, campaignId);
      if (!c || c.advisory.status !== 'draft') return;
      const ids = new Set(draft.reportIds);
      const reportTexts = (await store.listReports(tenant.id)).filter((r) => ids.has(r.id)).map((r) => r.maskedText);
      const input = briefingInput({
        bankName: tenant.name,
        summary: draft.summary,
        indicators: draft.indicators,
        linkDomains: draft.linkDomains,
        callbackKeyCount: draft.callbackKeyCount,
        reportCount: draft.reportIds.length,
        reportTexts,
      });
      const { advisory, ...briefing } = await briefCampaign(model, input, opts.briefingTimeoutMs ?? 15_000, now());
      const safe = guardAdvisory(advisory) ?? templateAdvisory(tenant.name, draft.linkDomains);
      await store.putCampaign({
        ...c,
        briefing,
        advisory: { text: safe, status: 'draft', approvedBy: null, approvedAt: null },
      });
    },
  };
}

export async function runAgentForAll(store: Store, model: ModelProvider, tenants: Iterable<Tenant>, opts: AgentOptions = {}) {
  const results = [];
  for (const t of tenants) results.push({ tenantId: t.id, ...(await runCampaignAgent(agentTools(store, model, t, opts))) });
  return results;
}
