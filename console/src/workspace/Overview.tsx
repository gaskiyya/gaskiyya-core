import copy from '../../../packages/schemas/copy.json';
import type { Metrics } from '../api.ts';
import { IconArrow, IconShield, IconWarning } from '../icons.tsx';
import type { Workspace } from './data.ts';
import { DayBars, fmtNum, fmtPct, PageHead, Section, Skeleton, SkeletonBars, SkeletonRows, Stat, usePoll } from './ui.tsx';

export interface LiveEvent {
  key: number;
  at: Date;
  tone: 'green' | 'orange' | 'red' | 'blue';
  text: string;
}

const OUTCOMES = [
  { k: 'confirmed', name: 'Confirmed', tone: 'green' },
  { k: 'not_confirmed', name: 'Not confirmed', tone: 'orange' },
  { k: 'cannot_check', name: 'Cannot check', tone: 'red' },
] as const;
const CHANNELS: Record<string, string> = { app: 'App', whatsapp: 'WhatsApp', ussd: 'USSD' };
const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

export function OverviewPage({ ws, metrics, events, go, onSignedOut }: { ws: Workspace; metrics: Metrics | null; events: LiveEvent[]; go: (p: 'fraud' | 'integration') => void; onSignedOut: () => void }) {
  const [ov] = usePoll(() => ws.overview(), 15_000, [ws], onSignedOut);
  const v = metrics?.verifications ?? {};
  const cov = metrics?.coverage;
  const checks = OUTCOMES.reduce((a, o) => a + (v[o.k] ?? 0), 0);
  const attention = [
    ov && ov.campaigns.drafts > 0 && { tone: 'orange', text: `${ov.campaigns.drafts} draft advisor${ov.campaigns.drafts === 1 ? 'y' : 'ies'} waiting for an analyst`, to: 'fraud' as const },
    ov && ov.campaigns.new > 0 && { tone: 'red', text: `${ov.campaigns.new} new scam campaign${ov.campaigns.new === 1 ? '' : 's'} from customer reports`, to: 'fraud' as const },
    ov && ov.alerts.length > 0 && { tone: 'orange', text: `${ov.alerts.length} registration alert${ov.alerts.length === 1 ? '' : 's'} to review`, to: 'fraud' as const },
  ].filter(Boolean) as { tone: string; text: string; to: 'fraud' | 'integration' }[];

  return (
    <div className="page">
      <PageHead title="Overview" sub={<>How {ws.profile.name}'s customers are checking messages, links and calls. Counts only, never message content.</>} />

      <div className="stats-grid">
        <Stat label="Messages registered" value={fmtNum(metrics?.registrations)} hint={`${fmtNum(metrics?.registrationsByChannel?.whatsapp)} on WhatsApp`} tone="blue" loading={!metrics} />
        <Stat label="Customer checks" value={fmtNum(checks)} hint={`${fmtNum(sum(metrics?.links))} links · ${fmtNum(sum(metrics?.callChecks))} calls`} tone="indigo" loading={!metrics} />
        <Stat label="Confirmed" value={fmtPct(checks ? (v.confirmed ?? 0) / checks : null)} hint={`${fmtNum(v.confirmed)} genuine messages`} tone="green" loading={!metrics} />
        <Stat label="Not confirmed" value={fmtPct(cov?.notConfirmedRate)} hint={`${fmtNum(v.not_confirmed)} likely fakes`} tone="orange" loading={!metrics} />
      </div>

      <div className="split">
        <div className="stack">
          <Section title="Check outcomes">
            {!metrics ? (
              <>
                <Skeleton h={14} r={999} />
                <SkeletonRows rows={4} label="Loading check outcomes" />
              </>
            ) : (
              <>
                <div className="bar big" aria-hidden="true">
                  {OUTCOMES.map((o) => <span key={o.k} className={o.tone} style={{ width: `${checks ? ((v[o.k] ?? 0) / checks) * 100 : 0}%` }} />)}
                </div>
                <div className="legend">
                  {OUTCOMES.map((o) => (
                    <div key={o.k}>
                      <span className={`ws-dot ${o.tone}`} />
                      <span>{o.name}</span>
                      <b>{fmtNum(v[o.k])}</b>
                    </div>
                  ))}
                </div>
                <dl className="ws-kv">
                  {Object.entries(cov?.checksByChannel ?? {}).map(([k, n]) => (
                    <div key={k}><dt>Checks in {CHANNELS[k] ?? cap(k)}</dt><dd>{fmtNum(n)}</dd></div>
                  ))}
                  <div><dt>Cannot-check rate</dt><dd>{fmtPct(cov?.cannotCheckRate)}</dd></div>
                  <div><dt>Open call codes</dt><dd>{fmtNum(metrics?.openCalls)}</dd></div>
                  <div><dt>Scam reports from customers</dt><dd>{fmtNum(metrics?.reports)}</dd></div>
                </dl>
              </>
            )}
            <p className="muted small flat">A high not-confirmed rate means many fakes, or genuine messages your systems did not register.</p>
          </Section>

          {ws.kind === 'live' && (
            <Section title="API traffic, last 14 days" action={<button className="ws-link" onClick={() => go('integration')}>Integration <IconArrow /></button>}>
              {!ov ? <SkeletonBars label="Loading API traffic" /> : <DayBars days={ov.usage} empty="No API calls in the last 14 days. Registrations from your systems appear here." />}
            </Section>
          )}

          <Section title="Registered by type">
            {!metrics ? <SkeletonRows rows={3} label="Loading registrations by type" /> : Object.keys(metrics.registrationsByCategory ?? {}).length === 0 ? (
              <p className="muted small flat">Nothing registered yet.</p>
            ) : (
              <div className="meter-list">
                {Object.entries(metrics?.registrationsByCategory ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <div key={k} className="meter">
                      <span>{cap((copy.categories as Record<string, string>)[k] ?? k)}</span>
                      <div className="meter-bar"><span style={{ width: `${(n / Math.max(1, metrics?.registrations ?? 0)) * 100}%` }} /></div>
                      <b>{fmtNum(n)}</b>
                    </div>
                  ))}
              </div>
            )}
          </Section>
        </div>

        <div className="stack side">
          <Section title="Needs attention">
            {!ov ? <SkeletonRows rows={2} label="Loading what needs attention" /> : attention.length === 0 ? (
              <div className="all-clear"><IconShield /><span>All clear. No drafts, new campaigns or alerts.</span></div>
            ) : (
              <ul className="todo">
                {attention.map((a) => (
                  <li key={a.text}>
                    <button onClick={() => go(a.to)}>
                      <IconWarning className={a.tone} />
                      <span>{a.text}</span>
                      <IconArrow />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ov && <p className="muted small flat">{ov.campaigns.liveAdvisories} advisor{ov.campaigns.liveAdvisories === 1 ? 'y' : 'ies'} live in customers' apps.</p>}
          </Section>

          <Section title="Live activity" action={<span className="live-dot" aria-hidden="true" />} className="feed">
            {events.length === 0 ? (
              <p className="muted small flat">Checks from customers appear here as they happen.</p>
            ) : (
              <ol className="feed-list" aria-live="polite">
                {events.map((e) => (
                  <li key={e.key}>
                    <span className={`ws-dot ${e.tone}`} />
                    <span className="feed-text">{e.text}</span>
                    <time className="muted small">{e.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
