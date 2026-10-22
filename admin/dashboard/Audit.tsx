import { useEffect, useState } from 'react';
import { admin, type AuditEntry } from './api.ts';
import { Badge, fmtTime } from './ui.tsx';

const LABELS: Record<string, string> = {
  'admin.login': 'Signed in',
  'admin.login_failed': 'Failed sign-in',
  'admin.logout': 'Signed out',
  'admin.refresh': 'Reloaded registry',
  'org.create': 'Organisation created',
  'org.update': 'Organisation updated',
  'org.profile_reset': 'Profile reset to configuration',
  'org.suspend': 'Organisation suspended',
  'org.reactivate': 'Organisation reactivated',
  'client.create': 'API client created',
  'client.rotate': 'Client secret rotated',
  'client.revoke': 'API client revoked',
  'client.restore': 'API client restored',
  'key.rotate': 'Hashing key rotated',
  'key.retire': 'Hashing key retired',
  'webhook.set': 'Webhook set',
  'webhook.remove': 'Webhook removed',
  'webhook.test': 'Webhook tested',
  'email.test': 'Test email sent',
  'console_code.issue': 'Console code issued',
  'console_code.revoke': 'Console code revoked',
  'console_code.regenerate': 'Console code regenerated',
  'console.login': 'Bank signed in to console',
  'console.login_failed': 'Failed console sign-in',
  'console.advisory_approve': 'Advisory approved (console)',
  'console.advisory_withdraw': 'Advisory withdrawn (console)',
  'console.campaign_dismiss': 'Campaign dismissed (console)',
};

const tone = (a: string) => (/suspend|revoke|retire|failed|remove|withdraw/.test(a) ? 'red' : /create|issue|reactivate|restore|login$|approve/.test(a) ? 'green' : /rotate/.test(a) ? 'orange' : undefined);

function details(d: AuditEntry['details']) {
  const parts = Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  return parts.length ? parts.join(' \u00b7 ') : '';
}

export function AuditTable({ entries, showOrg = true }: { entries: AuditEntry[]; showOrg?: boolean }) {
  if (!entries.length) return <p className="muted small">Nothing recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>When</th><th>Who</th><th>Action</th>{showOrg && <th>Organisation</th>}<th>Target</th><th>Details</th><th>From</th></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="small nowrap">{fmtTime(e.at)}</td>
              <td>{e.actor}</td>
              <td><Badge tone={tone(e.action)}>{LABELS[e.action] ?? e.action}</Badge></td>
              {showOrg && <td>{e.tenantId ? <code>{e.tenantId}</code> : <span className="muted">platform</span>}</td>}
              <td>{e.target ? <code>{e.target}</code> : ''}</td>
              <td className="small muted wrap">{details(e.details)}</td>
              <td className="small muted">{e.ip ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage({ orgIds }: { orgIds: string[] }) {
  const [org, setOrg] = useState('');
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    admin
      .audit({ org: org || undefined, action: action || undefined, limit: 300 })
      .then((r) => (setEntries(r.entries), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [org, action]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Every admin action: who, what, when and from where. Secrets are never written here, only hints such as the first characters of a client secret.</p>
        </div>
        <div className="row">
          <select value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organisation">
            <option value="">All organisations</option>
            {orgIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
            <option value="">All actions</option>
            <option value="admin.">Sign-ins</option>
            <option value="org.">Organisations</option>
            <option value="client.">API clients</option>
            <option value="key.">Hashing keys</option>
            <option value="webhook.">Webhooks</option>
          </select>
        </div>
      </div>
      <div className="card">
        {error ? <p className="notice error">{error}</p> : entries ? <AuditTable entries={entries} /> : <p className="muted">{'Loading\u2026'}</p>}
      </div>
    </div>
  );
}
