function words(...lists: string[]): Set<string> {
  return new Set(lists.join(' ').split(/\s+/).filter(Boolean));
}

const INVISIBLE = /[\p{Cf}\u00ad\u115f\u1160\u180e\u3164\uffa0]/gu;

const CONFUSABLE: Record<string, string> = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x',
  '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u043a': 'k', '\u043c': 'm', '\u043d': 'h', '\u0442': 't',
  '\u0432': 'b', '\u0457': 'i', '\u04cf': 'i', '\u0501': 'd', '\u051b': 'q', '\u051d': 'w',
  '\u03bf': 'o', '\u03c1': 'p', '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v', '\u03c4': 't', '\u03b1': 'a',
  '\u03b5': 'e', '\u03c5': 'u', '\u03c7': 'x', '\u0131': 'i', '\u0237': 'j', '\u0269': 'i', '\u026a': 'i',
};

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

const SENTENCE_END = /[.!?\n\u2026]/;
const CLAUSE_MARK = /[;:,()[\]{}"\u2013\u2014]/;

export function secretTokens(text: string): string[] {
  let t = text.normalize('NFKC').replace(INVISIBLE, '').toLowerCase();
  t = t.normalize('NFD').replace(/\p{M}/gu, '');
  t = [...t].map((c) => CONFUSABLE[c] ?? c).join('');
  t = t.replace(/(?<=\p{L})[!|](?=\p{L})/gu, 'i');
  t = t.replace(/[013457@$]/g, (c) => LEET[c] ?? c);
  t = t.replace(/[\u0027\u2018\u2019\u0060\u00b4\u02bc]/g, '');

  const parts = t.split(/([a-z0-9]+)/);
  const raw: Array<{ w?: string; sep?: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p) continue;
    raw.push(i % 2 === 1 ? { w: p } : { sep: p });
  }

  const words: Array<{ w?: string; mark?: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    if (r.sep !== undefined) {
      if (SENTENCE_END.test(r.sep)) words.push({ mark: '|' });
      else if (CLAUSE_MARK.test(r.sep)) words.push({ mark: ',' });
      continue;
    }
    if (r.w!.length === 1) {
      let j = i;
      const run = [r.w!];
      while (raw[j + 1]?.sep !== undefined && !/\n/.test(raw[j + 1]!.sep!) && raw[j + 2]?.w?.length === 1) {
        run.push(raw[j + 2]!.w!);
        j += 2;
      }
      if (run.length >= 2) {
        if (run.length >= 4 && (run[0] === 'a' || run[0] === 'i')) words.push({ w: run.shift()! });
        words.push({ w: run.join('') });
        i = j;
        continue;
      }
    }
    words.push({ w: r.w! });
  }

  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i]!;
    if (a.mark) {
      const last = out.at(-1);
      if (last === '|' || last === ',') out[out.length - 1] = last === '|' ? '|' : a.mark;
      else out.push(a.mark);
      continue;
    }
    let joined = false;
    for (const n of [3, 2]) {
      const slice = words.slice(i, i + n);
      if (slice.length === n && slice.every((s) => s.w && s.w.length <= 4)) {
        const cat = slice.map((s) => s.w).join('');
        if (SECRET_WORDS.has(cat)) {
          out.push(cat);
          i += n - 1;
          joined = true;
          break;
        }
      }
    }
    if (!joined) out.push(a.w!);
  }
  return out;
}

const SECRET_WORDS = words(
  'pin pins mpin pincode pinnumber password passwords passwd pword pwd',
  'passcode passcodes passkey passphrase otp otps onetime cvv cvv2 cvc cvn cvvs',
  'bvn credentials creds',
  'igbaniwole okwuntughe',
);

const CODE_QUALIFIERS = words(
  'otp sms verification verify auth authentication authorisation authorization confirmation',
  'activation access transfer transaction reset security secret login digit digits',
  'token onetime pin ussd approval withdrawal cardless hardware soft software otp',
);
const CODE_NOUNS = words('token tokens code codes koodu number numbers answer answers question questions word details pin password');
const DETERMINERS = words('the your ur yur yo ya that this these those my our any d da thy');

function secretAt(t: string[], i: number, named = false): number {
  const w = t[i];
  if (!w || w === '|') return 0;
  const n1 = t[i + 1];
  const n2 = t[i + 2];
  if ((w === 'one' || w === 'i') && n1 === 'time' && n2 && /^(code|codes|password|passcode|pin|token|otp|pass|passwords)$/.test(n2)) return 3;
  if (SECRET_WORDS.has(w)) return 1;
  if (w === 'card' && n1 && /^(number|numbers|no|nos|num|details|digits|info|information|data|pin|code|cvv|cvc)$/.test(n1)) return 2;
  if ((w === 'security' || w === 'secret') && n1 && /^(code|codes|answer|answers|question|questions|word|words|details|number|pin|phrase)$/.test(n1)) return 2;
  if ((w === 'login' || w === 'logon' || w === 'signin') && n1 && /^(details|credentials|info|information|code)$/.test(n1)) return 2;
  if (w === 'log' && n1 === 'in' && n2 && /^(details|credentials|info|code)$/.test(n2)) return 3;
  if (w === 'maiden' && n1 === 'name') return 2;
  if (CODE_QUALIFIERS.has(w) && n1 && CODE_NOUNS.has(n1) && !(w === 'digit' && n1 === 'number')) return 2;
  if (w === 'code' || w === 'codes' || w === 'token' || w === 'tokens') {
    if (named) return 0;
    const prev = t[i - 1];
    if (prev === 'call' || prev === 'kira') return 0;
    if (prev && DETERMINERS.has(prev)) return 1;
    const after = t.slice(i + 1, i + 4).join(' ');
    if (/^((we|i|they|he|she|that|which|wey|bank|wey we|wey dem) )?(sent|send|texted|gave|got|received|get|receive|dey)\b/.test(after)) return 1;
    if (/^(you|u) (got|received|get|receive|just)\b/.test(after)) return 1;
    return 0;
  }
  if (w === 'koodu' && n1 && /^(re|yin|mi|wa|gi|unu|anyi|eekan|otu)$/.test(n1)) return 2;
  if (w === 'nomba' && n1 && /^(kaadi|kaad)$/.test(n1)) return 2;
  if (/^(kalmar|kalmomin|lambar|lambobin|lamba)$/.test(w) && n1 && /^(sirri|kati|katin)$/.test(n1)) return 2;
  return 0;
}

export function mentionsSecret(text: string): boolean {
  const t = secretTokens(text);
  return t.some((_, i) => secretAt(t, i) > 0);
}

const REQUEST_VERBS = words(
  'share sharing send sending snd enter entering input type key provide providing',
  'give giving gimme tell telling reply replying respond text sms whatsapp dm submit',
  'forward fwd disclose reveal confirm verify validate update supply write say dictate',
  'spell drop post paste upload hand pass need needs require requires request ask want',
  'dial fill put show whats transmit mail email',
  'bayar aiko aika tura turo fada gaya shigar rubuta raba nema neman bukaci tambaya',
  'beere ranse fi',
  'ziga nye gwa kesaa kesa tinye ario rio',
);

const PASSIVE = words('needed required requested wanted please pls plz abeg biko asap');

const NEGATIONS = words(
  'not never nevr neva dont doesnt didnt wont cant cannot shouldnt mustnt',
  'wouldnt no nobody noone none neither nor avoid refuse',
  'kada kar ba babu ma mase kii kiyoo agaghi anaghi',
);

const FILLERS = words(
  'ever evr eva under any circumstances circumstance one body will would should',
  'shall must can could may might need needs to you u we they i he she',
  'it be have has had do does did go dey fit also still bank banks call phone contact come try',
  'genuine real legitimate staff official officials agent agents person member members',
  'of worker workers employee employees gaskiyya our your the a an us them',
  'yourself really actually ask asks',
  'zan za ta taba ku ka ki ya yi su mu ne ce yoo o si mi emi m gi ha',
);

const CONTROL = words('tell ask let allow encourage advise urge invite instruct direct expect want get make force');

const OR = words('or nor ko tabi bu');

const CAUSE = /^(get|gets|make|makes|trick|tricks|lure|lures|push|pushes|pressure|pressures|persuade|persuades|convince|convinces|force|forces|sa|mu|mee)$/;
const PEOPLE = words('people victims customers someone others mutane eniyan mmadu');

const URGING = (
  'never mind / no matter / no problem / no wahala / no delay / no delays / no worries / no worry / ' +
  'no wait / no time / no excuse / no excuses / no hesitation / not later / do not delay / dont delay / ' +
  'do not wait / dont wait / do not hesitate / dont hesitate / do not forget / dont forget / not forget / ' +
  'never forget / do not worry / dont worry / do not panic / dont panic / no need to worry / no need to panic / ' +
  'do not fail / dont fail / never fail / not fail / without delay / not to delay / no go forget / ' +
  'no forget / no shaking'
).split(' / ');

const EXCEPT = words('except unless only but apart besides save sai ayafi belu');

const POINTER = words('it them am this that those these shi su e ya');

const FORWARD = 7;
const BACKWARD = 8;

function cutUrging(t: string[]): string[] {
  let out = ' ' + t.join(' ') + ' ';
  out = out.replace(/ never , ever /g, ' never ever ');
  for (const p of URGING) out = out.split(' ' + p + ' ').join(' | ');
  out = out.replace(/ ma se /g, ' mase ').replace(/ ki i /g, ' kii ').replace(/ ki yoo /g, ' kiyoo ');
  return out.trim().split(/\s+/).filter(Boolean);
}

function excused(t: string[], v: number): boolean {
  let i = v - 1;
  let inList = false;
  let steps = 0;
  let negated = false;
  while (i >= 0 && steps++ < 14) {
    const w = t[i]!;
    if (NEGATIONS.has(w)) {
      negated = true;
      break;
    }
    if (inList) {
      if (w === '|') break;
      if (PEOPLE.has(w) && t[i - 1] && CAUSE.test(t[i - 1]!)) return true;
      i--;
      continue;
    }
    if (w === '|' || w === ',') break;
    if (PEOPLE.has(w) && t[i - 1] && CAUSE.test(t[i - 1]!)) return true;
    if (OR.has(w)) {
      inList = true;
      i--;
      continue;
    }
    if (w === 'to' && t[i - 1] && PEOPLE.has(t[i - 1]!) && t[i - 2] && CAUSE.test(t[i - 2]!)) return true;
    if (w === 'to') {
      for (let k = i - 1; k >= Math.max(0, i - 4) && t[k] !== '|' && t[k] !== ','; k--) {
        if (REQUEST_VERBS.has(t[k]!) || CONTROL.has(t[k]!)) return excused(t, k);
      }
    }
    if (FILLERS.has(w)) {
      i--;
      continue;
    }
    break;
  }
  if (!negated) return false;
  for (let j = v + 1; j < t.length && j <= v + 12 && t[j] !== '|' && t[j] !== ','; j++) if (EXCEPT.has(t[j]!)) return false;
  return true;
}

export function asksForSecret(text: string): boolean {
  const t = cutUrging(secretTokens(text));
  const secrets: number[] = [];
  for (let i = 0; i < t.length; i++) if (secretAt(t, i) > 0) secrets.push(i);
  if (!secrets.length) return false;

  for (let v = 0; v < t.length; v++) {
    const w = t[v]!;
    const isWhat = (w === 'what' || w === 'wetin') && /^(is|s|be|are)$/.test(t[v + 1] ?? '');
    const reads = w === 'read' || w === 'recite';
    if (!REQUEST_VERBS.has(w) && !isWhat && !reads) continue;
    let hit = false;
    for (let j = v + 1, words = 0; j < t.length && words < FORWARD; j++) {
      if (t[j] === '|' || t[j] === ',') continue;
      words++;
      if (secretAt(t, j, reads) > 0) {
        hit = true;
        break;
      }
      if (REQUEST_VERBS.has(t[j]!)) break;
    }
    if (!hit && POINTER.has(t[v + 1] ?? '')) {
      for (let j = v - 1, words = 0; j >= 0 && words < BACKWARD; j--) {
        if (t[j] === '|' || t[j] === ',') continue;
        words++;
        if (secretAt(t, j, reads) > 0) {
          hit = true;
          break;
        }
      }
    }
    if (hit && !excused(t, v)) return true;
  }

  for (const s of secrets) {
    const len = secretAt(t, s);
    let k0 = s - 1;
    while (k0 >= 0 && DETERMINERS.has(t[k0]!)) k0--;
    const opensClause = k0 < 0 || t[k0] === '|' || t[k0] === ',';
    for (let j = s + len, words = 0; j < t.length && words < 3 && t[j] !== '|'; j++, words++) {
      if (t[j] === ',') {
        if (opensClause) continue;
        break;
      }
      if (NEGATIONS.has(t[j]!)) break;
      if (PASSIVE.has(t[j]!)) {
        let k = s - 1;
        while (k >= 0 && FILLERS.has(t[k]!)) k--;
        if (k >= 0 && NEGATIONS.has(t[k]!)) break;
        return true;
      }
    }
  }
  return false;
}
