import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LicenceDataFile } from '@gaskiya/licences';
import { buildLicenceIndex, type LicenceIndex } from '../domain/licence.ts';
import type { LicenceRegistry } from './registry.ts';

export class DirectoryLicenceRegistry implements LicenceRegistry {
  private index: LicenceIndex | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private dir: string,
    private refreshMs = 10 * 60 * 1000,
    private clock: () => number = Date.now,
  ) {}

  private async load() {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json')).sort();
    const files = await Promise.all(names.map(async (n) => LicenceDataFile.parse(JSON.parse(await readFile(join(this.dir, n), 'utf8')))));
    if (files.length === 0) throw new Error(`no licence data files in ${this.dir}`);
    this.index = buildLicenceIndex(files);
  }

  async snapshot() {
    if (!this.index || this.clock() - this.loadedAt >= this.refreshMs) {
      this.loading ??= this.load()
        .catch(() => {})
        .finally(() => {
          this.loadedAt = this.clock();
          this.loading = null;
        });
      await this.loading;
    }
    if (!this.index) throw new Error('licence lists unavailable');
    return this.index;
  }
}
