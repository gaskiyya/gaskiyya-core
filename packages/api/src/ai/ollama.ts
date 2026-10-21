import {
  ADVISORY_SYSTEM,
  advisoryUserText,
  BRIEFING_SCHEMA,
  BRIEFING_SYSTEM,
  briefingUserText,
  EXPLAIN_SCHEMA,
  EXPLAIN_SYSTEM,
  explainUserText,
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  toExtraction,
} from './prompts.ts';
import { NoModelProvider, type BriefingInput, type Embedding, type ModelProvider } from './provider.ts';

export interface OllamaOptions {
  url?: string;
  model?: string;
  visionModel?: string;
  embeddingModel?: string;
}

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
export const OLLAMA_DEFAULT_MODEL = 'llama3.1:8b';
export const OLLAMA_DEFAULT_VISION_MODEL = 'gemma3:4b';
export const OLLAMA_DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

const KEEP_ALIVE = '30m';

export interface OllamaStatus {
  reachable: boolean;
  missing: string[];
}

export class OllamaProvider implements ModelProvider {
  readonly url: string;
  readonly model: string;
  readonly visionModel: string;
  readonly embeddingModel: string;
  private none = new NoModelProvider();

  constructor(o: OllamaOptions = {}) {
    this.url = (o.url || OLLAMA_DEFAULT_URL).replace(/\/+$/, '');
    this.model = o.model || OLLAMA_DEFAULT_MODEL;
    this.visionModel = o.visionModel || OLLAMA_DEFAULT_VISION_MODEL;
    this.embeddingModel = o.embeddingModel || OLLAMA_DEFAULT_EMBEDDING_MODEL;
  }

  private async post(path: string, body: object, signal: AbortSignal): Promise<unknown> {
    const r = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) throw new Error(`Ollama ${path} returned ${r.status}`);
    return r.json();
  }

  private async chat(model: string, messages: object[], format: object | undefined, signal: AbortSignal): Promise<string | null> {
    const r = (await this.post('/api/chat', { model, messages, stream: false, keep_alive: KEEP_ALIVE, options: { temperature: 0 }, ...(format ? { format } : {}) }, signal)) as {
      message?: { content?: unknown };
    } | null;
    const content = r?.message?.content;
    return typeof content === 'string' && content.trim() ? content : null;
  }

  private async json(model: string, system: string, user: object, schema: object, signal: AbortSignal): Promise<unknown> {
    const text = await this.chat(model, [{ role: 'system', content: system }, { role: 'user', ...user }], schema, signal);
    return text ? JSON.parse(text) : null;
  }

  async explain(input: { maskedText: string; language: string; bankName: string; ruleIndicators: string[] }, signal: AbortSignal): Promise<unknown> {
    try {
      return await this.json(this.model, EXPLAIN_SYSTEM, { content: explainUserText(input.bankName, input.language, input.maskedText) }, EXPLAIN_SCHEMA, signal);
    } catch {
      return this.none.explain();
    }
  }

  async extractText(input: { imageBase64: string; mediaType: string }, signal: AbortSignal) {
    try {
      const raw = await this.json(this.visionModel, EXTRACT_SYSTEM, { content: 'Transcribe the message.', images: [input.imageBase64] }, EXTRACT_SCHEMA, signal);
      return toExtraction(raw);
    } catch {
      return this.none.extractText();
    }
  }

  async embed(text: string): Promise<Embedding> {
    try {
      const r = (await this.post('/api/embed', { model: this.embeddingModel, input: text, keep_alive: KEEP_ALIVE }, AbortSignal.timeout(4000))) as { embeddings?: unknown[] } | null;
      const vector = r?.embeddings?.[0];
      if (Array.isArray(vector) && vector.length && vector.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        return { model: this.embeddingModel, vector };
      }
    } catch {
    }
    return this.none.embed(text);
  }

  async draftAdvisory(input: { bankName: string; summary: string; indicators: string[]; domains: string[] }, signal: AbortSignal) {
    try {
      const text = await this.chat(this.model, [{ role: 'system', content: ADVISORY_SYSTEM }, { role: 'user', content: advisoryUserText(input) }], undefined, signal);
      return text?.trim() || null;
    } catch {
      return this.none.draftAdvisory();
    }
  }

  briefCampaign(input: BriefingInput, signal: AbortSignal): Promise<unknown> {
    return this.json(this.model, BRIEFING_SYSTEM, { content: briefingUserText(input) }, BRIEFING_SCHEMA, signal);
  }

  async warm(): Promise<void> {
    for (const model of new Set([this.model, this.visionModel])) {
      await this.post('/api/chat', { model, messages: [], keep_alive: KEEP_ALIVE }, AbortSignal.timeout(120_000)).catch(() => undefined);
    }
  }

  async status(timeoutMs = 1500): Promise<OllamaStatus> {
    try {
      const r = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return { reachable: false, missing: [] };
      const body = (await r.json()) as { models?: { name?: string; model?: string }[] };
      const have = new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean).map((n) => withTag(n!)));
      const wanted = [...new Set([this.model, this.visionModel, this.embeddingModel])];
      return { reachable: true, missing: wanted.filter((m) => !have.has(withTag(m))) };
    } catch {
      return { reachable: false, missing: [] };
    }
  }
}

function withTag(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}
