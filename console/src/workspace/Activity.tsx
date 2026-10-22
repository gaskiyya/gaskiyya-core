import { IconClock } from '../icons.tsx';
import type { ActivityEntry, Workspace } from './data.ts';
import { Empty, fmtTime, PageHead, usePoll } from './ui.tsx';

const ACTIONS: Record<string, string> = {
  'console.login': 'Signed in to the dashboard',
  'console.advisory_approve': 'Approved a customer advisory',
  'console.advisory_withdraw': 'Withdrew a customer advisory',
  'console.advisory_send': 'Sent an advisory to customers',
  'console.campaign_dismiss': 'Dismissed a campaign',
  'console.agent_run': 'Grouped new reports',
  'console_code.issue': 'Issued a dashboard access code',
  'console_code.revoke': 'Revoked a dashboard access code',
  'console_code.regenerate': 'Replaced the console sign-in code',
  'org.create': 'Registered the organisation',
  'org.update': 'Updated the organisation profile',
  'org.profile_reset': 'Reset the organisation profile',
  'org.suspend': 'Suspended the organisation',
  'org.reactivate': 'Reactivated the organisation',
  'client.create': 'Created an API client',
  'client.rotate': 'Rotated an API client secret',
  'client.revoke': 'Revoked an API client',
  'client.restore': 'Restored an API client',
  'key.rotate': 'Rotated the hashing key',
  'key.retire': 'Retired a hashing key',
  'webhook.set': 'Set the alert webhook',
  'webhook.remove': 'Removed the alert webhook',
  'webhook.test': 'Sent a test webhook',
  'email.test': 'Sent a test alert email',
};

const describe = (e: ActivityEntry) => ACTIONS[e.action] ?? e.action.replace(/[._]/g, ' ');
const who = (actor: string) => (actor.startsWith('console:') ? `${actor.slice(8)} (dashboard)` : actor === 'You (demo)' ? actor : `${actor} (Gaskiyya)`);
const detail = (e: ActivityEntry) =>
  Object.entries(e.details)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');

export function ActivityPage({ ws, onSignedOut }: { ws: Workspace; onSignedOut: () => void }) {
  const [entries] = usePoll(() => ws.activity(), 8000, [ws], onSignedOut);
  return (
    <div className="page">
      <PageHead
        title="Activity"
        sub={ws.kind === 'demo' ? 'What you have done in this demo session.' : `Every sign-in, approval and change for ${ws.profile.name}, by your team or by Gaskiyya. Kept for audit.`}
      />
      <div className="card">
        {!entries ? (
          <p className="muted small flat">Loading&hellip;</p>
        ) : entries.length === 0 ? (
          <Empty icon={<IconClock />} title="Nothing yet">Approvals, sign-ins and changes to your organisation appear here.</Empty>
        ) : (
          <ol className="timeline">
            {entries.map((e) => (
              <li key={e.id}>
                <span className={`ws-dot ${e.action.includes('revoke') || e.action.includes('suspend') ? 'red' : e.action.startsWith('console.advisory') ? 'green' : 'blue'}`} />
                <div className="grow">
                  <div className="strong">{describe(e)}</div>
                  <div className="muted small">{who(e.actor)}{detail(e) ? ` · ${detail(e)}` : ''}</div>
                </div>
                <time className="muted small nowrap">{fmtTime(e.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
