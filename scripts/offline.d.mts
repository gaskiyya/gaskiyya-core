export interface OllamaSettings {
  url: string;
  model: string;
  visionModel: string;
  embeddingModel: string;
}
export const OLLAMA_DEFAULTS: OllamaSettings;
export function ollamaSettings(env: Record<string, string | undefined>): OllamaSettings;
export function probeOllama(o: OllamaSettings, timeoutMs?: number): Promise<{ reachable: boolean; missing: string[] }>;
export function describeAi(env: Record<string, string | undefined>): Promise<string[]>;
export function offlineEnv(ollamaReachable: boolean): Record<string, string>;
