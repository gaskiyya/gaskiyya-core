import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SignedOut, type UsageDay } from './data.ts';

export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = [], onSignedOut?: () => void): [T | null, () => void, boolean] {
  const [data, setData] = useState<T | null>(null);
  const [ok, setOk] = useState(true);
  const ref = useRef(fn);
  ref.current = fn;
  const out = useRef(onSignedOut);
  out.current = onSignedOut;
  const load = useCallback(() => {
    ref.current()
      .then((d) => (setData(d), setOk(true)))
      .catch((e) => (e instanceof SignedOut ? out.current?.() : setOk(false)));
  }, []);
  // A hidden tab stops polling and catches up as soon as it is shown again.
  useEffect(() => {
    const tick = () => document.visibilityState !== 'hidden' && load();
    load();
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, load, ...deps]);
  return [data, load, ok];
}

/** Running actions, one key per button. Clicks on a running key are ignored. */
export function useActions(onError: (e: Error) => void) {
  const running = useRef(new Set<string>());
  const [, rerender] = useState(0);
  const fail = useRef(onError);
  fail.current = onError;
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    if (running.current.has(key)) return;
    running.current.add(key);
    rerender((n) => n + 1);
    try {
      await fn();
    } catch (e) {
      fail.current(e as Error);
    } finally {
      running.current.delete(key);
      rerender((n) => n + 1);
    }
  }, []);
  const busy = (key: string) => running.current.has(key);
  const busyOn = (prefix: string) => [...running.current].some((k) => k.startsWith(prefix));
  return { run, busy, busyOn };
}

export const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString();
export const fmtPct = (r: number | null | undefined, digits = 1) => (r === null || r === undefined ? '–' : `${(r * 100).toFixed(digits)}%`);
export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, loading = false }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'orange' | 'red' | 'blue' | 'indigo'; loading?: boolean }) {
  return (
    <div className="card stat" aria-busy={loading || undefined}>
      <div className="stat-k">{tone && <span className={`ws-dot ${tone}`} />}{label}</div>
      <div className="stat-v">{loading ? <Skeleton w={84} h={30} r={8} /> : value}</div>
      {hint && <div className="stat-hint">{loading ? <Skeleton w={120} h={11} /> : hint}</div>}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 12, r }: { w?: number | string; h?: number | string; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 3, lead, label = 'Loading' }: { rows?: number; lead?: 'avatar' | 'square' | 'dot'; label?: string }) {
  const size = lead === 'dot' ? 9 : 36;
  return (
    <div className="skel-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          {lead && <Skeleton w={size} h={size} r={lead === 'square' ? 10 : 999} />}
          <div className="skel-lines">
            <Skeleton w={`${64 - (i % 3) * 12}%`} h={13} />
            <Skeleton w={`${36 + (i % 2) * 16}%`} h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonBars({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="skel-bars" role="status" aria-label={label}>
      {Array.from({ length: 14 }, (_, i) => <Skeleton key={i} h={`${30 + ((i * 37) % 60)}%`} />)}
    </div>
  );
}

export function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card section ${className}`}>
      <header className="section-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export interface Scenario<T extends string> {
  id: T;
  label: string;
  hint: string;
  fraud?: boolean;
}

export function Scenarios<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Scenario<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="scenarios" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`scenario ${o.fraud ? 'fraud' : ''} ${value === o.id ? 'on' : ''}`} onClick={() => onChange(o.id)}>
          <span className="scenario-dot" aria-hidden="true" />
          <span>
            <b>{o.label}</b>
            <small>{o.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function DayBars({ days, empty }: { days: UsageDay[]; empty: string }) {
  const max = Math.max(1, ...days.map((d) => d.calls));
  const total = days.reduce((a, d) => a + d.calls, 0);
  if (days.length === 0 || total === 0) return <p className="muted small flat">{empty}</p>;
  return (
    <div className="day-bars" role="img" aria-label={`API calls per day, ${total.toLocaleString()} in ${days.length} days`}>
      {days.map((d) => (
        <div className="day" key={d.day} title={`${d.day}: ${d.calls.toLocaleString()} calls, ${d.errors.toLocaleString()} errors`}>
          <div className="day-col">
            <span className="day-ok" style={{ height: `${((d.calls - d.errors) / max) * 100}%` }} />
            <span className="day-err" style={{ height: `${(d.errors / max) * 100}%` }} />
          </div>
          <span className="day-label">{new Date(`${d.day}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', timeZone: 'UTC' })}</span>
        </div>
      ))}
    </div>
  );
}

export function Ring({ value, total, size = 64 }: { value: number; total: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const p = total ? value / total : 0;
  return (
    <svg className="ring-progress" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${total} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{value}/{total}</text>
    </svg>
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
