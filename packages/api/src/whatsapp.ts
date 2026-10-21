import { createHmac, timingSafeEqual } from 'node:crypto';
import { contentDigest } from '@gaskiya/canonical';
import { copyFor, copyForOrg, fill, type ContactResult, type ContactView, type Copy, type Language, type LicenceResult, type OrgKind, type VerifyResult } from '@gaskiya/schemas';
import type { Messaging } from './channels/channels.ts';
import { parseContact } from './domain/contact.ts';
import { normalisePhone } from './domain/phone.ts';
import type { RateLimiter } from './ratelimit/ratelimit.ts';
import type { AdvisoryView, CallCheckResult, GaskiyaService } from './service.ts';
import type { Tenant } from './store/types.ts';

export function validSignature(appSecret: string, rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function formatDate(iso: string, c: Copy) {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Africa/Lagos' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const month = c.app.result.months.split(',')[Number(parts.month) - 1];
  const date = `${parts.day} ${month} ${parts.year}`;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  return { date, time };
}

const cannotCheck = (c: Copy, bank = '') => `${c.verdict.cannot_check.title}\n${fill(c.verdict.cannot_check.body, { bank })}`;

export function simSwapLines(warnings: readonly string[] | undefined, c: Copy): string {
  const out: string[] = [];
  if (warnings?.includes('sim_swapped_recently')) out.push(`${c.simswap.title}\n${c.simswap.body}`);
  if (warnings?.includes('sim_status_unknown')) out.push(`${c.simswap.unknownTitle}\n${c.simswap.unknownBody}`);
  return out.length ? `\n\n${out.join('\n\n')}` : '';
}

export function verdictReply(result: VerifyResult, bank: string, language: Language = 'en', kind?: OrgKind): string {
  const c = copyForOrg(language, kind);
  const sim = simSwapLines(result.warnings, c);
  if (result.verdict === 'confirmed') {
    const { date, time } = formatDate(result.sentAt, c);
    return `${fill(c.verdict.confirmed.title, { bank })}\n${fill(c.verdict.confirmed.body, { bank, channel: c.channels[result.channel], date, time })}${sim}`;
  }
  if (result.verdict === 'not_confirmed') {
    return `${c.verdict.not_confirmed.title}\n${fill(c.verdict.not_confirmed.body, { bank })}\n\n${result.activityText}${sim}`;
  }
  return `${cannotCheck(c, bank)}${sim}`;
}

export function callReply(r: CallCheckResult, bank: string, language: Language = 'en', kind?: OrgKind): string {
  const c = copyForOrg(language, kind);
  return `${callAnswer(r, bank, c)}${simSwapLines(r.warnings, c)}`;
}

function callAnswer(r: CallCheckResult, bank: string, c: Copy): string {
  if (r.verdict === 'calling') {
    const each = r.calls.map((call) => `${fill(c.call.calling.body, { purpose: c.purposes[call.purpose] })}\n${c.call.calling.codeLabel}: ${call.code}`);
    return `${fill(c.call.calling.title, { bank })}\n${each.join('\n\n')}\n${r.calls.length > 1 ? c.call.mismatchMany : c.call.mismatch}`;
  }
  if (r.verdict === 'not_calling') return `${fill(c.call.not_calling.title, { bank })}\n${fill(c.call.not_calling.body, { bank })}`;
  return cannotCheck(c, bank);
}

export function contactKindText(contact: ContactView, c: Copy, platforms?: string[]): string {
  const k = c.official.contact.kinds;
  if (contact.type === 'phone') return k.phone;
  if (contact.type === 'whatsapp') return k.whatsapp;
  if (contact.type === 'email') return k.email;
  const p = contact.platform ?? platforms?.[0];
  const name = p ? c.official.contact.platforms[p as keyof typeof c.official.contact.platforms] : `@${contact.value}`;
  return fill(k.social, { platform: name });
}

export function contactReply(r: ContactResult, language: Language = 'en'): string {
  const c = copyFor(language);
  const t = c.official.contact;
  if (r.verdict === 'cannot_check') return `${c.verdict.cannot_check.title}\n${t.cannotCheckBody}`;
  if (r.verdict === 'official') {
    const lines = r.matches.map((m) => fill(t.official.body, { org: m.name, contact: contactKindText(r.contact, c, m.platforms) }));
    return `${t.official.title}\n${lines.join('\n')}\n\n${t.spoofNote}`;
  }
  const kind = contactKindText(r.contact, c);
  const body = r.organisation ? fill(t.not_official.body, { org: r.organisation.name, contact: kind }) : fill(t.not_official.bodyAny, { contact: kind });
  const warnings = r.impersonates.map((o) => fill(t.impersonation, { org: o.name }));
  return [`${t.not_official.title}\n${body}`, ...warnings].join('\n\n');
}

export function regulatorList(c: Copy, names: string[]): string {
  if (names.length < 2) return names.join('');
  return fill(c.banks.or, { first: names.slice(0, -1).join(', '), last: names[names.length - 1]! });
}

export function licenceReply(r: LicenceResult, language: Language = 'en'): string {
  const c = copyFor(language);
  const regulators = regulatorList(c, r.regulators.map((x) => x.name));
  if (r.verdict === 'licensed') {
    const f = r.firm;
    const category = c.licence.categories[f.category as keyof typeof c.licence.categories] ?? f.category;
    return [
      c.licence.licensed.title,
      fill(c.licence.licensed.body, { name: f.name, regulator: f.regulator, category }),
      '',
      `${c.licence.source}: ${f.source.title} (${f.source.url})`,
      `${c.licence.listDate}: ${f.source.retrievedAt}`,
      ...(f.status ? [`${c.licence.status}: ${f.status}`] : []),
      ...(f.source.sample ? [c.licence.sample] : []),
    ].join('\n');
  }
  if (r.verdict === 'not_listed') {
    const lists = [...new Map(r.sources.map((s) => [s.regulator, `${s.regulator} (${s.retrievedAt})`])).values()].join(', ');
    return [
      c.licence.not_listed.title,
      fill(c.licence.not_listed.body, { regulators }),
      ...(r.similarTo ? ['', fill(c.licence.similar, { name: r.similarTo.name })] : []),
      '',
      fill(c.licence.listsChecked, { lists }),
      ...r.regulators.map((x) => `${x.name}: ${x.url}`),
      ...(r.sources.some((s) => s.sample) ? [c.licence.sample] : []),
    ].join('\n');
  }
  return [c.licence.cannot_check.title, c.licence.cannot_check.body, ...r.regulators.map((x) => `${x.name}: ${x.url}`)].join('\n');
}

export function parseLicenceCommand(body: string): string | null | undefined {
  const m = /^(licen[cs]e|loan)(?:\s*[:=-]?\s+(.*))?$/is.exec(body.trim());
  if (!m) return undefined;
  const rest = (m[2] ?? '').trim();
  if (!rest) return null;
  const loan = m[1]!.toLowerCase() === 'loan';
  if (/\n/.test(rest) || rest.length > 100 || rest.split(/\s+/).length > (loan ? 4 : 8)) return undefined;
  if (loan && /:\/\/|\bwww\.|\d{4,}|[!?\u20a6,;]|\bN\d|\bNGN\b|\.\s/i.test(rest)) return undefined;
  return rest;
}

export const defang = (domain: string) => domain.replace(/\./g, '[.]');

export function alertsReply(advisories: AdvisoryView[], bank: string, language: Language = 'en'): string {
  const c = copyFor(language);
  if (advisories.length === 0) return fill(c.advisory.botNone, { bank });
  const items = advisories.map((a) => {
    let text = a.text;
    for (const d of a.linkDomains) text = text.split(d).join(defang(d));
    const lines = [`*${a.title}*`, text];
    if (a.linkDomains.length) lines.push(`${c.advisory.lookalikeLabel}: ${a.linkDomains.map(defang).join(', ')}`);
    if (a.asksCallback) lines.push(c.advisory.callbackNote);
    return lines.join('\n');
  });
  return [fill(c.advisory.botHeading, { bank }), ...items, fill(c.advisory.botFooter, { bank })].join('\n\n');
}

const LANGUAGE_WORDS: Record<string, Language> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  pcm: 'pcm',
  pidgin: 'pcm',
  naija: 'pcm',
  ha: 'ha',
  hausa: 'ha',
  yo: 'yo',
  yoruba: 'yo',
  ig: 'ig',
  igbo: 'ig',
};

export function parseLanguageCommand(body: string): Language | null | undefined {
  const m = /^(?:lang|language)(?:\s*[:=]?\s*(\S+))?$/i.exec(body.trim());
  if (!m) return undefined;
  const word = (m[1] ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();
  return Object.hasOwn(LANGUAGE_WORDS, word) ? LANGUAGE_WORDS[word]! : null;
}

interface InboundMessage {
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string };
}

export async function handleWhatsApp(
  svc: GaskiyaService,
  tenant: Tenant,
  messaging: Messaging,
  limiter: RateLimiter,
  msg: InboundMessage,
): Promise<void> {
  const phone = normalisePhone(msg.from);
  if (!phone) return;
  try {
    await answer(svc, tenant, messaging, limiter, msg, phone);
  } catch (err) {
    const lang = await svc.languageFor(tenant, phone);
    await messaging.sendText(phone, cannotCheck(copyForOrg(lang, tenant.kind), tenant.name)).catch(() => {});
    throw err;
  }
}

async function answer(svc: GaskiyaService, tenant: Tenant, messaging: Messaging, limiter: RateLimiter, msg: InboundMessage, phone: string): Promise<void> {
  const bank = tenant.name;
  let lang = await svc.languageFor(tenant, phone);
  let c = copyForOrg(lang, tenant.kind);

  if (!(await limiter.take(`${tenant.id}:wa:${svc.recipientKey(tenant.id, phone)}`, svc.now().getTime()))) {
    await messaging.sendText(phone, cannotCheck(c, bank));
    return;
  }

  const welcome = () => `${fill(c.bot.welcome, { bank })}\n\n${c.licence.bot.hint}\n\n${c.app.language.hint}`;

  let text: string;
  if (msg.type === 'text' && msg.text) {
    const body = msg.text.body.trim();
    if (/^(hi|hello|help|start|menu)$/i.test(body)) {
      await messaging.sendText(phone, welcome());
      return;
    }
    const chosen = parseLanguageCommand(body);
    if (chosen === null) {
      await messaging.sendText(phone, c.app.language.options);
      return;
    }
    if (chosen) {
      const saved = await svc.setLanguage(tenant, phone, chosen).then(
        () => true,
        () => false,
      );
      if (!saved) {
        await messaging.sendText(phone, cannotCheck(c, bank));
        return;
      }
      lang = chosen;
      c = copyForOrg(lang, tenant.kind);
      await messaging.sendText(phone, c.app.language.set);
      return;
    }
    if (/^(alerts?|warnings?)$/i.test(body)) {
      await messaging.sendText(phone, alertsReply(await svc.activeAdvisories(tenant), bank, lang));
      return;
    }
    if (/^call\??$/i.test(body) || /is (my|the) bank calling/i.test(body)) {
      const r = await svc.openCallFor(tenant, phone, 'whatsapp');
      await messaging.sendText(phone, callReply(r, bank, lang, tenant.kind));
      return;
    }
    const licenceQuery = parseLicenceCommand(body);
    if (licenceQuery === null) {
      await messaging.sendText(phone, c.licence.bot.usage);
      return;
    }
    if (licenceQuery) {
      const r = await svc.checkLicence(tenant, phone, licenceQuery, 'whatsapp');
      await messaging.sendText(phone, licenceReply(r, lang));
      return;
    }
    if (parseContact(body)) {
      const r = await svc.verifyContact({ tenant, phone }, body, 'whatsapp');
      if (r) {
        await messaging.sendText(phone, contactReply(r, lang));
        return;
      }
    }
    text = msg.text.body;
  } else if (msg.type === 'image' && msg.image) {
    const media = await messaging.fetchMedia(msg.image.id).catch(() => null);
    const extracted = media ? await svc.extractText(media.base64, media.mediaType) : null;
    if (!extracted) {
      await messaging.sendText(phone, c.bot.screenshotUnread);
      return;
    }
    text = extracted.text;
  } else {
    await messaging.sendText(phone, welcome());
    return;
  }

  const result = await svc.verifyDigest(tenant.id, phone, contentDigest(text), 'whatsapp');
  let reply = verdictReply(result, bank, lang, tenant.kind);
  if (result.verdict === 'not_confirmed') {
    const ex = await svc.explain(tenant, text, lang);
    reply += `\n\n${c.explain.heading}\n${ex.explanation}\n${ex.action}`;
  }
  if (/\b(one[- ]time|otp|code)\b/i.test(text)) reply += `\n\n${fill(c.bot.otpAdvice, { bank })}`;
  await messaging.sendText(phone, reply);
}
