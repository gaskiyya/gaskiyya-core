import { LicenceDataFile } from '@gaskiya/licences';
import { buildLicenceIndex, type LicenceIndex } from '../domain/licence.ts';

export interface LicenceRegistry {
  snapshot(): Promise<LicenceIndex>;
}

export class MemoryLicenceRegistry implements LicenceRegistry {
  private index: LicenceIndex;
  constructor(files: readonly LicenceDataFile[]) {
    this.index = buildLicenceIndex(files.map((f) => LicenceDataFile.parse(f)));
  }
  async snapshot() {
    return this.index;
  }
}

export class UnavailableLicenceRegistry implements LicenceRegistry {
  async snapshot(): Promise<LicenceIndex> {
    throw new Error('licence lists unavailable');
  }
}
