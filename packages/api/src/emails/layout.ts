export const DEFAULT_LOGO_URL = 'https://res.cloudinary.com/dpa2qyejg/image/upload/w_112,h_112,c_fit,f_png/v1791202930/gaskiya-logo_xf5zua.png';

const C = {
  emerald: '#0A7A55',
  emeraldSoft: '#E6F2EC',
  ink: '#0E1512',
  paper: '#F4F3EF',
  card: '#FFFFFF',
  muted: '#5B6660',
  faint: '#8A938E',
  line: '#E5E4DF',
  amber: '#B45309',
  amberSoft: '#FDF1E3',
  red: '#B42318',
  redSoft: '#FDECEA',
};

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

export const fmt = (v: string | number) => (typeof v === 'number' ? v.toLocaleString('en-NG') : v);

export const esc = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type Tone = 'brand' | 'warning' | 'danger' | 'neutral';

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'facts'; rows: [string, string][] }
  | { kind: 'stats'; items: { label: string; value: string | number; tone?: Tone }[] }
  | { kind: 'chips'; items: string[]; tone?: Tone }
  | { kind: 'quote'; label: string; text: string; status?: string }
  | { kind: 'steps'; items: { title: string; text: string }[] }
  | { kind: 'list'; title?: string; items: { title: string; meta?: string }[] }
  | { kind: 'note'; text: string; tone?: Tone };

export interface EmailContent {
  preheader: string;
  eyebrow: string;
  title: string;
  badge?: { text: string; tone: Tone };
  intro: string;
  blocks: Block[];
  cta?: { label: string; url: string };
  reason: string;
}

export interface Rendered {
  html: string;
  text: string;
}

const toneColors: Record<Tone, [string, string]> = {
  brand: [C.emerald, C.emeraldSoft],
  warning: [C.amber, C.amberSoft],
  danger: [C.red, C.redSoft],
  neutral: [C.muted, C.paper],
};

function block(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return `<p class="g-ink" style="margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${C.ink}">${esc(b.text)}</p>`;
    case 'facts':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="g-line" style="margin:4px 0 20px;border-top:1px solid ${C.line}">${b.rows
        .map(
          ([k, v]) =>
            `<tr><td class="g-muted g-line" style="padding:11px 0;border-bottom:1px solid ${C.line};font:400 14px/1.4 ${FONT};color:${C.muted};width:42%;vertical-align:top">${esc(k)}</td><td class="g-ink g-line" style="padding:11px 0;border-bottom:1px solid ${C.line};font:600 14px/1.4 ${FONT};color:${C.ink};text-align:right">${esc(fmt(v))}</td></tr>`,
        )
        .join('')}</table>`;
    case 'stats': {
      const cells = b.items.map((s) => {
        const [fg] = toneColors[s.tone ?? 'neutral'];
        return `<td width="${Math.floor(100 / b.items.length)}%" style="padding:4px;vertical-align:top"><div class="g-tile" style="background:${C.paper};border-radius:14px;padding:14px 12px"><div class="g-stat-v${s.tone ? '' : ' g-ink'}" style="font:700 26px/1.1 ${DISPLAY};color:${s.tone ? fg : C.ink};letter-spacing:-0.02em">${esc(fmt(s.value))}</div><div class="g-muted" style="margin-top:4px;font:500 12px/1.3 ${FONT};color:${C.muted}">${esc(s.label)}</div></div></td>`;
      });
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>${cells.join('')}</tr></table>`;
    }
    case 'chips': {
      const [fg, bg] = toneColors[b.tone ?? 'neutral'];
      return `<p style="margin:0 0 18px;line-height:30px">${b.items
        .map((c) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 11px;border-radius:999px;background:${bg};color:${fg};font:600 12px/20px ${FONT}">${esc(c)}</span>`)
        .join('')}</p>`;
    }
    case 'quote':
      return `<p style="margin:4px 0 8px;font:600 11px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.faint}">${esc(b.label)}${b.status ? ` &middot; ${esc(b.status)}` : ''}</p><div class="g-tile g-ink" style="margin:0 0 20px;padding:14px 16px;border-left:3px solid ${C.emerald};background:${C.paper};border-radius:0 12px 12px 0;font:400 14px/1.6 ${FONT};color:${C.ink}">${esc(b.text)}</div>`;
    case 'steps':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${b.items
        .map(
          (s, i) =>
            `<tr><td width="40" style="vertical-align:top;padding:2px 0 14px"><div style="width:28px;height:28px;border-radius:14px;background:${C.emeraldSoft};color:${C.emerald};font:700 13px/28px ${FONT};text-align:center">${i + 1}</div></td><td style="vertical-align:top;padding:2px 0 14px"><div class="g-ink" style="font:600 15px/1.4 ${FONT};color:${C.ink}">${esc(s.title)}</div><div class="g-muted" style="margin-top:2px;font:400 14px/1.5 ${FONT};color:${C.muted}">${esc(s.text)}</div></td></tr>`,
        )
        .join('')}</table>`;
    case 'list':
      return `${b.title ? `<p style="margin:4px 0 8px;font:600 11px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.faint}">${esc(b.title)}</p>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="g-line" style="margin:0 0 20px;border-top:1px solid ${C.line}">${b.items
        .map(
          (it) =>
            `<tr><td class="g-line" style="padding:11px 0;border-bottom:1px solid ${C.line}"><div class="g-ink" style="font:600 14px/1.4 ${FONT};color:${C.ink}">${esc(it.title)}</div>${it.meta ? `<div class="g-muted" style="margin-top:2px;font:400 13px/1.4 ${FONT};color:${C.muted}">${esc(it.meta)}</div>` : ''}</td></tr>`,
        )
        .join('')}</table>`;
    case 'note': {
      const [fg, bg] = toneColors[b.tone ?? 'brand'];
      return `<div class="g-note-${b.tone ?? 'brand'}" style="margin:0 0 20px;padding:12px 14px;border-radius:12px;background:${bg};font:500 13px/1.5 ${FONT};color:${fg}">${esc(b.text)}</div>`;
    }
  }
}

function blockText(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return b.text;
    case 'facts':
      return b.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    case 'stats':
      return b.items.map((s) => `${s.label}: ${fmt(s.value)}`).join('\n');
    case 'chips':
      return b.items.join(', ');
    case 'quote':
      return `${b.label}${b.status ? ` (${b.status})` : ''}:\n${b.text}`;
    case 'steps':
      return b.items.map((s, i) => `${i + 1}. ${s.title}: ${s.text}`).join('\n');
    case 'list':
      return `${b.title ? `${b.title}\n` : ''}${b.items.map((i) => `- ${i.title}${i.meta ? ` (${i.meta})` : ''}`).join('\n')}`;
    case 'note':
      return b.text;
  }
}

export function renderEmail(c: EmailContent, logoUrl = DEFAULT_LOGO_URL): Rendered {
  const [badgeFg, badgeBg] = c.badge ? toneColors[c.badge.tone] : ['', ''];
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(c.title)}</title>
<style>
  @media (max-width:620px){ .g-card{padding:28px 20px!important} .g-title{font-size:24px!important} .g-stat-v{font-size:21px!important} }
  @media (prefers-color-scheme:dark){
    .g-body{background:#0B0F0D!important} .g-card{background:#161B18!important}
    .g-ink{color:#F4F3EF!important} .g-muted{color:#A7B0AB!important}
    .g-tile{background:#202723!important} .g-line{border-color:#2A322E!important}
    .g-note-brand{background:#13392B!important;color:#7FD8B4!important}
    .g-note-neutral{background:#202723!important;color:#C9D1CC!important}
    .g-note-warning{background:#3A2A12!important;color:#F5C27A!important}
    .g-note-danger{background:#3B1A17!important;color:#F4A39B!important}
  }
</style>
</head>
<body class="g-body" style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="g-body" style="background:${C.paper}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
    <tr><td style="padding:0 6px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle"><div style="width:48px;height:48px;border-radius:14px;background:#FFFFFF;box-shadow:0 1px 2px rgba(14,21,18,.06);text-align:center"><img src="${esc(logoUrl)}" width="36" height="36" alt="Gaskiya" style="display:inline-block;margin-top:6px;border:0;outline:none;text-decoration:none"></div></td>
        <td style="vertical-align:middle;padding-left:12px;font:700 20px/1 ${DISPLAY};letter-spacing:-0.02em;color:${C.ink}" class="g-ink">Gaskiya</td>
      </tr></table>
    </td></tr>
    <tr><td class="g-card" style="background:${C.card};border-radius:22px;padding:36px 36px 32px;box-shadow:0 1px 2px rgba(14,21,18,.04),0 12px 32px rgba(14,21,18,.06)">
      <p style="margin:0 0 10px;font:700 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.emerald}">${esc(c.eyebrow)}${
        c.badge ? ` <span style="display:inline-block;margin-left:6px;padding:2px 9px;border-radius:999px;background:${badgeBg};color:${badgeFg};font:700 11px/18px ${FONT};letter-spacing:.04em;vertical-align:1px">${esc(c.badge.text)}</span>` : ''
      }</p>
      <h1 class="g-title g-ink" style="margin:0 0 14px;font:700 28px/1.2 ${DISPLAY};letter-spacing:-0.025em;color:${C.ink}">${esc(c.title)}</h1>
      <p class="g-muted" style="margin:0 0 24px;font:400 16px/1.6 ${FONT};color:${C.muted}">${esc(c.intro)}</p>
      ${c.blocks.map(block).join('\n      ')}
      ${
        c.cta
          ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:14px;background:${C.emerald}"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:14px 24px;font:600 15px/1 ${FONT};color:#FFFFFF;text-decoration:none;border-radius:14px">${esc(c.cta.label)} &rarr;</a></td></tr></table>`
          : ''
      }
    </td></tr>
    <tr><td style="padding:22px 12px 0;text-align:center;font:400 12px/1.6 ${FONT};color:${C.faint}">
      ${esc(c.reason)}<br>
      Gaskiya stores no phone numbers and no text of the messages banks register; customer fraud reports, sent with consent, are kept masked. Gaskiya never asks anyone for a PIN, password, card number or one-time code.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `GASKIYA \u00B7 ${c.eyebrow.toUpperCase()}${c.badge ? ` (${c.badge.text})` : ''}`,
    '',
    c.title,
    '',
    c.intro,
    '',
    ...c.blocks.flatMap((b) => [blockText(b), '']),
    ...(c.cta ? [`${c.cta.label}: ${c.cta.url}`, ''] : []),
    '--',
    c.reason,
    'Gaskiya stores no phone numbers and no text of the messages banks register; customer fraud reports, sent with consent, are kept masked. Gaskiya never asks anyone for a PIN, password, card number or one-time code.',
  ].join('\n');

  return { html, text };
}
