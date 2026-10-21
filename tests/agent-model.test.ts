import { describe, expect, it } from 'vitest';
import { agentModelFromEnv, createSystem, NoModelProvider, OllamaProvider, StaticKeyService } from '../packages/api/src/index.ts';
import type { ModelProvider } from '../packages/api/src/ai/provider.ts';
import { BANK_CLIENT, TENANT, TOKEN_SECRET } from './helpers.ts';

const main = new NoModelProvider();

describe('campaign agent model', () => {
  it('AGT-1: by default the agent uses Qwen3 4B on the local Ollama, separate from the explanation model', () => {
    const m = agentModelFromEnv({}, main);
    expect(m).toBeInstanceOf(OllamaProvider);
    expect((m as OllamaProvider).model).toBe('qwen3:4b-instruct');
    expect((m as OllamaProvider).url).toBe('http://127.0.0.1:11434');
    expect((agentModelFromEnv({ AGENT_OLLAMA_MODEL: 'qwen3:4b', OLLAMA_URL: 'http://10.0.0.5:11434/' }, main) as OllamaProvider).url).toBe('http://10.0.0.5:11434');
  });

  it('AGT-2: same reuses AI_PROVIDER, none writes template briefings, anything else is a config error', () => {
    expect(agentModelFromEnv({ AGENT_AI_PROVIDER: 'same' }, main)).toBe(main);
    expect(agentModelFromEnv({ AGENT_AI_PROVIDER: 'none' }, main)).toBeInstanceOf(NoModelProvider);
    expect(() => agentModelFromEnv({ AGENT_AI_PROVIDER: 'gpt' }, main)).toThrow(/AGENT_AI_PROVIDER/);
  });

  it('AGT-3: the agent briefs campaigns with its own model, and never with the explanation model', async () => {
    const calls: string[] = [];
    const fake = (name: string): ModelProvider => ({
      explain: async () => {
        calls.push(`${name}:explain`);
        return null;
      },
      extractText: async () => null,
      embed: (t) => new NoModelProvider().embed(t),
      draftAdvisory: async () => null,
      briefCampaign: async () => {
        calls.push(`${name}:brief`);
        return { pattern: 'Fake account-update texts with a link.', channel: 'sms', advisory: 'DemoBank never sends links to update your account. Do not tap them.' };
      },
    });
    const sys = createSystem({
      tenants: [TENANT],
      keys: StaticKeyService.random([TENANT.id]),
      bankClients: [BANK_CLIENT],
      tokenSecret: TOKEN_SECRET,
      logger: false,
      model: fake('main'),
      agentModel: fake('agent'),
    });
    const text = 'Your account is blocked. Update now at http://demobank-verify.example/login';
    const e = await new NoModelProvider().embed(text);
    for (let i = 0; i < 2; i++) {
      await sys.store.putReport({ id: `rep_${i}`, tenantId: TENANT.id, maskedText: text, indicators: [], embedding: e.vector, embeddingModel: e.model, linkDomains: ['demobank-verify.example'], callbackKeys: [], campaignId: null, consentAt: new Date().toISOString() });
    }
    const { results } = await sys.runAgent();
    expect(results[0]!.campaignsTouched.length).toBe(1);
    expect(calls).toEqual(['agent:brief']);
    await sys.app.close();
  });

});
