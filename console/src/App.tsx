import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import copy from '../../packages/schemas/copy.json';
import { setConsoleToken, sim, type Call, type Metrics, type SimConfig, type SimSwapAnswer, type Transfer } from './api.ts';
import { type Category } from '@gaskiya/schemas';
import { genuineTemplate } from '../../packages/api/src/simulator/demo-data.ts';
import { normalisePhone } from './device/api.ts';
import { Device, officialBankNumber } from './device/Device.tsx';
import { FeaturePhone, type UssdHop } from './ussd/FeaturePhone.tsx';
import {
  IconBuilding,
  IconCheck,
  IconClock,
  IconHome,
  IconKeypad,
  IconLogout,
  IconMessage,
  IconPhone,
  IconPlug,
  IconReset,
  IconScissors,
  IconSend,
  IconShield,
  IconTransfer,
  IconUsers,
  IconWarning,
} from './icons.tsx';
import { demoCode, demoWorkspace, liveWorkspace, loadSession, resume, saveSession, SignedOut, signOut, type OrgProfile, type StoredSession, type Workspace } from './workspace/data.ts';
import { ActivityPage } from './workspace/Activity.tsx';
import { CustomersPage } from './workspace/Customers.tsx';
import { FraudDeskPage } from './workspace/FraudDesk.tsx';
import { IntegrationPage } from './workspace/Integration.tsx';
import { OrganisationPage } from './workspace/Organisation.tsx';
import { OverviewPage, type LiveEvent } from './workspace/Overview.tsx';
import { SignIn } from './workspace/SignIn.tsx';
import { ago, Empty, Scenarios, Skeleton, SkeletonRows, useActions, usePoll, type Scenario } from './workspace/ui.tsx';

type WorkPage = 'overview' | 'fraud' | 'integration' | 'organisation' | 'activity';
type DemoPage = 'customers' | 'messages' | 'calls' | 'transfers' | 'ussd';
type Page = WorkPage | DemoPage;

const SANDBOX = __SANDBOX__;
const WORK_PAGES: WorkPage[] = ['overview', 'fraud', 'integration', 'organisation', 'activity'];
const DEMO_PAGES: DemoPage[] = ['customers', 'messages', 'calls', 'transfers', 'ussd'];

const label = (map: Record<string, string>, key: string) => {
  const s = map[key] ?? key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function useToast(): [ReactNode, (s: string) => void] {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast" role="status" key={msg.key}>{msg.text}</div> : null, (text) => setMsg({ text, key: Date.now() })];
}

const VERDICT_TONE: Record<string, LiveEvent['tone']> = { confirmed: 'green', calling: 'green', not_confirmed: 'orange', not_calling: 'orange', mismatch: 'red', cannot_check: 'red' };
const VERDICT_NAME: Record<string, string> = {
  confirmed: 'Sent by the bank',
  not_confirmed: 'Not confirmed',
  cannot_check: 'Cannot check right now',
  calling: 'The bank is calling',
  not_calling: 'The bank is not calling',
  mismatch: 'Code did not match',
};

function useLiveEvents(metrics: Metrics | null): LiveEvent[] {
  const prev = useRef<Metrics | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = metrics;
    if (!before || !metrics) return;
    const fresh: LiveEvent[] = [];
    const diff = (a: Record<string, number>, b: Record<string, number>, what: string) => {
      for (const [k, n] of Object.entries(b)) {
        const d = n - (a[k] ?? 0);
        if (d > 0) fresh.push({ key: Math.random(), at: new Date(), tone: VERDICT_TONE[k] ?? 'blue', text: `${what}: ${VERDICT_NAME[k] ?? label({}, k)}${d > 1 ? ` (${d})` : ''}` });
      }
    };
    diff(before.verifications, metrics.verifications, 'Message checked');
    diff(before.links, metrics.links, 'Link checked');
    diff(before.callChecks, metrics.callChecks, 'Call checked');
    const reg = metrics.registrations - before.registrations;
    if (reg > 0) fresh.push({ key: Math.random(), at: new Date(), tone: 'blue', text: `${reg} message${reg > 1 ? 's' : ''} registered` });
    const rep = metrics.reports - before.reports;
    if (rep > 0) fresh.push({ key: Math.random(), at: new Date(), tone: 'red', text: `${rep} scam report${rep > 1 ? 's' : ''} from customers` });
    if (fresh.length) setEvents((e) => [...fresh, ...e].slice(0, 30));
    if (metrics.registrations < before.registrations) setEvents([]);
  }, [metrics]);
  return events;
}

const pageFromHash = (): Page | null => {
  const h = window.location.hash.replace(/^#\/?/, '') as Page;
  return [...WORK_PAGES, ...DEMO_PAGES].includes(h) ? h : null;
};

type DemoCode = { name: string; code: string } | null;
type State =
  | { kind: 'loading' }
  | { kind: 'signin'; config: SimConfig | null; demo: DemoCode }
  | { kind: 'ready'; ws: Workspace; config: SimConfig | null; session: StoredSession | null };

const demoCodeFor = async (config: SimConfig | null): Promise<DemoCode> =>
  SANDBOX ? (config?.consoleCode ? { name: config.bank.name, code: config.consoleCode } : null) : demoCode();

// The demo bank, signed in with its own code, also gets the tools that act as its systems and customers.
function withDemoTools(ws: Workspace, config: SimConfig | null): Workspace {
  if (!config || ws.profile.id !== config.bank.id) return ws;
  return {
    ...ws,
    sendAdvisory: async (id) => (await sim.sendAdvisory(id)).sent,
    seedReports: async () => (await sim.seedReports()).reported,
    reset: async () => void (await sim.reset()),
  };
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [toast, notify] = useToast();

  const toSignIn = useCallback(async (config: SimConfig | null) => {
    setConsoleToken(null);
    setState({ kind: 'signin', config, demo: await demoCodeFor(config) });
  }, []);

  const openLive = useCallback((session: StoredSession, profile: OrgProfile, accessLabel: string, config: SimConfig | null) => {
    saveSession(session);
    setConsoleToken(config && profile.id === config.bank.id ? session.token : null);
    setState({ kind: 'ready', ws: withDemoTools(liveWorkspace(session.token, profile, accessLabel), config), config, session });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await sim.config().catch(() => null);
      const stored = loadSession();
      if (stored && !SANDBOX) {
        try {
          const r = await resume(stored);
          if (!cancelled) openLive(stored, r.profile, r.accessLabel, config);
          return;
        } catch (e) {
          if (e instanceof SignedOut) saveSession(null);
        }
      }
      // Nothing opens without a code; a demo server shows its demo bank's code on this page.
      if (!cancelled) await toSignIn(config);
    })();
    return () => {
      cancelled = true;
    };
  }, [openLive, toSignIn]);

  if (state.kind === 'loading') {
    return (
      <div className="boot" aria-busy="true">
        <img src="favicon.svg" alt="" />
      </div>
    );
  }
  if (state.kind === 'signin') {
    const { config } = state;
    return (
      <>
        <SignIn
          demo={state.demo}
          onSandboxDemo={config ? () => void demoWorkspace(config).then((ws) => setState({ kind: 'ready', ws, config, session: null })) : undefined}
          onSignedIn={(s, p, l) => openLive(s, p, l, config)}
        />
        {toast}
      </>
    );
  }
  return (
    <Shell
      key={state.ws.profile.id + state.ws.kind}
      ws={state.ws}
      config={state.config}
      notify={notify}
      toast={toast}
      onSignOut={async () => {
        if (state.session) await signOut(state.session);
        await toSignIn(state.config);
        notify('Signed out');
      }}
      onExpired={() => {
        saveSession(null);
        void toSignIn(state.config);
        notify('Your session ended. Sign in again with your code.');
      }}
    />
  );
}

function Shell({ ws, config, notify, toast, onSignOut, onExpired }: {
  ws: Workspace;
  config: SimConfig | null;
  notify: (s: string) => void;
  toast: ReactNode;
  onSignOut: () => void;
  onExpired: () => void;
}) {
  const demo = config !== null && ws.profile.id === config.bank.id;
  const [page, setPageState] = useState<Page>(() => {
    const p = pageFromHash();
    return p && (demo || WORK_PAGES.includes(p as WorkPage)) ? p : 'overview';
  });
  const [phone, setPhone] = useState('');
  const [placed, setPlaced] = useState<Call | null>(null);
  const [metrics, reloadMetrics, online] = usePoll(() => ws.metrics(), 2500, [ws], onExpired);
  const events = useLiveEvents(metrics);
  const seen = useRef(0);

  const setPage = (p: Page) => {
    if (p !== 'calls') setPlaced(null);
    setPageState(p);
    history.replaceState(null, '', `#/${p}`);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    const e = events[0];
    if (e && e.key !== seen.current && !e.text.includes('registered')) notify(e.text);
    if (e) seen.current = e.key;
  }, [events]);

  const work: { id: Page; name: string; icon: ReactNode }[] = [
    { id: 'overview', name: 'Overview', icon: <IconHome /> },
    ...(demo ? [{ id: 'customers' as const, name: 'Customers', icon: <IconUsers /> }] : []),
    { id: 'fraud', name: 'Fraud desk', icon: <IconShield /> },
    { id: 'integration', name: 'Integration', icon: <IconPlug /> },
    { id: 'organisation', name: 'Organisation', icon: <IconBuilding /> },
    { id: 'activity', name: 'Activity', icon: <IconClock /> },
  ];
  const tools: { id: DemoPage; name: string; icon: ReactNode }[] = demo
    ? [
        { id: 'messages', name: 'Messages', icon: <IconMessage /> },
        { id: 'calls', name: 'Calls', icon: <IconPhone /> },
        { id: 'transfers', name: 'Transfers', icon: <IconTransfer /> },
        { id: 'ussd', name: 'USSD', icon: <IconKeypad /> },
      ]
    : [];

  const actions = useActions((e) => notify(e.message));
  const reset = () => {
    if (!ws.reset || !confirm('Reset all demo data in the registry and the simulator?')) return;
    void actions.run('reset', async () => {
      await ws.reset!();
      reloadMetrics();
      notify('Demo reset');
    });
  };

  const badge = ws.kind === 'demo' ? 'Demo' : ws.profile.mode === 'live' ? 'Live' : 'Sandbox';
  const status = (
    <span className={`live-pill ${online ? '' : 'off'}`}>
      <span className="status-dot" />
      {online ? (SANDBOX ? 'Sandbox · this browser' : 'Registry connected') : 'Registry unreachable'}
    </span>
  );
  const navButton = (n: { id: Page; name: string; icon: ReactNode }) => (
    <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}>
      {n.icon}
      <span>{n.name}</span>
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="org-switch">
          <div className="org-mark">{ws.profile.name.slice(0, 1)}</div>
          <div className="org-text">
            <div className="org-name">{ws.profile.name}</div>
            <div className="org-sub"><span className={`mode ${badge.toLowerCase()}`}>{badge}</span>{ws.accessLabel && <span className="muted">{ws.accessLabel}</span>}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          {work.map(navButton)}
          {tools.length > 0 && (
            <>
              <div className="nav-label">Demo tools</div>
              {tools.map(navButton)}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          {status}
          {ws.reset && <button className="btn plain small muted-btn" disabled={actions.busy('reset')} aria-busy={actions.busy('reset')} onClick={reset}><IconReset /> <span>Reset demo</span></button>}
          <button className="btn plain small" onClick={onSignOut}><IconLogout /> <span>Sign out</span></button>
          <div className="powered"><img src="favicon.svg" alt="" /> Gaskiyya bank console</div>
        </div>
      </aside>
      <header className="topbar">
        <div className="org-switch compact">
          <div className="org-mark">{ws.profile.name.slice(0, 1)}</div>
          <div className="org-text">
            <div className="org-name">{ws.profile.name}</div>
            <div className="org-sub"><span className={`mode ${badge.toLowerCase()}`}>{badge}</span></div>
          </div>
        </div>
        {ws.reset && <button className="icon-btn" aria-label="Reset demo" disabled={actions.busy('reset')} aria-busy={actions.busy('reset')} onClick={reset}><IconReset /></button>}
        <button className="icon-btn" aria-label="Sign out" onClick={onSignOut}><IconLogout /></button>
      </header>
      <main>
        {page === 'overview' && <OverviewPage ws={ws} metrics={metrics} events={events} go={setPage} onSignedOut={onExpired} />}
        {page === 'fraud' && <FraudDeskPage ws={ws} notify={notify} onSignedOut={onExpired} />}
        {page === 'integration' && <IntegrationPage ws={ws} onSignedOut={onExpired} />}
        {page === 'organisation' && <OrganisationPage ws={ws} />}
        {page === 'activity' && <ActivityPage ws={ws} onSignedOut={onExpired} />}
        {demo && page === 'customers' && (
          <CustomersPage
            config={config}
            notify={notify}
            onCalled={(c) => {
              setPhone(c.phone);
              setPlaced(c);
              setPage('calls');
            }}
            onOpen={(p) => {
              setPhone(p);
              setPage('messages');
            }}
          />
        )}
        {demo && page === 'messages' && <MessagesPage config={config} phone={phone} setPhone={setPhone} notify={notify} />}
        {demo && page === 'calls' && <CallsPage config={config} phone={phone} setPhone={setPhone} notify={notify} placed={placed} />}
        {demo && page === 'transfers' && <TransfersPage config={config} notify={notify} />}
        {demo && page === 'ussd' && <UssdPage config={config} phone={phone} setPhone={setPhone} />}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {[...work, ...tools].map((n) => (
          <button key={n.id} className={page === n.id ? 'on' : ''} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}>
            {n.icon}
            <span>{n.name}</span>
          </button>
        ))}
      </nav>
      {toast}
    </div>
  );
}

const showPhone = (p: string) => p.replace(/^(\+\d{3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4');
const NoPhone = () => (
  <div className="card">
    <Empty icon={<IconPhone />} title="No customer picked">Pick a customer, or type their number, to see their phone.</Empty>
  </div>
);

// Whether this number is signed in to the real Gaskiyya app.
function useAppUser(phone: string) {
  const [recent] = usePoll(() => sim.recentCustomers(), 4000);
  return Boolean(phone && recent?.customers.some((c) => c.phone === phone));
}

function People({ phone, setPhone, except }: { phone: string; setPhone: (p: string) => void; except?: string }) {
  const [recent] = usePoll(() => sim.recentCustomers(), 3000);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const all = recent?.customers ?? [];
  const appUsers = all.filter((c) => c.phone !== except);
  const typedOnly = phone && !appUsers.some((c) => c.phone === phone) ? phone : null;
  useEffect(() => {
    if (!phone && appUsers[0]) setPhone(appUsers[0].phone);
  }, [phone, appUsers[0]?.phone]);
  const use = (e: FormEvent) => {
    e.preventDefault();
    const p = normalisePhone(typed);
    setBad(!p);
    if (p) {
      setPhone(p);
      setTyped('');
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="people-label">
        <span>App users</span>
        {appUsers.length > 0 && <span className="muted small">{appUsers.length}</span>}
      </div>
      {!recent ? (
        <div className="skel-grid" role="status" aria-label="Loading app users">
          {[0, 1, 2].map((i) => (
            <div className="skel-tile" key={i}>
              <Skeleton w={36} h={36} r={999} />
              <div className="skel-lines"><Skeleton w="80%" h={13} /></div>
            </div>
          ))}
        </div>
      ) : appUsers.length === 0 && !typedOnly ? (
        <Empty icon={<IconUsers />} title={all.length ? 'No one else has signed in to the app yet' : 'No one has signed in to the app yet'}>
          People who sign in to the Gaskiyya app appear here.
        </Empty>
      ) : (
        <div className="people">
          {typedOnly && (
            <button className="person on" onClick={() => setPhone(typedOnly)}>
              <span className="avatar app">#</span>
              <span>
                <div className="person-name">Typed number</div>
                <div className="person-phone">{showPhone(typedOnly)}</div>
              </span>
            </button>
          )}
          {appUsers.map((c) => (
            <button key={c.phone} className={`person ${c.phone === phone ? 'on' : ''}`} aria-pressed={c.phone === phone} onClick={() => setPhone(c.phone)}>
              <span className="avatar app">{c.phone.slice(-2)}</span>
              <span>
                <div className="person-name">{showPhone(c.phone)}</div>
                <div className="person-phone">{ago(c.lastSeenAt)}</div>
              </span>
            </button>
          ))}
        </div>
      )}
      <form className="row" onSubmit={use} style={{ gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setBad(false); }}
          placeholder="Or type a number"
          inputMode="tel"
          aria-label="Type a phone number to send to"
          aria-invalid={bad}
        />
        <button className="btn secondary" type="submit" disabled={!typed.trim()}>Use</button>
      </form>
      {bad && <p className="small" style={{ margin: 0, color: 'var(--red)' }}>Enter a Nigerian mobile number, or an international one starting with +.</p>}
    </div>
  );
}

type MessageMode = 'genuine' | 'tampered' | 'scam' | 'credit_alert';

function MessagesPage({ config, phone, setPhone, notify }: { config: SimConfig; phone: string; setPhone: (p: string) => void; notify: (s: string) => void }) {
  const isAppUser = useAppUser(phone);
  const [mode, setMode] = useState<MessageMode>('genuine');
  const [category, setCategory] = useState('transaction_alert');
  const draft = (c: string, p: string) => genuineTemplate(c as Category, config.bank.name, p, new Date(), config.bank.domain).text;
  const [text, setText] = useState(() => draft('transaction_alert', phone));
  const [edited, setEdited] = useState(false);
  const choose = (c: string) => {
    setCategory(c);
    setText(draft(c, phone));
    setEdited(false);
  };
  useEffect(() => {
    if (!edited) setText(draft(category, phone));
  }, [phone]);
  const { run, busy } = useActions((e) => notify(e.message));
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [inbox, reload] = usePoll(() => sim.inbox(phone), 2000, [phone]);
  const lastGenuine = (inbox?.items ?? []).find((i) => i.kind === 'genuine');
  const modes: Scenario<MessageMode>[] = [
    { id: 'genuine', label: 'Genuine', hint: 'Registered, then sent.' },
    { id: 'tampered', label: 'Tampered copy', hint: 'One character changed.', fraud: true },
    { id: 'scam', label: 'Scam text', hint: 'Lookalike link or number.', fraud: true },
    { id: 'credit_alert', label: 'Fake credit alert', hint: '"I have paid you."', fraud: true },
  ];

  const send = () =>
    run('send', async () => {
      if (mode === 'genuine') {
        const r = await sim.send(phone, category, text.trim() || undefined);
        setLastMs(r.registrationMs);
        if (r.simSwapWarning) notify('SIM changed recently: a real gateway would hold this code (simSwapWarning)');
        else notify('Registered and sent');
        setText(draft(category, phone));
        setEdited(false);
      } else if (mode === 'tampered') {
        await sim.sendTampered(phone, lastGenuine?.id);
        notify('Tampered copy sent');
      } else if (mode === 'scam') {
        await sim.sendFake(phone, Math.floor(Math.random() * 4));
        notify('Scam text sent');
      } else {
        await sim.sendFake(phone, 'credit_alert');
        notify('Fake credit alert sent');
      }
      reload();
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p>Send a genuine message or a fake one.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Recipient</h3>
            <People phone={phone} setPhone={setPhone} />
          </div>

          <div className="card stack">
            <h2>New message</h2>
            <Scenarios label="Message to send" value={mode} options={modes} onChange={setMode} />
            {mode === 'genuine' ? (
              <>
                <div className="chips" role="group" aria-label="Message type">
                  {config.categories.map((c) => (
                    <button key={c} className={`chip ${category === c ? 'on' : ''}`} aria-pressed={category === c} onClick={() => choose(c)} title={category === c ? 'Another example' : undefined}>
                      {label(copy.categories, c)}
                    </button>
                  ))}
                </div>
                <textarea
                  aria-label="Message text"
                  placeholder="Pick a message type above, or write your own"
                  value={text}
                  rows={6}
                  onChange={(e) => {
                    setText(e.target.value);
                    setEdited(true);
                  }}
                />
              </>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                {mode === 'tampered' ? <>For example, <span className="mono">demobank.ng</span> becomes <span className="mono">demo-bank.ng</span>.</> : 'The customer sees it as not confirmed.'}
              </p>
            )}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted small">
                {mode !== 'genuine' ? 'Not registered with Gaskiyya' : lastMs !== null ? <>Searchable in <b>{lastMs} ms</b></> : 'Registration target: under 2 seconds'}
              </span>
              <button className={`btn ${mode === 'genuine' ? '' : 'danger'}`} disabled={busy('send') || !phone || (mode === 'genuine' && !text.trim())} aria-busy={busy('send')} onClick={send}>
                {mode === 'genuine' ? <IconSend /> : mode === 'tampered' ? <IconScissors /> : <IconWarning />} Send
              </button>
            </div>
          </div>

          {config.simSwap && phone ? <SimSwapCard phone={phone} notify={notify} /> : null}
        </div>

        {phone ? <Device key={phone} phone={phone} bank={config.bank.name} bankId={config.bank.id} realPhone={isAppUser} /> : <NoPhone />}
      </div>
    </div>
  );
}

function SimSwapCard({ phone, notify }: { phone: string; notify: (s: string) => void }) {
  const [answer, setAnswer] = useState<SimSwapAnswer | null>(null);
  // The three actions change or read one SIM, so each waits for the others.
  const { run, busy, busyOn } = useActions((e) => notify(e.message));
  useEffect(() => setAnswer(null), [phone]);
  const verdict =
    answer?.status === 'swapped'
      ? { tone: 'red', says: 'SIM changed recently: hold the one-time code' }
      : answer?.status === 'not_swapped'
        ? { tone: 'green', says: 'No SIM change reported in the last 24 hours' }
        : answer
          ? { tone: 'orange', says: 'The network could not answer: treat as risky' }
          : null;
  return (
    <div className="card stack">
      <div>
        <h2>SIM swap</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          A fraudster talks the mobile network into moving the customer&apos;s number to a new SIM, and starts receiving their one-time codes. The bank asks first.
        </p>
      </div>
      <div className="row">
        <button className="btn danger" disabled={busyOn('')} aria-busy={busy('swap')} onClick={() => run('swap', async () => { await sim.simSwap(phone, 'swap'); setAnswer(null); notify('SIM swapped on the simulated network'); })}>
          <IconWarning /> Swap the SIM
        </button>
        <button className="btn secondary" disabled={busyOn('')} aria-busy={busy('restore')} onClick={() => run('restore', async () => { await sim.simSwap(phone, 'restore'); setAnswer(null); notify('Original SIM restored'); })}>
          Restore SIM
        </button>
        <button className="btn" disabled={busyOn('')} aria-busy={busy('check')} onClick={() => run('check', async () => setAnswer(await sim.simSwapCheck(phone, 24)))}>
          Check SIM before OTP
        </button>
      </div>
      {answer && verdict ? (
        <div role="status" aria-live="polite" className="stack" style={{ gap: 6 }}>
          <span className={`tag ${verdict.tone}`} style={{ alignSelf: 'flex-start' }}>{verdict.says}</span>
          <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{`POST /v1/sim-swap/check\n${JSON.stringify(answer, null, 2)}`}</pre>
        </div>
      ) : null}
    </div>
  );
}

function Countdown({ expiresAt, total }: { expiresAt: string; total: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  const frac = Math.min(1, left / total);
  const C = 2 * Math.PI * 42;
  return (
    <svg className="ring" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="42" fill="none" stroke="var(--fill)" strokeWidth="6" />
      <circle cx="48" cy="48" r="42" fill="none" stroke="var(--blue)" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 48 48)" />
      <text x="48" y="54" textAnchor="middle" fontSize="18" fontWeight="600" fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </text>
    </svg>
  );
}

type CallMode = 'announce' | 'spoof';

const liveCall = (c: Call) => c.status !== 'ended' && Date.parse(c.expiresAt) > Date.now();

function CallsPage({ config, phone, setPhone, notify, placed }: { config: SimConfig; phone: string; setPhone: (p: string) => void; notify: (s: string) => void; placed?: Call | null }) {
  const isAppUser = useAppUser(phone);
  const [mode, setMode] = useState<CallMode>('announce');
  const [purpose, setPurpose] = useState(placed?.purpose ?? config.purposes[0]!);
  const [calls, reload] = usePoll(() => sim.calls(), 1500);
  // The call just placed, shown until the next poll lists it.
  const [fresh, setFresh] = useState<Call | null>(placed ?? null);
  const [number, setNumber] = useState<string | null>(null);
  useEffect(() => {
    void officialBankNumber(config.bank.name).then(setNumber);
  }, [config.bank.name]);
  // One open session per customer: the agent screen follows the selected number's session.
  const listed = calls?.calls.find((c) => c.phone === phone && liveCall(c)) ?? null;
  const open = listed ?? (fresh && fresh.phone === phone && liveCall(fresh) && !calls?.calls.some((c) => c.id === fresh.id) ? fresh : null);

  const { run, busy, busyOn } = useActions((e) => notify(e.message));
  const modes: Scenario<CallMode>[] = [
    { id: 'announce', label: `${config.bank.name} calls`, hint: 'The app shows a code first.' },
    { id: 'spoof', label: 'Fraudster calls', hint: 'Spoofs the bank\u2019s number.', fraud: true },
  ];
  const place = () =>
    run('place', async () => {
      if (mode === 'announce') {
        setFresh({ ...(await sim.openCall(phone, purpose)), phone });
        notify('Call announced. The customer\u2019s app now shows the code.');
      } else {
        await sim.fraudCall(phone, number ?? '');
        notify(`The phone is ringing from ${config.bank.name}\u2019s number. No call is announced.`);
      }
      reload();
    });
  // Answered and End call act on the same call, so each waits for the other.
  const update = (status: 'answered' | 'ended') =>
    run(`call:${status}`, async () => {
      if (!open) return;
      await sim.updateCall(open.id, status);
      if (status === 'ended') setFresh(null);
      reload();
      notify(status === 'ended' ? 'Call ended. Session closed.' : 'Call answered');
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p>Announce a genuine call or place a spoofed one.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Customer</h3>
            <People phone={phone} setPhone={setPhone} />
          </div>
          <div className="card stack">
            <h2>New call</h2>
            <Scenarios label="Call to make" value={mode} options={modes} onChange={setMode} />
            {mode === 'announce' ? (
              <div className="chips" role="group" aria-label="Call purpose">
                {config.purposes.map((p) => (
                  <button key={p} className={`chip ${purpose === p ? 'on' : ''}`} aria-pressed={purpose === p} onClick={() => setPurpose(p)}>
                    {label(copy.purposes, p)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Calls from {number ? <span className="mono">{number}</span> : `${config.bank.name}\u2019s number`}. The app says {config.bank.name} is not calling.
              </p>
            )}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted small">{open ? 'A call to this customer is open. End it first.' : mode === 'announce' ? 'One open call per customer at a time' : 'Not announced to Gaskiyya'}</span>
              <button className={`btn ${mode === 'announce' ? '' : 'danger'}`} onClick={place} disabled={busy('place') || Boolean(open) || !phone} aria-busy={busy('place')}>
                <IconPhone /> {mode === 'announce' ? 'Announce and call' : 'Call from the bank\u2019s number'}
              </button>
            </div>
          </div>
          <div className="card code-card">
            <h3 style={{ position: 'relative' }}>Agent screen</h3>
            {open ? (
              <>
                <div className="muted small" style={{ position: 'relative' }}>Read this code to the customer</div>
                <div className="code-digits">
                  {open.code.split('').map((d, i) => <div className="digit" key={`${open.id}${i}`}>{d}</div>)}
                </div>
                {open.status === 'open' && <Countdown expiresAt={open.expiresAt} total={180} />}
                {open.status === 'answered' && <span className="tag green"><IconCheck style={{ width: 14 }} /> In call</span>}
                <div className="row" style={{ justifyContent: 'center', marginTop: 18, position: 'relative' }}>
                  {open.status === 'open' && <button className="btn secondary" disabled={busyOn('call:')} aria-busy={busy('call:answered')} onClick={() => update('answered')}>Answered</button>}
                  <button className="btn danger" disabled={busyOn('call:')} aria-busy={busy('call:ended')} onClick={() => update('ended')}>End call</button>
                </div>
              </>
            ) : (
              <div className="empty" style={{ padding: '40px 10px' }}>
                <IconPhone />
                <div>No active call</div>
                <div className="small">Announce a call to see the session code.</div>
              </div>
            )}
          </div>
          <div className="card">
            <h3>Recent sessions</h3>
            {!calls && <SkeletonRows rows={2} label="Loading recent sessions" />}
            {calls?.calls.length === 0 && <p className="muted small" style={{ margin: 0 }}>No calls yet.</p>}
            {(calls?.calls ?? []).map((c) => (
              <div className="kbd-row" key={c.id}>
                <span>
                  <b>{showPhone(c.phone)}</b>
                  <span className="muted small"> · {label(copy.purposes, c.purpose)} · {timeOf(c.openedAt)}</span>
                </span>
                <span className={`tag ${c.status === 'ended' ? '' : Date.parse(c.expiresAt) > Date.now() ? 'blue' : ''}`}>
                  {Date.parse(c.expiresAt) <= Date.now() && c.status === 'open' ? 'expired' : c.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {phone ? <Device key={phone} phone={phone} bank={config.bank.name} bankId={config.bank.id} realPhone={isAppUser} /> : <NoPhone />}
      </div>
    </div>
  );
}

const nairaText = (kobo: number) => `NGN${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const groupSession = (s: string) => s.replace(/(.{6})(.{6})(.{6})(.{6})(.*)/, '$1 $2 $3 $4 $5');
const KIND_LABEL: Record<Transfer['kind'], string> = { genuine: 'Genuine', fake_amount: 'Fake: amount changed', fake_reference: 'Fake: made-up session ID' };
const VERDICT_TAG: Record<string, string> = { received: 'green', not_confirmed: 'red', cannot_check: 'orange' };

type ReceiptMode = 'genuine' | 'fake_amount' | 'fake_reference';

function TransfersPage({ config, notify }: { config: SimConfig; notify: (s: string) => void }) {
  const [payer, setPayer] = useState('');
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('25000');
  const [mode, setMode] = useState<ReceiptMode>('genuine');
  const [checkNow, setCheckNow] = useState(true);
  const { run, busy } = useActions((e) => notify(e.message));
  const [selected, setSelected] = useState<string | null>(null);
  const [list, reload] = usePoll(() => sim.transfers(), 2000);
  const transfers = list?.transfers ?? [];
  const shown = transfers.find((t) => t.id === selected) ?? transfers[0] ?? null;
  const receipt = copy.receipt.verdict;
  const kobo = Math.round(Number(amount.replace(/,/g, '')) * 100);
  // An altered receipt starts from a real payment of a tenth of the amount, which must itself be at least NGN1.
  const amountOk = Number.isSafeInteger(kobo) && kobo >= (mode === 'fake_amount' ? 1000 : 100) && kobo <= 100_000_000_000;
  const paidPart = Math.round(kobo / 10);
  const modes: Scenario<ReceiptMode>[] = [
    { id: 'genuine', label: 'Genuine', hint: 'Paid and registered.' },
    { id: 'fake_amount', label: 'Amount altered', hint: 'Pays a tenth, shows the full amount.', fraud: true },
    { id: 'fake_reference', label: 'Made-up session ID', hint: 'Nothing paid or registered.', fraud: true },
  ];
  const verdictOf = (t: Transfer) => receipt[t.check?.verdict ?? 'cannot_check'].title;

  const check = (t: Transfer) =>
    run(`check:${t.id}`, async () => {
      const r = (await sim.checkReceipt(t.id)).transfer;
      setSelected(r.id);
      reload();
      notify(`Merchant's check: ${verdictOf(r)}`);
    });
  const submit = () =>
    run('submit', async () => {
      let t: Transfer;
      let done: string;
      if (mode === 'genuine') {
        t = (await sim.pay(payer, merchant, kobo)).transfer;
        done = t.registered ? 'Paid. Receipt registered.' : 'Paid, but the receipt was not stored';
      } else if (mode === 'fake_amount') {
        const paid = (await sim.pay(payer, merchant, paidPart)).transfer;
        t = (await sim.fakeReceipt('fake_amount', paid.id)).transfer;
        done = `Paid ${nairaText(paid.amountKobo)}; the receipt now shows ${nairaText(t.amountKobo)}`;
      } else {
        t = (await sim.forgeReceipt(payer, merchant, kobo)).transfer;
        done = 'Fake receipt made. Nothing was paid or registered.';
      }
      if (checkNow) {
        t = (await sim.checkReceipt(t.id)).transfer;
        done = `${done} Merchant's check: ${verdictOf(t)}.`;
      }
      setSelected(t.id);
      reload();
      notify(done);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Transfers</h1>
          <p>Pay a merchant, then check the receipt.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card stack">
            <h2>New transfer</h2>
            <Scenarios label="Receipt to make" value={mode} options={modes} onChange={setMode} />
            <div>
              <h3>Payer</h3>
              <People phone={payer} setPhone={(p) => { setPayer(p); if (p === merchant) setMerchant(''); }} />
            </div>
            <div>
              <h3>Merchant</h3>
              <People phone={merchant} setPhone={setMerchant} except={payer} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="money small muted">
                Amount (NGN)
                <input aria-label="Amount in naira" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} />
              </label>
              <div className="chips" role="group" aria-label="Quick amounts">
                {['5000', '25000', '250000'].map((v) => (
                  <button key={v} type="button" className={`chip ${amount === v ? 'on' : ''}`} onClick={() => setAmount(v)}>{Number(v).toLocaleString()}</button>
                ))}
              </div>
            </div>
            {mode === 'fake_amount' && amountOk && (
              <p className="muted small" style={{ margin: 0 }}>Pays {nairaText(paidPart)}, receipt shows {nairaText(paidPart * 10)}.</p>
            )}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="toggle-line">
                <input type="checkbox" checked={checkNow} onChange={(e) => setCheckNow(e.target.checked)} />
                Check it right away
              </label>
              <button
                className={`btn ${mode === 'genuine' ? '' : 'danger'}`}
                disabled={busy('submit') || !amountOk || !payer || !merchant || payer === merchant}
                aria-busy={busy('submit')}
                onClick={submit}
              >
                {mode === 'genuine' ? <><IconSend /> Pay and register</> : mode === 'fake_amount' ? <><IconScissors /> Pay {nairaText(paidPart)}, show {nairaText(paidPart * 10)}</> : <><IconWarning /> Make the fake receipt</>}
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Receipts</h3>
            {!list && <SkeletonRows rows={2} label="Loading receipts" />}
            {list && transfers.length === 0 && <p className="muted small" style={{ margin: 0 }}>No transfers yet.</p>}
            {transfers.map((t) => (
              <div className="kbd-row" key={t.id} onClick={() => setSelected(t.id)} style={{ cursor: 'pointer', background: shown?.id === t.id ? 'var(--fill-2)' : undefined }}>
                <span>
                  <b>{nairaText(t.amountKobo)}</b>
                  <span className="muted small"> &middot; {showPhone(t.payer)} to {showPhone(t.merchant)} &middot; {timeOf(t.at)}</span>
                  <div className="small mono muted">{groupSession(t.reference)}</div>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className={`tag ${t.kind === 'genuine' ? 'blue' : 'red'}`}>{KIND_LABEL[t.kind]}</span>
                  {t.check ? (
                    <span className={`tag ${VERDICT_TAG[t.check.verdict] ?? 'orange'}`}>{receipt[t.check.verdict]?.short ?? receipt.cannot_check.short}</span>
                  ) : (
                    <button className="btn plain small" disabled={busy(`check:${t.id}`)} aria-busy={busy(`check:${t.id}`)} onClick={(e) => { e.stopPropagation(); void check(t); }}>
                      <IconCheck /> Merchant checks
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card receipt-card">
          <h3>Receipt the buyer shows</h3>
          {shown ? (
            <>
              <div className="receipt-amount">{nairaText(shown.amountKobo)}</div>
              <div className="muted small">Transfer successful</div>
              <dl className="receipt-fields">
                <dt>From</dt><dd>{showPhone(shown.payer)}</dd>
                <dt>To</dt><dd>{showPhone(shown.merchant)}, {config.bank.name}</dd>
                <dt>Account</dt><dd className="mono">{shown.account}</dd>
                <dt>Session ID</dt><dd className="mono">{groupSession(shown.reference)}</dd>
                <dt>Date</dt><dd>{shown.valueDate}</dd>
              </dl>
              <span className={`tag ${shown.kind === 'genuine' ? 'blue' : 'red'}`}>{KIND_LABEL[shown.kind]}{shown.registered ? ' \u00b7 registered' : ' \u00b7 not registered'}</span>
              {shown.check ? (
                <div className={`receipt-verdict ${VERDICT_TAG[shown.check.verdict] ?? 'orange'}`}>
                  <b>{receipt[shown.check.verdict].title}</b>
                  <div className="small">
                    {shown.check.verdict === 'received'
                      ? `${shown.check.paidFrom ?? ''} registered this payment at ${shown.check.registeredAt ? timeOf(shown.check.registeredAt) : ''}.`
                      : shown.check.verdict === 'not_confirmed'
                        ? 'No registered payment matches. The merchant should check their balance before releasing goods.'
                        : 'The registry could not be reached. The merchant should check their balance.'}
                  </div>
                </div>
              ) : (
                <button className="btn" style={{ marginTop: 14 }} disabled={busy(`check:${shown.id}`)} aria-busy={busy(`check:${shown.id}`)} onClick={() => void check(shown)}>
                  <IconCheck /> Merchant checks this receipt
                </button>
              )}
            </>
          ) : (
            <div className="empty" style={{ padding: '40px 10px' }}>
              <IconSend />
              <div>No receipt yet</div>
              <div className="small">Pay a merchant to see the receipt and check it.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UssdPage({ config, phone, setPhone }: { config: SimConfig; phone: string; setPhone: (p: string) => void }) {
  const [hops, setHops] = useState<(UssdHop & { key: number })[]>([]);
  useEffect(() => setHops([]), [phone]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>USSD</h1>
          <p>
            Customers without a smartphone or data dial <span className="mono">{config.ussdCode}</span> to ask whether {config.bank.name} is calling them, and what it sent them today.
          </p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Customer</h3>
            <People phone={phone} setPhone={setPhone} />
          </div>
          <div className="card stack">
            <div>
              <h2>How it works</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                The mobile network tells Gaskiyya which number is dialling, so the customer only ever sees calls and messages bound to their own number. Message
                text is never stored, so the list shows the type, channel and time only. Announce a call on the Calls page or send a message on the Messages page, then dial.
              </p>
            </div>
            <div className="kbd-row"><span>1. Is my bank calling me?</span><span className="muted small">Call code and purpose</span></div>
            <div className="kbd-row"><span>2. Messages my bank sent me today</span><span className="muted small">Type, channel and time</span></div>
            <div className="kbd-row"><span>3. Is this number my bank's?</span><span className="muted small">Official number or not</span></div>
            <div className="kbd-row"><span>9. More, then 4. Is a lender licensed?</span><span className="muted small">Type a lender or loan app name; 0 goes back</span></div>
          </div>
          <div className="card">
            <h3>Callback traffic</h3>
            {hops.length === 0 && <p className="muted small" style={{ margin: 0 }}>Each key press that sends is one POST to <span className="mono">/webhooks/ussd</span>. The replies appear here.</p>}
            <div className="ussd-log">
              {hops.map((h) => (
                <div className="ussd-hop" key={h.key}>
                  <div className="meta">
                    <span>text=<span className="mono">{h.text === '' ? '(empty)' : h.text}</span></span>
                    <span>{h.reply.length} chars</span>
                  </div>
                  <div className="mono">{h.reply}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {phone ? <FeaturePhone phone={phone} code={config.ussdCode} onHop={(h) => setHops((list) => [{ ...h, key: Math.random() }, ...list].slice(0, 8))} /> : <NoPhone />}
      </div>
    </div>
  );
}
