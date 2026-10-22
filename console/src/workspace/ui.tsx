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
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [ms, load, ...deps]);
  return [data, load, ok];
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

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'orange' | 'red' | 'blue' | 'indigo' }) {
  return (
    <div className="card stat">
      <div className="stat-k">{tone && <span className={`ws-dot ${tone}`} />}{label}</div>
      <div className="stat-v">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
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
