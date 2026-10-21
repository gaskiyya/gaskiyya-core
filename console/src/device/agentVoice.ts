interface Manifest {
  pauses: Record<'afterOpening' | 'betweenDigits', number>;
  clips: Record<string, { text: string; ms: number }>;
}

export interface AgentCall {
  orgId: string;
  code: string;
}

const BASE = 'audio/agent/';

let manifestP: Promise<Manifest> | null = null;
const manifest = () => (manifestP ??= fetch(`${BASE}voice.json`).then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error('no voice')))));

const clipBytes = new Map<string, Promise<ArrayBuffer>>();
const clip = (id: string) => {
  let p = clipBytes.get(id);
  if (!p) {
    p = fetch(`${BASE}${id}.wav`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(id))));
    p.catch(() => clipBytes.delete(id));
    clipBytes.set(id, p);
  }
  return p;
};

export class AgentVoice {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private stopped = false;

  constructor(private readonly call: AgentCall) {
    void manifest()
      .then((m) => {
        for (const id of this.ids(m)) void clip(id).catch(() => {});
      })
      .catch(() => {});
  }

  private ids(m: Manifest): string[] {
    const opening = m.clips[`opening-${this.call.orgId}`] ? `opening-${this.call.orgId}` : 'opening-generic';
    const digits = [...this.call.code];
    return [opening, ...digits.map((d, i) => `digit-${d}-${i === digits.length - 1 ? 'last' : 'mid'}`)];
  }

  start(): void {
    if (this.ctx || this.stopped) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    void this.ctx.resume();
    void this.run().catch(() => {});
  }

  setMuted(muted: boolean): void {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  stop(): void {
    this.stopped = true;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => {});
  }

  private async run(): Promise<void> {
    const m = await manifest();
    const ctx = this.ctx!;
    const ids = this.ids(m);
    const bufs = await Promise.all(ids.map(async (id) => ctx.decodeAudioData((await clip(id)).slice(0))));
    if (this.stopped) return;
    let t = ctx.currentTime + 0.6;
    bufs.forEach((buf, i) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.out!);
      src.start(t);
      t += buf.duration + (i === 0 ? m.pauses.afterOpening : m.pauses.betweenDigits) / 1000;
    });
  }
}
