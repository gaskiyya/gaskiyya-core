import { useState } from 'react';
import copy from '../../../packages/schemas/copy.json';
import type { Campaign, RegistrationAlert } from '../api.ts';
import { IconCheck, IconShield, IconSpark } from '../icons.tsx';
import type { CampaignAction, Workspace } from './data.ts';
import { Empty, fmtNum, fmtTime, PageHead, Section, Skeleton, SkeletonRows, useActions, usePoll } from './ui.tsx';

const CHANNEL: Record<NonNullable<Campaign['briefing']>['channel'], string> = {
  sms: 'Impersonates SMS',
  whatsapp: 'Impersonates WhatsApp',
  call: 'Impersonates phone calls',
  email: 'Impersonates email',
  social: 'Impersonates social media',
  unknown: 'Channel unclear',
};
const indicatorName = (k: string) => (copy.indicators as Record<string, string>)[k] ?? k.replace(/_/g, ' ');
const ANALYST_KEY = 'gaskiya.analyst';

function storedAnalyst() {
  try {
    return localStorage.getItem(ANALYST_KEY) ?? '';
  } catch {
    return '';
  }
}

export function describeAlert(a: RegistrationAlert) {
  return a.kind === 'unknown_link_domain'
    ? `A registered message links to ${a.domain}, which is not one of your domains`
    : `${a.count.toLocaleString()} registrations in ${a.windowMinutes} min, about ${(a.expected ?? 0).toLocaleString()} expected`;
}

export function FraudDeskPage({ ws, notify, onSignedOut }: { ws: Workspace; notify: (s: string) => void; onSignedOut: () => void }) {
  const [data, reload] = usePoll(() => ws.campaigns(), 3000, [ws], onSignedOut);
  const [alertData] = usePoll(() => ws.alerts(), 5000, [ws], onSignedOut);
  const [analyst, setAnalyst] = useState(storedAnalyst);
  const [view, setView] = useState<'open' | 'all'>('open');
  const { run: guard, busy, busyOn } = useActions((e) => notify(e.message));
  const all = data ?? [];
  const campaigns = view === 'open' ? all.filter((c) => c.status !== 'dismissed') : all;
  const alerts = alertData ?? [];
  const named = analyst.trim().length >= 2;
  const canApprove = ws.profile.features.advisories !== false;

  const saveAnalyst = (v: string) => {
    setAnalyst(v);
    try {
      localStorage.setItem(ANALYST_KEY, v);
    } catch {
      // The name is still used for this visit.
    }
  };
  const act = (c: Campaign, a: CampaignAction) =>
    guard(`${c.id}:${a}`, async () => {
      await ws.campaignAction(c.id, a, analyst.trim());
      reload();
      notify(a === 'approve' ? 'Advisory approved: customers’ apps now show the warning' : a === 'withdraw' ? 'Advisory withdrawn from customers’ apps' : 'Campaign dismissed');
    });
  const run = () =>
    guard('agent', async () => {
      const n = await ws.runAgent();
      reload();
      notify(n ? `The agent updated ${n} campaign${n === 1 ? '' : 's'}` : 'No new reports to group');
    });

  const stats = [
    { k: 'New campaigns', v: all.filter((c) => c.status === 'new').length },
    { k: 'Drafts to review', v: all.filter((c) => c.status !== 'dismissed' && c.advisory.status === 'draft').length },
    { k: 'Live advisories', v: all.filter((c) => c.advisory.status === 'approved').length },
    { k: 'Registration alerts', v: alerts.length },
  ];

  return (
    <div className="page">
      <PageHead title="Fraud desk" sub="Customer scam reports grouped into campaigns. A warning reaches customers only after an analyst approves it.">
        {ws.seedReports && (
          <button className="btn secondary" disabled={busy('seed')} aria-busy={busy('seed')} onClick={() => guard('seed', async () => notify(`${await ws.seedReports!()} customer reports submitted`))}>
            Simulate 3 reports
          </button>
        )}
        <button className="btn" disabled={busy('agent')} aria-busy={busy('agent')} onClick={run}><IconSpark /> Group new reports</button>
      </PageHead>

      <div className="mini-stats">
        {stats.map((s) => (
          <div key={s.k}><b>{data && alertData ? fmtNum(s.v) : <Skeleton w={32} h={22} r={6} />}</b><span>{s.k}</span></div>
        ))}
      </div>

      <div className="analyst card">
        <label htmlFor="analyst">Signed actions are recorded as</label>
        <input id="analyst" placeholder="Your full name" value={analyst} onChange={(e) => saveAnalyst(e.target.value)} maxLength={100} autoComplete="name" />
        <span className="muted small">{named ? 'Approvals and withdrawals carry this name in the audit log.' : 'Enter your name to approve or withdraw advisories.'}</span>
      </div>

      <Section title="Registration alerts">
        {!alertData ? <SkeletonRows rows={2} label="Loading registration alerts" /> : alerts.length === 0 ? (
          <p className="muted small flat">Nothing unusual. Registrations that link outside your domains, or a sudden jump in volume, appear here and go to your alert email. They are never blocked.</p>
        ) : (
          <ul className="rows">
            {alerts.map((a) => (
              <li key={a.id}>
                <span className={`tag ${a.kind === 'unknown_link_domain' ? 'orange' : 'red'}`}>{a.kind === 'unknown_link_domain' ? 'Link domain' : 'Volume'}</span>
                <span className="grow">{describeAlert(a)}</span>
                <span className="muted small nowrap">{a.kind === 'unknown_link_domain' && a.count > 1 ? `${a.count} messages · ` : ''}{fmtTime(a.lastSeen)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="list-head">
        <h2>Scam campaigns</h2>
        <div className="segmented" role="tablist" aria-label="Campaigns shown">
          <button role="tab" aria-selected={view === 'open'} className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>Open</button>
          <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All</button>
        </div>
      </div>

      {!data ? (
        <div className="card">
          <SkeletonRows rows={3} lead="square" label="Loading scam campaigns" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card">
          <Empty icon={<IconShield />} title="No campaigns">When customers report fakes that share a link, number or lure, they are grouped here as one campaign.</Empty>
        </div>
      ) : (
        <div className="stack">
          {campaigns.map((c) => (
            <article className={`card campaign ${c.status}`} key={c.id}>
              <header className="campaign-head">
                <div>
                  <div className="row ws-tight">
                    <span className={`tag ${c.status === 'confirmed' ? 'green' : c.status === 'dismissed' ? '' : 'orange'}`}>{c.status === 'confirmed' ? 'Confirmed' : c.status === 'dismissed' ? 'Dismissed' : 'New'}</span>
                    <span className="muted small">First seen {fmtTime(c.firstSeen)} &middot; last seen {fmtTime(c.lastSeen)}</span>
                  </div>
                  <h3>{c.summary}</h3>
                </div>
                <div className="ws-count"><b>{c.reportCount}</b><span>reports</span></div>
              </header>
              <div className="chips">
                {c.indicators.map((i) => <span className="tag red" key={i}>{indicatorName(i)}</span>)}
                {c.linkDomains.map((d) => <span className="tag mono" key={d}>{d}</span>)}
                {c.callbackKeyCount > 0 && <span className="tag">{c.callbackKeyCount} callback number{c.callbackKeyCount > 1 ? 's' : ''}</span>}
              </div>
              {c.briefing && (
                <div className="briefing">
                  <div className="row ws-tight">
                    <span className="eyebrow">Briefing</span>
                    <span className="tag blue">{CHANNEL[c.briefing.channel]}</span>
                    <span className="tag">{c.briefing.source === 'model' ? 'Written by AI, check before use' : 'Built from report data'}</span>
                  </div>
                  <p>{c.briefing.pattern}</p>
                </div>
              )}
              <div>
                <span className="eyebrow">{c.advisory.status === 'approved' ? 'Approved advisory' : c.advisory.status === 'withdrawn' ? 'Withdrawn advisory' : 'Suggested advisory (draft)'}</span>
                <blockquote className="advisory">{c.advisory.text}</blockquote>
              </div>
              <footer className="campaign-foot">
                <span className="muted small">
                  {c.advisory.status === 'approved'
                    ? `Approved by ${c.advisory.approvedBy} · ${fmtTime(c.advisory.approvedAt)}${c.advisory.expiresAt ? ` · shown in customers’ apps until ${fmtTime(c.advisory.expiresAt)}` : ''}`
                    : c.advisory.status === 'withdrawn'
                      ? `Withdrawn by ${c.advisory.withdrawnBy} · ${fmtTime(c.advisory.withdrawnAt)}`
                      : 'Approving shows the warning in customers’ apps. Nothing is sent by SMS from here.'}
                </span>
                {c.status !== 'dismissed' && c.advisory.status === 'draft' && (
                  <div className="row">
                    <button className="btn plain" disabled={busyOn(`${c.id}:`)} aria-busy={busy(`${c.id}:dismiss`)} onClick={() => act(c, 'dismiss')}>Dismiss</button>
                    <button className="btn success" disabled={!named || !canApprove || busyOn(`${c.id}:`)} aria-busy={busy(`${c.id}:approve`)} title={!named ? 'Enter your name above to approve' : !canApprove ? 'Advisories are not switched on for your organisation' : undefined} onClick={() => act(c, 'approve')}>
                      <IconCheck /> Approve advisory
                    </button>
                  </div>
                )}
                {c.advisory.status === 'approved' && (
                  <div className="row">
                    <button className="btn plain" disabled={!named || busyOn(`${c.id}:`)} aria-busy={busy(`${c.id}:withdraw`)} title={!named ? 'Enter your name above to withdraw' : undefined} onClick={() => act(c, 'withdraw')}>Withdraw</button>
                    {ws.sendAdvisory && (
                      <button className="btn" disabled={busyOn(`${c.id}:`)} aria-busy={busy(`${c.id}:send`)} title="Sends this warning by SMS through DemoBank's gateway, registering each message so customers can check it" onClick={() => guard(`${c.id}:send`, async () => notify(`Warning sent to ${await ws.sendAdvisory!(c.id)} customers by SMS, each one registered`))}>
                        Send to customers
                      </button>
                    )}
                  </div>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
