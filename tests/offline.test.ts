import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configFromEnv, MemoryMessaging, MemoryPush, MemoryStore, NoModelProvider, OllamaProvider } from '../packages/api/src/index.ts';
import { offlineEnv } from '../scripts/offline.mjs';
import { demoEnv } from './helpers.ts';

describe('offline demo mode', () => {
  const online = demoEnv({
    STORE: 'firestore',
    FIRESTORE_PROJECT_ID: 'gaskiya-prod',
    GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/service-account.json',
    RESEND_API_KEY: 're_test_not_real',
    EMAIL_FROM: 'Gaskiya <alerts@example.com>',
    WHATSAPP_VERIFY_TOKEN: 'v',
    WHATSAPP_APP_SECRET: 's',
    WHATSAPP_ACCESS_TOKEN: 'a',
    WHATSAPP_PHONE_NUMBER_ID: '1',
    GEMINI_API_KEY: 'test-key-not-real',
    NODE_ENV: 'production',
  });

  for (const ollamaUp of [true, false]) {
    it(`resolves to the memory store and no external integration (Ollama ${ollamaUp ? 'running' : 'not running'})`, () => {
      const cfg = configFromEnv({ ...online, ...offlineEnv(ollamaUp) });
      expect(cfg.store).toBeInstanceOf(MemoryStore);
      expect(cfg.push).toBeInstanceOf(MemoryPush);
      expect(cfg.mailer).toBeNull();
      expect(cfg.whatsapp).toBeNull();
      expect(cfg.messaging).toBeInstanceOf(MemoryMessaging);
      expect(cfg.model).toBeInstanceOf(ollamaUp ? OllamaProvider : NoModelProvider);
      if (cfg.model instanceof OllamaProvider) expect(new URL(cfg.model.url).hostname).toBe('127.0.0.1');
      expect(cfg.integrations).toMatchObject({ store: 'memory: not persisted, demo only', push: 'off: live in-app events only', email: 'off', whatsapp: 'off' });
      expect(cfg.allowDemoReset).toBe(true);
    });
  }

  it('pnpm demo:offline wraps pnpm dev with the offline overrides', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['demo:offline']).toBe('node scripts/demo-offline.mjs');
    const script = readFileSync('scripts/demo-offline.mjs', 'utf8');
    expect(script).toContain('offlineEnv(');
    expect(script).toContain('scripts/dev.mjs');
  });
});
