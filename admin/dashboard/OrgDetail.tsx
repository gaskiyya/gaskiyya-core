import { useCallback, useEffect, useState } from 'react';
import { admin, ApiError, FEATURES, type AuditEntry, type ClientView, type OrgDetail as Detail } from './api.ts';
import { AccessSection, draftFrom, IdentitySection, IntegrationSection, PublicSection, toInput, type Draft } from './OrgForm.tsx';
import { AuditTable } from './Audit.tsx';
import { ago, Badge, Bars, Confirm, Copy, errorsByField, Field, fmtNum, fmtPct, fmtTime, Modal, SecretOnce, StatusBadges, Tile } from './ui.tsx';

type Tab = 'overview' | 'profile' | 'access' | 'console' | 'keys' | 'alerts' | 'usage' | 'audit';
const TABS: { id: Tab; name: string }[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'profile', name: 'Profile' },
  { id: 'access', name: 'API access' },
  { id: 'console', name: 'Bank console' },
  { id: 'keys', name: 'Hashing keys' },
  { id: 'alerts', name: 'Alerts' },
  { id: 'usage', name: 'Usage' },
  { id: 'audit', name: 'Audit' },
];

export function OrgDetail({ id, notify, onBack, initial, startTab }: { id: string; notify: (s: string, tone?: 'error') => void; onBack: () => void; initial?: Detail | null; startTab?: Tab }) {
  const [d, setD] = useState<Detail | null>(initial ?? null);
  const [tab, setTab] = useState<Tab>(startTab ?? 'overview');
  const [failed, setFailed] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'suspend' | 'reactivate'>(null);

  const load = useCallback(() => {
    admin.org(id).then((x) => (setD(x), setFailed(null))).catch((e: Error) => setFailed(e.message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'org' in r) setD(r as Detail);
      else load();
      notify(ok);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
  };

  if (failed && !d) return <div className="page"><div className="card notice error">{failed} <button className="btn plain" onClick={load}>Retry</button></div></div>;
  if (!d) return <div className="page"><div className="card empty">{'Loading\u2026'}</div></div>;
  const o = d.org;

  return (
    <div className="page">
      <button className="btn plain back" onClick={onBack}>&larr; Organisations</button>
      <div className="page-head">
        <div>
          <div className="row tight">
            <h1>{o.name}</h1>
            <StatusBadges status={o.status} mode={o.mode} />
          </div>
          <p>
            <code>{o.id}</code> &middot; {o.kind} {o.bankCode ? <>&middot; NIBSS {o.bankCode}</> : null} &middot; {d.meta.source === 'env' ? 'configured in GASKIYA_TENANTS' : `added by ${d.meta.createdBy ?? 'unknown'} ${ago(d.meta.createdAt)}`}
          </p>
        </div>
        <div className="row">
          {o.mode === 'sandbox' && o.status === 'active' && (
            <button className="btn secondary" onClick={() => act(() => admin.update(o.id, { mode: 'live' }), 'Now live')}>Switch to live</button>
          )}
          {o.status === 'active' ? (
            <button className="btn danger" onClick={() => setConfirm('suspend')}>Suspend</button>
          ) : (
            <button className="btn success" onClick={() => setConfirm('reactivate')}>Reactivate</button>
          )}
        </div>
      </div>
      {o.status === 'suspended' && (
        <div className="notice error">
          <b>Suspended</b> by {d.meta.suspendedBy} {ago(d.meta.suspendedAt)}: {d.meta.suspendedReason}. Its API calls answer 403 org_suspended and its customers' checks answer &quot;cannot check right now&quot;, never confirmed.
        </div>
      )}
      <nav className="tabs" aria-label="Organisation sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.name}
            {t.id === 'access' && <span className="count">{d.clients.filter((c) => c.status === 'active').length}</span>}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <OverviewTab d={d} go={setTab} />}
      {tab === 'profile' && <ProfileTab d={d} setD={setD} notify={notify} />}
      {tab === 'access' && <AccessTab d={d} reload={load} notify={notify} />}
      {tab === 'console' && <ConsoleTab d={d} reload={load} notify={notify} />}
      {tab === 'keys' && <KeysTab d={d} reload={load} notify={notify} />}
      {tab === 'alerts' && <AlertsTab d={d} reload={load} notify={notify} />}
      {tab === 'usage' && <UsageTab d={d} />}
      {tab === 'audit' && <OrgAudit entries={d.audit} />}
      {confirm === 'suspend' && (
        <Confirm
          title={`Suspend ${o.name}?`}
          body={<p>Every API call from its systems is refused at once, its tokens stop working, and its customers' checks answer &quot;cannot check right now&quot;. Records are kept. You can reactivate later.</p>}
          action="Suspend organisation"
          danger
          input={{ label: 'Reason (recorded in the audit log)', placeholder: 'e.g. contract ended, suspected key compromise', required: true }}
          onCancel={() => setConfirm(null)}
          onConfirm={(reason) => void act(() => admin.suspend(o.id, reason), 'Suspended').then(() => setConfirm(null))}
        />
      )}
      {confirm === 'reactivate' && (
        <Confirm
          title={`Reactivate ${o.name}?`}
          body={<p>Its API clients that are still active can sign in again and its customers' checks resume.</p>}
          action="Reactivate"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void act(() => admin.reactivate(o.id), 'Reactivated').then(() => setConfirm(null))}
        />
      )}
    </div>
  );
}

function OverviewTab({ d, go }: { d: Detail; go: (t: Tab) => void }) {
  const s = d.summary;
  const cov = d.metrics?.coverage;
  const done = d.checklist.filter((c) => c.done).length;
  return (
    <div className="grid-2">
      <div className="stack">
        <div className="tiles">
          <Tile k="Messages registered" v={fmtNum(s.usage?.registrations)} sub={`${fmtNum(s.usage?.receiptsRegistered)} receipts`} />
          <Tile k="Customer checks" v={fmtNum(s.usage?.checks)} sub={`${fmtNum(s.usage?.confirmed)} confirmed`} />
          <Tile k="API calls, 7 days" v={fmtNum(s.api?.last7Days)} sub={`${fmtNum(s.api?.errors7Days)} errors`} />
        </div>
        <div className="card stack">
          <h3>Message checks</h3>
          {cov && cov.checked > 0 ? (
            <>
              <div className="bar">
                <span style={{ width: `${(cov.confirmed / cov.checked) * 100}%`, background: 'var(--green)' }} />
                <span style={{ width: `${(cov.notConfirmed / cov.checked) * 100}%`, background: 'var(--orange)' }} />
                <span style={{ width: `${(cov.cannotCheck / cov.checked) * 100}%`, background: 'var(--red)' }} />
              </div>
              <div className="row small">
                <span><span className="dot green" /> Confirmed {fmtNum(cov.confirmed)}</span>
                <span><span className="dot orange" /> Not confirmed {fmtNum(cov.notConfirmed)} ({fmtPct(cov.notConfirmedRate)})</span>
                <span><span className="dot red" /> Cannot check {fmtNum(cov.cannotCheck)} ({fmtPct(cov.cannotCheckRate)})</span>
              </div>
            </>
          ) : (
            <p className="muted small">No customer has checked a message yet.</p>
          )}
          <p className="muted small">Counts only. Gaskiyya stores keyed hashes and a few descriptive fields, never message text.</p>
        </div>
        <div className="card stack">
          <h3>Fraud desk</h3>
          <div className="row small">
            <span>{d.campaigns.total} campaigns</span>
            <span>{d.campaigns.new} new</span>
            <span>{d.campaigns.liveAdvisories} live advisories</span>
            <span>{fmtNum(s.usage?.reports)} customer reports</span>
            <span>{d.alerts.length} registration alerts</span>
          </div>
        </div>
      </div>
      <div className="stack">
        <div className="card stack">
          <div className="row between">
            <h3>Go-live checklist</h3>
            <span className="muted small">{done} of {d.checklist.length}</span>
          </div>
          <ul className="checklist">
            {d.checklist.map((c) => (
              <li key={c.id} className={c.done ? 'done' : ''}>
                <span className="tick">{c.done ? '\u2713' : ''}</span>
                {c.label}
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn secondary small-btn" onClick={() => go('access')}>API access</button>
            <button className="btn secondary small-btn" onClick={() => go('profile')}>Edit profile</button>
          </div>
        </div>
        <div className="card stack">
          <h3>Features</h3>
          <ul className="plain-list small">
            {FEATURES.map((f) => (
              <li key={f.id}>{d.summary.features[f.id] ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>} {f.label}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ d, setD, notify }: { d: Detail; setD: (d: Detail) => void; notify: (s: string, tone?: 'error') => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(d));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setDraft((x) => ({ ...x, ...p }));
  const errs = errorsByField(errors);
  const save = async () => {
    const { body, errors: local } = toInput(draft, 'update');
    if (local.length) return setErrors(local);
    setBusy(true);
    try {
      const r = await admin.update(d.org.id, body);
      setD(r);
      setDraft(draftFrom(r));
      setErrors([]);
      notify('Saved. It applies at once.');
    } catch (e) {
      const msg = (e as Error).message;
      setErrors(msg.replace(/^Invalid fields: /, '').split('; '));
      notify('Not saved: see the highlighted fields', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card form-card">
      {d.meta.source === 'env' && (
        <div className="notice">
          This organisation is configured in <code>GASKIYA_TENANTS</code>. Saving here stores an edited profile in the registry that replaces the environment one{d.meta.profileOverridden ? ' (it already does)' : ''}.
          {d.meta.profileOverridden && (
            <button className="btn plain" onClick={() => void admin.resetProfile(d.org.id).then((r) => (setD(r), setDraft(draftFrom(r)), notify('Back to the configured profile'))).catch((e: Error) => notify(e.message, 'error'))}>
              Go back to the configured profile
            </button>
          )}
        </div>
      )}
      {errs._general && <div className="notice error">{errs._general.map((e) => <div key={e}>{e}</div>)}</div>}
      <IdentitySection d={draft} set={set} errs={errs} editing />
      <PublicSection d={draft} set={set} errs={errs} />
      <IntegrationSection d={draft} set={set} errs={errs} />
      <AccessSection d={draft} set={set} errs={errs} />
      <div className="form-actions">
        <button className="btn secondary" disabled={busy} onClick={() => (setDraft(draftFrom(d)), setErrors([]))}>Discard changes</button>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving\u2026' : 'Save profile'}</button>
      </div>
    </div>
  );
}

function quickstart(origin: string, clientId: string) {
  return `# 1. Get an access token (valid 10 minutes). Keep the secret in your secret manager.
export GASKIYYA_CLIENT_SECRET='<the secret shown once>'
TOKEN=$(curl -s -X POST ${origin}/v1/oauth/token \\
  -H 'content-type: application/json' \\
  -d '{"grant_type":"client_credentials","client_id":"${clientId}","client_secret":"'"$GASKIYYA_CLIENT_SECRET"'"}' | jq -r .access_token)

# 2. Register a message at the moment you send it (contentDigest: SHA-256 of the canonical text,
#    see packages/canonical). The customer's message itself does not change.
curl -s -X POST ${origin}/v1/messages \\
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \\
  -H 'idempotency-key: msg-0001' \\
  -d '{"recipient":"+2348012345678","channel":"sms","category":"transaction_alert",
       "contentDigest":"2c0c122ad56268258bb16e6ba85fb2f9c8bab9ce1d8ff20527060f8c3151729f",
       "hasLink":false,"linkDomains":[],"asksCallback":false,"sentAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'

# 3. Announce an outbound call before the agent dials.
curl -s -X POST ${origin}/v1/calls \\
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \\
  -d '{"recipient":"+2348012345678","purpose":"fraud_check","agentRef":"agent-17"}'`;
}

function AccessTab({ d, reload, notify }: { d: Detail; reload: () => void; notify: (s: string, tone?: 'error') => void }) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('Production notification service');
  const [secret, setSecret] = useState<{ client: ClientView; clientSecret: string; rotated?: boolean } | null>(null);
  const [rotate, setRotate] = useState<ClientView | null>(null);
  const [grace, setGrace] = useState('0');
  const [revoke, setRevoke] = useState<ClientView | null>(null);
  const origin = window.location.origin;
  const first = d.clients.find((c) => c.status === 'active');

  const create = async () => {
    try {
      const r = await admin.createClient(d.org.id, label.trim());
      setCreating(false);
      setSecret(r);
      reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <div>
            <h2>API clients</h2>
            <p className="muted small">Each of the organisation's systems gets its own client. The secret is generated here, shown once, and stored only as a salted scrypt hash.</p>
          </div>
          <button className="btn" disabled={d.org.status === 'suspended'} onClick={() => setCreating(true)}>New API client</button>
        </div>
        {d.clients.length === 0 ? (
          <p className="empty small">No API client yet. Create one to let the organisation register messages and calls.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Client ID</th><th>Label</th><th>Secret</th><th>Status</th><th>Created</th><th>Last used</th><th /></tr>
              </thead>
              <tbody>
                {d.clients.map((c) => (
                  <tr key={c.clientId} className={c.status === 'revoked' ? 'dim' : ''}>
                    <td><code>{c.clientId}</code> <Copy text={c.clientId} label="Copy ID" /></td>
                    <td>{c.label}{c.source === 'env' && <div className="muted small">From the environment</div>}</td>
                    <td className="mono small">{c.secretHint ?? (c.source === 'env' ? 'in GASKIYA_BANK_CLIENTS' : '\u2013')}{c.previousSecretExpiresAt && <div className="muted small">old secret valid until {fmtTime(c.previousSecretExpiresAt)}</div>}</td>
                    <td>{c.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="red">Revoked</Badge>}</td>
                    <td className="small">{c.createdAt ? <>{fmtTime(c.createdAt)}<div className="muted">{c.createdBy}</div></> : '\u2013'}{c.rotatedAt && <div className="muted">rotated {ago(c.rotatedAt)}</div>}</td>
                    <td className="small">{ago(c.lastUsedAt)}</td>
                    <td className="actions">
                      {c.status === 'active' && c.source === 'admin' && <button className="btn plain" onClick={() => (setGrace('0'), setRotate(c))}>Rotate</button>}
                      {c.status === 'active' && <button className="btn plain danger-text" onClick={() => setRevoke(c)}>Revoke</button>}
                      {c.status === 'revoked' && c.source === 'env' && <button className="btn plain" onClick={() => void admin.restoreClient(d.org.id, c.clientId).then(() => (reload(), notify('Restored'))).catch((e: Error) => notify(e.message, 'error'))}>Restore</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card stack">
        <h2>Quick start</h2>
        <p className="muted small">
          Send this to the organisation's engineers with the client ID. It holds no secret. The full reference is the bank API guide (<code>apps/web/banks.html</code>): batch registration, receipts, SIM swap checks, campaigns and metrics.
        </p>
        <div className="code-block">
          <div className="row end"><Copy text={quickstart(origin, first?.clientId ?? '<client id>')} /></div>
          <pre>{quickstart(origin, first?.clientId ?? '<client id>')}</pre>
        </div>
        <div className="kv small">
          <span>Registry base URL</span><code>{origin}</code>
          <span>Token endpoint</span><code>POST /v1/oauth/token</code>
          <span>Customer token issuer (iss)</span><code>{d.org.id}</code>
          <span>Customer token audience (aud)</span><code>gaskiya</code>
        </div>
      </div>
      {creating && (
        <Modal title="New API client" onClose={() => setCreating(false)}>
          <div className="stack">
            <Field label="Label" help="Which system uses it, so you know what breaks if you revoke it.">
              <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
            </Field>
            <p className="muted small">The secret starts with <code>{d.org.mode === 'live' ? 'gsk_live_' : 'gsk_test_'}</code> because the organisation is {d.org.mode}.</p>
            <div className="row end">
              <button className="btn secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn" disabled={!label.trim()} onClick={create}>Create and show secret</button>
            </div>
          </div>
        </Modal>
      )}
      {rotate && (
        <Modal title={`Rotate ${rotate.clientId}`} onClose={() => setRotate(null)}>
          <div className="stack">
            <p>A new secret is generated. With no overlap, the old secret and every token issued with it stop working now: use that after a leak.</p>
            <Field label="Keep the old secret working for" help="Lets the organisation deploy the new secret without downtime.">
              <select value={grace} onChange={(e) => setGrace(e.target.value)}>
                <option value="0">No overlap (immediately)</option>
                <option value="15">15 minutes</option>
                <option value="60">1 hour</option>
                <option value="1440">24 hours</option>
              </select>
            </Field>
            <div className="row end">
              <button className="btn secondary" onClick={() => setRotate(null)}>Cancel</button>
              <button
                className="btn"
                onClick={() =>
                  void admin
                    .rotateClient(d.org.id, rotate.clientId, Number(grace))
                    .then((r) => (setRotate(null), setSecret({ ...r, rotated: true }), reload()))
                    .catch((e: Error) => notify(e.message, 'error'))
                }
              >
                Rotate secret
              </button>
            </div>
          </div>
        </Modal>
      )}
      {revoke && (
        <Confirm
          title={`Revoke ${revoke.clientId}?`}
          body={<p>The client can no longer get tokens, and tokens it already holds stop working at once. {revoke.source === 'admin' ? 'This cannot be undone.' : 'Its secret stays in GASKIYA_BANK_CLIENTS; you can restore it here.'}</p>}
          action="Revoke client"
          danger
          onCancel={() => setRevoke(null)}
          onConfirm={() => void admin.revokeClient(d.org.id, revoke.clientId).then(() => (setRevoke(null), reload(), notify('Revoked'))).catch((e: Error) => notify(e.message, 'error'))}
        />
      )}
      {secret && (
        <SecretOnce
          title={secret.rotated ? 'New client secret' : 'API client created'}
          items={[
            { label: 'Client ID', value: secret.client.clientId },
            { label: 'Client secret', value: secret.clientSecret, secret: true },
          ]}
          note={<>Exchange them at <code>POST /v1/oauth/token</code> for a 10-minute access token. Never put the secret in a mobile app or a web page.</>}
          onDone={() => setSecret(null)}
        />
      )}
    </div>
  );
}

function ConsoleTab({ d, reload, notify }: { d: Detail; reload: () => void; notify: (s: string, tone?: 'error') => void }) {
  const [confirming, setConfirming] = useState(false);
  const consoleUrl = `${window.location.origin}/console/`;
  const current = d.consoleCodes.find((c) => c.status === 'active');

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <div>
            <h2>Bank console sign-in code</h2>
            <p className="muted small">
              {d.org.name} signs in to its dashboard at <code>{consoleUrl}</code> with this code. It is issued when the organisation is registered, signed with its own hashing key, and opens this organisation only.
            </p>
          </div>
          <button className="btn secondary" disabled={d.org.status === 'suspended' || !d.consoleCode} onClick={() => setConfirming(true)}>Regenerate code</button>
        </div>
        {d.consoleCode ? (
          <div className="console-code">
            <code>{d.consoleCode}</code>
            <Copy text={d.consoleCode} />
            <span className="muted small">{current ? <>Issued {fmtTime(current.createdAt)} by {current.createdBy} &middot; last sign-in {ago(current.lastUsedAt)}</> : null}</span>
          </div>
        ) : (
          <p className="notice warn">No code yet. It is issued as soon as the organisation has a hashing key.</p>
        )}
        <p className="muted small">Hand it to the organisation over a secure channel. Regenerating issues a new code and signs out everyone using the old one.</p>
      </div>
      {d.consoleCodes.length > 1 && (
        <div className="card stack">
          <h2>Earlier codes</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Code ends</th><th>Issued</th><th>Replaced</th><th>Last sign-in</th></tr>
              </thead>
              <tbody>
                {d.consoleCodes.filter((c) => c.status === 'revoked').map((c) => (
                  <tr key={c.id} className="dim">
                    <td className="mono small">&hellip;{c.hint}</td>
                    <td className="small">{fmtTime(c.createdAt)}<div className="muted">{c.createdBy}</div></td>
                    <td className="small">{fmtTime(c.revokedAt)}<div className="muted">{c.revokedBy}</div></td>
                    <td className="small">{ago(c.lastUsedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {confirming && (
        <Confirm
          title="Regenerate the console code"
          body={<p>{d.org.name} gets a new code. The current one stops working at once and everyone signed in with it is signed out.</p>}
          action="Regenerate"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => void admin.regenerateConsoleCode(d.org.id).then(() => (setConfirming(false), reload(), notify('New code issued'))).catch((e: Error) => notify(e.message, 'error'))}
        />
      )}
    </div>
  );
}

function KeysTab({ d, reload, notify }: { d: Detail; reload: () => void; notify: (s: string, tone?: 'error') => void }) {
  const [confirm, setConfirm] = useState<null | { kind: 'rotate' } | { kind: 'retire'; version: number }>(null);
  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <h2>Hashing keys</h2>
          <p className="muted small">HMAC keys that turn phone numbers and message digests into the keyed hashes the registry stores. Key material is never shown, not even here. Checks try every usable version, so rotation never breaks a live record (decision 0008).</p>
        </div>
        <button className="btn" disabled={d.keys.some((k) => k.state === 'pending')} onClick={() => setConfirm({ kind: 'rotate' })}>Rotate key</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Version</th><th>State</th><th>Held in</th><th>Created</th><th>Becomes current</th><th /></tr>
          </thead>
          <tbody>
            {d.keys.map((k) => (
              <tr key={k.version} className={k.state === 'retired' ? 'dim' : ''}>
                <td><b>v{k.version}</b></td>
                <td>
                  {k.state === 'current' && <Badge tone="green">Current</Badge>}
                  {k.state === 'pending' && <Badge tone="orange">Pending</Badge>}
                  {k.state === 'previous' && <Badge>Previous</Badge>}
                  {k.state === 'retired' && <Badge tone="red">Retired</Badge>}
                </td>
                <td className="small">{k.source === 'env' ? 'GASKIYA_TENANT_KEYS' : 'Registry, encrypted'}</td>
                <td className="small">{k.createdAt ? <>{fmtTime(k.createdAt)} <span className="muted">{k.createdBy}</span></> : '\u2013'}</td>
                <td className="small">{k.state === 'retired' ? <>retired {fmtTime(k.retiredAt)} <span className="muted">{k.retiredBy}</span></> : k.activatesAt ? fmtTime(k.activatesAt) : '\u2013'}</td>
                <td className="actions">{k.state === 'previous' && <button className="btn plain danger-text" onClick={() => setConfirm({ kind: 'retire', version: k.version })}>Retire</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.keys.length === 0 && <p className="notice error">No hashing key: this organisation's checks answer &quot;cannot check right now&quot;.</p>}
      {confirm?.kind === 'rotate' && (
        <Confirm
          title="Rotate the hashing key?"
          body={<p>A new version is made and becomes current once every server has loaded it. Records written under older versions keep confirming until you retire those versions; keep them until their records expire ({d.org.recordTtlDays ?? 30} days).</p>}
          action="Rotate key"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void admin.rotateKey(d.org.id).then(() => (setConfirm(null), reload(), notify('New key version made'))).catch((e: Error) => notify(e.message, 'error'))}
        />
      )}
      {confirm?.kind === 'retire' && (
        <Confirm
          title={`Retire key v${confirm.version}?`}
          body={<p>The key is deleted. Messages and receipts registered under it answer &quot;not confirmed&quot; from now on, never confirmed. This cannot be undone.</p>}
          action="Retire key"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void admin.retireKey(d.org.id, confirm.version).then(() => (setConfirm(null), reload(), notify('Key retired'))).catch((e: Error) => notify(e.message, 'error'))}
        />
      )}
    </div>
  );
}

function AlertsTab({ d, reload, notify }: { d: Detail; reload: () => void; notify: (s: string, tone?: 'error') => void }) {
  const [url, setUrl] = useState(d.meta.webhook?.url ?? '');
  const [secret, setSecret] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const testEmail = async () => {
    const r = await admin.testEmail(d.org.id).catch((e: ApiError) => ({ ok: false, error: e.message }));
    setResult(r.ok ? 'Test email sent.' : `Test email not sent: ${r.error}`);
  };
  const testHook = async () => {
    const r = await admin.testWebhook(d.org.id).catch((e: ApiError) => ({ ok: false, error: e.message, status: undefined }));
    setResult(r.ok ? `Webhook answered ${r.status}.` : `Webhook failed: ${r.error}`);
  };
  return (
    <div className="grid-2">
      <div className="stack">
        <div className="card stack">
          <h2>Alert emails</h2>
          <p className="muted small">Campaign alerts, registration alerts (unknown link domains, volume spikes) and SIM swap notices.</p>
          {d.org.alertEmails?.length ? <ul className="plain-list mono small">{d.org.alertEmails.map((e) => <li key={e}>{e}</li>)}</ul> : <p className="muted small">None. Add them under Profile, Integration.</p>}
          <div><button className="btn secondary" onClick={testEmail}>Send a test email</button></div>
        </div>
        <div className="card stack">
          <h2>Alert webhook</h2>
          <p className="muted small">
            The same alerts as JSON, posted to the organisation's own systems. Each request carries <code>x-gaskiyya-signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, an HMAC-SHA256 of <code>t.body</code> with the signing secret. Payloads hold IDs, counts and domains only, never message text or phone numbers.
          </p>
          <Field label="Endpoint URL" help="https in production.">
            <input value={url} placeholder="https://hooks.firstcitybank.ng/gaskiyya" onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn" disabled={!url.trim()} onClick={() => void admin.setWebhook(d.org.id, url.trim()).then((r) => (setSecret(r.signingSecret), reload())).catch((e: Error) => notify(e.message, 'error'))}>
              {d.meta.webhook ? 'Save and make a new signing secret' : 'Save webhook'}
            </button>
            {d.meta.webhook && <button className="btn secondary" onClick={testHook}>Send a test event</button>}
            {d.meta.webhook && <button className="btn plain danger-text" onClick={() => void admin.removeWebhook(d.org.id).then(() => (setUrl(''), reload(), notify('Webhook removed'))).catch((e: Error) => notify(e.message, 'error'))}>Remove</button>}
          </div>
          {d.meta.webhook && <p className="muted small">Set {fmtTime(d.meta.webhook.createdAt)}.</p>}
        </div>
        {result && <div className="notice">{result}</div>}
      </div>
      <div className="card stack">
        <h3>Recent registration alerts</h3>
        {d.alerts.length === 0 ? (
          <p className="muted small">None.</p>
        ) : (
          <ul className="plain-list small">
            {d.alerts.map((a) => (
              <li key={a.id}>
                <Badge tone="orange">{a.kind === 'unknown_link_domain' ? 'Unknown link domain' : 'Volume spike'}</Badge> {a.domain && <code>{a.domain}</code>} {fmtNum(a.count)}
                {a.expected !== null && <> (expected {fmtNum(a.expected)})</>} <span className="muted">{ago(a.lastSeen)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {secret && (
        <SecretOnce
          title="Webhook signing secret"
          items={[{ label: 'Signing secret', value: secret, secret: true }]}
          note="The organisation verifies each request with it. Saving the webhook again makes a new one."
          onDone={() => setSecret(null)}
        />
      )}
    </div>
  );
}

function UsageTab({ d }: { d: Detail }) {
  const routes: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  const clients: Record<string, number> = {};
  for (const u of d.usage) {
    for (const [k, v] of Object.entries(u.byRoute)) routes[k] = (routes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(u.byStatus)) statuses[k] = (statuses[k] ?? 0) + v;
    for (const [k, v] of Object.entries(u.byClient)) clients[k] = (clients[k] ?? 0) + v;
  }
  const sorted = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return (
    <div className="stack">
      <div className="card stack">
        <h2>API calls, last 14 days</h2>
        <Bars data={d.usage.map((u) => ({ label: u.day, value: u.calls, errors: u.errors }))} />
        <p className="muted small">Bank API calls by authenticated clients of this organisation, counted by route and status. Bodies are never stored.</p>
      </div>
      <div className="tiles">
        <div className="card">
          <h3>By endpoint</h3>
          <ul className="plain-list small">{sorted(routes).map(([k, v]) => <li key={k} className="row between"><code>{k}</code><span>{fmtNum(v)}</span></li>)}</ul>
          {!Object.keys(routes).length && <p className="muted small">No calls yet.</p>}
        </div>
        <div className="card">
          <h3>By status</h3>
          <ul className="plain-list small">{sorted(statuses).map(([k, v]) => <li key={k} className="row between"><span>{Number(k) >= 400 ? <Badge tone="red">{k}</Badge> : <Badge tone="green">{k}</Badge>}</span><span>{fmtNum(v)}</span></li>)}</ul>
        </div>
        <div className="card">
          <h3>By client</h3>
          <ul className="plain-list small">{sorted(clients).map(([k, v]) => <li key={k} className="row between"><code>{k}</code><span>{fmtNum(v)}</span></li>)}</ul>
        </div>
      </div>
      <div className="card stack">
        <h2>Recent errors</h2>
        {d.errors.length === 0 ? (
          <p className="muted small">No failed calls in the last 30 days.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Client</th><th>Call</th><th>Status</th><th>Code</th></tr></thead>
              <tbody>
                {d.errors.map((e, i) => (
                  <tr key={i}>
                    <td className="small">{fmtTime(e.at)}</td>
                    <td><code>{e.clientId}</code></td>
                    <td><code>{e.method} {e.route}</code></td>
                    <td><Badge tone="red">{e.status}</Badge></td>
                    <td><code>{e.code ?? '\u2013'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OrgAudit({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="card">
      <AuditTable entries={entries} showOrg={false} />
    </div>
  );
}
