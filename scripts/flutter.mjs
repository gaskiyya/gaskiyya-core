#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

function bin(name) {
  const dirs = [...(process.env.FLUTTER_ROOT ? [join(process.env.FLUTTER_ROOT, 'bin')] : []), ...(process.env.PATH ?? '').split(delimiter), '/opt/flutter/bin'];
  for (const d of dirs) if (existsSync(join(d, name))) return join(d, name);
  return null;
}

const step = process.argv[2];
const flutter = bin('flutter');
const dart = bin('dart');
if (!flutter || !dart) {
  console.error('Flutter SDK not found. Install Flutter (https://docs.flutter.dev/get-started/install) or set FLUTTER_ROOT.');
  process.exit(1);
}

const run = (cmd, args, cwd) => {
  console.log(`\n$ (${cwd}) ${[cmd.split('/').pop(), ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const pkgs = [
  { dir: 'packages/canonical_dart', tool: dart },
  { dir: 'mobile', tool: flutter },
];

for (const { dir, tool } of pkgs) {
  if (step === 'pub-get') run(tool, ['pub', 'get'], dir);
  else if (step === 'test') run(tool, ['test'], dir);
  else if (step === 'analyze') run(tool, tool === flutter ? ['analyze', '--fatal-infos'] : ['analyze', '--fatal-infos'], dir);
  else {
    console.error('usage: flutter.mjs pub-get|test|analyze');
    process.exit(2);
  }
}
