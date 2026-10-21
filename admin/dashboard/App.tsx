import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { IconChart, IconPlus, IconShield, IconBadge, IconSettings } from './icons.tsx';
import { admin, type OrgDetail as Detail, type OrgSummary, type Overview } from './api.ts';
import { AuditPage, AuditTable } from './Audit.tsx';
import { Onboard } from './Onboard.tsx';
import { OrgDetail } from './OrgDetail.tsx';
import { ago, Badge, Bars, fmtNum, StatusBadges, Tile, useToast } from './ui.tsx';

type Page = { name: 'overview' } | { name: 'orgs' } | { name: 'org'; id: string; initial?: Detail; tab?: 'access' } | { name: 'onboard' } | { name: 'audit' } | { name: 'settings' };

function readHash(): Page {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'orgs' && b) return { name: 'org', id: decodeURIComponent(b) };
  if (a === 'orgs') return { name: 'orgs' };
  if (a === 'onboard') return { name: 'onboard' };
  if (a === 'audit') return { name: 'audit' };
  if (a === 'settings') return { name: 'settings' };
  return { name: 'overview' };
}

function hashOf(p: Page) {
  return p.name === 'org' ? `#/orgs/${encodeURIComponent(p.id)}` : p.name === 'overview' ? '#/' : `#/${p.name}`;
}

export function App() {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    admin.session().then((s) => setUser(s.username)).catch(() => {});
  }, []);
  if (!user) return <div className="signin-wrap"><p className="muted">{'Loading\u2026'}</p></div>;
  return <Shell user={user} onSignOut={() => void admin.signOut()} />;
}

function Shell({ user, onSignOut }: { user: string; onSignOut: () => void }) {
  const [page, setPageState] = useState<Page>(readHash);
  const [toast, notify] = useToast();
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    if (window.location.hash !== hashOf(p)) window.history.pushState(null, '', hashOf(p));
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const on = () => setPageState(readHash());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  useEffect(() => {
    admin.orgs().then((r) => setOrgIds(r.orgs.map((o) => o.id))).catch(() => {});
  }, [page]);

  const nav = [
    { id: 'overview', name: 'Overview', icon: <IconChart /> },
    { id: 'orgs', name: 'Organisations', icon: <IconBadge /> },
    { id: 'onboard', name: 'Onboard', icon: <IconPlus /> },
    { id: 'audit', name: 'Audit log', icon: <IconShield /> },
    { id: 'settings', name: 'Platform', icon: <IconSettings /> },
  ] as const;
  const active = page.name === 'org' ? 'orgs' : page.name;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="favicon.svg" alt="" />
          <div>
            <div className="brand-name">Gaskiyya</div>
            <div className="brand-sub">Platform admin</div>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          {nav.map((n) => (
            <button key={n.id} className={`nav-item ${active === n.id ? 'active' : ''}`} aria-current={active === n.id ? 'page' : undefined} onClick={() => setPage({ name: n.id } as Page)}>
              {n.icon}
              <span>{n.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="live-pill"><span className="status-dot" /> {user}</span>
          <button className="btn plain small" onClick={onSignOut}><span>Sign out</span></button>
        </div>
      </aside>
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="favicon.svg" alt="" />
          <div className="brand-name">Gaskiyya admin</div>
        </div>
        <button className="btn plain" onClick={onSignOut}>Sign out</button>
      </header>
      <main>
        {page.name === 'overview' && <OverviewPage open={(id) => setPage({ name: 'org', id })} onboard={() => setPage({ name: 'onboard' })} />}
        {page.name === 'orgs' && <OrgsPage open={(id) => setPage({ name: 'org', id })} onboard={() => setPage({ name: 'onboard' })} />}
        {page.name === 'org' && <OrgDetail key={page.id} id={page.id} initial={page.initial} startTab={page.tab} notify={notify} onBack={() => setPage({ name: 'orgs' })} />}
        {page.name === 'onboard' && (
          <Onboard
            onCancel={() => setPage({ name: 'orgs' })}
            onCreated={(d) => {
              notify(`${d.org.name} created. Next: issue its API credentials.`);
              setPage({ name: 'org', id: d.org.id, initial: d, tab: 'access' });
            }}
          />
        )}
        {page.name === 'audit' && <AuditPage orgIds={orgIds} />}
        {page.name === 'settings' && <SettingsPage notify={notify} />}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {nav.slice(0, 4).map((n) => (
          <button key={n.id} className={active === n.id ? 'on' : ''} onClick={() => setPage({ name: n.id } as Page)}>
            {n.icon}
            {n.name}
          </button>
        ))}
      </nav>
      {toast}
    </div>
  );
}

function usePolled<T>(fn: () => Promise<T>, ms: number): [T | null, string | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fn().then((d) => (setData(d), setError(null))).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [data, error, load];
}

function OverviewPage({ open, onboard }: { open: (id: string) => void; onboard: () => void }) {
  const [o, error] = usePolled<Overview>(() => admin.overview(), 15_000);
  if (error && !o) return <div className="page"><p className="notice error">{error}</p></div>;
  if (!o) return <div className="page"><p className="muted">{'Loading\u2026'}</p></div>;
  const t = o.totals;
  const attention = o.orgs.filter((x) => x.status === 'suspended' || !x.hasKey || (x.api?.errors7Days ?? 0) > 0 || x.clients.active === 0);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Platform overview</h1>
          <p>Every organisation on Gaskiyya, its API traffic and its customers' checks. Counts only: no message content is stored.</p>
        </div>
        <button className="btn" onClick={onboard}>Onboard an organisation</button>
      </div>
      {!o.masterKeySet && <p className="notice warn">GASKIYA_MASTER_KEY is not set, so the dashboard cannot store hashing keys or webhook secrets. You can manage organisations from the environment, but not add new ones.</p>}
      <div className="tiles four">
        <Tile k="Organisations" v={fmtNum(t.organisations)} sub={`${t.active} active \u00b7 ${t.suspended} suspended \u00b7 ${t.sandbox} sandbox`} />
        <Tile k="Active API clients" v={fmtNum(t.activeClients)} sub={`${t.byKind.bank ?? 0} banks \u00b7 ${t.byKind.agency ?? 0} agencies \u00b7 ${t.byKind.company ?? 0} companies`} />
        <Tile k="API calls today" v={fmtNum(t.apiCallsToday)} sub={`${fmtNum(t.apiCalls7Days)} in 7 days \u00b7 ${fmtNum(t.apiErrors7Days)} errors`} />
        <Tile k="Customer checks" v={fmtNum(t.checks)} sub={`${fmtNum(t.confirmed)} confirmed \u00b7 ${fmtNum(t.cannotCheck)} cannot check`} />
      </div>
      <div className="grid-2 overview-grid">
        <div className="stack">
          <div className="card stack">
            <h3>Bank API calls, last 14 days</h3>
            <Bars data={o.apiByDay.map((d) => ({ label: d.day, value: d.calls, errors: d.errors }))} />
          </div>
          <div className="card">
            <OrgTable orgs={o.orgs} open={open} />
          </div>
        </div>
        <div className="stack">
          <div className="card stack">
            <h3>Needs attention</h3>
            {attention.length === 0 ? (
              <p className="muted small">Nothing right now.</p>
            ) : (
              <ul className="plain-list small">
                {attention.map((x) => (
                  <li key={x.id}>
                    <button className="link" onClick={() => open(x.id)}>{x.name}</button>{' '}
                    {x.status === 'suspended' && <Badge tone="red">Suspended</Badge>}
                    {!x.hasKey && <Badge tone="red">No hashing key</Badge>}
                    {x.clients.active === 0 && <Badge tone="orange">No API client</Badge>}
                    {(x.api?.errors7Days ?? 0) > 0 && <Badge tone="orange">{x.api!.errors7Days} API errors</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card stack">
            <h3>Recent admin activity</h3>
            <AuditTable entries={o.recentAudit.slice(0, 8)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function OrgTable({ orgs, open }: { orgs: OrgSummary[]; open: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead>
          <tr><th>Organisation</th><th>Status</th><th>Clients</th><th>Key</th><th className="num">Registered</th><th className="num">Checks</th><th className="num">API 7d</th><th>Last used</th></tr>
        </thead>
        <tbody>
          {orgs.map((x) => (
            <tr key={x.id} onClick={() => open(x.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(x.id)}>
              <td>
                <b>{x.name}</b>
                <div className="muted small"><code>{x.id}</code> &middot; {x.kind}{x.source === 'env' ? ' \u00b7 env' : ''}</div>
              </td>
              <td><StatusBadges status={x.status} mode={x.mode} /></td>
              <td>{x.clients.active}<span className="muted">/{x.clients.total}</span></td>
              <td>{x.keyVersion ? `v${x.keyVersion}` : <Badge tone="red">none</Badge>}</td>
              <td className="num">{fmtNum(x.usage?.registrations)}</td>
              <td className="num">{fmtNum(x.usage?.checks)}</td>
              <td className="num">{fmtNum(x.api?.last7Days)}{(x.api?.errors7Days ?? 0) > 0 && <div className="small danger-text">{x.api!.errors7Days} errors</div>}</td>
              <td className="small">{ago(x.lastUsedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgsPage({ open, onboard }: { open: (id: string) => void; onboard: () => void }) {
  const [data, error] = usePolled(() => admin.orgs(), 30_000);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const orgs = useMemo(
    () =>
      (data?.orgs ?? []).filter(
        (o) =>
          (!q || `${o.id} ${o.name} ${o.domains.join(' ')} ${o.bankCode ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
          (!status || (status === 'sandbox' ? o.mode === 'sandbox' : o.status === status)) &&
          (!kind || o.kind === kind),
      ),
    [data, q, status, kind],
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Organisations</h1>
          <p>Banks, agencies and companies that register what they send with Gaskiyya.</p>
        </div>
        <button className="btn" onClick={onboard}>Onboard an organisation</button>
      </div>
      <div className="row filters">
        <input value={q} placeholder="Search by name, ID, domain or bank code" onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="sandbox">Sandbox</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Any kind</option>
          <option value="bank">Banks</option>
          <option value="agency">Agencies</option>
          <option value="company">Companies</option>
        </select>
      </div>
      <div className="card">
        {error && !data ? <p className="notice error">{error}</p> : !data ? <p className="muted">{'Loading\u2026'}</p> : orgs.length ? <OrgTable orgs={orgs} open={open} /> : <p className="empty">No organisation matches.</p>}
      </div>
    </div>
  );
}

function SettingsPage({ notify }: { notify: (s: string, tone?: 'error') => void }) {
  const [s, error, load] = usePolled(() => admin.settings(), 60_000);
  if (error && !s) return <div className="page"><p className="notice error">{error}</p></div>;
  if (!s) return <div className="page"><p className="muted">{'Loading\u2026'}</p></div>;
  const integrations = (s.integrations ?? {}) as Record<string, unknown>;
  const limits = s.limits as Record<string, number>;
  const retention = s.retention as Record<string, number>;
  const guard = s.guard as Record<string, number>;
  const licences = s.licences as { status: string; maxAgeDays: number; sources: { id: string; regulator: string; title: string; retrievedAt: string; entries: number; stale: boolean; sample?: boolean }[] };
  const kv = (o: Record<string, unknown>) => (
    <div className="kv small">
      {Object.entries(o).map(([k, v]) => (
        <Fragment key={k}><span>{k}</span><code>{Array.isArray(v) ? v.join(', ') : String(v)}</code></Fragment>
      ))}
    </div>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Platform</h1>
          <p>Server-wide settings. These come from environment variables (apps/web/docs/CONFIGURATION.md) and change with a redeploy; per-organisation limits are set on each organisation.</p>
        </div>
        <button className="btn secondary" onClick={() => void admin.refresh().then(() => (load(), notify('Registry reloaded from the store'))).catch((e: Error) => notify(e.message, 'error'))}>Reload registry</button>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card stack"><h3>Integrations</h3>{kv(integrations)}</div>
          <div className="card stack">
            <h3>Licence lists</h3>
            <p className="small">Status: {licences.status === 'fresh' ? <Badge tone="green">Fresh</Badge> : <Badge tone="red">{licences.status}</Badge>} stale after {licences.maxAgeDays} days. Import with <code>pnpm licences:import</code>, or point <code>LICENCE_DATA_DIR</code> at a directory.</p>
            <ul className="plain-list small">
              {licences.sources.map((x) => (
                <li key={x.id}>{x.stale ? <Badge tone="red">Stale</Badge> : <Badge tone="green">Fresh</Badge>} <b>{x.regulator}</b> {x.title} {x.sample && <Badge tone="orange">Sample</Badge>} <span className="muted">{x.entries} entries, retrieved {x.retrievedAt.slice(0, 10)}</span></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="stack">
          <div className="card stack">
            <h3>Security</h3>
            {kv({ masterKey: s.masterKeySet ? 'set' : 'NOT SET', keyActivationSeconds: s.keyActivationSeconds, adminSessionHours: s.adminSessionHours, registryLoadedAt: s.registryLoadedAt, webhooks: s.webhooks })}
          </div>
          <div className="card stack"><h3>Default rate limits (per minute)</h3>{kv(limits)}</div>
          <div className="card stack"><h3>Retention</h3>{kv(retention)}</div>
          <div className="card stack"><h3>Registration guard</h3>{kv(guard)}</div>
        </div>
      </div>
    </div>
  );
}
