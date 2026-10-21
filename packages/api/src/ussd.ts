import { copy, copyForOrg, fill, type Copy, type LicenceResult } from '@gaskiya/schemas';
import { contactPhone } from './domain/contact.ts';
import { normalisePhone } from './domain/phone.ts';
import type { RateLimiter } from './ratelimit/ratelimit.ts';
import type { GaskiyaService } from './service.ts';
import type { MessageRecord, Tenant } from './store/types.ts';

export const USSD_MAX = 160;
const TIME_ZONE = 'Africa/Lagos';

export interface UssdInput {
  phoneNumber?: unknown;
  text?: unknown;
}

type State = { at: 'menu' } | { at: 'today'; page: number } | { at: 'contact' } | { at: 'contactAnswer'; number: string } | { at: 'licencePrompt' } | { at: 'more' };

const lines = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join('\n');
const FOLD: Record<string, string> = {
  '\u0253': 'b',
  '\u0181': 'B',
  '\u0257': 'd',
  '\u018a': 'D',
  '\u0199': 'k',
  '\u0198': 'K',
  '\u01b4': 'y',
  '\u01b3': 'Y',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
};

export const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\n\x20-\x7e]/g, (ch) => FOLD[ch] ?? '?');
const con = (body: string) => ascii(`CON ${body}`);
const end = (body: string) => ascii(`END ${body}`);

export function callingMany(c: Copy, bank: string, codes: string[]): string {
  const body = (n: number) => lines(fill(c.call.calling.title, { bank }), `${c.call.calling.codeLabel}: ${codes.slice(0, n).join(', ')}`, c.call.mismatchMany);
  let n = Math.min(codes.length, 3);
  while (n > 1 && ascii(`END ${body(n)}`).length > USSD_MAX) n--;
  return body(n);
}

export function fitName(bank: string, render: (name: string) => string): string {
  let screen = render(bank);
  for (let n = bank.length - 1; screen.length > USSD_MAX && n >= 4; n--) screen = render(`${bank.slice(0, n).trimEnd()}...`);
  return screen;
}

export const cannotCheck = (c: Copy = copy, bank = '') => fitName(bank, (b) => end(lines(c.verdict.cannot_check.title, fill(c.verdict.cannot_check.body, { bank: b }))));

export const notCallingScreen = (c: Copy, bank: string) => fitName(bank, (b) => end(lines(fill(c.call.not_calling.title, { bank: b }), fill(c.call.not_calling.body, { bank: b }))));

export const callingScreen = (c: Copy, bank: string, code: string, purpose: string) => fitName(bank, (b) => end(fill(c.ussd.calling, { bank: b, code, purpose })));

export const contactAnswerScreen = (c: Copy, official: boolean, number: string, bank: string) =>
  fitName(bank, (b) => end(fill(official ? c.official.ussd.official : c.official.ussd.notOfficial, { number, bank: b })));

export interface MenuLine {
  text: string;
  required: boolean;
}

export function menuOptions(c: Copy): MenuLine[] {
  return [
    { text: c.official.ussd.option, required: true },
    { text: c.licence.ussd.moreOption, required: false },
  ];
}

export function moreOptions(c: Copy): string[] {
  return [c.licence.ussd.menuOption];
}

export const moreScreen = (c: Copy) => con(lines(c.licence.ussd.moreHeading, ...moreOptions(c), c.licence.ussd.backOption));

export function menuScreen(c: Copy, bank: string, swapped: boolean): string {
  const head = swapped ? [c.simswap.ussd] : [];
  const [titleTemplate = '', ...builtIn] = c.ussd.menu.split('\n');
  const options = menuOptions(c);
  const required = options.filter((o) => o.required);
  const build = (name: string | null, opts: MenuLine[], neverAsks: boolean) =>
    con(lines(...head, ...(name === null ? [] : [fill(titleTemplate, { bank: name })]), ...builtIn.map((l) => fill(l, { bank })), ...opts.map((o) => o.text), ...(neverAsks ? [c.ussd.neverAsks] : [])));
  for (const [opts, neverAsks] of [[options, true], [required, true], [options, false], [required, false]] as const) {
    const screen = build(bank, opts, neverAsks);
    if (screen.length <= USSD_MAX) return screen;
  }
  const shortened = fitName(bank, (b) => build(b, required, false));
  return shortened.length <= USSD_MAX ? shortened : build(null, required, false);
}

function withSimSwap(screen: string, c: Copy, swapped: boolean): string {
  if (!swapped) return screen;
  const longer = ascii(`${screen}\n${c.simswap.ussd}`);
  return longer.length <= USSD_MAX ? longer : screen;
}

export function startOfDay(now: Date, timeZone = TIME_ZONE): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - elapsed);
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE });
}

export function paginate(heading: string, items: string[], note: string, c: Copy = copy): { body: string; last: boolean }[] {
  const budget = USSD_MAX - 4;
  const footer = lines(c.ussd.more, c.ussd.menuOption);
  const pages: { body: string; last: boolean }[] = [];
  let rest = [...items];
  let first = true;
  for (;;) {
    const head = first ? heading : '';
    if (lines(head, ...rest, note).length <= budget) {
      pages.push({ body: lines(head, ...rest, note), last: true });
      return pages;
    }
    let n = 0;
    while (n < rest.length && lines(head, ...rest.slice(0, n + 1), footer).length <= budget) n++;
    n = Math.max(n, 1);
    pages.push({ body: lines(head, ...rest.slice(0, n), footer), last: false });
    rest = rest.slice(n);
    first = false;
  }
}

function todayItem(r: MessageRecord, c: Copy) {
  return fill(c.ussd.todayItem, {
    time: clock(r.sentAt),
    category: c.categories[r.category as keyof typeof c.categories] ?? r.category,
    channel: c.channels[r.channel as keyof typeof c.channels] ?? r.channel,
  });
}

export function licenceScreen(c: Copy, r: LicenceResult): string {
  const regulators = r.regulators.map((x) => x.name).join(', ');
  if (r.verdict === 'cannot_check') return end(c.licence.ussd.cannotCheck);
  if (r.verdict === 'not_listed' && !r.similarTo) return end(fill(c.licence.ussd.notListed, { regulators }));
  const firm = r.verdict === 'licensed' ? r.firm : r.similarTo!;
  return fitName(firm.name, (name) =>
    end(r.verdict === 'licensed' ? fill(c.licence.ussd.licensed, { name, regulator: firm.regulator }) : fill(c.licence.ussd.similar, { name })),
  );
}

type Step = State | 'call' | 'invalid' | { at: 'licence'; query: string };

function walk(inputs: string[]): Step {
  let state: State = { at: 'menu' };
  for (const [i, input] of inputs.entries()) {
    if (state.at === 'contactAnswer') return 'invalid';
    if (state.at === 'menu') {
      if (input === '1') return 'call';
      if (input === '2') state = { at: 'today', page: 0 };
      else if (input === '3') state = { at: 'contact' };
      else if (input === '4') state = { at: 'licencePrompt' };
      else if (input === '9') state = { at: 'more' };
      else return 'invalid';
    } else if (state.at === 'more') {
      if (input === '4') state = { at: 'licencePrompt' };
      else if (input === '0') state = { at: 'menu' };
      else return 'invalid';
    } else if (state.at === 'contact') state = { at: 'contactAnswer', number: input };
    else if (state.at === 'licencePrompt') {
      const query = inputs.slice(i).join('*').trim();
      return query.length >= 2 && query.length <= 100 ? { at: 'licence', query } : 'invalid';
    } else if (input === '98') state = { at: 'today', page: state.page + 1 };
    else if (input === '0') state = { at: 'menu' };
    else return 'invalid';
  }
  return state;
}

export async function handleUssd(
  svc: GaskiyaService,
  tenant: Tenant | undefined,
  limiter: RateLimiter | null,
  input: UssdInput,
): Promise<string> {
  const phone = normalisePhone(input.phoneNumber);
  if (!tenant || !phone) return cannotCheck();
  const bank = tenant.name;
  let c: Copy = copyForOrg('en', tenant.kind);
  try {
    c = copyForOrg(await svc.languageFor(tenant, phone), tenant.kind);
    const recipientKey = svc.recipientKey(tenant.id, phone);
    if (limiter && !(await limiter.take(`${tenant.id}:ussd:${recipientKey}`, svc.now().getTime()))) return end(c.ussd.tooMany);

    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const next = walk(text === '' ? [] : text.split('*').map((s) => s.trim()));

    if (next === 'invalid') return end(c.ussd.invalid);
    if (next === 'call') {
      const r = await svc.openCallFor(tenant, phone, 'ussd');
      const swapped = r.warnings?.includes('sim_swapped_recently') ?? false;
      if (r.verdict === 'cannot_check') return withSimSwap(cannotCheck(c, bank), c, swapped);
      if (r.verdict === 'not_calling') return withSimSwap(notCallingScreen(c, bank), c, swapped);
      const [only] = r.calls;
      if (r.calls.length === 1 && only) return withSimSwap(callingScreen(c, bank, only.code, c.purposes[only.purpose]), c, swapped);
      return withSimSwap(end(callingMany(c, bank, r.calls.map((x) => x.code))), c, swapped);
    }
    if (next.at === 'menu') return menuScreen(c, bank, (await svc.simSwapWarnings(tenant, phone)).includes('sim_swapped_recently'));
    if (next.at === 'more') return moreScreen(c);
    if (next.at === 'licencePrompt') return con(c.licence.ussd.prompt);
    if (next.at === 'licence') return licenceScreen(c, await svc.checkLicence(tenant, phone, next.query, 'ussd'));
    if (next.at === 'contact') return con(c.official.ussd.enterNumber);
    if (next.at === 'contactAnswer') {
      const number = contactPhone(next.number);
      if (!number) return end(c.official.ussd.badNumber);
      const r = await svc.verifyContact({ tenant, phone }, number, 'ussd', tenant);
      if (!r || r.verdict === 'cannot_check') return cannotCheck(c, bank);
      return contactAnswerScreen(c, r.verdict === 'official', number, bank);
    }

    const now = svc.now();
    const records = (await Promise.all(svc.recipientKeys(tenant.id, phone).map((k) => svc.store.recentMessages(tenant.id, k, startOfDay(now), now))))
      .flat()
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const pages = records.length
      ? paginate(fill(c.ussd.todayHeading, { bank }), records.map((r) => todayItem(r, c)), c.ussd.todayNote, c)
      : paginate(fill(c.ussd.todayNone, { bank }), [], c.ussd.todayNote, c);
    const page = pages[Math.min(next.page, pages.length - 1)]!;
    return page.last ? end(page.body) : con(page.body);
  } catch {
    return cannotCheck(c, bank);
  }
}
