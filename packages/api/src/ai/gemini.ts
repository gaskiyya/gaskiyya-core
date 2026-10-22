import { GoogleGenAI, ThinkingLevel } from '@google/genai';
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

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  baseUrl?: string;
}

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const GEMINI_DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

export class GeminiProvider implements ModelProvider {
  private ai: GoogleGenAI;
  readonly model: string;
  readonly embeddingModel: string;

  constructor(o: GeminiOptions) {
    this.ai = new GoogleGenAI({ apiKey: o.apiKey, ...(o.baseUrl ? { httpOptions: { baseUrl: o.baseUrl } } : {}) });
    this.model = o.model || GEMINI_DEFAULT_MODEL;
    this.embeddingModel = o.embeddingModel || GEMINI_DEFAULT_EMBEDDING_MODEL;
  }

  private thinking() {
    return this.model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {};
  }

  private async json(contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'], system: string, schema: object, signal: AbortSignal): Promise<unknown> {
    const r = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        maxOutputTokens: 2048,
        abortSignal: signal,
        ...this.thinking(),
      },
    });
    const text = r.text;
    return text ? JSON.parse(text) : null;
  }

  explain(input: { maskedText: string; language: string; bankName: string }, signal: AbortSignal) {
    return this.json(explainUserText(input.bankName, input.language, input.maskedText), EXPLAIN_SYSTEM, EXPLAIN_SCHEMA, signal);
  }

  async extractText(input: { imageBase64: string; mediaType: string }, signal: AbortSignal) {
    const raw = await this.json(
      [{ role: 'user', parts: [{ inlineData: { data: input.imageBase64, mimeType: input.mediaType } }, { text: 'Transcribe the message.' }] }],
      EXTRACT_SYSTEM,
      EXTRACT_SCHEMA,
      signal,
    );
    return toExtraction(raw);
  }

  async embed(text: string): Promise<Embedding> {
    try {
      const r = await this.ai.models.embedContent({
        model: this.embeddingModel,
        contents: text,
        config: { outputDimensionality: EMBED_DIMENSIONS, taskType: 'CLUSTERING', abortSignal: AbortSignal.timeout(4000) },
      });
      const vector = r.embeddings?.[0]?.values;
      if (vector?.length) return { model: this.embeddingModel, vector };
    } catch {
      // Use the deterministic local embedding if the provider is unavailable.
    }
    return { model: LOCAL_EMBEDDING_MODEL, vector: localEmbed(text) };
  }

  async draftAdvisory(input: { bankName: string; summary: string; indicators: string[]; domains: string[] }, signal: AbortSignal) {
    const r = await this.ai.models.generateContent({
      model: this.model,
      contents: advisoryUserText(input),
      config: { systemInstruction: ADVISORY_SYSTEM, maxOutputTokens: 1024, abortSignal: signal, ...this.thinking() },
    });
    return guardAdvisory(r.text);
  }

  briefCampaign(input: BriefingInput, signal: AbortSignal) {
    return this.json(briefingUserText(input), BRIEFING_SYSTEM, BRIEFING_SCHEMA, signal);
  }
}
