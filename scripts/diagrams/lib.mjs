export const STYLE = `
.bg{fill:#ffffff}
.lane{stroke-width:1}
.lane-bank{fill:#f3f5f8;stroke:#d8dee6}
.lane-gk{fill:#eef8f3;stroke:#bfe3d1}
.lane-cust{fill:#fbf6ee;stroke:#ecdcc0}
.lane-plain{fill:#f6f6f3;stroke:#e1e1da}
.lane-label{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}
.lane-label.bank{fill:#4a5a6e}.lane-label.gk{fill:#0a7a55}.lane-label.cust{fill:#9a6a1c}.lane-label.plain{fill:#6b716d}
.node{fill:#ffffff;stroke:#c9d0d8;stroke-width:1.2}
.node.gk{stroke:#0a7a55;stroke-width:1.5}
.node.cust{stroke:#d9a441}
.node.bank{stroke:#8494a7}
.node.muted{fill:#f7f7f5;stroke:#c9ccc8;stroke-dasharray:4 3}
.node.good{fill:#e7f6ee;stroke:#0a7a55;stroke-width:1.5}
.node.warn{fill:#fff4e5;stroke:#d9890b;stroke-width:1.5}
.node.bad{fill:#fdecea;stroke:#c8372d;stroke-width:1.5}
.node.dec{fill:#ffffff;stroke:#4a5a6e;stroke-width:1.3}
.t{font:600 13.5px Inter,system-ui,sans-serif;fill:#0e1512}
.ts{font:400 11.5px Inter,system-ui,sans-serif;fill:#59645e}
.tm{font:500 11px "SF Mono",Menlo,Consolas,monospace;fill:#0e1512}
.edge{fill:none;stroke:#3d4843;stroke-width:1.4}
.edge.gk{stroke:#0a7a55}
.edge.dash{stroke-dasharray:5 4}
.edge.soft{stroke:#9aa39e}
.arrow{fill:#3d4843}.arrow.gk{fill:#0a7a55}.arrow.soft{fill:#9aa39e}
.el{font:500 11px Inter,system-ui,sans-serif;fill:#26302b}
.elb{fill:#ffffff;opacity:.94}
.step{fill:#0a7a55}
.stepn{font:700 10.5px Inter,system-ui,sans-serif;fill:#ffffff}
.life{stroke:#b9c0bc;stroke-width:1.2;stroke-dasharray:3 4}
.act{fill:#e7f6ee;stroke:#0a7a55;stroke-width:1}
.note{fill:#fffaf0;stroke:#e6cf9c}
.cap{font:400 11px Inter,system-ui,sans-serif;fill:#6b716d}
`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const textWidth = (s, size = 11) => String(s).length * size * 0.56;

export class Diagram {
  constructor(name, width, height, title, desc) {
    Object.assign(this, { name, width, height, title, desc });
    this.els = [];
    this.top = [];
  }

  id(s) {
    return `${this.name}-${s}`;
  }

  add(svg, layer = 'main') {
    (layer === 'top' ? this.top : this.els).push(svg);
  }

  rect(x, y, w, h, cls, r = 12) {
    this.add(`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`);
  }

  text(x, y, s, cls = 't', anchor = 'middle', layer = 'main') {
    const str = String(s).startsWith('`') ? String(s).slice(1) : s;
    this.add(`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(str)}</text>`, layer);
  }

  lane(x, y, w, h, label, kind) {
    this.rect(x, y, w, h, `lane lane-${kind}`, 16);
    this.text(x + 18, y + 26, label, `lane-label ${kind}`, 'start');
  }

  node(x, y, w, h, title, sub = [], kind = '') {
    const lines = Array.isArray(sub) ? sub : [sub];
    this.rect(x, y, w, h, `node ${kind}`, 10);
    const block = 17 + lines.length * 15;
    let ty = y + (h - block) / 2 + 13;
    this.text(x + w / 2, ty, title, 't');
    for (const l of lines) {
      ty += 15;
      this.text(x + w / 2, ty + 1, l, l.startsWith('`') ? 'tm' : 'ts');
    }
    return anchors(x, y, w, h);
  }

  store(x, y, w, h, title, sub = []) {
    const e = 9;
    this.add(
      `<path class="node gk" d="M${x} ${y + e} a${w / 2} ${e} 0 0 1 ${w} 0 v${h - 2 * e} a${w / 2} ${e} 0 0 1 ${-w} 0 Z"/>` +
        `<path class="node gk" style="fill:none" d="M${x} ${y + e} a${w / 2} ${e} 0 0 0 ${w} 0"/>`,
    );
    const lines = Array.isArray(sub) ? sub : [sub];
    let ty = y + e + (h - e - (17 + lines.length * 15)) / 2 + 13;
    this.text(x + w / 2, ty, title, 't');
    for (const l of lines) {
      ty += 15;
      this.text(x + w / 2, ty + 1, l, 'ts');
    }
    return anchors(x, y, w, h);
  }

  diamond(cx, cy, w, h, lines) {
    this.add(`<path class="node dec" d="M${cx} ${cy - h / 2} L${cx + w / 2} ${cy} L${cx} ${cy + h / 2} L${cx - w / 2} ${cy} Z"/>`);
    const ls = Array.isArray(lines) ? lines : [lines];
    let ty = cy - ((ls.length - 1) * 15) / 2 + 4.5;
    for (const l of ls) {
      this.text(cx, ty, l, 't');
      ty += 15;
    }
    return { cx, cy, t: [cx, cy - h / 2], b: [cx, cy + h / 2], l: [cx - w / 2, cy], r: [cx + w / 2, cy] };
  }

  stepBadge(x, y, n) {
    this.add(`<circle class="step" cx="${x}" cy="${y}" r="10"/><text class="stepn" x="${x}" y="${y + 3.7}" text-anchor="middle">${n}</text>`, 'top');
  }

  edge(points, { label, at, kind = '', dash = false, step, both = false, labelDy = 0, labelDx = 0 } = {}) {
    const cls = `edge ${kind}${dash ? ' dash' : ''}`;
    const marker = kind === 'gk' ? 'gk' : kind === 'soft' ? 'soft' : 'ink';
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
    this.add(
      `<path class="${cls}" d="${d}" marker-end="url(#${this.id(marker)})"${both ? ` marker-start="url(#${this.id(marker + '-s')})"` : ''}/>`,
    );
    if (label || step) {
      let seg = at;
      if (seg === undefined) {
        let best = -1;
        for (let i = 0; i < points.length - 1; i++) {
          const len = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
          if (len > best) {
            best = len;
            seg = i;
          }
        }
      }
      const [a, b] = [points[seg], points[seg + 1]];
      const mx = (a[0] + b[0]) / 2 + labelDx;
      const my = (a[1] + b[1]) / 2 + labelDy;
      const lines = label ? (Array.isArray(label) ? label : [label]) : [];
      const w = Math.max(0, ...lines.map((l) => textWidth(l))) + (step ? 26 : 0) + 12;
      const h = lines.length * 14 + 6;
      if (lines.length || step) {
        this.add(`<rect class="elb" x="${mx - w / 2}" y="${my - h / 2}" width="${w}" height="${Math.max(h, 22)}" rx="6"/>`, 'top');
        let ly = my - ((lines.length - 1) * 14) / 2 + 4;
        const tx = mx + (step ? 13 : 0);
        for (const l of lines) {
          this.text(tx, ly, l, l.startsWith('`') ? 'tm' : 'el', 'middle', 'top');
          ly += 14;
        }
        if (step) this.stepBadge(mx - w / 2 + 13, my + (h < 22 ? (22 - h) / 2 : 0), step);
      }
    }
  }

  svg({ standalone = true } = {}) {
    const markers = ['ink', 'gk', 'soft']
      .map(
        (m) =>
          `<marker id="${this.id(m)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow ${m === 'ink' ? '' : m}" d="M0 0 L10 5 L0 10 z"/></marker>` +
          `<marker id="${this.id(m + '-s')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow ${m === 'ink' ? '' : m}" d="M0 0 L10 5 L0 10 z"/></marker>`,
      )
      .join('');
    const body = [
      `<title id="${this.id('title')}">${esc(this.title)}</title>`,
      `<desc id="${this.id('desc')}">${esc(this.desc)}</desc>`,
      standalone ? `<style>${STYLE.trim()}</style>` : '',
      `<defs>${markers}</defs>`,
      `<rect class="bg" x="0" y="0" width="${this.width}" height="${this.height}"/>`,
      ...this.els,
      ...this.top,
    ].join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" class="diagram" viewBox="0 0 ${this.width} ${this.height}" role="img" aria-labelledby="${this.id('title')} ${this.id('desc')}">\n${body}\n</svg>\n`;
  }
}

function anchors(x, y, w, h) {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, t: [x + w / 2, y], b: [x + w / 2, y + h], l: [x, y + h / 2], r: [x + w, y + h / 2] };
}

export function sequence(name, title, desc, { width, participants, messages, rowH = 46, headH = 58, footer }) {
  const n = participants.length;
  const margin = 40;
  const colW = (width - margin * 2) / n;
  const xs = participants.map((_, i) => margin + colW * i + colW / 2);
  const top = 24;
  const startY = top + headH + 34;
  let y = startY;
  const rows = messages.map((m) => {
    const r = { ...m, y };
    y += m.self ? rowH + 6 : m.gap ? 34 : rowH;
    return r;
  });
  const height = y + 18 + (footer ? 34 : 0) + top;
  const d = new Diagram(name, width, height, title, desc);
  const boxW = Math.min(colW - 18, 210);
  participants.forEach((p, i) => {
    d.node(xs[i] - boxW / 2, top, boxW, headH, p.label, p.sub ? [p.sub] : [], p.kind ?? '');
    d.add(`<line class="life" x1="${xs[i]}" y1="${top + headH}" x2="${xs[i]}" y2="${y + 6}"/>`);
  });
  const ix = (id) => participants.findIndex((p) => p.id === id);
  let step = 1;
  for (const m of rows) {
    if (m.gap) {
      const w = textWidth(m.gap, 11) + 24;
      d.add(`<rect class="elb" x="${width / 2 - w / 2}" y="${m.y - 10}" width="${w}" height="20" rx="6"/>`, 'top');
      d.text(width / 2, m.y + 4, m.gap, 'cap', 'middle', 'top');
      continue;
    }
    const a = xs[ix(m.from)];
    if (m.self) {
      const lines = Array.isArray(m.label) ? m.label : [m.label];
      const w = Math.max(...lines.map((l) => textWidth(l, 11))) + 40;
      const h = lines.length * 14 + 12;
      const x = Math.min(a - 12, width - margin - w);
      d.rect(x, m.y - h / 2 + 4, w, h, 'note', 8);
      let ly = m.y - ((lines.length - 1) * 14) / 2 + 8;
      for (const l of lines) {
        d.text(x + 30, ly, l, l.startsWith('`') ? 'tm' : 'el', 'start');
        ly += 14;
      }
      d.stepBadge(x + 15, m.y + 4, step++);
      continue;
    }
    const b = xs[ix(m.to)];
    const dir = b > a ? 1 : -1;
    d.edge(
      [
        [a + dir * 4, m.y + 8],
        [b - dir * 6, m.y + 8],
      ],
      { kind: m.kind ?? (m.reply ? 'soft' : ''), dash: Boolean(m.reply || m.dash) },
    );
    const lines = Array.isArray(m.label) ? m.label : [m.label];
    const mid = (a + b) / 2;
    let ly = m.y - (lines.length - 1) * 13 - 1;
    const w = Math.max(...lines.map((l) => textWidth(l, 11))) + 34;
    d.add(`<rect class="elb" x="${mid - w / 2}" y="${ly - 12}" width="${w}" height="${lines.length * 13 + 5}" rx="5"/>`, 'top');
    for (const l of lines) {
      d.text(mid + 11, ly, l, l.startsWith('`') ? 'tm' : 'el', 'middle', 'top');
      ly += 13;
    }
    d.stepBadge(mid - w / 2 + 11, m.y - ((lines.length - 1) * 13) / 2 - 5, step++);
  }
  if (footer) d.text(width / 2, y + 30, footer, 'cap');
  return d;
}
