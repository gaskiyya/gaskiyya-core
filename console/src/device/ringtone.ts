// Classic double ring for the simulated phone while a call is incoming: 400 + 450 Hz with a 20 Hz bell
// trill, rung 0.4 s on, 0.2 s off, 0.4 s on, 2 s off (the cadence used in Nigeria and the UK).

const CYCLE = 3;
const BURSTS: [number, number][] = [
  [0, 0.4],
  [0.6, 1.0],
];

export class Ringtone {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resumeOnTap: (() => void) | null = null;

  start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    // The console click that placed the call usually allows audio; if the browser still holds it, ring from the next tap.
    if (ctx.state === 'suspended') {
      this.resumeOnTap = () => void ctx.resume().catch(() => {});
      window.addEventListener('pointerdown', this.resumeOnTap, { once: true });
    }
    void ctx.resume().catch(() => {});

    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(ctx.destination);
    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.5;
    tremolo.connect(out);
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 20;
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(tremolo.gain);
    lfo.start();
    for (const hz of [400, 450]) {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      o.connect(tremolo);
      o.start();
    }

    const ring = () => {
      const t0 = ctx.currentTime + 0.05;
      for (const [on, off] of BURSTS) {
        out.gain.setTargetAtTime(0.18, t0 + on, 0.01);
        out.gain.setTargetAtTime(0, t0 + off, 0.01);
      }
    };
    ring();
    this.timer = setInterval(ring, CYCLE * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.resumeOnTap) window.removeEventListener('pointerdown', this.resumeOnTap);
    this.resumeOnTap = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}
