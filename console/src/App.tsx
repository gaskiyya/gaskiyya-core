import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import copy from '../../packages/schemas/copy.json';
import { sim, type Call, type Campaign, type Metrics, type Organisation, type RegistrationAlert, type SimConfig, type SimSwapAnswer, type Transfer } from './api.ts';
import { fill, type Category, type LicenceResult } from '@gaskiya/schemas';
import { genuineTemplate } from '../../packages/api/src/simulator/demo-data.ts';
import { device, normalisePhone, type ContactCheck } from './device/api.ts';
import { Device, officialBankNumber } from './device/Device.tsx';
import { FeaturePhone, type UssdHop } from './ussd/FeaturePhone.tsx';
import {
  IconBadge,
  IconChart,
  IconCheck,
  IconKeypad,
  IconMessage,
  IconPhone,
  IconReset,
  IconScissors,
  IconSend,
  IconShield,
  IconSpark,
  IconTransfer,
  IconWarning,
} from './icons.tsx';

type Page = 'messages' | 'calls' | 'transfers' | 'ussd' | 'contacts' | 'licence' | 'fraud' | 'overview';

const SANDBOX = __SANDBOX__;

const label = (map: Record<string, string>, key: string) => {
  const s = map[key] ?? key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const initials = (name: string) => name.split(' ').map((p) => p[0]).join('').slice(0, 2);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const PALETTE = ['linear-gradient(160deg,#ff9f0a,#ff375f)', 'linear-gradient(160deg,#64d2ff,#0a7aff)', 'linear-gradient(160deg,#bf5af2,#5e5ce6)'];

function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []): [T | null, () => void, boolean] {
  const [data, setData] = useState<T | null>(null);
  const [ok, setOk] = useState(true);
  const ref = useRef(fn);
  ref.current = fn;
  const load = useCallback(() => {
    ref.current().then((d) => (setData(d), setOk(true))).catch(() => setOk(false));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [ms, load, ...deps]);
  return [data, load, ok];
}

function useToast(): [ReactNode, (s: string) => void] {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast" key={msg.key}>{msg.text}</div> : null, (text) => setMsg({ text, key: Date.now() })];
}

interface LiveEvent {
  key: number;
  at: Date;
  tone: 'green' | 'orange' | 'red' | 'blue';
  text: string;
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

export function App() {
  const [page, setPage] = useState<Page>('messages');
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [phone, setPhone] = useState<string>('');
  const [toast, notify] = useToast();
  const [metrics, reloadMetrics, online] = usePoll(() => sim.metrics(), 2000);
  const events = useLiveEvents(metrics);
  const seen = useRef(0);

  useEffect(() => {
    sim.config().then((c) => {
      setConfig(c);
      setPhone(c.customers[0]!.phone);
    }).catch(() => notify('Cannot reach the bank simulator'));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    const e = events[0];
    if (e && e.key !== seen.current && !e.text.includes('registered')) notify(e.text);
    if (e) seen.current = e.key;
  }, [events]);

  const nav: { id: Page; name: string; icon: ReactNode }[] = [
    { id: 'messages', name: 'Messages', icon: <IconMessage /> },
    { id: 'calls', name: 'Calls', icon: <IconPhone /> },
    { id: 'transfers', name: 'Transfers', icon: <IconTransfer /> },
    { id: 'ussd', name: 'USSD', icon: <IconKeypad /> },
    { id: 'contacts', name: 'Contacts', icon: <IconCheck /> },
    { id: 'licence', name: 'Licence check', icon: <IconBadge /> },
    { id: 'fraud', name: 'Fraud desk', icon: <IconShield /> },
    { id: 'overview', name: 'Overview', icon: <IconChart /> },
  ];

  const reset = async () => {
    if (!confirm('Reset all demo data in the registry and the simulator?')) return;
    await sim.reset();
    reloadMetrics();
    notify('Reset');
  };

  const status = (
    <span className={`live-pill ${online ? '' : 'off'}`}>
      <span className="status-dot" />
      {online ? (SANDBOX ? 'Sandbox \u00b7 this browser' : 'Registry live') : 'Registry unreachable'}
    </span>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="favicon.svg" alt="" />
          <div>
            <div className="brand-name">Gaskiyya</div>
            <div className="brand-sub">Bank sandbox console</div>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          {nav.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}>
              {n.icon}
              <span>{n.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {status}
          <button className="btn plain small" onClick={reset}>
            <IconReset /> Reset
          </button>
        </div>
      </aside>
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="favicon.svg" alt="" />
          <div className="brand-name">{config?.bank.name ?? 'Gaskiyya'}</div>
        </div>
        {status}
        <button className="icon-btn" aria-label="Reset" onClick={reset}><IconReset /></button>
      </header>
      <main>
        {SANDBOX && (
          <p className="sandbox-note">
            <b>Live sandbox.</b> DemoBank and the Gaskiyya registry run in this browser tab, with the registry's own code. Nothing leaves your device; reload to start fresh.
          </p>
        )}
        {config && page === 'messages' && <MessagesPage config={config} phone={phone} setPhone={setPhone} notify={notify} />}
        {config && page === 'calls' && <CallsPage config={config} phone={phone} setPhone={setPhone} notify={notify} />}
        {config && page === 'transfers' && <TransfersPage config={config} notify={notify} />}
        {config && page === 'ussd' && <UssdPage config={config} phone={phone} setPhone={setPhone} />}
        {config && page === 'contacts' && <ContactsPage config={config} phone={phone} setPhone={setPhone} notify={notify} />}
        {config && page === 'licence' && <LicencePage config={config} phone={phone} setPhone={setPhone} />}
        {config && page === 'fraud' && <FraudPage notify={notify} />}
        {config && page === 'overview' && <OverviewPage metrics={metrics} events={events} />}
        {!config && (
          <div className="card empty">
            <IconWarning />
            <h2>Connecting to the bank simulator</h2>
            <p className="small">Start it with <span className="mono">pnpm dev</span>.</p>
          </div>
        )}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {nav.map((n) => (
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
const nameOf = (config: SimConfig, phone: string) => config.customers.find((c) => c.phone === phone)?.name ?? phone;

function People({ config, phone, setPhone }: { config: SimConfig; phone: string; setPhone: (p: string) => void }) {
  const [recent] = usePoll(() => sim.recentCustomers(), 3000);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const demo = new Set(config.customers.map((c) => c.phone));
  const others = (recent?.customers ?? []).map((c) => c.phone).filter((p) => !demo.has(p));
  if (phone && !demo.has(phone) && !others.includes(phone)) others.unshift(phone);
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
      <div className="people">
        {config.customers.map((c, i) => (
          <button key={c.phone} className={`person ${c.phone === phone ? 'on' : ''}`} onClick={() => setPhone(c.phone)}>
            <span className="avatar" style={{ background: PALETTE[i % PALETTE.length] }}>{initials(c.name)}</span>
            <span>
              <div className="person-name">{c.name}</div>
              <div className="person-phone">{showPhone(c.phone)}</div>
            </span>
          </button>
        ))}
      </div>
      {others.length > 0 && (
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>Signed in to Gaskiyya</div>
          <div className="chips">
            {others.map((p) => (
              <button key={p} className={`chip mono ${p === phone ? 'on' : ''}`} aria-pressed={p === phone} onClick={() => setPhone(p)}>{showPhone(p)}</button>
            ))}
          </div>
        </div>
      )}
      <form className="row" onSubmit={use} style={{ gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setBad(false); }}
          placeholder="Or type a number, e.g. 0803 123 4567"
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

function MessagesPage({ config, phone, setPhone, notify }: { config: SimConfig; phone: string; setPhone: (p: string) => void; notify: (s: string) => void }) {
  const [category, setCategory] = useState('transaction_alert');
  const orgs = config.orgs ?? [{ id: config.bank.id, name: config.bank.name, kind: 'bank' as const }];
  const [org, setOrg] = useState(orgs[0]!.id);
  const asOther = org !== config.bank.id;
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
  const [busy, setBusy] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [inbox, reload] = usePoll(() => sim.inbox(phone), 2000, [phone]);
  const items = inbox?.items ?? [];
  const lastGenuine = items.find((i) => i.kind === 'genuine');
  const customer = config.customers.find((c) => c.phone === phone);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      reload();
      notify(done);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p>Register and send messages as {config.bank.name}'s notification service would.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Recipient</h3>
            <People config={config} phone={phone} setPhone={setPhone} />
          </div>

          <div className="card stack">
            <div>
              <h2>Send a genuine message</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                The simulator registers a fingerprint with Gaskiyya first, then hands the message to the SMS gateway. No text is stored.
              </p>
            </div>
            {orgs.length > 1 && (
              <div className="chips" role="group" aria-label="Send as">
                {orgs.map((o) => (
                  <button key={o.id} className={`chip ${org === o.id ? 'on' : ''}`} aria-pressed={org === o.id} onClick={() => setOrg(o.id)}>
                    {o.name}
                  </button>
                ))}
              </div>
            )}
            {asOther ? (
              <p className="muted small" style={{ margin: 0 }}>
                {orgs.find((o) => o.id === org)?.name} is a fictional {orgs.find((o) => o.id === org)?.kind === 'agency' ? 'government agency' : 'company'}. It registers its message exactly as a bank does; leave the text empty to send its sample message.
              </p>
            ) : (
              <div className="chips">
                {config.categories.map((c) => (
                  <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => choose(c)} title={category === c ? 'Another example' : undefined}>
                    {label(copy.categories, c)}
                  </button>
                ))}
              </div>
            )}
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted small">
                {lastMs !== null ? <>Searchable in <b>{lastMs} ms</b></> : 'Registration target: under 2 seconds'}
              </span>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await sim.send(phone, asOther ? 'service_update' : category, (asOther && !edited ? '' : text.trim()) || undefined, asOther ? org : undefined);
                    setLastMs(r.registrationMs);
                    if (r.simSwapWarning) notify('SIM changed recently: a real gateway would hold this code (simSwapWarning)');
                    setText(draft(category, phone));
                    setEdited(false);
                  }, asOther ? `Registered and sent as ${orgs.find((o) => o.id === org)?.name}` : 'Registered and sent')
                }
              >
                <IconSend /> Send
              </button>
            </div>
          </div>

          <div className="card stack">
            <div>
              <h2>Play the fraudster</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>These are never registered, so customers see them as not confirmed.</p>
            </div>
            <div className="row">
              <button className="btn danger" disabled={busy} onClick={() => act(() => sim.sendTampered(phone, lastGenuine?.id), 'Tampered copy sent')}>
                <IconScissors /> Tampered copy{lastGenuine ? '' : ' of a link'}
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => act(() => sim.sendFake(phone, Math.floor(Math.random() * 4)), 'Fake message sent')}>
                <IconWarning /> Fake message
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => act(() => sim.sendFake(phone, 'credit_alert'), 'Fake credit alert sent')}>
                <IconWarning /> Fake credit alert
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              A tampered copy changes one character, for example <span className="mono">demobank.ng</span> becomes{' '}
              <span className="mono">demo-bank.ng</span>.
            </p>
          </div>

          {config.simSwap ? <SimSwapCard phone={phone} name={customer?.name ?? ''} notify={notify} /> : null}
        </div>

        <Device key={phone} phone={phone} name={nameOf(config, phone)} bank={config.bank.name} bankId={config.bank.id} />
      </div>
    </div>
  );
}

function SimSwapCard({ phone, name, notify }: { phone: string; name: string; notify: (s: string) => void }) {
  const who = name || 'the customer';
  const [answer, setAnswer] = useState<SimSwapAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAnswer(null), [phone]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
          A fraudster talks the mobile network into moving {who}&apos;s number to a new SIM, and starts receiving their one-time codes. The bank asks first.
        </p>
      </div>
      <div className="row">
        <button className="btn danger" disabled={busy} onClick={() => run(async () => { await sim.simSwap(phone, 'swap'); setAnswer(null); notify('SIM swapped on the simulated network'); })}>
          <IconWarning /> Swap the SIM
        </button>
        <button className="btn secondary" disabled={busy} onClick={() => run(async () => { await sim.simSwap(phone, 'restore'); setAnswer(null); notify('Original SIM restored'); })}>
          Restore SIM
        </button>
        <button className="btn" disabled={busy} onClick={() => run(async () => setAnswer(await sim.simSwapCheck(phone, 24)))}>
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

function CallsPage({ config, phone, setPhone, notify }: { config: SimConfig; phone: string; setPhone: (p: string) => void; notify: (s: string) => void }) {
  const [purpose, setPurpose] = useState(config.purposes[0]!);
  const [active, setActive] = useState<Call | null>(null);
  const [calls, reload] = usePoll(() => sim.calls(), 1500);

  useEffect(() => {
    if (!active) return;
    const latest = calls?.calls.find((c) => c.id === active.id);
    if (!latest) return;
    if (latest.status === 'ended') setActive(null);
    else if (latest.status !== active.status) setActive({ ...active, ...latest });
  }, [calls]);

  const place = async () => {
    try {
      const c = await sim.openCall(phone, purpose);
      setActive(c);
      reload();
      notify('Call announced. The customer’s app now shows the code.');
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const update = async (status: 'answered' | 'ended') => {
    if (!active) return;
    const r = await sim.updateCall(active.id, status);
    setActive(status === 'ended' ? null : { ...active, ...r });
    reload();
    notify(status === 'ended' ? 'Call ended. Session closed.' : 'Call answered');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p>Announce an outbound call before dialling. The agent reads the code aloud; the customer compares it in the app.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Customer</h3>
            <People config={config} phone={phone} setPhone={setPhone} />
          </div>
          <div className="card stack">
            <h2>Purpose</h2>
            <div className="chips">
              {config.purposes.map((p) => (
                <button key={p} className={`chip ${purpose === p ? 'on' : ''}`} onClick={() => setPurpose(p)}>
                  {label(copy.purposes, p)}
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={place} disabled={Boolean(active)}>
                <IconPhone /> Announce and call
              </button>
            </div>
          </div>
          <FraudCallCard config={config} phone={phone} announced={Boolean(active) || (calls?.calls ?? []).some((c) => c.phone === phone && c.status !== 'ended' && Date.parse(c.expiresAt) > Date.now())} notify={notify} />
          <div className="card code-card">
            <h3 style={{ position: 'relative' }}>Agent screen</h3>
            {active ? (
              <>
                <div className="muted small" style={{ position: 'relative' }}>Read this code to the customer</div>
                <div className="code-digits">
                  {active.code.split('').map((d, i) => <div className="digit" key={`${active.id}${i}`}>{d}</div>)}
                </div>
                {active.status === 'open' && <Countdown expiresAt={active.expiresAt} total={180} />}
                {active.status === 'answered' && <span className="tag green"><IconCheck style={{ width: 14 }} /> In call</span>}
                <div className="row" style={{ justifyContent: 'center', marginTop: 18, position: 'relative' }}>
                  {active.status === 'open' && <button className="btn secondary" onClick={() => update('answered')}>Answered</button>}
                  <button className="btn danger" onClick={() => update('ended')}>End call</button>
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
            {(calls?.calls ?? []).length === 0 && <p className="muted small" style={{ margin: 0 }}>No calls yet.</p>}
            {(calls?.calls ?? []).map((c) => (
              <div className="kbd-row" key={c.id}>
                <span>
                  <b>{nameOf(config, c.phone)}</b>
                  <span className="muted small"> · {label(copy.purposes, c.purpose)} · {timeOf(c.openedAt)}</span>
                </span>
                <span className={`tag ${c.status === 'ended' ? '' : Date.parse(c.expiresAt) > Date.now() ? 'blue' : ''}`}>
                  {Date.parse(c.expiresAt) <= Date.now() && c.status === 'open' ? 'expired' : c.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <Device key={phone} phone={phone} name={nameOf(config, phone)} bank={config.bank.name} bankId={config.bank.id} />
      </div>
    </div>
  );
}

function FraudCallCard({ config, phone, announced, notify }: { config: SimConfig; phone: string; announced: boolean; notify: (s: string) => void }) {
  const [number, setNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void officialBankNumber(config.bank.name).then(setNumber);
  }, [config.bank.name]);
  const ring = async () => {
    setBusy(true);
    try {
      await sim.fraudCall(phone, number ?? '');
      notify('The phone is ringing from the bank\u2019s number. No call is announced.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack">
      <div>
        <h2>Play the fraudster</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Spoofs caller ID with {config.bank.name}&rsquo;s official number{number ? <> (<span className="mono">{number}</span>)</> : null}. Nothing is announced to the registry, so Gaskiyya on the phone says {config.bank.name} is not calling.
        </p>
      </div>
      <div className="row">
        <button className="btn danger" disabled={busy || announced} onClick={ring} title={announced ? 'End the announced call first' : undefined}>
          <IconPhone /> Fraudster calls from the bank&rsquo;s number
        </button>
      </div>
      {announced && <p className="muted small" style={{ margin: 0 }}>A call to this customer is announced. End it first.</p>}
    </div>
  );
}

const nairaText = (kobo: number) => `NGN${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const groupSession = (s: string) => s.replace(/(.{6})(.{6})(.{6})(.{6})(.*)/, '$1 $2 $3 $4 $5');
const KIND_LABEL: Record<Transfer['kind'], string> = { genuine: 'Genuine', fake_amount: 'Fake: amount changed', fake_reference: 'Fake: made-up session ID' };
const VERDICT_TAG: Record<string, string> = { received: 'green', not_confirmed: 'red', cannot_check: 'orange' };

function TransfersPage({ config, notify }: { config: SimConfig; notify: (s: string) => void }) {
  const [payer, setPayer] = useState(config.customers[1]?.phone ?? config.customers[0]!.phone);
  const [merchant, setMerchant] = useState(config.customers[0]!.phone);
  const [amount, setAmount] = useState('25000');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [list, reload] = usePoll(() => sim.transfers(), 2000);
  const transfers = list?.transfers ?? [];
  const shown = transfers.find((t) => t.id === selected) ?? transfers[0] ?? null;
  const lastGenuine = transfers.find((t) => t.kind === 'genuine');
  const nameOf = (phone: string) => config.customers.find((c) => c.phone === phone)?.name ?? phone;
  const receipt = copy.receipt.verdict;

  const act = async (fn: () => Promise<{ transfer: Transfer }>, done: (t: Transfer) => string) => {
    setBusy(true);
    try {
      const { transfer } = await fn();
      setSelected(transfer.id);
      reload();
      notify(done(transfer));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const kobo = Math.round(Number(amount.replace(/,/g, '')) * 100);
  const amountOk = Number.isSafeInteger(kobo) && kobo >= 100;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Transfers</h1>
          <p>A customer pays a merchant; {config.bank.name} registers the transfer receipt. The merchant checks any receipt before releasing goods.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card stack">
            <div>
              <h2>Pay a merchant</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                As the paying bank, {config.bank.name} registers a fingerprint of the receipt bound to the merchant's account. No account number, amount or session ID is stored.
              </p>
            </div>
            <div>
              <h3>Payer</h3>
              <People config={config} phone={payer} setPhone={(p) => { setPayer(p); if (p === merchant) setMerchant(config.customers.find((c) => c.phone !== p)!.phone); }} />
            </div>
            <div>
              <h3>Merchant (paid into)</h3>
              <div className="chips">
                {config.customers.filter((c) => c.phone !== payer).map((c) => (
                  <button key={c.phone} className={`chip ${merchant === c.phone ? 'on' : ''}`} onClick={() => setMerchant(c.phone)}>
                    {c.name} <span className="mono">{c.phone.slice(-10).replace(/^(\d{6})/, '******')}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="row small muted">
                Amount (NGN)
                <input aria-label="Amount in naira" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} />
              </label>
              <button className="btn" disabled={busy || !amountOk || payer === merchant} onClick={() => act(() => sim.pay(payer, merchant, kobo), (t) => (t.registered ? 'Paid. Receipt registered.' : 'Paid, but the receipt was not stored'))}>
                <IconSend /> Pay and register
              </button>
            </div>
          </div>

          <div className="card stack">
            <div>
              <h2>Play the fraudster</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>A fake receipt copies a genuine one. Nobody registers it, so the merchant's check is not confirmed.</p>
            </div>
            <div className="row">
              <button className="btn danger" disabled={busy || !lastGenuine} onClick={() => act(() => sim.fakeReceipt('fake_amount', lastGenuine?.id), () => 'Fake receipt: amount multiplied by ten')}>
                <IconScissors /> Same receipt, amount changed
              </button>
              <button className="btn secondary" disabled={busy || !lastGenuine} onClick={() => act(() => sim.fakeReceipt('fake_reference', lastGenuine?.id), () => 'Fake receipt: made-up session ID')}>
                <IconWarning /> Made-up session ID
              </button>
            </div>
            {!lastGenuine && <p className="muted small" style={{ margin: 0 }}>Make a genuine payment first.</p>}
          </div>

          <div className="card">
            <h3>Receipts</h3>
            {transfers.length === 0 && <p className="muted small" style={{ margin: 0 }}>No transfers yet.</p>}
            {transfers.map((t) => (
              <div className="kbd-row" key={t.id} onClick={() => setSelected(t.id)} style={{ cursor: 'pointer', background: shown?.id === t.id ? 'var(--fill-2)' : undefined }}>
                <span>
                  <b>{nairaText(t.amountKobo)}</b>
                  <span className="muted small"> &middot; {t.payer} to {nameOf(t.merchant)} &middot; {timeOf(t.at)}</span>
                  <div className="small mono muted">{groupSession(t.reference)}</div>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className={`tag ${t.kind === 'genuine' ? 'blue' : 'red'}`}>{KIND_LABEL[t.kind]}</span>
                  {t.check ? (
                    <span className={`tag ${VERDICT_TAG[t.check.verdict] ?? 'orange'}`}>{receipt[t.check.verdict]?.short ?? receipt.cannot_check.short}</span>
                  ) : (
                    <button className="btn plain small" disabled={busy} onClick={(e) => { e.stopPropagation(); void act(() => sim.checkReceipt(t.id), (r) => `Merchant's check: ${receipt[r.check?.verdict ?? 'cannot_check'].title}`); }}>
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
                <dt>From</dt><dd>{shown.payer}</dd>
                <dt>To</dt><dd>{nameOf(shown.merchant)}, {config.bank.name}</dd>
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
                <button className="btn" style={{ marginTop: 14 }} disabled={busy} onClick={() => act(() => sim.checkReceipt(shown.id), (r) => `Merchant's check: ${receipt[r.check?.verdict ?? 'cannot_check'].title}`)}>
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
  const customer = config.customers.find((c) => c.phone === phone);

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
            <People config={config} phone={phone} setPhone={setPhone} />
          </div>
          <div className="card stack">
            <div>
              <h2>How it works</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                The mobile network tells Gaskiyya which number is dialling, so {customer?.name ?? 'the customer'} only ever sees calls and messages bound to their own number. Message
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

        <FeaturePhone phone={phone} code={config.ussdCode} onHop={(h) => setHops((list) => [{ ...h, key: Math.random() }, ...list].slice(0, 8))} />
      </div>
    </div>
  );
}

const LICENCE_EXAMPLES = [
  { label: 'Listed loan app', query: 'FairMoney' },
  { label: 'Near miss', query: 'Fair Mony' },
  { label: 'Unknown lender', query: 'Moonbeam Quick Loans' },
];

const LICENCE_TONE = { licensed: 'var(--blue)', not_listed: 'var(--orange)', cannot_check: 'var(--red)' } as const;

function LicencePage({ config, phone, setPhone }: { config: SimConfig; phone: string; setPhone: (p: string) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LicenceResult | null>(null);
  const l = copy.licence;
  const run = async (q: string) => {
    if (q.trim().length < 2) return;
    setQuery(q);
    setBusy(true);
    try {
      setResult(await device.checkLicence(phone, q.trim()));
    } finally {
      setBusy(false);
    }
  };
  const regulators = (r: LicenceResult) => r.regulators.map((x) => x.name).join(', ').replace(/, ([^,]*)$/, ' or $1');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Licence check</h1>
          <p>{l.intro} The same check answers in the app, on WhatsApp (LOAN followed by a name) and on USSD option 4.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Customer</h3>
            <People config={config} phone={phone} setPhone={setPhone} />
          </div>
          <div className="card stack">
            <h2>{l.title}</h2>
            <div className="chips">
              {LICENCE_EXAMPLES.map((e) => (
                <button key={e.query} className={`chip ${query === e.query ? 'on' : ''}`} onClick={() => run(e.query)} title={e.label}>
                  {e.label}: {e.query}
                </button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(query);
              }}
            >
              <input aria-label={l.placeholder} placeholder={l.placeholder} value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
              <button className="btn" disabled={busy || query.trim().length < 2}>{l.check}</button>
            </form>
            <p className="muted small" style={{ margin: 0 }}>
              The name is checked and dropped: the registry stores only a count of each answer.
            </p>
          </div>
        </div>
        <div className="card stack" aria-live="polite">
          {!result && <p className="muted small" style={{ margin: 0 }}>Pick an example or type a name, website or Android app ID.</p>}
          {result && (
            <>
              <div className="row" style={{ gap: 8 }}>
                <span className="status-dot" style={{ background: LICENCE_TONE[result.verdict], boxShadow: 'none' }} />
                <b>{l[result.verdict].short}</b>
              </div>
              <h2 style={{ margin: 0 }}>{l[result.verdict].title}</h2>
              {result.verdict === 'licensed' && (
                <>
                  <p style={{ margin: 0 }}>{fillText(l.licensed.body, { name: result.firm.name, regulator: result.firm.regulator, category: label(l.categories, result.firm.category) })}</p>
                  <div className="kbd-row"><span>{l.regulator}</span><b>{result.firm.regulator}</b></div>
                  <div className="kbd-row"><span>{l.category}</span><b>{label(l.categories, result.firm.category)}</b></div>
                  {result.firm.status && <div className="kbd-row"><span>{l.status}</span><b>{result.firm.status}</b></div>}
                  <div className="kbd-row"><span>{l.listDate}</span><b>{result.firm.source.retrievedAt}</b></div>
                  <p className="muted small" style={{ margin: 0 }}>{l.source}: <a href={result.firm.source.url} target="_blank" rel="noreferrer">{result.firm.source.title}</a></p>
                </>
              )}
              {result.verdict === 'not_listed' && (
                <>
                  <p style={{ margin: 0 }}>{fillText(l.not_listed.body, { regulators: regulators(result) })}</p>
                  {result.similarTo && (
                    <p className="row" style={{ margin: 0, gap: 8, alignItems: 'flex-start' }}>
                      <IconWarning style={{ color: 'var(--orange)', flex: 'none', width: 18 }} />
                      <span>{fillText(l.similar, { name: result.similarTo.name })}</span>
                    </p>
                  )}
                  <p className="muted small" style={{ margin: 0 }}>{fillText(l.listsChecked, { lists: [...new Set(result.sources.map((s) => `${s.regulator} (${s.retrievedAt})`))].join(', ') })}</p>
                </>
              )}
              {result.verdict === 'cannot_check' && <p style={{ margin: 0 }}>{l.cannot_check.body}</p>}
              {result.regulators.length > 0 && (
                <p className="muted small" style={{ margin: 0 }}>
                  {result.regulators.map((r, i) => (
                    <span key={r.name}>{i > 0 && ' \u00b7 '}<a href={r.url} target="_blank" rel="noreferrer">{r.name}</a></span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const fillText = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

function FraudPage({ notify }: { notify: (s: string) => void }) {
  const [data, reload] = usePoll(() => sim.campaigns(), 3000);
  const campaigns = (data?.campaigns ?? []).filter((c) => c.status !== 'dismissed');
  const [analyst, setAnalyst] = useState(() => {
    try {
      return localStorage.getItem('gaskiya.analyst') ?? '';
    } catch {
      return '';
    }
  });
  const saveAnalyst = (v: string) => {
    setAnalyst(v);
    try {
      localStorage.setItem('gaskiya.analyst', v);
    } catch {
      // The demo can still run when browser storage is unavailable.
    }
  };

  const run = async () => {
    const r = await sim.runAgent();
    reload();
    notify(r.campaignsTouched.length ? `Agent updated ${r.campaignsTouched.length} campaign(s)` : 'No new reports to group');
  };
  const seed = async () => {
    const r = await sim.seedReports();
    notify(`${r.reported} customer reports submitted`);
  };
  const action = async (c: Campaign, a: 'approve' | 'dismiss' | 'withdraw') => {
    await sim.campaignAction(c.id, a, analyst.trim());
    reload();
    notify(a === 'approve' ? 'Advisory approved: customers\u2019 apps now show the warning' : a === 'withdraw' ? 'Advisory withdrawn from customers\u2019 apps' : 'Campaign dismissed');
  };
  const send = async (c: Campaign) => {
    const r = await sim.sendAdvisory(c.id);
    reload();
    notify(`Warning sent to ${r.sent} customers by SMS, each one registered`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Fraud desk</h1>
          <p>Customer reports grouped into campaigns. Advisories stay drafts until an analyst approves them.</p>
        </div>
        <div className="row">
          <button className="btn secondary" onClick={seed}>Simulate 3 reports</button>
          <button className="btn" onClick={run}><IconSpark /> Run agent</button>
        </div>
      </div>
      <RegistrationAlerts />
      <div className="section-label">Scam campaigns</div>
      {campaigns.length === 0 ? (
        <div className="card empty">
          <IconShield />
          <h2>No campaigns</h2>
          <p className="small">When customers report fakes that share a link, number or lure, they appear here as one campaign.</p>
        </div>
      ) : (
        <div className="stack">
          {campaigns.map((c) => (
            <div className="card campaign" key={c.id}>
              <div className="campaign-head">
                <div>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className={`tag ${c.status === 'confirmed' ? 'green' : 'orange'}`}>{c.status === 'confirmed' ? 'Confirmed' : 'New'}</span>
                    <span className="muted small">First seen {timeOf(c.firstSeen)} · last seen {timeOf(c.lastSeen)}</span>
                  </div>
                  <h2>{c.summary}</h2>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{c.reportCount}</div>
                  <div className="muted small">reports</div>
                </div>
              </div>
              <div className="chips">
                {c.indicators.map((i) => <span className="tag red" key={i}>{label(copy.indicators, i)}</span>)}
                {c.linkDomains.map((d) => <span className="tag mono" key={d}>{d}</span>)}
                {c.callbackKeyCount > 0 && <span className="tag">{c.callbackKeyCount} callback number{c.callbackKeyCount > 1 ? 's' : ''}</span>}
              </div>
              {c.briefing && (
                <div>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <h3 style={{ margin: 0 }}>Briefing</h3>
                    <span className="tag blue">{CHANNEL_LABEL[c.briefing.channel]}</span>
                    <span className="tag">{c.briefing.source === 'model' ? 'Written by AI, check before use' : 'Built from report data'}</span>
                  </div>
                  <p style={{ margin: 0 }}>{c.briefing.pattern}</p>
                </div>
              )}
              <div>
                <h3>{c.advisory.status === 'approved' ? 'Approved advisory' : c.advisory.status === 'withdrawn' ? 'Withdrawn advisory' : 'Suggested advisory (draft)'}</h3>
                <div className="advisory">{c.advisory.text}</div>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted small">
                  {c.advisory.status === 'approved'
                    ? `Approved by ${c.advisory.approvedBy} at ${timeOf(c.advisory.approvedAt!)}${c.advisory.expiresAt ? ` \u00b7 shown in customers\u2019 apps until ${timeOf(c.advisory.expiresAt)}` : ''}`
                    : c.advisory.status === 'withdrawn'
                      ? `Withdrawn by ${c.advisory.withdrawnBy} at ${timeOf(c.advisory.withdrawnAt!)}`
                      : 'Approving shows the warning in customers\u2019 apps. Nothing is sent by SMS until you send it.'}
                </span>
                {c.advisory.status === 'approved' && (
                  <div className="row">
                    <button className="btn plain" disabled={analyst.trim().length < 2} title={analyst.trim().length < 2 ? 'Enter your name to withdraw' : undefined} onClick={() => action(c, 'withdraw')}>Withdraw</button>
                    <input
                      aria-label="Your name, recorded with the withdrawal"
                      placeholder="Your name"
                      value={analyst}
                      onChange={(e) => saveAnalyst(e.target.value)}
                      maxLength={100}
                    />
                    <button className="btn" onClick={() => send(c)} title="Sends this warning by SMS through the bank's gateway, registering each message so customers can check it">Send to customers</button>
                  </div>
                )}
                {c.advisory.status === 'draft' && (
                  <div className="row">
                    <button className="btn plain" onClick={() => action(c, 'dismiss')}>Dismiss</button>
                    <input
                      aria-label="Your name, recorded with the approval"
                      placeholder="Your name"
                      value={analyst}
                      onChange={(e) => saveAnalyst(e.target.value)}
                      maxLength={100}
                    />
                    <button className="btn success" disabled={analyst.trim().length < 2} title={analyst.trim().length < 2 ? 'Enter your name to approve' : undefined} onClick={() => action(c, 'approve')}><IconCheck /> Approve advisory</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CHANNEL_LABEL: Record<NonNullable<Campaign['briefing']>['channel'], string> = {
  sms: 'Impersonates SMS',
  whatsapp: 'Impersonates WhatsApp',
  call: 'Impersonates phone calls',
  email: 'Impersonates email',
  social: 'Impersonates social media',
  unknown: 'Channel unclear',
};

function RegistrationAlerts() {
  const [data] = usePoll(() => sim.alerts(), 3000);
  const alerts = data?.alerts ?? [];
  const describe = (a: RegistrationAlert) =>
    a.kind === 'unknown_link_domain'
      ? `Registered message links to ${a.domain}, not one of the bank's domains`
      : `${a.count.toLocaleString()} registrations in ${a.windowMinutes} min (about ${(a.expected ?? 0).toLocaleString()} expected)`;
  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>Registration alerts</div>
      <div className="card registration-alerts">
        {alerts.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Nothing unusual. Registrations that link outside the bank's domains, or a sudden jump in volume, appear here and are emailed to the fraud desk. They are never blocked.</p>
        ) : (
          alerts.map((a) => (
            <div className="kbd-row" key={a.id}>
              <span>
                <span className={`tag ${a.kind === 'unknown_link_domain' ? 'orange' : 'red'}`} style={{ marginRight: 8 }}>{a.kind === 'unknown_link_domain' ? 'Link domain' : 'Volume'}</span>
                {describe(a)}
              </span>
              <span className="muted small">{a.kind === 'unknown_link_domain' && a.count > 1 ? `${a.count} messages \u00b7 ` : ''}{timeOf(a.lastSeen)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

const CHECK_CHANNELS: Record<string, string> = { app: 'app', whatsapp: 'WhatsApp', ussd: 'USSD' };
const pct = (r: number | null | undefined) => (r === null || r === undefined ? 'n/a' : `${(r * 100).toFixed(1)}%`);

function OverviewPage({ metrics, events }: { metrics: Metrics | null; events: LiveEvent[] }) {
  const v = metrics?.verifications ?? {};
  const cov = metrics?.coverage;
  const totalChecks = (v.confirmed ?? 0) + (v.not_confirmed ?? 0) + (v.cannot_check ?? 0);
  const segs = useMemo(
    () => [
      { k: 'confirmed', c: 'var(--green)' },
      { k: 'not_confirmed', c: 'var(--orange)' },
      { k: 'cannot_check', c: 'var(--red)' },
    ],
    [],
  );
  const tiles = [
    { k: 'Messages registered', v: metrics?.registrations ?? 0, color: 'var(--blue)' },
    { k: 'Confirmed checks', v: v.confirmed ?? 0, color: 'var(--green)' },
    { k: 'Not confirmed', v: v.not_confirmed ?? 0, color: 'var(--orange)' },
    { k: 'Links checked', v: Object.values(metrics?.links ?? {}).reduce((a, b) => a + b, 0), color: 'var(--teal)' },
    { k: 'Open call sessions', v: metrics?.openCalls ?? 0, color: 'var(--indigo)' },
    { k: 'Reports', v: metrics?.reports ?? 0, color: 'var(--red)' },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Registration coverage and verification outcomes. Counts only, never content.</p>
        </div>
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="card tile" key={t.k}>
            <div className="k"><span className="status-dot" style={{ background: t.color, boxShadow: 'none' }} />{t.k}</div>
            <div className="v">{t.v.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="grid-2 overview-grid">
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>Message check outcomes</div>
          <div className="card stack">
            <div className="bar">
              {segs.map((s) => <span key={s.k} style={{ width: `${totalChecks ? ((v[s.k] ?? 0) / totalChecks) * 100 : 0}%`, background: s.c }} />)}
            </div>
            <div className="row small">
              {segs.map((s) => (
                <span key={s.k} className="row" style={{ gap: 6, marginRight: 14 }}>
                  <span className="status-dot" style={{ background: s.c, boxShadow: 'none' }} />
                  {label({ confirmed: 'Confirmed', not_confirmed: 'Not confirmed', cannot_check: 'Cannot check' }, s.k)} · {v[s.k] ?? 0}
                </span>
              ))}
            </div>
          </div>
          <div className="section-label">Coverage</div>
          <div className="card coverage">
            <div className="kbd-row"><span>Registered</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{(cov?.registered ?? 0).toLocaleString()}</b></div>
            <div className="kbd-row"><span>Verified (confirmed checks)</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{(cov?.confirmed ?? 0).toLocaleString()}</b></div>
            <div className="kbd-row"><span>Message checks</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{(cov?.checked ?? 0).toLocaleString()}</b></div>
            <div className="kbd-row"><span>Not-confirmed rate</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(cov?.notConfirmedRate)}</b></div>
            {Object.entries(cov?.checksByChannel ?? {}).map(([k, n]) => (
              <div className="kbd-row" key={k}>
                <span className="muted">Checks by {label(CHECK_CHANNELS, k)}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString()}</b>
              </div>
            ))}
            <div className="kbd-row"><span>Registration alerts (see Fraud desk)</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{Object.values(metrics?.registrationAlerts ?? {}).reduce((a, b) => a + b, 0).toLocaleString()}</b></div>
            <p className="muted small" style={{ margin: '8px 0 0' }}>A high not-confirmed rate means many fakes, or genuine messages that were never registered.</p>
          </div>
          <div className="section-label">Registered by type</div>
          <div className="card">
            {Object.keys(metrics?.registrationsByCategory ?? {}).length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing registered yet.</p>}
            {Object.entries(metrics?.registrationsByCategory ?? {}).map(([k, n]) => (
              <div className="kbd-row" key={k}>
                <span>{label(copy.categories, k)}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card feed">
          <div className="feed-head">
            <h3>Live activity</h3>
            <span className="live-dot" aria-hidden="true" />
          </div>
          {events.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Checks from the customer app appear here as they happen.</p>
          ) : (
            <ol className="feed-list" aria-live="polite">
              {events.map((e) => (
                <li key={e.key}>
                  <span className={`feed-dot ${e.tone}`} />
                  <span className="feed-text">{e.text}</span>
                  <time className="muted small">{e.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function contactKindLabel(c: { type: string; value: string; platform?: string }, platforms?: string[]): string {
  const k = copy.official.contact.kinds;
  if (c.type === 'phone' || c.type === 'whatsapp' || c.type === 'email') return k[c.type];
  const p = c.platform ?? platforms?.[0];
  const names = copy.official.contact.platforms as Record<string, string>;
  return fill(k.social, { platform: p ? (names[p] ?? p) : `@${c.value}` });
}

const PLATFORM_URL: Record<string, (h: string) => string> = {
  x: (h) => `x.com/${h}`,
  facebook: (h) => `facebook.com/${h}`,
  instagram: (h) => `instagram.com/${h}`,
  tiktok: (h) => `tiktok.com/@${h}`,
  telegram: (h) => `t.me/${h}`,
};

function ContactsPage({ config, phone, setPhone, notify }: { config: SimConfig; phone: string; setPhone: (p: string) => void; notify: (s: string) => void }) {
  const [data] = usePoll(() => sim.organisations(), 10_000);
  const [contact, setContact] = useState('');
  const [result, setResult] = useState<ContactCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const orgs: Organisation[] = data?.organisations ?? [];
  const care = config.fakeCustomerCare;
  const t = copy.official.contact;

  const check = async (value = contact) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      setResult(await device.verifyContact(phone, value.trim()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Official contacts</h1>
          <p>The numbers, emails, social accounts and apps each organisation declares as its own. A customer can check any contact against them; only an exact match is official.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <h3>Customer</h3>
            <People config={config} phone={phone} setPhone={setPhone} />
          </div>

          <div className="card stack">
            <div>
              <h2>Check a number or account</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>As the customer's app does: a phone number, email, @handle or profile link, checked against every organisation. The contact is never stored.</p>
            </div>
            <input aria-label="Contact to check" placeholder={copy.official.app.placeholder} value={contact} onChange={(e) => setContact(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void check()} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" disabled={busy || !contact.trim()} onClick={() => void check()}>
                <IconCheck /> Check
              </button>
            </div>
            {result && (
              <div role="status" className="stack" style={{ gap: 6 }}>
                {result.verdict === 'official' && (
                  <>
                    <span className="tag green">{t.official.short}</span>
                    {result.matches.map((m) => <p key={m.id} style={{ margin: 0 }}>{fill(t.official.body, { org: m.name, contact: contactKindLabel(result.contact, m.platforms) })}</p>)}
                    <p className="muted small" style={{ margin: 0 }}>{t.spoofNote}</p>
                  </>
                )}
                {result.verdict === 'not_official' && (
                  <>
                    <span className="tag red">{t.not_official.short}</span>
                    <p style={{ margin: 0 }}>{result.organisation ? fill(t.not_official.body, { org: result.organisation.name, contact: contactKindLabel(result.contact) }) : fill(t.not_official.bodyAny, { contact: contactKindLabel(result.contact) })}</p>
                    {result.impersonates.map((o) => <p key={o.id} className="small" style={{ margin: 0, color: 'var(--red)' }}>{fill(t.impersonation, { org: o.name })}</p>)}
                  </>
                )}
                {result.verdict === 'cannot_check' && (
                  <>
                    <span className="tag orange">{copy.verdict.cannot_check.short}</span>
                    <p style={{ margin: 0 }}>{t.cannotCheckBody}</p>
                  </>
                )}
                {result.verdict === 'not_a_contact' && <p className="muted" style={{ margin: 0 }}>{t.notAContact}</p>}
              </div>
            )}
          </div>

          {care && (
            <div className="card stack">
              <div>
                <h2>Fake customer care</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  A scam message sends the customer to a WhatsApp "help desk" ({care.whatsapp}) that {config.bank.name} never registered. Send it, then check the number.
                </p>
              </div>
              <div className="row">
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const r = await sim.sendFakeCare(phone);
                      notify('Fake customer care message sent');
                      const link = `https://wa.me/${r.contact.whatsapp.replace(/\D/g, '')}`;
                      setContact(link);
                      await check(link);
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <IconWarning /> Send the scam and check its number
                </button>
                <button className="btn secondary" disabled={busy} onClick={() => { setContact(`@${care.handle}`); void check(`@${care.handle}`); }}>
                  Check @{care.handle}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          {orgs.map((o) => {
            const oc = o.officialContacts;
            const rows: [string, string][] = [
              ...oc.phones.map((v): [string, string] => [t.kinds.phone, v]),
              ...oc.whatsapp.map((v): [string, string] => [t.kinds.whatsapp, v]),
              ...oc.emails.map((v): [string, string] => [t.kinds.email, v]),
              ...oc.social.map((s): [string, string] => [fill(t.kinds.social, { platform: (t.platforms as Record<string, string>)[s.platform] ?? s.platform }), `@${s.handle}`]),
              ...o.officialApps.android.map((v): [string, string] => ['Android app', v]),
              ...o.officialApps.ios.map((v): [string, string] => ['App Store app', `id${v.replace(/\D/g, '')}`]),
            ];
            return (
              <div className="card" key={o.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0 }}>{o.name}</h2>
                  <span className="tag blue">{label(copy.official.kinds, o.kind)}</span>
                </div>
                <p className="muted small">{o.domains.join(', ')}</p>
                {rows.length === 0 && <p className="muted small">No official contacts declared.</p>}
                {rows.map(([k, v]) => (
                  <div className="kbd-row" key={`${k}${v}`}>
                    <span>{k}</span>
                    <button className="btn plain small mono" title="Check this contact" onClick={() => {
                      const value = v.startsWith('@') && k !== t.kinds.email ? (Object.entries(PLATFORM_URL).find(([p]) => fill(t.kinds.social, { platform: (t.platforms as Record<string, string>)[p] ?? p }) === k)?.[1](v.slice(1)) ?? v) : v;
                      setContact(value);
                      void check(value);
                    }}>{v}</button>
                  </div>
                ))}
              </div>
            );
          })}
          {!data && <div className="card empty"><p className="small">Loading what each organisation publishes&hellip;</p></div>}
        </div>
      </div>
    </div>
  );
}
