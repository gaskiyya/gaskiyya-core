interface Manifest {
  pauses: Record<'afterOpening' | 'betweenDigits', number> & { betweenRepeats?: number };
  clips: Record<string, { text: string; ms: number }>;
}

export interface AgentCall {
  orgId: string;
  code: string;
}

const BASE = 'audio/agent/';
const REPEAT_PAUSE_MS = 1800;

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

  // The opening line once, then the code again and again with a short pause, until the call ends (stop()).
  private async run(): Promise<void> {
    const m = await manifest();
    const ctx = this.ctx!;
    const [opening, ...digits] = await Promise.all(this.ids(m).map(async (id) => ctx.decodeAudioData((await clip(id)).slice(0))));
    if (this.stopped || !opening) return;
    const play = (buf: AudioBuffer, at: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.out!);
      src.start(at);
      return at + buf.duration;
    };
    let t = play(opening, ctx.currentTime + 0.6) + m.pauses.afterOpening / 1000;
    while (!this.stopped) {
      digits.forEach((buf, i) => (t = play(buf, t) + (i < digits.length - 1 ? m.pauses.betweenDigits / 1000 : 0)));
      t += (m.pauses.betweenRepeats ?? REPEAT_PAUSE_MS) / 1000;
      // Queue the next round just before this one ends, so stop() never leaves more than one round queued.
      await new Promise((r) => setTimeout(r, Math.max(0, (t - ctx.currentTime - 0.4) * 1000)));
      if (ctx.state === 'closed') return;
    }
  }
}
