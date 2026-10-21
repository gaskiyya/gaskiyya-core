export interface VectorCase {
  id: string;
  description: string;
  input: string;
}

export const cases: VectorCase[] = [
  { id: 'plain-alert', description: 'Simple transaction alert', input: 'Acct:***5678 Debit:NGN5,000.00 Desc:POS PURCHASE Bal:NGN12,450.10' },
  { id: 'naira-sign', description: 'Naira sign is kept', input: 'Debit: \u20A625,000.00 on 20-Oct-2026. Avail Bal: \u20A6104,220.55' },
  { id: 'naira-sign-spaced', description: 'Naira sign with odd spacing', input: '  Debit:   \u20A625,000.00\ton 20-Oct-2026.  ' },
  { id: 'multiline-sms', description: 'Multi-line SMS collapses to one line', input: 'Txn: Credit\nAmt: NGN150,000.00\nAcc: 01******89\nDesc: SALARY OCT\nBal: NGN212,004.17' },
  { id: 'multiline-crlf', description: 'CRLF line breaks', input: 'Txn: Credit\r\nAmt: NGN150,000.00\r\nAcc: 01******89\r\nDesc: SALARY OCT\r\nBal: NGN212,004.17' },
  { id: 'otp', description: 'OTP message', input: 'Your one-time code is 482913. It expires in 5 minutes. Do not share it with anyone, including bank staff.' },
  { id: 'link-genuine', description: 'Message with the bank link', input: 'Update your app for new features: https://www.demobank.ng/app' },
  { id: 'link-tampered-hyphen', description: 'Link with an extra hyphen', input: 'Update your app for new features: https://www.demo-bank.ng/app' },
  { id: 'link-tampered-dot', description: 'Link with an extra dot', input: 'Update your app for new features: https://www.demobank.ng.app/app' },
  { id: 'link-tampered-letter', description: 'Link with l swapped for 1', input: 'Update your app for new features: https://www.demobank.ng/app1' },
  { id: 'link-case', description: 'Link letter case is kept', input: 'Update your app for new features: https://www.DemoBank.ng/app' },
  { id: 'phone-number', description: 'Callback number', input: 'For enquiries call 0700 123 4567 or visit any branch.' },
  { id: 'phone-number-tampered', description: 'Callback number with one digit changed', input: 'For enquiries call 0700 123 4568 or visit any branch.' },
  { id: 'amount-tampered', description: 'Amount with one digit changed', input: 'Debit: \u20A625,001.00 on 20-Oct-2026. Avail Bal: \u20A6104,220.55' },
  { id: 'pidgin', description: 'Pidgin text', input: 'Abeg no share your card details with anybody o. Bank no go ever ask you for am.' },
  { id: 'pidgin-multiline', description: 'Pidgin, multi-line', input: 'Oga, we don send your money.\nCheck your balance for app.\nNo dey click any link wey dem send you.' },
  { id: 'hausa', description: 'Hausa text', input: 'An cire \u20A62,000.00 daga asusunka. Kada ka bayyana lambar sirrinka ga kowa.' },
  { id: 'yoruba-diacritics', description: 'Yoruba precomposed diacritics', input: 'A ti gba \u20A610,000 s\u00ED \u00E0k\u00E1\u00E0nt\u00EC r\u1EB9.' },
  { id: 'yoruba-decomposed', description: 'Yoruba decomposed diacritics (NFKC composes)', input: 'A ti gba \u20A610,000 si\u0301 a\u0300ka\u0301a\u0300nti\u0300 re\u0323.' },
  { id: 'igbo', description: 'Igbo text with dot-below letters', input: 'Ego \u1ECBnye ego: \u20A65,000. Ekwela ka onye \u1ECD b\u1EE5la mara PIN g\u1ECB.' },
  { id: 'zero-width-space', description: 'Zero-width space removed', input: 'Debit:\u200B NGN5,000.00' },
  { id: 'zero-width-joiner', description: 'Zero-width joiner and non-joiner removed', input: 'De\u200Dbit: NGN\u200C5,000.00' },
  { id: 'bom', description: 'Leading BOM removed', input: '\uFEFFDebit: NGN5,000.00' },
  { id: 'word-joiner', description: 'Word joiner removed', input: 'Debit:\u2060 NGN5,000.00' },
  { id: 'nbsp', description: 'No-break space becomes a space', input: 'Debit:\u00A0NGN5,000.00' },
  { id: 'fullwidth', description: 'Full-width compatibility forms fold', input: '\uFF24\uFF45\uFF42\uFF49\uFF54: NGN5,000.00' },
  { id: 'ligature', description: 'fi ligature folds', input: 'Con\uFB01rm your transfer in the app.' },
  { id: 'tabs-and-spaces', description: 'Tabs and space runs', input: 'Debit:\t\t  NGN5,000.00' },
  { id: 'trailing-newlines', description: 'Trailing newlines trimmed', input: 'Debit: NGN5,000.00\n\n\n' },
  { id: 'empty', description: 'Empty input', input: '' },
  { id: 'whitespace-only', description: 'Whitespace only', input: ' \n\t \u200B ' },
  { id: 'emoji', description: 'Emoji kept', input: 'Happy birthday from your bank \uD83C\uDF89' },
  { id: 'security-notice', description: 'Security notice', input: 'Security alert: a new device signed in to your profile on 20-Oct-2026 13:02. If this was not you, call 0700 123 4567.' },
  { id: 'punycode-link', description: 'Punycode lookalike link', input: 'Verify at https://xn--demobnk-6za.ng/login' },
  { id: 'ideographic-space', description: 'Ideographic space collapses', input: 'Debit:\u3000NGN5,000.00' },
  { id: 'unicode-line-sep', description: 'Unicode line separator collapses', input: 'Debit:\u2028NGN5,000.00' },
  { id: 'u16-armenian-0558', description: 'U+0558 (assigned after 15.1) is kept', input: 'Ref \u0558 \u0531\u0558' },
  { id: 'u16-armenian-058b', description: 'U+058B and U+058C (assigned after 15.1) are kept', input: 'Ref \u058B\u058C' },
  { id: 'u16-subscripts-209d', description: 'U+209D-209F (assigned after 15.1) are kept', input: 'x\u209D\u209E\u209F' },
  { id: 'u16-hangul-d7a4', description: 'U+D7A4 (assigned after 15.1) is kept, Hangul around it still composes', input: '\u1100\u1161\uD7A4\u1100\u1161' },
  { id: 'u16-latin-ext-f', description: 'U+107BB-107BF (assigned after 15.1) are kept', input: 'a\u{107BB}\u{107BC}\u{107BD}\u{107BE}\u{107BF}' },
  { id: 'u16-kana-1b123', description: 'U+1B123-1B126 (assigned after 15.1) are kept', input: '\u{1B123}\u{1B124}\u{1B125}\u{1B126}' },
  { id: 'u16-math-1d6a6', description: 'U+1D6A6 (assigned after 15.1) is kept, U+1D6A4 still folds', input: '\u{1D6A4}\u{1D6A6}' },
  { id: 'u16-latin-1df95', description: 'U+1DF95 and U+1DFCD-1DFFF (assigned after 15.1) are kept', input: '\u{1DF95} \u{1DFCD}\u{1DFE0}\u{1DFFF}' },
  { id: 'u16-mark-1aef', description: 'U+1AEF between a letter and an accent stops reordering and composition', input: 'e\u1AEF\u0301 e\u0323\u1AEF\u0301' },
  { id: 'u16-mark-1d252', description: 'U+1D252 between a letter and accents stops reordering and composition', input: 'o\u0301\u{1D252}\u0323 o\u{1D252}\u0301' },
  { id: 'u16-scripts', description: 'Newer scripts (Garay, Tulu-Tigalari, Ol Onal, Kirat Rai) are kept', input: '\u{10D50}\u{10D51} \u{11380}\u{113B8} \u{1E5D0}\u{1E5D1} \u{16D43}\u{16D63}' },
  { id: 'u16-outlined-latin', description: 'Outlined Latin and digits (Unicode 16) do not fold to ASCII, though newer normalisers fold them', input: '\u{1CCD6}\u{1CCD7}\u{1CCE3}\u{1CCDA} \u{1CCF1}\u{1CCF2}' },
  { id: 'u16-outlined-latin-ascii', description: 'The outlined text in ASCII (must differ)', input: 'ABNE 12' },
  { id: 'u17-modifier-a7f1', description: 'U+A7F1 (Unicode 17) does not fold, though newer normalisers fold it', input: 'Ref \uA7F1' },
  { id: 'u16-mark-before-dot', description: 'A newer combining mark stops the dot below composing with the letter', input: 'a\u1ACF\u0323 a\u{10D69}\u0323 a\u{10EFA}\u0301' },
  { id: 'u15-kawi', description: 'Kawi (Unicode 15.0) normalises as usual', input: '\u{11F04}\u{11F05}\u{11F41}' },
  { id: 'unassigned-planes', description: 'Unassigned and private-use code points are kept', input: '\u0378 \u{E0080} \uE000 \u{F0000} \u{10FFFD}' },
  { id: 'emoji-zwj-family', description: 'ZWJ family emoji: the joiners are removed', input: 'Family plan \u{1F468}\u200D\u{1F469}\u200D\u{1F467}' },
  { id: 'emoji-skin-tone-flag', description: 'Skin tone, flag and keycap sequences are kept', input: '\u{1F44D}\u{1F3FD} \u{1F1F3}\u{1F1EC} 1\uFE0F\u20E3' },
  { id: 'emoji-new', description: 'Emoji from Unicode 15 and later', input: '\u{1FAE8}\u{1FA77} \u{1FAE9}\u{1FAC6}\u{1FABE}' },
  { id: 'compat-circled', description: 'Circled and parenthesised digits fold', input: 'Step \u2460 then \u2474 then \u2488' },
  { id: 'compat-super-sub', description: 'Superscripts, subscripts and fractions fold', input: 'x\u00B2 H\u2082O \u00BD \u2153' },
  { id: 'compat-units', description: 'Unit and letterlike symbols fold', input: '\u338F \u2121 \u2122 \u216B \u2103' },
  { id: 'compat-math-letters', description: 'Mathematical alphanumerics fold to plain letters', input: '\u{1D401}\u{1D41A}\u{1D427}\u{1D424} \u{1D7CF}\u{1D7D0}' },
  { id: 'compat-hangul-halfwidth', description: 'Half-width Hangul and katakana fold', input: '\uFFA1\uFFC2 \uFF76\uFF9E' },
  { id: 'compat-arabic-ligature', description: 'Arabic presentation forms fold', input: '\uFDFA \uFEFB' },
  { id: 'hausa-hooked', description: 'Hausa hooked letters are kept', input: 'Ku \u0253\u0101 ku \u0257a\u0199a \u01B4a\u0199i \u0181\u018A\u0198\u01B3' },
  { id: 'hausa-apostrophe-y', description: 'Hausa apostrophe y with modifier letter apostrophe', input: '\u02BCyan uwa, \u2019yan uwa' },
  { id: 'yoruba-tone-dot-precomposed', description: 'Yoruba dot-below vowels with tones, precomposed', input: '\u1EB9\u0300 \u1EB9\u0301 \u1ECD\u0300 \u1ECD\u0301 \u1E63\u00E9' },
  { id: 'yoruba-tone-dot-decomposed', description: 'Yoruba dot-below vowels with tones, decomposed with dot first', input: 'e\u0323\u0300 e\u0323\u0301 o\u0323\u0300 o\u0323\u0301 s\u0323e\u0301' },
  { id: 'yoruba-tone-dot-reordered', description: 'Yoruba dot-below vowels with tones, decomposed with tone first', input: 'e\u0300\u0323 e\u0301\u0323 o\u0300\u0323 o\u0301\u0323 s\u0323e\u0301' },
  { id: 'yoruba-macron-n', description: 'Yoruba syllabic n with tones', input: '\u0144 \u01F9 n\u0304' },
  { id: 'igbo-tones', description: 'Igbo dot-below and n-dot letters with tones', input: '\u1ECB\u0301 \u1EE5\u0300 \u1E45 i\u0323\u0301 u\u0323\u0300 n\u0307' },
  { id: 'igbo-tones-composed', description: 'Igbo letters, precomposed where Unicode has them', input: '\u1ECB\u0301 \u1EE5\u0300 \u1E45 \u1ECB\u0301 \u1EE5\u0300 \u1E45' },
  { id: 'nigerian-names', description: 'Mixed Nigerian names and Naira amount', input: 'Transfer to \u00C0d\u00E9b\u00E1y\u1ECD Ok\u1EE5 \u0181ello \u20A6150,000.00' },
  { id: 'hausa-unhooked', description: 'The Hausa text with plain b, d, k, y (must differ)', input: 'Ku b\u0101 ku daka yaki BDKY' },
  { id: 'no-1aef', description: 'The U+1AEF text without U+1AEF (must differ)', input: 'e\u0301 e\u0323\u0301' },
];

export const sameDigestGroups: string[][] = [
  ['multiline-sms', 'multiline-crlf'],
  ['yoruba-diacritics', 'yoruba-decomposed'],
  ['zero-width-space', 'word-joiner', 'tabs-and-spaces', 'nbsp', 'ideographic-space', 'unicode-line-sep', 'trailing-newlines', 'bom'],
  ['empty', 'whitespace-only'],
  ['yoruba-tone-dot-precomposed', 'yoruba-tone-dot-decomposed', 'yoruba-tone-dot-reordered'],
  ['igbo-tones', 'igbo-tones-composed'],
];

export const differentDigestPairs: [string, string][] = [
  ['link-genuine', 'link-tampered-hyphen'],
  ['link-genuine', 'link-tampered-dot'],
  ['link-genuine', 'link-tampered-letter'],
  ['link-genuine', 'link-case'],
  ['phone-number', 'phone-number-tampered'],
  ['naira-sign', 'amount-tampered'],
  ['hausa-hooked', 'hausa-unhooked'],
  ['u16-mark-1aef', 'no-1aef'],
  ['u16-outlined-latin', 'u16-outlined-latin-ascii'],
];

export interface ReceiptCase {
  id: string;
  description: string;
  fields: { beneficiaryAccount: string; beneficiaryBank: string; amountKobo: number | string; reference: string; valueDate: string };
  error?: 'beneficiaryAccount' | 'beneficiaryBank' | 'amountKobo' | 'reference' | 'valueDate';
}

const SESSION = '000013261020130211123456789012';
const base = { beneficiaryAccount: '0123456789', beneficiaryBank: '999001', amountKobo: 2500000, reference: SESSION, valueDate: '2026-10-20' };

export const receiptCases: ReceiptCase[] = [
  { id: 'rcpt-nip', description: 'NIP transfer: 30-digit session ID, N25,000.00', fields: base },
  { id: 'rcpt-amount-string', description: 'Amount given as a string of digits', fields: { ...base, amountKobo: '2500000' } },
  { id: 'rcpt-spaced', description: 'Spaces and hyphens in account, bank code and session ID are removed', fields: { ...base, beneficiaryAccount: '012-345 6789', beneficiaryBank: ' 999001 ', reference: '000013 2610201302 1112345678 9012' } },
  { id: 'rcpt-nbsp-tab', description: 'No-break space, tab and line breaks are removed', fields: { ...base, beneficiaryAccount: '0123\u00A0456789', reference: `${SESSION.slice(0, 10)}\t${SESSION.slice(10, 20)}\r\n${SESSION.slice(20)}` } },
  { id: 'rcpt-amount-plus-1', description: 'One kobo more (must differ)', fields: { ...base, amountKobo: 2500001 } },
  { id: 'rcpt-amount-x10', description: 'An extra zero on the amount (must differ)', fields: { ...base, amountKobo: 25000000 } },
  { id: 'rcpt-other-account', description: 'Same transfer into another account (must differ)', fields: { ...base, beneficiaryAccount: '0123456780' } },
  { id: 'rcpt-other-bank', description: 'Same account number at another bank (must differ)', fields: { ...base, beneficiaryBank: '999002' } },
  { id: 'rcpt-other-session', description: 'Last digit of the session ID changed (must differ)', fields: { ...base, reference: `${SESSION.slice(0, 29)}3` } },
  { id: 'rcpt-other-date', description: 'Value date one day later (must differ)', fields: { ...base, valueDate: '2026-10-21' } },
  { id: 'rcpt-ref-lower', description: 'Alphanumeric reference in lower case', fields: { ...base, reference: 'ft26293abc12', amountKobo: 150050 } },
  { id: 'rcpt-ref-upper', description: 'The same reference in upper case', fields: { ...base, reference: 'FT26293ABC12', amountKobo: 150050 } },
  { id: 'rcpt-ref-dashed', description: 'The same reference with hyphens and spaces', fields: { ...base, reference: 'FT-26293 ABC-12', amountKobo: 150050 } },
  { id: 'rcpt-one-kobo', description: 'Smallest amount, one kobo', fields: { ...base, amountKobo: 1 } },
  { id: 'rcpt-large', description: 'A large amount: N9,999,999,999.99', fields: { ...base, amountKobo: 999999999999 } },
  { id: 'rcpt-leap-day', description: 'Leap day value date', fields: { ...base, valueDate: '2028-02-29' } },
  { id: 'rcpt-bad-account-short', description: 'Nine-digit account number', fields: { ...base, beneficiaryAccount: '012345678' }, error: 'beneficiaryAccount' },
  { id: 'rcpt-bad-account-letter', description: 'Letter O in place of zero', fields: { ...base, beneficiaryAccount: 'O123456789' }, error: 'beneficiaryAccount' },
  { id: 'rcpt-bad-account-fullwidth', description: 'Full-width digits are refused, not folded', fields: { ...base, beneficiaryAccount: '\uFF10123456789' }, error: 'beneficiaryAccount' },
  { id: 'rcpt-bad-bank', description: 'Three-digit CBN code instead of the six-digit NIBSS code', fields: { ...base, beneficiaryBank: '058' }, error: 'beneficiaryBank' },
  { id: 'rcpt-bad-amount-zero', description: 'Zero amount', fields: { ...base, amountKobo: 0 }, error: 'amountKobo' },
  { id: 'rcpt-bad-amount-negative', description: 'Negative amount', fields: { ...base, amountKobo: -100 }, error: 'amountKobo' },
  { id: 'rcpt-bad-amount-fraction', description: 'Fraction of a kobo', fields: { ...base, amountKobo: 2500000.5 }, error: 'amountKobo' },
  { id: 'rcpt-bad-amount-leading-zero', description: 'Leading zero in a string amount', fields: { ...base, amountKobo: '02500000' }, error: 'amountKobo' },
  { id: 'rcpt-bad-amount-naira', description: 'Naira text where kobo is required', fields: { ...base, amountKobo: '25,000.00' }, error: 'amountKobo' },
  { id: 'rcpt-bad-amount-too-long', description: 'Sixteen-digit amount', fields: { ...base, amountKobo: '1000000000000000' }, error: 'amountKobo' },
  { id: 'rcpt-bad-ref-short', description: 'Five-character reference', fields: { ...base, reference: 'AB123' }, error: 'reference' },
  { id: 'rcpt-bad-ref-symbol', description: 'Slash in the reference', fields: { ...base, reference: 'FT/26293/ABC' }, error: 'reference' },
  { id: 'rcpt-bad-ref-non-ascii', description: 'Non-ASCII letter in the reference', fields: { ...base, reference: 'FT26293\u0130BC12' }, error: 'reference' },
  { id: 'rcpt-bad-date-format', description: 'Day-first date', fields: { ...base, valueDate: '20-10-2026' }, error: 'valueDate' },
  { id: 'rcpt-bad-date-feb-30', description: 'February 30th', fields: { ...base, valueDate: '2026-02-30' }, error: 'valueDate' },
  { id: 'rcpt-bad-date-not-leap', description: 'February 29th in a common year', fields: { ...base, valueDate: '2027-02-29' }, error: 'valueDate' },
  { id: 'rcpt-bad-date-padded', description: 'Date with a trailing space', fields: { ...base, valueDate: '2026-10-20 ' }, error: 'valueDate' },
];

export const receiptSameGroups: string[][] = [
  ['rcpt-nip', 'rcpt-amount-string', 'rcpt-spaced', 'rcpt-nbsp-tab'],
  ['rcpt-ref-lower', 'rcpt-ref-upper', 'rcpt-ref-dashed'],
];

export const receiptDifferentPairs: [string, string][] = [
  ['rcpt-nip', 'rcpt-amount-plus-1'],
  ['rcpt-nip', 'rcpt-amount-x10'],
  ['rcpt-nip', 'rcpt-other-account'],
  ['rcpt-nip', 'rcpt-other-bank'],
  ['rcpt-nip', 'rcpt-other-session'],
  ['rcpt-nip', 'rcpt-other-date'],
];

export const amountCases: { input: string; kobo: number | null }[] = [
  { input: 'NGN25,000.00', kobo: 2500000 },
  { input: '\u20A625,000.00', kobo: 2500000 },
  { input: '\u20A6 25,000', kobo: 2500000 },
  { input: 'N1,500.5', kobo: 150050 },
  { input: 'ngn 1500.50', kobo: 150050 },
  { input: '2500', kobo: 250000 },
  { input: '0.01', kobo: 1 },
  { input: '1,234,567.89', kobo: 123456789 },
  { input: '25\u00A0000.00', kobo: 2500000 },
  { input: '9,999,999,999,999.99', kobo: 999999999999999 },
  { input: '0', kobo: null },
  { input: '0.00', kobo: null },
  { input: '25,00.00', kobo: null },
  { input: '25000.001', kobo: null },
  { input: '-5000', kobo: null },
  { input: 'USD25.00', kobo: null },
  { input: '25.000,00', kobo: null },
  { input: '', kobo: null },
  { input: 'NGN', kobo: null },
  { input: '99,999,999,999,999.99', kobo: null },
];

export const lagosDateCases: { instant: string; date: string }[] = [
  { instant: '2026-10-20T12:00:00.000Z', date: '2026-10-20' },
  { instant: '2026-10-20T22:59:59.999Z', date: '2026-10-20' },
  { instant: '2026-10-20T23:00:00.000Z', date: '2026-10-21' },
  { instant: '2026-12-31T23:30:00.000Z', date: '2027-01-01' },
  { instant: '2028-02-28T23:00:00.000Z', date: '2028-02-29' },
  { instant: '2026-06-15T00:30:00.000Z', date: '2026-06-15' },
];
