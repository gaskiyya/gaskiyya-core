#!/usr/bin/env node
import { copyFileSync, readdirSync } from 'node:fs';

for (const f of readdirSync('packages/schemas').filter((f) => /^copy(\.[a-z]+)?\.json$/.test(f)).sort()) {
  copyFileSync(`packages/schemas/${f}`, `mobile/assets/${f}`);
  console.log(`copied packages/schemas/${f} -> mobile/assets/${f}`);
}
