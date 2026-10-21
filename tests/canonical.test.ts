import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalise, contentDigest, isAssigned, UNICODE_VERSION } from '@gaskiya/canonical';
import { ASSIGNED_RANGES } from '../packages/canonical/src/unicode-assigned.ts';
import { vectors } from '@gaskiya/test-vectors';
import { flutterBin } from '../scripts/flutter-bin.ts';

const byId = new Map(vectors.vectors.map((v) => [v.id, v]));

describe('canonicalisation', () => {
  it('CAN-1: TypeScript matches every shared vector', () => {
    for (const v of vectors.vectors) {
      expect(canonicalise(v.input), v.id).toBe(v.canonical);
      expect(contentDigest(v.input), v.id).toBe(v.digest);
    }
  });

  it('CAN-1: Dart gives identical digests for every shared vector', () => {
    const dart = flutterBin('dart');
    if (!dart) throw new Error('Dart SDK not found: run `pnpm setup` or put flutter on PATH');
    const out = execFileSync(dart, ['test', '--reporter', 'compact'], { cwd: 'packages/canonical_dart', encoding: 'utf8' });
    expect(out).toMatch(/All tests passed/);
  }, 120_000);

  it('CAN-2: whitespace, zero-width and compatibility forms do not change the digest', () => {
    for (const group of vectors.sameDigestGroups) {
      const digests = new Set(group.map((id) => contentDigest(byId.get(id)!.input)));
      expect(digests.size, group.join(',')).toBe(1);
    }
    expect(contentDigest('  Debit:\tNGN5,000.00 \n')).toBe(contentDigest('Debit: NGN5,000.00'));
    expect(contentDigest('Debit:\u200B NGN5,000.00')).toBe(contentDigest('Debit: NGN5,000.00'));
    expect(contentDigest('\uFF24ebit: NGN5,000.00')).toBe(contentDigest('Debit: NGN5,000.00'));
  });

  it('CAN-3: one changed character in a link, number, amount or case changes the digest', () => {
    for (const [a, b] of vectors.differentDigestPairs) {
      expect(contentDigest(byId.get(a!)!.input), `${a} vs ${b}`).not.toBe(contentDigest(byId.get(b!)!.input));
    }
    expect(contentDigest('Debit: NGN5,000.00')).not.toBe(contentDigest('debit: NGN5,000.00'));
  });

  it('F13: TypeScript and Dart pin the same Unicode version with identical assigned-code-point tables', () => {
    expect(UNICODE_VERSION).toBe('15.1');
    const dartSrc = readFileSync('packages/canonical_dart/lib/src/unicode_assigned.dart', 'utf8');
    expect(dartSrc).toContain(`const unicodeVersion = '${UNICODE_VERSION}';`);
    const dartRanges = dartSrc.slice(dartSrc.indexOf('<int>[')).match(/0x[0-9A-F]+/g)!.map((h) => parseInt(h, 16));
    expect(dartRanges).toEqual([...ASSIGNED_RANGES]);
    for (let i = 1; i < ASSIGNED_RANGES.length; i++) {
      const [prev, cur] = [ASSIGNED_RANGES[i - 1]!, ASSIGNED_RANGES[i]!];
      if (i % 2) expect(cur).toBeGreaterThanOrEqual(prev);
      else expect(cur).toBeGreaterThan(prev + 1);
    }
  });

  it('F13: this runtime knows at least the pinned Unicode version', () => {
    const assigned = /^\p{Assigned}$/u;
    for (let i = 0; i < ASSIGNED_RANGES.length; i += 2) {
      for (let cp = ASSIGNED_RANGES[i]!; cp <= ASSIGNED_RANGES[i + 1]!; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        if (!assigned.test(String.fromCodePoint(cp))) throw new Error(`U+${cp.toString(16)} is not assigned in this runtime`);
      }
    }
  });

  it('F13: code points assigned after the pinned version are kept unchanged and stop normalisation', () => {
    const qaList = [0x0558, 0x058b, 0x058c, 0x209d, 0x209e, 0x209f, 0xd7a4, 0x107bb, 0x107bf, 0x1b123, 0x1b126, 0x1d6a6, 0x1df95, 0x1dfcd, 0x1dfff, 0x1aef, 0x1d252, 0x1ccd6, 0xa7f1];
    const acute = String.fromCodePoint(0x301);
    const dot = String.fromCodePoint(0x323);
    for (const cp of qaList) {
      expect(isAssigned(cp), cp.toString(16)).toBe(false);
      const ch = String.fromCodePoint(cp);
      expect(canonicalise(ch), cp.toString(16)).toBe(ch);
      expect(canonicalise('e' + acute + ch + dot), cp.toString(16)).toBe(String.fromCodePoint(0xe9) + ch + dot);
    }
    expect(isAssigned(0x41)).toBe(true);
    expect(isAssigned(0x1ecb)).toBe(true);
  });

  it('CAN-4: at least 30 vectors, covering multi-line SMS, naira, Pidgin and tampered links', () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(30);
    const all = vectors.vectors.map((v) => v.input);
    expect(all.some((t) => t.includes('\n'))).toBe(true);
    expect(all.some((t) => t.includes('\u20A6'))).toBe(true);
    expect(vectors.vectors.some((v) => v.id.startsWith('pidgin'))).toBe(true);
    expect(vectors.vectors.filter((v) => v.id.startsWith('link-tampered')).length).toBeGreaterThanOrEqual(3);
  });
});
