import { MODE_FRAMES, paintFrame, resolvePreset } from 'thinking-orbs/engine';
import copy from '../../packages/schemas/copy.json';

type Digest = (text: string) => Promise<string | null>;
type RGB = { r: number; g: number; b: number };

const NS = 'http://www.w3.org/2000/svg';
const HEX = '0123456789abcdef';
const DOTS = String.fromCharCode(8230);
const MINT: RGB = { r: 127, g: 240, b: 192 };
const AMBER: RGB = { r: 255, g: 181, b: 71 };
// SHA-256 of the SMS text; update it if the text changes.
const SMS_FALLBACK = '326d634f47e4cdffee9b6cdf3741323c4ff745a8376efae169393ca26b8eed86';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const rand = (s: string) => s[Math.floor(Math.random() * s.length)]!;
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

interface Step {
  id: 'sms' | 'call' | 'link';
  read: string;
  label: string;
  result: () => Promise<string>;
  stream: string;
  lookup: string;
  verdict: string;
  warn: boolean;
}

export function runCore(core: HTMLElement, digest: Digest, reduceMotion: boolean) {
  const q = <T extends Element = HTMLElement>(s: string, el: ParentNode = core) => el.querySelector<T>(s)!;
  const canvas = q<HTMLCanvasElement>('[data-orb]');
  const ctx = canvas.getContext('2d')!;
  const svg = q<SVGSVGElement>('[data-wires]');
  const label = q('[data-orb-label]');
  const code = q('[data-orb-text]');
  const status = q('[data-orb-status]');
  const orbBox = q('.core-orb');
  const nodes = [...core.querySelectorAll<HTMLElement>('[data-node]')];
  const idleStatus = status.innerHTML;
  const idleLabel = label.innerHTML;
  const idleCode = code.innerHTML;

  const { mode, speed: baseSpeed, opts } = resolvePreset('composing', 64);
  const frameFn = MODE_FRAMES[mode];
  let size = 0;
  let dpr = 1;
  const fit = () => {
    size = canvas.clientWidth;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  };
  fit();
  new ResizeObserver(fit).observe(canvas);

  let t = 0.6;
  let pace = 1;
  let paceTarget = 1;
  const tint = { ...MINT };
  let tintTarget = MINT;
  const paintOrb = () => {
    if (!size) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    paintFrame(ctx, frameFn(size, t, opts), true, { r: Math.round(tint.r), g: Math.round(tint.g), b: Math.round(tint.b) });
  };

  const mk = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element = svg) => {
    const e = document.createElementNS(NS, tag);
    e.setAttribute('class', cls);
    parent.append(e);
    return e;
  };
  const wires = nodes.map((node) => {
    const line = mk('path', 'wire');
    const beam = mk('path', 'beam');
    const end = mk('circle', 'end');
    end.setAttribute('r', '3.5');
    beam.style.opacity = '0';
    return { node, line, beam, end, len: 0, beamAt: -1, beamColor: '#c8ffe8' };
  });
  type Wire = (typeof wires)[number];

  const geometry = () => {
    const box = core.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const o = orbBox.getBoundingClientRect();
    const cx = o.left + o.width / 2 - box.left;
    const cy = o.top + o.height / 2 - box.top;
    const R = (o.width / 2) * 1.02;
    for (const w of wires) {
      const r = w.node.firstElementChild!.getBoundingClientRect();
      const ax = Math.min(Math.max(cx, r.left - box.left), r.right - box.left);
      const ay = Math.min(Math.max(cy, r.top - box.top), r.bottom - box.top);
      const d = Math.hypot(ax - cx, ay - cy) || 1;
      const ox = cx + ((ax - cx) / d) * R;
      const oy = cy + ((ay - cy) / d) * R;
      const mx = (ax + ox) / 2 + ((oy - ay) / d) * 24;
      const my = (ay + oy) / 2 + ((ax - ox) / d) * 24;
      const path = `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ox.toFixed(1)} ${oy.toFixed(1)}`;
      w.line.setAttribute('d', path);
      w.beam.setAttribute('d', path);
      w.end.setAttribute('cx', ax.toFixed(1));
      w.end.setAttribute('cy', ay.toFixed(1));
      w.len = w.line.getTotalLength();
    }
  };

  const glyphs: { el: SVGTextElement; wire: Wire; start: number; dur: number }[] = [];
  const pool: SVGTextElement[] = [];
  const emit = (wire: Wire, ch: string, now: number) => {
    const el = pool.pop() ?? mk('text', 'glyph');
    el.textContent = ch;
    el.style.opacity = '0';
    glyphs.push({ el, wire, start: now, dur: 760 + Math.random() * 260 });
  };

  const SEG = 70;
  let last = performance.now();
  let visible = true;
  let raf = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pace += (paceTarget - pace) * Math.min(1, dt * 3);
    t += dt * baseSpeed * pace;
    tint.r += (tintTarget.r - tint.r) * Math.min(1, dt * 4);
    tint.g += (tintTarget.g - tint.g) * Math.min(1, dt * 4);
    tint.b += (tintTarget.b - tint.b) * Math.min(1, dt * 4);
    paintOrb();
    geometry();
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const g = glyphs[i]!;
      const k = (now - g.start) / g.dur;
      if (k >= 1) {
        g.el.style.opacity = '0';
        pool.push(g.el);
        glyphs.splice(i, 1);
        continue;
      }
      const p = g.wire.line.getPointAtLength(easeInOut(k) * g.wire.len);
      g.el.setAttribute('x', (p.x - 3).toFixed(1));
      g.el.setAttribute('y', (p.y + 3).toFixed(1));
      g.el.style.opacity = String(Math.sin(Math.PI * k) * 0.95);
    }
    for (const w of wires) {
      if (w.beamAt < 0) continue;
      const at = easeInOut(w.beamAt) * (w.len + SEG);
      w.beam.style.strokeDasharray = `${SEG} ${w.len + SEG}`;
      w.beam.style.strokeDashoffset = String(-(w.len - at));
    }
    raf = visible ? requestAnimationFrame(frame) : 0;
  };
  const resume = () => {
    if (!raf && visible) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  new IntersectionObserver(([e]) => {
    visible = e!.isIntersecting && !document.hidden;
    resume();
  }).observe(core);
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    resume();
  });
  const whenVisible = async () => {
    while (!visible) await sleep(250);
  };

  const animate = (ms: number, step: (k: number, now: number) => void) =>
    new Promise<void>((done) => {
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / ms);
        step(k, now);
        if (k < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });

  const read = async (node: HTMLElement, wire: Wire, stream: string) => {
    const txt = q('[data-txt]', node);
    const original = txt.textContent!;
    node.style.setProperty('--sweep-to', `${node.firstElementChild!.clientWidth + 60}px`);
    node.classList.remove('scan');
    void node.offsetWidth;
    node.classList.add('scan');
    let sent = 0;
    await animate(1100, (k, now) => {
      const at = k * 1.15 - 0.08;
      let html = '';
      for (let i = 0; i < original.length; i++) {
        const c = original[i]!;
        const d = Math.abs(i / original.length - at);
        html += c !== ' ' && d < 0.07 ? `<span class="hx">${rand(HEX)}</span>` : c === '<' ? '&lt;' : c;
      }
      txt.innerHTML = html;
      const want = Math.floor(k * 22);
      for (; sent < want; sent++) emit(wire, stream[sent % stream.length] ?? rand(HEX), now);
    });
    txt.textContent = original;
  };

  const resolve = (text: string, ms: number) =>
    animate(ms, (k) => {
      const settled = Math.floor(easeInOut(k) * text.length);
      let html = '';
      for (let i = 0; i < text.length; i++) html += i < settled ? text[i] : `<span class="w">${text[i] === '.' ? '.' : rand(HEX)}</span>`;
      code.innerHTML = html;
    });

  const beam = (wire: Wire, color: string) => {
    wire.beam.style.stroke = color;
    wire.beam.style.filter = `drop-shadow(0 0 6px ${color})`;
    wire.beam.style.opacity = '1';
    return animate(800, (k) => {
      wire.beamAt = k;
    }).then(() => {
      wire.beamAt = -1;
      wire.beam.style.opacity = '0';
    });
  };

  let smsDigest = '';
  const steps: Step[] = [
    {
      id: 'sms',
      read: 'Reading the message',
      label: 'SHA-256 fingerprint',
      result: async () => (smsDigest ||= (await digest(q('[data-node="sms"] [data-txt]').textContent!)) ?? SMS_FALLBACK),
      stream: '',
      lookup: `Checking DemoBank's records${DOTS}`,
      verdict: 'No record for this number',
      warn: true,
    },
    {
      id: 'call',
      read: 'Reading the call',
      label: 'Call session',
      result: async () => '4 8 2 1',
      stream: '48214821',
      lookup: `Looking for an open session${DOTS}`,
      verdict: `${copy.call.calling.codeLabel} 4821 ${String.fromCharCode(183)} card activation`,
      warn: false,
    },
    {
      id: 'link',
      read: 'Reading the link',
      label: 'Domain match',
      result: async () => 'demobank.ng',
      stream: 'demobank.ng',
      lookup: `Matching registered domains${DOTS}`,
      verdict: fill(copy.link.belongs.body, { domain: 'demobank.ng', bank: 'DemoBank' }),
      warn: false,
    },
  ];
  const setStatus = (text: string) => {
    status.innerHTML = `<i></i>${text}`;
  };

  geometry();
  paintOrb();

  if (reduceMotion) {
    for (const n of nodes) n.classList.add('done');
    nodes.find((n) => n.dataset.node === 'sms')!.classList.add('warn');
    void steps[0]!.result().then((d) => {
      label.textContent = steps[0]!.label;
      code.textContent = d;
    });
    return;
  }
  resume();

  const play = async () => {
    for (;;) {
      for (const s of steps) {
        await whenVisible();
        const node = nodes.find((n) => n.dataset.node === s.id)!;
        const wire = wires.find((w) => w.node === node)!;
        const answer = await s.result();
        core.classList.remove('amber');
        tintTarget = MINT;
        node.classList.add('on');
        wire.line.classList.add('live');
        label.textContent = s.read;
        setStatus(`Fingerprinting on the device${DOTS}`);
        code.textContent = '';
        paceTarget = 2.2;
        core.classList.add('busy');
        await read(node, wire, s.stream || answer.replace(/\s/g, ''));
        label.textContent = s.label;
        await resolve(answer, s.id === 'sms' ? 1300 : 800);
        setStatus(s.lookup);
        paceTarget = 3.2;
        await sleep(650);
        paceTarget = 1;
        core.classList.remove('busy');
        tintTarget = s.warn ? AMBER : MINT;
        core.classList.toggle('amber', s.warn);
        setStatus(s.verdict);
        await beam(wire, s.warn ? '#ffc46e' : '#c8ffe8');
        node.classList.remove('verify-ok', 'verify-warn');
        void node.offsetWidth;
        node.classList.add(s.warn ? 'verify-warn' : 'verify-ok', 'done');
        node.classList.toggle('warn', s.warn);
        await sleep(1900);
        node.classList.remove('on');
        wire.line.classList.remove('live');
      }
      await sleep(1800);
      for (const n of nodes) n.classList.remove('done', 'warn', 'verify-ok', 'verify-warn');
      core.classList.remove('amber');
      tintTarget = MINT;
      label.innerHTML = idleLabel;
      code.innerHTML = idleCode;
      status.innerHTML = idleStatus;
      await sleep(1600);
    }
  };
  void play();
}
