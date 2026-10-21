import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copy } from '@gaskiya/schemas';
import { vectors } from '@gaskiya/test-vectors';
import { canonicalise, demoResult, digest } from '../site/src/fingerprint.ts';

describe('marketing site fingerprint demo', () => {
  it('CAN-1: the site fingerprints exactly like the app, for every shared vector', async () => {
    for (const v of vectors.vectors) {
      expect(canonicalise(v.input), v.id).toBe(v.canonical);
      expect(await digest(v.input), v.id).toBe(v.digest);
    }
  });

  it('F21: without WebCrypto, or if hashing fails, there is no fingerprint and the demo says cannot check', async () => {
    expect(await digest('hello', null)).toBeNull();
    const broken = { digest: () => Promise.reject(new Error('not allowed')) } as unknown as SubtleCrypto;
    expect(await digest('hello', broken)).toBeNull();
    const d = (await digest('hello'))!;
    expect(demoResult(null, null)).toBe('cannot_check');
    expect(demoResult('', '')).toBe('cannot_check');
    expect(demoResult(d, null)).toBe('cannot_check');
    expect(demoResult(null, d)).toBe('cannot_check');
    expect(demoResult('x'.repeat(64), 'x'.repeat(64))).toBe('cannot_check');
    expect(demoResult(d, d)).toBe('match');
    expect(demoResult(d, (await digest('hellO'))!)).toBe('no_match');
  });

  it('F21: the page does not say "Sent by your bank" before a check has run', () => {
    const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
    const match = html.match(/<div class="demo-match"[^>]*>([\s\S]*?)<\/div>/)!;
    expect(match[0]).toContain('data-state="pending"');
    expect(match[1]).not.toContain(copy.verdict.confirmed.title);
    const main = readFileSync(new URL('../site/src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("state === 'match' ? copy.verdict.confirmed.title");
    expect(main).not.toMatch(/same \? copy\.verdict\.confirmed/);
  });
});
