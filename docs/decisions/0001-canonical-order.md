# 0001: Canonicalisation order and whitespace set

**Status:** accepted

The guide lists NFKC first, then zero-width removal. We remove zero-width characters **before** NFKC. Removing them afterwards can leave a base letter and a combining mark adjacent but uncomposed (for example `e`, ZWSP, U+0301), so two texts that look identical would digest differently depending on where an attacker put the ZWSP.

Order: remove ZWSP, ZWNJ, ZWJ, word joiner and BOM, then NFKC, then collapse every whitespace run (including line breaks) to one space, then trim.

"Whitespace" is an explicit character set, identical in TypeScript and Dart, because the two languages' `\s` classes differ (`\u0085` is one example). Punctuation and letter case are kept.

Consequence: removing ZWJ changes emoji sequences such as family emoji. Bank messages rarely contain these, and both libraries do the same thing, so digests still agree.
