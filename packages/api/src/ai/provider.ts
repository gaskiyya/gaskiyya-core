export interface ModelProvider {
  explain(input: { maskedText: string; language: string; bankName: string; ruleIndicators: string[] }, signal: AbortSignal): Promise<unknown>;
  extractText(input: { imageBase64: string; mediaType: string }, signal: AbortSignal): Promise<{ sender: string | null; text: string } | null>;
  embed(text: string): Promise<Embedding>;
  draftAdvisory(input: { bankName: string; summary: string; indicators: string[]; domains: string[] }, signal: AbortSignal): Promise<string | null>;
  briefCampaign?(input: BriefingInput, signal: AbortSignal): Promise<unknown>;
}

export interface BriefingInput {
  bankName: string;
  summary: string;
  indicators: string[];
  linkDomains: string[];
  callbackKeyCount: number;
  reportCount: number;
  samples: string[];
}

export interface Embedding {
  model: string;
  vector: number[];
}

export const LOCAL_EMBEDDING_MODEL = 'local-hash-256';

const DIMS = 256;

export function localEmbed(text: string): number[] {
  const v = new Float64Array(DIMS);
  const t = ` ${text.toLowerCase().replace(/#+/g, '#').replace(/\s+/g, ' ')} `;
  const add = (s: string, w: number) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIMS]! += w;
  };
  for (let i = 0; i < t.length - 2; i++) add(t.slice(i, i + 3), 1);
  for (const w of t.split(' ')) if (w.length > 2) add(`w:${w}`, 2);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => Math.round((x / norm) * 1e4) / 1e4);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export class NoModelProvider implements ModelProvider {
  async explain(): Promise<unknown> {
    throw new Error('no model configured');
  }
  async extractText() {
    return null;
  }
  async embed(text: string): Promise<Embedding> {
    return { model: LOCAL_EMBEDDING_MODEL, vector: localEmbed(text) };
  }
  async draftAdvisory() {
    return null;
  }
}
