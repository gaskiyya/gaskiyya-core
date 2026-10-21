import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copy, copyFor, COPY_OVERLAYS, fill, LANGUAGES } from '@gaskiya/schemas';
import { asksForSecret, explain } from '../packages/api/src/ai/explain.ts';
import { callingMany, ascii as ussdAscii, USSD_MAX } from '../packages/api/src/ussd.ts';
import { parseLanguageCommand } from '../packages/api/src/whatsapp.ts';
import { ALICE, BOB, harness, LINK_MSG, TAMPERED_LINK_MSG, USSD, WA } from './helpers.ts';

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(path, v);
    else for (const [p, s] of leaves(v, path)) out.set(p, s);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const english = leaves(copy as unknown as Tree);
const overlays = Object.entries(COPY_OVERLAYS) as [string, Tree][];

const REASSURING: Record<string, RegExp> = {
  pcm: /\b(genuine|legit|original|safe|e dey okay|e fine|na real|correct|authentic)\b/i,
  ha: /\b(lafiya|na gaske|ingantacce|amintacce|sahihi|babu matsala)\b/i,
  yo: /\b(ododo|ailewu|gidi|ojulowo|tooto|ko si wahala)\b/i,
  ig: /\b(ezigbo|n\u2019ezie|eziokwu|d\u1ecb mma|nchekwa)\b/i,
};
const WARNINGS = [
  'verdict.not_confirmed', 'verdict.cannot_check', 'link.not_confirmed', 'call.not_calling', 'call.mismatch', 'explain.fallback', 'explain.action',
  'official.org.cannotCheckBody', 'official.org.notCalling', 'official.org.explain', 'official.contact.not_official', 'official.contact.cannotCheckBody',
  'official.contact.impersonation', 'official.contact.spoofNote', 'official.apps.apk', 'official.apps.fakeApp', 'official.ussd.notOfficial', 'official.ussd.badNumber',
  'simswap', 'receipt.verdict.not_confirmed', 'receipt.verdict.cannot_check',
];

describe('languages (decision 0006)', () => {
  it('LANG-1: the four overlays exist, are ASCII and carry the review marker', () => {
    expect(LANGUAGES).toEqual(['en', 'pcm', 'ha', 'yo', 'ig']);
    const files = readdirSync('packages/schemas').filter((f) => /^copy\.[a-z]+\.json$/.test(f)).sort();
    expect(files).toEqual(['copy.ha.json', 'copy.ig.json', 'copy.pcm.json', 'copy.yo.json']);
    for (const f of files) {
      const raw = readFileSync(`packages/schemas/${f}`, 'utf8');
      expect(/[^\t\n\r\x20-\x7e]/.test(raw), `${f} must write non-ASCII as \\u escapes`).toBe(false);
      expect(JSON.parse(raw)._review).toBe('needs native-speaker review');
      expect(readFileSync(`mobile/assets/${f}`, 'utf8'), `mobile/assets/${f} is stale`).toBe(raw);
    }
  });

  it('LANG-1: every overlay key exists in English and keeps exactly its placeholders', () => {
    for (const [lang, tree] of overlays) {
      const extra: string[] = [];
      const wrong: string[] = [];
      for (const [path, text] of leaves(tree)) {
        const en = english.get(path);
        if (en === undefined) extra.push(path);
        else if (placeholders(text).join() !== placeholders(en).join()) wrong.push(`${path}: {${placeholders(text)}} vs {${placeholders(en)}}`);
        expect(text.trim().length, `${lang} ${path} is empty`).toBeGreaterThan(0);
      }
      expect(extra, `${lang}: keys not in copy.json`).toEqual([]);
      expect(wrong, `${lang}: placeholder mismatch`).toEqual([]);
    }
  });

  it('LANG-1: every customer text except the activity sentence is translated in every overlay', () => {
    const required = [...english.keys()].filter((p) => !/^activity\.(?!heading)/.test(p) && !p.startsWith('app.language.names.'));
    const exempt = new Set(['app.language.names.en', 'app.language.names.pcm', 'app.language.names.ha', 'app.language.names.yo', 'app.language.names.ig']);
    for (const [lang, tree] of overlays) {
      const have = leaves(tree);
      expect(required.filter((p) => !have.has(p) && !exempt.has(p)), `${lang}: untranslated`).toEqual([]);
    }
  });

  it('LANG-2: a warning never reassures, in any language', () => {
    for (const [lang, tree] of overlays) {
      for (const [path, text] of leaves(tree)) {
        if (!WARNINGS.some((w) => path.startsWith(w))) continue;
        expect(REASSURING[lang]!.test(text), `${lang} ${path}: ${text}`).toBe(false);
        expect(asksForSecret(text), `${lang} ${path} asks for a secret`).toBe(false);
      }
      expect(leaves(tree).get('verdict.not_confirmed.title')).not.toBe(leaves(tree).get('verdict.confirmed.title'));
    }
  });

  it('LANG-3: overlays merge over English; a missing key or unknown language falls back to English', () => {
    expect(copyFor('ha').verdict.not_confirmed.title).toBe((COPY_OVERLAYS.ha as any).verdict.not_confirmed.title);
    expect(copyFor('ha').app.language.names.yo).toBe(copy.app.language.names.yo);
    expect(copyFor('xx')).toBe(copy);
    expect(copyFor(undefined)).toBe(copy);
    expect(copyFor('en')).toBe(copy);
  });

  it('LANG-4: the explanation fallback comes in the requested language', async () => {
    const h = await harness();
    const r = await h.sys.app.inject({
      method: 'POST',
      url: '/v1/explain',
      headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` },
      payload: { maskedText: 'URGENT: your account is blocked, verify at https://demobank-verify.com', language: 'yo' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ explanation: copyFor('yo').explain.fallback, action: copyFor('yo').explain.action, source: 'fallback' });
  });

  it('LANG-4: model output in a local language that mentions a secret is replaced by the fixed text', async () => {
    const model = {
      explain: async () => ({ indicators: ['credential_request'], explanation: 'Sakon yana neman PIN dinku.', action: 'Ku tura PIN dinku yanzu.' }),
      extractText: async () => null,
      embed: async () => ({ model: 'none', vector: [] }),
      draftAdvisory: async () => null,
    };
    const r = await explain(model, { text: 'Send your PIN', language: 'ha', bankName: 'DemoBank', bankDomains: ['demobank.ng'] }, 1000);
    expect(r).toMatchObject({ source: 'fallback', explanation: copyFor('ha').explain.fallback });
  });
});

async function send(h: Awaited<ReturnType<typeof harness>>, text: string, from = ALICE) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from: from.slice(1), id: `wamid.${Math.random()}`, timestamp: '1', type: 'text', text: { body: text } }] } }] }] });
  const signature = `sha256=${createHmac('sha256', WA.appSecret).update(raw).digest('hex')}`;
  const r = await h.sys.app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
  expect(r.statusCode).toBe(200);
  return h.messaging.sent.at(-1)!;
}

describe('WhatsApp language command', () => {
  it('LANG-5: reads LANG with a code or a language name, and nothing else', () => {
    expect(parseLanguageCommand('LANG HA')).toBe('ha');
    expect(parseLanguageCommand('lang hausa')).toBe('ha');
    expect(parseLanguageCommand('Language Yoruba')).toBe('yo');
    expect(parseLanguageCommand('LANG Yor\u00f9b\u00e1')).toBe('yo');
    expect(parseLanguageCommand('lang: pidgin')).toBe('pcm');
    expect(parseLanguageCommand('LANG IG')).toBe('ig');
    expect(parseLanguageCommand('lang en')).toBe('en');
    expect(parseLanguageCommand('LANG')).toBeNull();
    expect(parseLanguageCommand('LANG XX')).toBeNull();
    expect(parseLanguageCommand('LANG constructor')).toBeNull();
    expect(parseLanguageCommand('Language settings updated on your DemoBank app')).toBeUndefined();
    expect(parseLanguageCommand(LINK_MSG)).toBeUndefined();
  });

  it('LANG-5: LANG HA switches every later reply for that number to Hausa, and only that number', async () => {
    const h = await harness();
    const ha = copyFor('ha');
    expect((await send(h, 'LANG')).body).toBe(copy.app.language.options);
    expect((await send(h, 'LANG HA')).body).toBe(ha.app.language.set);
    expect((await send(h, 'CALL')).body).toContain(ha.call.not_calling.title);
    expect((await send(h, 'hi')).body).toContain(ha.bot.welcome.split('{bank}')[0]!);

    await h.register(ALICE, LINK_MSG);
    const ok = await send(h, LINK_MSG);
    expect(ok.body).toContain(ha.verdict.confirmed.title);
    const bad = await send(h, TAMPERED_LINK_MSG);
    expect(bad.body).toContain(ha.verdict.not_confirmed.title);
    expect(bad.body).toContain(ha.verdict.not_confirmed.body.replace('{bank}', 'DemoBank'));
    expect(bad.body).toContain(ha.explain.fallback);

    expect((await send(h, 'CALL', BOB)).body).toContain(copy.call.not_calling.title);

    expect((await send(h, 'language igbo')).body).toBe(copyFor('ig').app.language.set);
    expect((await send(h, 'CALL')).body).toContain(copyFor('ig').call.not_calling.title);
    expect((await send(h, 'LANG EN')).body).toBe(copy.app.language.set);
    expect((await send(h, 'CALL')).body).toContain(copy.call.not_calling.title);
  });

  it('LANG-5: the preference is stored under the keyed number, with no phone number or message text', async () => {
    const h = await harness();
    await send(h, 'LANG YO');
    await send(h, LINK_MSG);
    const dump = JSON.stringify(await h.sys.store.dump());
    expect(dump).toContain('"language":"yo"');
    expect(dump).not.toContain(ALICE.slice(1));
    expect(dump).not.toContain('update your app');
  });
});

async function dial(h: Awaited<ReturnType<typeof harness>>, phone: string, text = '') {
  const r = await h.sys.app.inject({
    method: 'POST',
    url: `/webhooks/ussd?token=${encodeURIComponent(USSD.token)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ sessionId: 'ATUid_lang', serviceCode: '*347*123#', phoneNumber: phone, networkCode: '62130', text }).toString(),
  });
  expect(r.statusCode).toBe(200);
  expect(r.body.length).toBeLessThanOrEqual(USSD_MAX);
  expect(r.body).toMatch(/^[\n\x20-\x7e]*$/);
  return r.body;
}

describe('USSD languages', () => {
  it('LANG-7: every fixed USSD screen fits one 160-character page in every language, as plain ASCII', () => {
    const bank = 'X'.repeat(16);
    const longestPurpose = (c: ReturnType<typeof copyFor>) => Object.values(c.purposes).sort((a, b) => b.length - a.length)[0]!;
    for (const lang of LANGUAGES) {
      const c = copyFor(lang);
      const screens = {
        menu: `CON ${fill(c.ussd.menu, { bank })}\n${c.ussd.neverAsks}`,
        calling: `END ${fill(c.ussd.calling, { bank, code: '4821', purpose: longestPurpose(c) })}`,
        callingMany: `END ${callingMany(c, bank, ['4821', '9031', '1442'])}`,
        notCalling: `END ${c.call.not_calling.title}\n${fill(c.call.not_calling.body, { bank })}`,
        cannotCheck: `END ${c.verdict.cannot_check.title}\n${c.verdict.cannot_check.body}`,
        none: `END ${fill(c.ussd.todayNone, { bank })}\n${c.ussd.todayNote}`,
        invalid: `END ${c.ussd.invalid}`,
        tooMany: `END ${c.ussd.tooMany}`,
        menuWithOption3: `CON ${fill(c.ussd.menu, { bank })}\n${c.official.ussd.option}\n${c.ussd.neverAsks}`,
        enterNumber: `CON ${c.official.ussd.enterNumber}`,
        official: `END ${fill(c.official.ussd.official, { number: '+234801234567890', bank })}`,
        notOfficial: `END ${fill(c.official.ussd.notOfficial, { number: '+234801234567890', bank })}`,
        badNumber: `END ${c.official.ussd.badNumber}`,
      };
      for (const [name, s] of Object.entries(screens)) {
        expect(ussdAscii(s).length, `${lang} ${name}: ${ussdAscii(s)}`).toBeLessThanOrEqual(USSD_MAX);
      }
      for (const code of ['4821', '9031', '1442']) expect(screens.callingMany, `${lang} callingMany`).toContain(code);
      expect(screens.callingMany).toContain(c.call.mismatchMany);
    }
    for (const [lang, tree] of overlays) {
      for (const [path, text] of leaves(tree)) {
        if (path.startsWith('ussd.') || path.startsWith('official.ussd.') || path.startsWith('official.org.ussd')) expect(/^[\n\x20-\x7e]*$/.test(text), `${lang} ${path} must be plain ASCII`).toBe(true);
      }
    }
    expect(ussdAscii('Sa\u0199on \u1ecd\u0300 \u0253 \u0257 \u01b4 n\u2019ezie')).toBe("Sakon o b d y n'ezie");
  });

  it('LANG-7: USSD answers in the language the number chose on WhatsApp', async () => {
    const h = await harness();
    const ha = copyFor('ha');
    expect(await dial(h, ALICE)).toContain(copy.ussd.neverAsks);
    await send(h, 'LANG HA');
    expect(await dial(h, ALICE)).toContain(ha.ussd.neverAsks);
    expect(await dial(h, ALICE, '1')).toContain(ussdAscii(ha.call.not_calling.title));
    expect(await dial(h, ALICE, '2')).toContain(ha.ussd.todayNote);
    expect(await dial(h, BOB)).toContain(copy.ussd.neverAsks);
  });
});
