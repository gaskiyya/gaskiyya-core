import { ASSIGNED_RANGES, UNICODE_VERSION } from './unicode-assigned.ts';

export { UNICODE_VERSION };

export function isAssigned(cp: number): boolean {
  let lo = 0;
  let hi = ASSIGNED_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ASSIGNED_RANGES[mid * 2]!) hi = mid - 1;
    else if (cp > ASSIGNED_RANGES[mid * 2 + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

export function nfkcPinned(text: string): string {
  let out = '';
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (!isAssigned(cp)) {
      out += text.slice(start, i).normalize('NFKC') + text.slice(i, i + width);
      start = i + width;
    }
    i += width;
  }
  return out + text.slice(start).normalize('NFKC');
}
