import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils';

type Data = string | Uint8Array;
const bytes = (d: Data) => (typeof d === 'string' ? utf8ToBytes(d) : d);

class Hash {
  private parts: Uint8Array[] = [];
  constructor(private key?: Uint8Array) {}
  update(d: Data, _enc?: string) {
    this.parts.push(bytes(d));
    return this;
  }
  digest(): Uint8Array;
  digest(enc: 'hex'): string;
  digest(enc?: 'hex') {
    const all = concatBytes(...this.parts);
    const out = this.key ? hmac(sha256, this.key, all) : sha256(all);
    return enc === 'hex' ? bytesToHex(out) : out;
  }
}

const sha = (alg: string) => {
  if (alg !== 'sha256') throw new Error(`sandbox crypto supports sha256 only, not ${alg}`);
};

export function createHash(alg: string) {
  sha(alg);
  return new Hash();
}

export function createHmac(alg: string, key: Data) {
  sha(alg);
  return new Hash(bytes(key));
}

export const randomUUID = () => crypto.randomUUID();

export function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomInt(min: number, max?: number) {
  if (max === undefined) [min, max] = [0, min];
  const range = max - min;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return min + (buf[0]! % range);
}
