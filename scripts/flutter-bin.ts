import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function flutterBin(name: 'flutter' | 'dart'): string | null {
  const dirs = [
    ...(process.env.FLUTTER_ROOT ? [join(process.env.FLUTTER_ROOT, 'bin')] : []),
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/flutter/bin',
  ];
  for (const d of dirs) {
    const p = join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}
