import { IconCheck, IconExternal, IconKey, IconPlug } from '../icons.tsx';
import type { Workspace } from './data.ts';
import { ago, DayBars, Empty, fmtNum, fmtTime, PageHead, Ring, Section, usePoll } from './ui.tsx';

const GUIDE_URL = 'https://gaskiyya-io.web.app/banks.html';
const KEY_STATE: Record<string, string> = { current: 'In use', previous: 'Previous, still accepted', pending: 'Activating', retired: 'Retired' };

export function IntegrationPage({ ws, onSignedOut }: { ws: Workspace; onSignedOut: () => void }) {
  const [d] = usePoll(() => ws.integration(), 10000, [ws], onSignedOut);
  const done = d?.checklist.filter((c) => c.done).length ?? 0;
  const total = d?.checklist.length ?? 0;
  const calls = d?.usage.reduce((a, u) => a + u.calls, 0) ?? 0;
  const errors = d?.usage.reduce((a, u) => a + u.errors, 0) ?? 0;

  return (
    <div className="page">
      <PageHead title="Integration" sub="How your systems connect to the Gaskiyya registry. Secrets are never shown here; Gaskiyya issues and rotates them.">
        <a className="btn secondary" href={GUIDE_URL} target="_blank" rel="noopener">API guide <IconExternal /></a>
      </PageHead>

      <div className="split">
        <div className="stack">
          <Section title="API clients">
            {!d ? <p className="muted small flat">Loading&hellip;</p> : d.clients.length === 0 ? (
              <Empty icon={<IconPlug />} title="No API client yet">Ask Gaskiyya for a client so your notification service can register messages.</Empty>
            ) : (
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <thead><tr><th>Client</th><th>Status</th><th>Created</th><th>Last used</th></tr></thead>
                  <tbody>
                    {d.clients.map((c) => (
                      <tr key={c.clientId} className={c.status === 'revoked' ? 'dim' : ''}>
                        <td><div className="strong">{c.label}</div><code className="muted small">{c.clientId}</code></td>
                        <td><span className={`tag ${c.status === 'active' ? 'green' : 'red'}`}>{c.status === 'active' ? 'Active' : 'Revoked'}</span></td>
                        <td className="small">{fmtTime(c.createdAt)}</td>
                        <td className="small">{ago(c.lastUsedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="API traffic, last 14 days" action={d && d.usage.length > 0 ? <span className="muted small">{fmtNum(calls)} calls &middot; {fmtNum(errors)} errors</span> : undefined}>
            <DayBars days={d?.usage ?? []} empty={ws.kind === 'demo' ? 'The demo registers through the simulator, so no API traffic is counted here.' : 'No API calls in the last 14 days.'} />
          </Section>

          <Section title="Recent errors">
            {!d || d.errors.length === 0 ? (
              <p className="muted small flat">No failed calls recently.</p>
            ) : (
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <thead><tr><th>When</th><th>Call</th><th>Status</th><th>Code</th></tr></thead>
                  <tbody>
                    {d.errors.map((e, i) => (
                      <tr key={`${e.at}-${i}`}>
                        <td className="small nowrap">{fmtTime(e.at)}</td>
                        <td><code className="small">{e.method} {e.route}</code></td>
                        <td><span className={`tag ${e.status >= 500 ? 'red' : 'orange'}`}>{e.status}</span></td>
                        <td className="small mono">{e.code ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        <div className="stack side">
          <Section title="Go-live checklist">
            <div className="checklist-head">
              <Ring value={done} total={total} />
              <p className="small flat">{done === total && total > 0 ? 'Everything is in place.' : 'Gaskiyya completes these with your team during onboarding.'}</p>
            </div>
            <ul className="ws-checklist">
              {d?.checklist.map((c) => (
                <li key={c.id} className={c.done ? 'done' : ''}>
                  <IconCheck />
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Hashing key">
            {d?.keys.length ? (
              <ul className="rows">
                {d.keys.map((k) => (
                  <li key={k.version}>
                    <IconKey className="muted" />
                    <span className="grow">Version {k.version}</span>
                    <span className={`tag ${k.state === 'current' ? 'green' : k.state === 'retired' ? '' : 'blue'}`}>{KEY_STATE[k.state] ?? k.state}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small flat">No hashing key yet.</p>}
            <p className="muted small flat">Phone numbers and messages are hashed with your own key before they are stored.</p>
          </Section>

          <Section title="Alert webhook">
            {d?.webhook ? (
              <>
                <code className="ws-wrap small">{d.webhook.url}</code>
                <p className="muted small flat">Set {fmtTime(d.webhook.createdAt)}. Campaign and registration alerts are posted here, signed.</p>
              </>
            ) : (
              <p className="muted small flat">Not set. Campaign and registration alerts go to your alert email only.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
