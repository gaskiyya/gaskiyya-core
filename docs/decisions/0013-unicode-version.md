# 0013: NFKC is pinned to Unicode 15.1

**Status:** accepted (approved by owner, 2026-10-20)

Canonicalisation (0001) applies NFKC. The TypeScript library used the runtime's ICU (`String.prototype.normalize`) and the Dart library used `unorm_dart`, and the two know different Unicode versions: Node 22 ships ICU 78 (Unicode 17), `node:24-slim` Unicode 16, `unorm_dart ^0.3.3` Unicode 18, and browsers vary. Normalisation is stable for characters that are assigned, but each new version adds characters with compatibility mappings (for example the outlined Latin letters U+1CCD6 onwards, which fold to `A`, `B`, ...) and new combining marks. A message containing one of them gave a different digest on the bank's side and the customer's side. QA finding F13 found 69 single code points and 13 pairs that differed; a fuzz over every code point found 1,138 differing strings.

## Rule

NFKC is defined by **Unicode 15.1**, whatever version the runtime knows:

1. A code point that is not assigned in Unicode 15.1 (unassigned, a noncharacter, or assigned in 16.0 or later) is copied to the output unchanged.
2. It also splits the text: the runs between such code points are normalised separately by the runtime (ICU in Node and the browser, `unorm_dart` in the app), and joined back in order.

This is exactly how a Unicode 15.1 normaliser treats such a code point. An unassigned code point has no decomposition and combining class 0, and composes with nothing, so it is a normalisation boundary. Splitting there therefore gives the 15.1 result. Within a run every code point is assigned in 15.1, and the Unicode normalisation stability policy guarantees that any later version normalises those runs exactly as 15.1 does.

The 15.1 table is generated once from `DerivedAge.txt` by `packages/canonical/scripts/generate-unicode.mjs`. It is committed as ASCII hex ranges in both languages: `packages/canonical/src/unicode-assigned.ts` and `packages/canonical_dart/lib/src/unicode_assigned.dart`. It has 707 ranges and 289,394 code points. The splitting code is `nfkc.ts` and `nfkc.dart`. The marketing site's demo (`site/src/fingerprint.ts`) imports the same `nfkcPinned` from `@gaskiya/canonical/nfkc`.

A runtime must know at least Unicode 15.1. Node 22 and later do (`engines` is `>=22`), and so does `unorm_dart` 0.3.3. `tests/canonical.test.ts` fails if the running Node does not know every code point in the table, and it also checks that the TypeScript and Dart tables are identical.

## Why 15.1

It is the oldest version among the runtimes we support (Node 22 LTS shipped with it), so every supported runtime can apply all of its mappings. Bank messages are written in Latin script, with Hausa hooked letters, Yoruba and Igbo dot-below letters and tone marks, the Naira sign and common emoji. All of these were assigned long before 15.1, so they normalise exactly as before.

## Alternatives considered

- **Ship our own normalisation tables (decomposition, combining class, composition) to both sides.** This would give full independence from the runtime, but it means about 6,000 mappings to keep correct in two languages. Pinning the version gets the same agreement with a much smaller table: one bit per code point, kept as ranges.
- **Pin `unorm_dart` to Unicode 15.1.** No such release exists. It would also leave Node's ICU free to move ahead when Node is upgraded.

## Effect on digests

**No existing digest changes.** All 36 existing vectors give the same canonical text and digest as before. The only text that canonicalises differently is text that contains a code point assigned after Unicode 15.1, and before this change such text already gave different digests on the two sides. For the bank's server on Node 22, the outputs change only for text that contains such a code point and that Node's ICU used to map, for example outlined letters, U+A7F1, or a new combining mark between a letter and an accent. Records registered from such text before this change stop matching until they expire (`RECORD_TTL_DAYS`, 30 by default). After that, the bank re-registers new messages under the pinned form. We know of no bank message that uses these characters.

These characters are now kept as they are instead of being folded to ASCII. A message written in outlined letters therefore does not match the same message written in plain letters. That is the safe direction: such a message is "not confirmed", never wrongly "confirmed".

## Tests

- `packages/test-vectors/cases.ts` gains 37 vectors. They cover the QA list (U+0558, U+058B-058C, U+209D-209F, U+D7A4, U+107BB-107BF, U+1B123-1B126, U+1D6A6, U+1DF95, U+1DFCD-1DFFF, and reordering around U+1AEF and U+1D252), Unicode 16 and 17 compatibility characters and marks, newer scripts, unassigned and private-use code points, emoji ZWJ, skin-tone, flag and keycap sequences, compatibility forms, and Hausa, Yoruba and Igbo letters in precomposed, decomposed and reordered forms.
- TypeScript (`tests/canonical.test.ts`), the site demo (`tests/web.test.ts`) and Dart (`packages/canonical_dart/test`) each check every vector.
- A one-off fuzz compared TypeScript with Dart on 1.69 million strings: every code point alone, every combining mark and every post-15.1 code point next to letters and accents, and random mixed strings. There were 0 mismatches, against 1,138 before the change.

## Changing the version

Moving to a newer Unicode version is a canonicalisation change. It needs a new decision note and approval. It also changes digests for text that contains the newly covered characters, with the same migration impact as described above. To make the change, edit `UNICODE_VERSION` in the generator, run it, run `pnpm vectors`, and check that every supported runtime knows the new version.
