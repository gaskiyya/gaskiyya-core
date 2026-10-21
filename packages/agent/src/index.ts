import type { Indicator } from '@gaskiya/schemas';

export interface AgentReport {
  id: string;
  maskedText: string;
  indicators: Indicator[];
  embedding: number[];
  embeddingModel: string;
  linkDomains: string[];
  callbackKeys: string[];
  campaignId: string | null;
  consentAt: string;
}

export interface CampaignDraft {
  id?: string;
  reportIds: string[];
  summary: string;
  indicators: Indicator[];
  linkDomains: string[];
  callbackKeyCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface AgentTools {
  fetchNewReports(): Promise<AgentReport[]>;
  findSimilar(report: AgentReport): Promise<{ report: AgentReport; score: number }[]>;
  upsertCampaign(draft: CampaignDraft): Promise<string>;
  draftAdvisory(campaignId: string, draft: CampaignDraft): Promise<void>;
}

export const AGENT_TOOL_NAMES = ['fetchNewReports', 'findSimilar', 'upsertCampaign', 'draftAdvisory'] as const satisfies readonly (keyof AgentTools)[];

export const SIMILARITY_THRESHOLD = 0.82;
export const MIN_CAMPAIGN_REPORTS = 2;

export function related(a: AgentReport, b: AgentReport, similarity: number): boolean {
  if (a.linkDomains.some((d) => b.linkDomains.includes(d))) return true;
  if (a.callbackKeys.some((k) => b.callbackKeys.includes(k))) return true;
  return similarity >= SIMILARITY_THRESHOLD;
}

export function similarity(a: AgentReport, b: AgentReport): number {
  return a.embeddingModel === b.embeddingModel ? cosine(a.embedding, b.embedding) : 0;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const INDICATOR_TEXT: Record<Indicator, string> = {
  urgency_or_threat: 'urgent threats',
  credential_request: 'requests for login details',
  non_bank_link: 'links to non-bank sites',
  callback_number: 'a callback number',
  reward_or_refund: 'promised rewards or refunds',
};

export function summarise(reports: AgentReport[], linkDomains: string[], callbackKeyCount: number): { summary: string; indicators: Indicator[] } {
  const counts = new Map<Indicator, number>();
  for (const r of reports) for (const i of r.indicators) counts.set(i, (counts.get(i) ?? 0) + 1);
  const indicators = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  const parts: string[] = [`${reports.length} customer reports of the same fake message`];
  if (linkDomains.length) parts.push(`pointing to ${linkDomains.join(', ')}`);
  if (callbackKeyCount) parts.push(`sharing ${callbackKeyCount === 1 ? 'one callback number' : `${callbackKeyCount} callback numbers`}`);
  let summary = parts.join(', ') + '.';
  if (indicators.length) summary += ` Uses ${indicators.map((i) => INDICATOR_TEXT[i]).join(', ')}.`;
  return { summary, indicators };
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

export interface AgentRunResult {
  campaignsTouched: string[];
  reportsAssigned: number;
}

export async function runCampaignAgent(tools: AgentTools): Promise<AgentRunResult> {
  const fresh = await tools.fetchNewReports();
  if (fresh.length === 0) return { campaignsTouched: [], reportsAssigned: 0 };

  const uf = new UnionFind();
  const byId = new Map<string, AgentReport>();
  const campaignOf = new Map<string, string>();

  for (const r of fresh) {
    byId.set(r.id, r);
    uf.find(r.id);
  }

  for (const r of fresh) {
    for (const { report: past, score } of await tools.findSimilar(r)) {
      if (!past.campaignId || !related(r, past, score)) continue;
      byId.set(past.id, past);
      uf.union(r.id, past.id);
    }
  }
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      const a = fresh[i]!, b = fresh[j]!;
      if (related(a, b, similarity(a, b))) uf.union(a.id, b.id);
    }
  }

  const groups = new Map<string, AgentReport[]>();
  for (const r of byId.values()) {
    const root = uf.find(r.id);
    const g = groups.get(root) ?? [];
    g.push(r);
    groups.set(root, g);
    if (r.campaignId) campaignOf.set(root, r.campaignId);
  }

  const touched: string[] = [];
  let assigned = 0;
  for (const [root, reports] of groups) {
    const existing = campaignOf.get(root);
    if (!existing && reports.length < MIN_CAMPAIGN_REPORTS) continue;
    const linkDomains = [...new Set(reports.flatMap((r) => r.linkDomains))];
    const callbackKeyCount = new Set(reports.flatMap((r) => r.callbackKeys)).size;
    const times = reports.map((r) => r.consentAt).sort();
    const { summary, indicators } = summarise(reports, linkDomains, callbackKeyCount);
    const draft: CampaignDraft = {
      id: existing,
      reportIds: reports.map((r) => r.id),
      summary,
      indicators,
      linkDomains,
      callbackKeyCount,
      firstSeen: times[0]!,
      lastSeen: times[times.length - 1]!,
    };
    const id = await tools.upsertCampaign(draft);
    await tools.draftAdvisory(id, draft);
    touched.push(id);
    assigned += reports.filter((r) => !r.campaignId).length;
  }
  return { campaignsTouched: touched, reportsAssigned: assigned };
}
