import OpenAI from 'openai';
import {
  ADVISORY_SYSTEM,
  advisoryUserText,
  BRIEFING_SCHEMA,
  BRIEFING_SYSTEM,
  briefingUserText,
  EMBED_DIMENSIONS,
  EXPLAIN_SCHEMA,
  EXPLAIN_SYSTEM,
  explainUserText,
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  toExtraction,
} from './prompts.ts';
import { LOCAL_EMBEDDING_MODEL, localEmbed, type BriefingInput, type Embedding, type ModelProvider } from './provider.ts';
import { guardAdvisory } from './briefing.ts';

export interface OpenAIOptions {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  baseUrl?: string;
}

export const OPENAI_DEFAULT_MODEL = 'gpt-5.4-mini';
export const OPENAI_DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export class OpenAIProvider implements ModelProvider {
  private client: OpenAI;
  readonly model: string;
  readonly embeddingModel: string;

  constructor(o: OpenAIOptions) {
    this.client = new OpenAI({ apiKey: o.apiKey, maxRetries: 0, ...(o.baseUrl ? { baseURL: o.baseUrl } : {}) });
    this.model = o.model || OPENAI_DEFAULT_MODEL;
    this.embeddingModel = o.embeddingModel || OPENAI_DEFAULT_EMBEDDING_MODEL;
  }

  private async json(input: OpenAI.Responses.ResponseInput | string, system: string, name: string, schema: object, signal: AbortSignal): Promise<unknown> {
    const r = await this.client.responses.create(
      {
        model: this.model,
        instructions: system,
        input,
        reasoning: { effort: 'low' },
        max_output_tokens: 2048,
        store: false,
        text: { format: { type: 'json_schema', name, schema: schema as Record<string, unknown>, strict: true } },
      },
      { signal },
    );
    return r.output_text ? JSON.parse(r.output_text) : null;
  }

  explain(input: { maskedText: string; language: string; bankName: string; ruleIndicators: string[] }, signal: AbortSignal) {
    return this.json(explainUserText(input.bankName, input.language, input.maskedText, input.ruleIndicators), EXPLAIN_SYSTEM, 'explanation', EXPLAIN_SCHEMA, signal);
  }

  async extractText(input: { imageBase64: string; mediaType: string }, signal: AbortSignal) {
    const raw = await this.json(
      [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: `data:${input.mediaType};base64,${input.imageBase64}`, detail: 'high' },
            { type: 'input_text', text: 'Transcribe the message.' },
          ],
        },
      ],
      EXTRACT_SYSTEM,
      'extraction',
      EXTRACT_SCHEMA,
      signal,
    );
    return toExtraction(raw);
  }

  async embed(text: string): Promise<Embedding> {
    try {
      const r = await this.client.embeddings.create(
        { model: this.embeddingModel, input: text, dimensions: EMBED_DIMENSIONS },
        { signal: AbortSignal.timeout(4000) },
      );
      const vector = r.data[0]?.embedding;
      if (vector?.length) return { model: this.embeddingModel, vector };
    } catch {
      // Use the deterministic local embedding if the provider is unavailable.
    }
    return { model: LOCAL_EMBEDDING_MODEL, vector: localEmbed(text) };
  }

  async draftAdvisory(input: { bankName: string; summary: string; indicators: string[]; domains: string[] }, signal: AbortSignal) {
    const r = await this.client.responses.create(
      { model: this.model, instructions: ADVISORY_SYSTEM, input: advisoryUserText(input), reasoning: { effort: 'low' }, max_output_tokens: 1024, store: false },
      { signal },
    );
    return guardAdvisory(r.output_text);
  }

  briefCampaign(input: BriefingInput, signal: AbortSignal) {
    return this.json(briefingUserText(input), BRIEFING_SYSTEM, 'campaign_briefing', BRIEFING_SCHEMA, signal);
  }
}
