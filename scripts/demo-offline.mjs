#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describeAi, offlineEnv, ollamaSettings, probeOllama } from './offline.mjs';

const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const settings = ollamaSettings({ ...fileEnv, ...process.env });
const { reachable } = await probeOllama(settings);
const env = { ...process.env, ...offlineEnv(reachable) };

console.log(`
  Offline demo mode: memory store, bank sandbox console, no Firestore, push, email or WhatsApp`);
for (const line of await describeAi({ ...fileEnv, ...env })) console.log(`    ${line}`);
if (!reachable) {
  console.log(`
    Ollama is not answering on ${settings.url}, so explanations use the fixed fallback text.
    For model explanations, install Ollama (https://ollama.com), then while still online:
      ollama pull ${settings.model}
      ollama pull ${settings.visionModel}
      ollama pull ${settings.embeddingModel}
    and start it with: ollama serve`);
}
console.log('');

const child = spawn(process.execPath, ['scripts/dev.mjs'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
