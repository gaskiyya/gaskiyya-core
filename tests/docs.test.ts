import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as schemas from '@gaskiya/schemas';
import { contentDigest } from '@gaskiya/canonical';

const page = readFileSync('site/banks.html', 'utf8');
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const blocks = (attr: RegExp) => [...page.matchAll(attr)].map((m) => ({ name: m[1] ?? '', text: unescape(m[2] ?? m[1]!) }));

const CustomerTokenRequest = z.strictObject({ phone: schemas.E164 });
const schemaFor: Record<string, z.ZodType> = { ...(schemas as unknown as Record<string, z.ZodType>), CustomerTokenRequest };

describe('bank integration guide', () => {
  it('every request example is accepted by the schema it documents', () => {
    const requests = blocks(/<code data-schema="(\w+)">([\s\S]*?)<\/code>/g);
    expect(requests.length).toBeGreaterThanOrEqual(12);
    for (const r of requests) {
      const schema = schemaFor[r.name];
      expect(schema, `no schema called ${r.name}`).toBeDefined();
      const parsed = schema!.safeParse(JSON.parse(r.text));
      expect(parsed.success, `${r.name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('every response example is valid JSON', () => {
    const responses = [...page.matchAll(/<code data-json>([\s\S]*?)<\/code>/g)].map((m) => unescape(m[1]!));
    expect(responses.length).toBeGreaterThanOrEqual(15);
    for (const r of responses) expect(() => JSON.parse(r), r.slice(0, 80)).not.toThrow();
  });

  it('every documented endpoint is a route the registry serves', () => {
    const source = readFileSync('packages/api/src/app.ts', 'utf8');
    const routes = new Set([...source.matchAll(/app\.(get|post|patch)(?:<[^>]*>)?\('([^']+)'/g)].map((m) => `${m[1]!.toUpperCase()} ${m[2]}`));
    const documented = [...page.matchAll(/<span class="m m-\w+">(\w+)<\/span> <code>([^<]+)<\/code>/g)]
      .map((m) => `${m[1]} ${m[2]!.replace(/\{(\w+)\}/g, ':$1')}`)
      .filter((e) => !e.includes(':customerTokenUrl'));
    expect(documented.length).toBeGreaterThanOrEqual(19);
    for (const e of documented) expect(routes.has(e), `${e} is documented but not served`).toBe(true);
    for (const r of routes) {
      if (!/^(GET|POST|PATCH) \/v1\//.test(r) || /notifications|agent|admin|dismiss/.test(r)) continue;
      expect(documented.includes(r), `${r} is served but not documented`).toBe(true);
    }
  });

  it('the sample digest is the real fingerprint of the sample text', () => {
    expect(page).toContain('2c0c122ad56268258bb16e6ba85fb2f9c8bab9ce1d8ff20527060f8c3151729f');
    expect(contentDigest('DemoBank: Debit\nAmt: NGN5,000.00\nAcc: ***5678')).toBe('2c0c122ad56268258bb16e6ba85fb2f9c8bab9ce1d8ff20527060f8c3151729f');
  });
});
