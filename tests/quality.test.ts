import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copy } from '@gaskiya/schemas';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);

describe('quality gates', () => {
  it('Q-1: one command installs, one tests, one starts the system', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
    expect(scripts.dev).toMatch(/vite --mode site/);
    expect(scripts.build).toContain('typecheck');
    expect(scripts['build:ui']).toMatch(/build:site/);
  });

  it('Q-2: TypeScript type checks and ESLint pass', () => {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { stdio: 'pipe' });
    execFileSync('npx', ['tsc', '-p', 'tsconfig.app.json'], { stdio: 'pipe' });
    execFileSync('npx', ['eslint', '.', '--max-warnings', '0'], { stdio: 'pipe' });
  }, 120_000);

  it('Q-3: no test is skipped, disabled or marked as expected to fail', () => {
    const tests = files.filter((f) => /(^tests\/.*\.ts$)|(\/test\/.*_test\.dart$)/.test(f));
    expect(tests.length).toBeGreaterThan(8);
    const banned = /\.(skip|only|todo|fails)\(|\b(xit|xdescribe|xtest)\(|skip:\s*(true|['"])|@Skip|\btestWidgets\.skip/;
    const offending = tests.filter((f) => banned.test(readFileSync(f, 'utf8').replace(/const banned = .*\n/, '')));
    expect(offending).toEqual([]);
  });

  it('CH-4: verdict wording lives only in the shared copy file', () => {
    const fixed = [
      copy.verdict.confirmed.title,
      copy.verdict.not_confirmed.body.split('{bank}')[1]!.trim(),
      copy.verdict.cannot_check.body,
      copy.call.not_calling.title,
      copy.explain.fallback,
      copy.link.belongs.title,
    ];
    const sources = files.filter((f) => /^(apps|packages)\/.*\.(ts|tsx|dart|mjs|js)$/.test(f) && !f.includes('/test') && !f.startsWith('mobile/art/'));
    const offending: string[] = [];
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      for (const s of fixed) if (text.includes(s)) offending.push(`${f}: ${s.slice(0, 40)}`);
    }
    expect(offending).toEqual([]);
    expect(readFileSync('mobile/assets/copy.json', 'utf8')).toBe(readFileSync('packages/schemas/copy.json', 'utf8'));
  });
});
