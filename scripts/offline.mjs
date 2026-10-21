export const OLLAMA_DEFAULTS = {
  url: 'http://127.0.0.1:11434',
  model: 'llama3.1:8b',
  visionModel: 'gemma3:4b',
  embeddingModel: 'nomic-embed-text',
};

export function ollamaSettings(env) {
  return {
    url: (env.OLLAMA_URL || OLLAMA_DEFAULTS.url).replace(/\/+$/, ''),
    model: env.OLLAMA_MODEL || OLLAMA_DEFAULTS.model,
    visionModel: env.OLLAMA_VISION_MODEL || OLLAMA_DEFAULTS.visionModel,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL || OLLAMA_DEFAULTS.embeddingModel,
  };
}

const withTag = (n) => (n.includes(':') ? n : `${n}:latest`);

export async function probeOllama(o, timeoutMs = 1500) {
  const wanted = [...new Set([o.model, o.visionModel, o.embeddingModel])];
  try {
    const r = await fetch(`${o.url}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { reachable: false, missing: wanted };
    const body = await r.json();
    const have = new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean).map(withTag));
    return { reachable: true, missing: wanted.filter((m) => !have.has(withTag(m))) };
  } catch {
    return { reachable: false, missing: wanted };
  }
}

export async function describeAi(env) {
  return [...(await describeMainAi(env)), ...(await describeAgentAi(env))];
}

async function describeAgentAi(env) {
  const provider = (env.AGENT_AI_PROVIDER || 'ollama').toLowerCase();
  if (provider === 'same') return ['Agent AI              same as AI'];
  if (provider === 'none') return ['Agent AI              off: template briefings'];
  if (provider !== 'ollama') return [`Agent AI              unknown AGENT_AI_PROVIDER "${provider}"`];
  const url = (env.OLLAMA_URL || OLLAMA_DEFAULTS.url).replace(/\/+$/, '');
  const model = env.AGENT_OLLAMA_MODEL || 'qwen3:4b-instruct';
  const s = await probeOllama({ url, model, visionModel: model, embeddingModel: model });
  const state = !s.reachable ? 'not reachable: template briefings until it is (start it with: ollama serve)' : s.missing.length ? `reachable; run: ollama pull ${model}` : 'reachable, model pulled';
  return [`Agent AI              ollama at ${url} (${model})`, `                      ${state}`];
}

async function describeMainAi(env) {
  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'none') return ['AI                    off: fixed fallback explanations'];
  if (provider === 'gemini' || provider === 'openai') {
    const key = provider === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY;
    const model = provider === 'gemini' ? env.GEMINI_MODEL : env.OPENAI_MODEL;
    return [`AI                    ${provider}${model ? ` (${model})` : ''}${key ? '' : ': no API key, fixed fallback explanations'}`];
  }
  if (provider !== 'ollama') return [`AI                    unknown AI_PROVIDER "${provider}"`];
  const o = ollamaSettings(env);
  const s = await probeOllama(o);
  const lines = [`AI                    ollama at ${o.url} (${o.model}, vision ${o.visionModel}, embeddings ${o.embeddingModel})`];
  if (!s.reachable) lines.push('                      not reachable: fixed fallback explanations until it is (start it with: ollama serve)');
  else if (s.missing.length) lines.push(`                      reachable; models still to pull: ${s.missing.map((m) => `ollama pull ${m}`).join(' && ')}`);
  else lines.push('                      reachable, all models pulled');
  return lines;
}

export function offlineEnv(ollamaReachable) {
  return {
    STORE: 'memory',
    NODE_ENV: 'development',
    ALLOW_DEMO_RESET: 'true',
    SIM_DEMO_LOGIN: 'true',
    SIM_SWAP_PROVIDER: 'simulated',
    FIRESTORE_PROJECT_ID: '',
    FIRESTORE_EMULATOR_HOST: '',
    FIRESTORE_SERVICE_ACCOUNT_JSON: '',
    GOOGLE_CLOUD_PROJECT: '',
    FCM_SERVICE_ACCOUNT_JSON: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
    FCM_PROJECT_ID: '',
    RESEND_API_KEY: '',
    WHATSAPP_VERIFY_TOKEN: '',
    WHATSAPP_APP_SECRET: '',
    WHATSAPP_ACCESS_TOKEN: '',
    WHATSAPP_PHONE_NUMBER_ID: '',
    GEMINI_API_KEY: '',
    OPENAI_API_KEY: '',
    AI_PROVIDER: ollamaReachable ? 'ollama' : 'none',
    AI_TIMEOUT_MS: ollamaReachable ? '10000' : '4000',
  };
}
