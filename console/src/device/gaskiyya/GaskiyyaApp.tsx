import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fill, type ActivityItem, type ContactResult, type LicenceResult, type VerifyResult } from '@gaskiya/schemas';
import copy from '../../../../packages/schemas/copy.json';
import type { InboxItem } from '../../api.ts';
import { parseContact } from '../../../../packages/api/src/domain/contact.ts';
import { device, looksLikeLink, normalisePhone, type Advisory, type CallState, type CallView, type ContactCheck, type Explained, type LinkResult } from '../api.ts';
import { dateText, timeText } from '../shield.ts';
import { I } from './icons.tsx';
import './gaskiyya.css';

const spring: Transition = { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const orList = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : fill(copy.banks.or, { first: names.slice(0, -1).join(', '), last: names[names.length - 1]! });
const purposeText = (p: string) => (copy.purposes as Record<string, string>)[p] ?? p.replace(/_/g, ' ');
const categoryText = (c: string) => (copy.categories as Record<string, string>)[c] ?? c.replace(/_/g, ' ');
const channelText = (c: string) => (copy.channels as Record<string, string>)[c] ?? c;
const art = (name: string) => `img/3d-${name}.webp`;

export interface Session {
  phone: string;
  bankId: string;
  bankName: string;
}

const SESSION_KEY = 'gaskiyya-emulator-sessions';
const sessions = new Map<string, Session>();
try {
  const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') as Record<string, Session>;
  for (const [k, v] of Object.entries(saved)) if (v && typeof v.phone === 'string') sessions.set(k, v);
} catch {
  // Start with an empty session when browser storage is missing or malformed.
}
export const loadSession = (devicePhone: string) => sessions.get(devicePhone) ?? null;
export function saveSession(devicePhone: string, s: Session | null) {
  if (s) sessions.set(devicePhone, s);
  else sessions.delete(devicePhone);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(Object.fromEntries(sessions)));
  } catch {
    // Keep the in-memory session when browser storage is unavailable.
  }
}

export interface CheckReq {
  kind: 'message' | 'link' | 'contact';
  text: string;
  key: number;
}
export function requestFor(text: string, asContact = false): CheckReq {
  const key = Date.now() + Math.random();
  if (asContact || parseContact(text.trim()) !== null) return { kind: 'contact', text: text.trim(), key };
  if (looksLikeLink(text)) return { kind: 'link', text: text.trim(), key };
  return { kind: 'message', text, key };
}

function Primary({ label, icon, onClick, disabled, gradient, red, loading }: { label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean; gradient?: boolean; red?: boolean; loading?: boolean }) {
  return (
    <button className={`gk-primary ${gradient ? 'gradient' : ''} ${red ? 'red' : ''}`} onClick={onClick} disabled={disabled || loading}>
      {loading ? <span className="gk-spinner light" /> : <>{icon}<span>{label}</span></>}
    </button>
  );
}

function Section({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="gk-section">
      <h2 className="gk-title3" style={{ margin: 0 }}>{title}</h2>
      {trailing}
    </div>
  );
}

function Shimmer({ lines = 3 }: { lines?: number }) {
  return <div className="gk-shimmer">{Array.from({ length: lines }, (_, i) => <i key={i} />)}</div>;
}

function Page({ title, trailing, leading, children, full }: { title: string; trailing?: ReactNode; leading?: ReactNode; children: ReactNode; full?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className={`gk-page ${full ? 'full' : ''}`} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 36)}>
      <div className={`gk-navbar ${scrolled ? 'scrolled' : ''}`}>
        {leading && <div className="gk-navbar-leading">{leading}</div>}
        <span className="gk-navbar-title">{title}</span>
        {trailing && <div className="gk-navbar-trailing">{trailing}</div>}
      </div>
      <div className="gk-largetitle-row"><h1 className="gk-large-title" style={{ margin: 0 }}>{title}</h1></div>
      {children}
    </div>
  );
}

type Tab = 'check' | 'calls' | 'activity' | 'settings';
const tabStore = new Map<string, Tab>();

export function GaskiyyaApp({
  devicePhone,
  bank,
  items,
  callId,
  spoofedCall = false,
  session,
  onSession,
  onCheck,
  onLicence,
}: {
  devicePhone: string;
  bank: string;
  items: InboxItem[];
  callId: string | null;
  // A call is ringing or on that no bank announced (the fraudster's): the Calls tab warns while it lasts.
  spoofedCall?: boolean;
  session: Session | null;
  onSession: (s: Session | null) => void;
  onCheck: (req: CheckReq) => void;
  onLicence: () => void;
}) {
  const [tab, setTabState] = useState<Tab>(() => tabStore.get(devicePhone) ?? 'check');
  const [adding, setAdding] = useState(false);
  const setTab = (t: Tab) => {
    tabStore.set(devicePhone, t);
    setTabState(t);
  };

  if (!session || adding) {
    return (
      <div className="gk">
        <SignIn devicePhone={devicePhone} session={session} adding={adding && !!session} onBack={() => setAdding(false)} onDone={(s) => { setAdding(false); onSession(s); }} />
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: string; on: string }[] = [
    { id: 'check', label: copy.app.tabs.check, icon: 'checkmark_shield', on: 'checkmark_shield_fill' },
    { id: 'calls', label: copy.app.tabs.calls, icon: 'phone', on: 'phone_fill' },
    { id: 'activity', label: copy.app.tabs.activity, icon: 'clock', on: 'clock_fill' },
    { id: 'settings', label: copy.app.tabs.settings, icon: 'gear', on: 'gear_solid' },
  ];
  return (
    <div className="gk">
      {tab === 'check' && <CheckTab session={session} items={items} onCheck={onCheck} onLicence={onLicence} />}
      {tab === 'calls' && <CallsTab session={session} callId={callId} spoofedCall={spoofedCall} />}
      {tab === 'activity' && <ActivityTab session={session} />}
      {tab === 'settings' && <SettingsTab session={session} bank={bank} onAdd={() => setAdding(true)} onSignOut={() => onSession(null)} />}
      <nav className="gk-tabbar">
        {tabs.map((t) => (
          <button key={t.id} className={`gk-tab ${tab === t.id ? 'on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {I[tab === t.id ? t.on : t.icon]!()}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

interface BankOption {
  id: string;
  name: string;
  domain: string | null;
}

function SignIn({ devicePhone, session, adding, onBack, onDone }: { devicePhone: string; session: Session | null; adding: boolean; onBack: () => void; onDone: (s: Session) => void }) {
  const t = copy.app.link;
  const local = devicePhone.startsWith('+234') ? `0${devicePhone.slice(4)}` : devicePhone;
  const [number, setNumber] = useState(adding ? (session?.phone ?? local) : local);
  const [banks, setBanks] = useState<BankOption[] | null | 'failed'>(null);
  const [bankId, setBankId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setBanks(null);
    fetch('/sim/organisations')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { organisations?: { id: string; name: string; kind?: string; domains?: string[] }[] }) => {
        const list = (j.organisations ?? []).filter((o) => (o.kind ?? 'bank') === 'bank').map((o) => ({ id: o.id, name: o.name, domain: o.domains?.[0] ?? null }));
        setBanks(list);
        if (list.length === 1) setBankId(list[0]!.id);
      })
      .catch(() => setBanks('failed'));
  };
  useEffect(load, []);

  const submit = async () => {
    const chosen = Array.isArray(banks) ? banks.find((b) => b.id === bankId) : undefined;
    if (!chosen) return setError(t.chooseBank);
    const phone = normalisePhone(number);
    if (!phone) return setError(t.enterNumber);
    setBusy(true);
    setError(null);
    try {
      await device.signIn(phone, chosen.id);
      onDone({ phone, bankId: chosen.id, bankName: chosen.name });
    } catch {
      setError(t.cannotReachBank);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gk-signin">
      {adding && (
        <div className="gk-row" style={{ height: 44, margin: '0 -16px', position: 'relative' }}>
          <button className="gk-row" style={{ color: 'var(--gk-tint)', gap: 2 }} onClick={onBack} aria-label={copy.app.common.cancel}>{I.chevron_back!({ size: 24 })}</button>
          <span className="gk-headline" style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>{copy.banks.add}</span>
        </div>
      )}
      <div style={{ height: 28 }} />
      <img className="gk-art gk-reveal" src={art('app_tile')} alt="" width={140} height={140} style={{ margin: '0 auto' }} />
      <h1 className="gk-large-title gk-center gk-reveal" style={{ margin: '18px 0 0', animationDelay: '80ms' }}>{t.title}</h1>
      <p className="gk-callout gk-center gk-reveal" style={{ marginTop: 10, color: 'var(--gk-label-2)', animationDelay: '140ms' }}>{t.intro}</p>
      <div style={{ height: 30 }} />
      {banks === 'failed' ? (
        <div className="gk-card gk-row">
          <p className="gk-subhead gk-grow">{t.banksUnreachable}</p>
          <button style={{ color: 'var(--gk-tint)' }} onClick={load}>{copy.app.common.tryAgain}</button>
        </div>
      ) : banks === null ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '14px 0' }}><span className="gk-spinner" /></div>
      ) : banks.length === 0 ? (
        <div className="gk-card"><p className="gk-subhead">{t.noBanks}</p></div>
      ) : (
        <div className="gk-card flush gk-reveal" style={{ animationDelay: '180ms' }}>
          {banks.map((b, i) => (
            <div key={b.id}>
              {i > 0 && <div className="gk-sep" style={{ marginLeft: 66 }} />}
              <button className="gk-bank-row" disabled={busy || banks.length === 1} onClick={() => setBankId(b.id)} aria-pressed={bankId === b.id}>
                <span className="gk-avatar">{b.name.charAt(0)}</span>
                <span className="gk-grow">
                  <span className="gk-headline" style={{ display: 'block' }}>{b.name}</span>
                  {b.domain && <span className="gk-footnote" style={{ display: 'block' }}>{b.domain}</span>}
                </span>
                {bankId === b.id && <span className="gk-tick">{I.checkmark_alt!()}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 14 }} />
      <div className="gk-card gk-phone-field gk-reveal" style={{ animationDelay: '200ms' }}>
        <span className="gk-flag"><i /><i /><i /></span>
        <span className="gk-body" style={{ fontWeight: 600, marginLeft: 8 }}>+234</span>
        <span className="gk-vsep" />
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/[^\d +]/g, '').slice(0, 16))}
          placeholder={t.mobileNumber}
          inputMode="tel"
          autoComplete="tel"
          aria-label={t.mobileNumber}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </div>
      {error ? <p className="gk-footnote gk-error">{error}</p> : <div style={{ height: 12 }} />}
      <div style={{ height: 14 }} />
      <Primary label={copy.app.common.continue} gradient loading={busy} onClick={() => void submit()} />
      <div style={{ height: 24 }} />
    </div>
  );
}

function CheckTab({ session, items, onCheck, onLicence }: { session: Session; items: InboxItem[]; onCheck: (r: CheckReq) => void; onLicence: () => void }) {
  const [text, setText] = useState('');
  const [contactMode, setContactMode] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let on = true;
    void device.checkCall(session.phone).then((s) => on && setLive(s.kind !== 'cannot_check'));
    return () => {
      on = false;
    };
  }, [session.phone]);

  const has = text.trim() !== '';
  const isContact = has && (contactMode || parseContact(text.trim()) !== null);
  const isLink = !isContact && has && looksLikeLink(text);
  const inbox = items.filter((m) => !m.tenantId || m.tenantId === session.bankId);
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch {
      field.current?.focus();
    }
  };
  const checkContact = () => {
    setContactMode(true);
    if (has) onCheck(requestFor(text, true));
    else field.current?.focus();
  };

  return (
    <Page title={copy.app.tabs.check} trailing={<><span className={`gk-dot ${live ? 'on' : ''}`} /><span className="gk-footnote gk-strong">{session.bankName}</span></>}>
      <div className="gk-content">
        <div className="gk-card gk-check-card gk-reveal">
          <textarea ref={field} value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={contactMode ? copy.official.app.placeholder : copy.app.check.placeholder} />
          <div className="gk-check-actions">
            <div className="gk-wrap">
              <button className="gk-tinted" onClick={() => void paste()}>{I.doc_on_clipboard!()}{copy.app.check.paste}</button>
              <button className="gk-tinted" onClick={checkContact}>{I.person_check!()}{copy.official.app.checkContact}</button>
            </div>
            <button className="gk-clear" style={{ opacity: has ? 1 : 0 }} disabled={!has} onClick={() => { setText(''); setContactMode(false); }} aria-label="Clear">{I.xmark_circle_fill!()}</button>
          </div>
        </div>
        <div style={{ height: 14 }} />
        <Primary
          label={isContact ? copy.official.app.checkContact : isLink ? copy.app.check.checkLink : copy.app.check.checkMessage}
          icon={isContact ? I.person_check!() : isLink ? I.link!() : I.checkmark_shield_fill!()}
          gradient={has}
          disabled={!has}
          onClick={() => onCheck(requestFor(text, contactMode))}
        />
        <p className="gk-caption gk-center" style={{ marginTop: 10 }}>{copy.app.check.fingerprintNote}</p>

        <Section title={copy.app.check.recentMessages} trailing={<span className="gk-footnote">{copy.app.check.demoInbox}</span>} />
        {inbox.length === 0 ? (
          <div className="gk-card gk-row gk-reveal">
            <img className="gk-art" src={art('message')} alt="" width={64} height={64} />
            <p className="gk-subhead gk-grow">{copy.app.check.inboxEmpty}</p>
          </div>
        ) : (
          <div className="gk-card flush">
            {inbox.slice(0, 8).map((m, i) => (
              <div key={m.id}>
                {i > 0 && <div className="gk-sep gk-inbox-sep" />}
                <button className="gk-inbox-row" onClick={() => onCheck(requestFor(m.text))}>
                  <span className="gk-avatar">{m.from.charAt(0)}</span>
                  <span className="gk-grow">
                    <span className="gk-row" style={{ gap: 0 }}>
                      <b className="gk-headline gk-grow">{m.from}</b>
                      {m.channel && <span className="gk-footnote">{channelText(m.channel)} &middot;&nbsp;</span>}
                      <span className="gk-footnote">{timeText(m.at)}</span>
                      <span className="gk-chevron" style={{ marginLeft: 4 }}>{I.chevron_forward!()}</span>
                    </span>
                    <span className="gk-subhead gk-inbox-text">{m.text}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 18 }} />
        <button className="gk-tile gk-reveal" onClick={onLicence} aria-label={`${copy.licence.title} ${copy.licence.entryHint}`}>
          <div className="gk-card gk-row" style={{ padding: '12px 12px 12px 14px' }}>
            <span className="gk-icon-tile">{I.checkmark_seal_fill!()}</span>
            <span className="gk-grow">
              <span className="gk-headline" style={{ display: 'block' }}>{copy.licence.title}</span>
              <span className="gk-subhead" style={{ display: 'block', marginTop: 2 }}>{copy.licence.entryHint}</span>
            </span>
            <span className="gk-chevron">{I.chevron_forward!()}</span>
          </div>
        </button>
        <div className="gk-footer">
          {I.lock_shield_fill!()}
          <span className="gk-caption gk-center">{copy.safety.neverAsks}</span>
        </div>
      </div>
    </Page>
  );
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return <p className="gk-footnote gk-white-85" style={{ marginTop: 18, fontVariantNumeric: 'tabular-nums' }}>{fill(copy.app.calls.validFor, { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}</p>;
}

export function CodeDigits({ code, light }: { code: string; light?: boolean }) {
  return (
    <div className={`gk-code ${light ? 'light' : ''}`} role="img" aria-label={fill(copy.a11y.callCode, { digits: code.split('').join(' ') })}>
      {code.split('').map((d, i) => <span key={`${code}${i}`}>{d}</span>)}
    </div>
  );
}

function CallsTab({ session, callId, spoofedCall }: { session: Session; callId: string | null; spoofedCall: boolean }) {
  const [state, setState] = useState<CallState | null>(null);
  const [checking, setChecking] = useState(false);
  const refresh = async () => {
    setChecking(true);
    setState(await device.checkCall(session.phone));
    setChecking(false);
  };
  useEffect(() => {
    void refresh();
  }, [session.phone, callId, spoofedCall]);
  const bank = session.bankName;
  const again = <Primary label={copy.app.calls.checkAgain} icon={I.arrow_clockwise!()} loading={checking} onClick={() => void refresh()} />;

  let body: ReactNode;
  if (!state) {
    body = <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><span className="gk-spinner" /></div>;
  } else if (state.kind === 'calling') {
    const calls: CallView[] = state.calls;
    body = (
      <div className="gk-reveal">
        {calls.map((c) => (
          <div key={c.id} style={{ marginBottom: 16 }}>
            <div className="gk-call-card">
              <div className="gk-pulse"><i /><i /><b>{I.phone_fill!()}</b></div>
              <h2 className="gk-title2 gk-white" style={{ margin: '14px 0 0' }}>{fill(copy.call.calling.title, { bank })}</h2>
              <p className="gk-subhead gk-white-85" style={{ marginTop: 6 }}>{cap(purposeText(c.purpose))}</p>
              <div className="gk-code-label">{copy.call.calling.codeLabel}</div>
              <CodeDigits code={c.code} light />
              {c.status === 'open' && <Countdown expiresAt={c.expiresAt} />}
            </div>
          </div>
        ))}
        <div className="gk-card">
          {calls.map((c) => <p key={c.id} className="gk-callout" style={{ marginBottom: 12 }}>{fill(copy.call.calling.body, { purpose: purposeText(c.purpose) })}</p>)}
          <div className="gk-warning">
            {I.exclamationmark_triangle_fill!()}
            <p className="gk-subhead gk-label gk-strong">{calls.length > 1 ? copy.call.mismatchMany : copy.call.mismatch}</p>
          </div>
        </div>
        <div style={{ height: 22 }} />
        {again}
      </div>
    );
  } else if (state.kind === 'not_calling' && spoofedCall) {
    // A phone call is ringing that the bank never announced: it isn't the bank.
    body = (
      <div className="gk-reveal gk-center">
        <span style={{ color: 'var(--gk-red)', display: 'inline-flex' }}>{I.exclamationmark_shield_fill!({ size: 72 })}</span>
        <h2 className="gk-title1" style={{ margin: '14px 0 0' }}>{fill(copy.official.org.notCallingTitle, { bank })}</h2>
        <p className="gk-callout" style={{ margin: '10px 8px 0', color: 'var(--gk-label-2)', lineHeight: 1.45 }}>{fill(copy.call.not_calling.body, { bank })}</p>
        <div style={{ height: 26 }} />
        {again}
      </div>
    );
  } else if (state.kind === 'not_calling') {
    // Nobody is calling: a calm tab with how it works, and nothing to check again.
    body = (
      <div className="gk-reveal gk-center">
        <img className="gk-art" src={art('call')} alt="" width={200} height={200} style={{ margin: '4px auto 0' }} />
        <h2 className="gk-title2" style={{ margin: '6px 0 18px' }}>{copy.app.calls.empty}</h2>
        <div className="gk-card gk-row top" style={{ textAlign: 'left', gap: 14 }}>
          <span className="gk-icon-tile s36 green">{I.bolt_fill!({ size: 18 })}</span>
          <p className="gk-subhead gk-grow">{copy.app.calls.howItWorks}</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="gk-reveal gk-center">
        <span style={{ color: 'var(--gk-orange)', display: 'inline-flex' }}>{I.exclamationmark_circle!({ size: 64 })}</span>
        <h2 className="gk-title1" style={{ margin: '14px 0 0' }}>{copy.verdict.cannot_check.title}</h2>
        <p className="gk-callout" style={{ margin: '10px 8px 0', color: 'var(--gk-label-2)', lineHeight: 1.45 }}>{copy.verdict.cannot_check.body}</p>
        <div style={{ height: 26 }} />
        {again}
      </div>
    );
  }
  return (
    <Page title={copy.app.tabs.calls}>
      <div className="gk-content" style={{ paddingTop: 8 }}>{body}</div>
    </Page>
  );
}

const CATEGORY_ICON: Record<string, string> = {
  otp: 'number_square_fill',
  transaction_alert: 'arrows_square_fill',
  security_notice: 'lock_shield_fill',
  service_update: 'sparkles',
  marketing: 'gift_fill',
};

function ActivityTab({ session }: { session: Session }) {
  const [advisories, setAdvisories] = useState<Advisory[] | null | 'loading'>('loading');
  const [data, setData] = useState<{ items: ActivityItem[]; text: string } | null | 'loading'>('loading');
  useEffect(() => {
    void device.advisories(session.phone).then(setAdvisories);
    device
      .activity(session.phone)
      .then((a) => setData(typeof a?.activityText === 'string' ? { items: a.recentActivity ?? [], text: a.activityText } : null))
      .catch(() => setData(null));
  }, [session.phone]);
  const bank = session.bankName;

  return (
    <Page title={copy.app.tabs.activity}>
      <div className="gk-content" style={{ paddingTop: 8 }}>
        <Section title={copy.advisory.section} />
        {advisories === 'loading' ? (
          <div className="gk-card" style={{ marginBottom: 10 }}><Shimmer lines={2} /></div>
        ) : advisories === null ? (
          <div className="gk-card gk-row top" style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--gk-orange-ink)', display: 'inline-flex' }}>{I.exclamationmark_circle!({ size: 22 })}</span>
            <p className="gk-subhead gk-grow">{fill(copy.advisory.unavailable, { bank })}</p>
          </div>
        ) : advisories.length === 0 ? (
          <div className="gk-card gk-row top" style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--gk-label-2)', display: 'inline-flex' }}>{I.shield!({ size: 22 })}</span>
            <p className="gk-subhead gk-grow">{fill(copy.advisory.none, { bank })}</p>
          </div>
        ) : (
          advisories.map((a, i) => <AdvisoryCard key={a.id} a={a} delay={60 * i} />)
        )}
        <div style={{ height: 16 }} />
        {data === 'loading' ? (
          <div className="gk-card"><Shimmer /></div>
        ) : data === null ? (
          <div className="gk-card"><p className="gk-subhead">{copy.verdict.cannot_check.body}</p></div>
        ) : (
          <>
            <div className="gk-card gk-reveal">
              <p className="gk-headline">{copy.activity.heading}</p>
              <p className="gk-callout" style={{ marginTop: 6, color: 'var(--gk-label-2)' }}>{data.text}</p>
            </div>
            {data.items.length > 0 && (
              <>
                <Section title={copy.app.activity.last24h} />
                <div className="gk-card flush">
                  {data.items.map((it, i) => (
                    <div key={`${it.category}-${it.channel}`}>
                      {i > 0 && <div className="gk-sep gk-activity-sep" />}
                      <div className="gk-row gk-activity-row gk-reveal" style={{ gap: 14, animationDelay: `${60 * i}ms` }}>
                        <span className="gk-icon-tile s34">{I[CATEGORY_ICON[it.category] ?? 'phone_fill']!({ size: 19 })}</span>
                        <span className="gk-grow">
                          <span className="gk-headline" style={{ display: 'block' }}>{cap(categoryText(it.category))}</span>
                          <span className="gk-footnote" style={{ display: 'block' }}>
                            {fill(copy.app.activity.by, { channel: channelText(it.channel) })}
                            {it.anyWithLink ? ` · ${copy.app.activity.withLink}` : ''}
                          </span>
                        </span>
                        <span className="gk-title3">{it.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <p className="gk-caption gk-center" style={{ marginTop: 18 }}>{copy.app.activity.footer}</p>
      </div>
    </Page>
  );
}

function AdvisoryCard({ a, delay }: { a: Advisory; delay: number }) {
  return (
    <div className="gk-card gk-reveal" style={{ marginBottom: 10, animationDelay: `${delay}ms` }}>
      <div className="gk-row top">
        <span className="gk-icon-tile s34 orange-ink">{I.exclamationmark_shield_fill!()}</span>
        <span className="gk-grow">
          <span className="gk-headline" style={{ display: 'block' }}>{fill(copy.advisory.title, { bank: a.bank })}</span>
          <span className="gk-footnote" style={{ display: 'block' }}>{fill(copy.advisory.issued, { date: dateText(a.approvedAt) })}</span>
        </span>
      </div>
      <p className="gk-callout" style={{ marginTop: 10 }}>{a.text}</p>
      {a.linkDomains.length > 0 && (
        <>
          <p className="gk-footnote" style={{ marginTop: 12 }}>{copy.advisory.lookalikeLabel}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {a.linkDomains.map((d) => <span key={d} className="gk-lookalike">{I.xmark_octagon_fill!()}{d}</span>)}
          </div>
        </>
      )}
      {a.asksCallback && <p className="gk-subhead" style={{ marginTop: 12 }}>{copy.advisory.callbackNote}</p>}
      <p className="gk-caption" style={{ marginTop: 12 }}>{fill(copy.advisory.until, { date: dateText(a.expiresAt) })}</p>
    </div>
  );
}

function SettingsTab({ session, onAdd, onSignOut }: { session: Session; bank: string; onAdd: () => void; onSignOut: () => void }) {
  const [confirm, setConfirm] = useState<'unlink' | 'remove' | null>(null);
  const s = copy.app.settings;
  const masked = session.phone.length > 4 ? `•••• ${session.phone.slice(-4)}` : session.phone;
  return (
    <>
      <Page title={copy.app.tabs.settings}>
        <div className="gk-list-head">{copy.banks.heading}</div>
        <div className="gk-list">
          <div className="gk-li static bank" style={{ minHeight: 64 }}>
            <span className="gk-bank-avatar">{session.bankName.charAt(0)}</span>
            <span className="gk-li-main">{session.bankName}<small>{masked}</small></span>
            <span className="gk-li-info" style={{ color: 'var(--gk-green-ink)' }}>{copy.banks.linked}</span>
            <button style={{ color: 'var(--gk-red)', display: 'inline-flex', padding: 10 }} onClick={() => setConfirm('remove')} aria-label={`${copy.banks.remove} ${session.bankName}`}>{I.minus_circle_fill!()}</button>
          </div>
          <button className="gk-li" onClick={onAdd}>
            <span className="gk-li-lead">{I.add_circled_solid!()}</span>
            <span className="gk-li-main" style={{ color: 'var(--gk-tint)' }}>{copy.banks.add}</span>
          </button>
        </div>

        <div style={{ height: 35 }} />
        <div className="gk-list">
          <div className="gk-li static">
            <span className="gk-li-lead" style={{ color: 'var(--gk-tint)' }}>{I.globe!()}</span>
            <span className="gk-li-main">{copy.app.language.title}</span>
            <span className="gk-li-info">{copy.app.language.names.en}</span>
          </div>
        </div>

        <div className="gk-list-head">{copy.shield.settingsTitle}</div>
        <div className="gk-list">
          {(['calls', 'messages'] as const).map((k) => (
            <div key={k} className="gk-li static">
              <span className="gk-li-lead">{k === 'calls' ? I.phone_fill!() : I.checkmark_shield_fill!()}</span>
              <span className="gk-li-main">{copy.shield.perm[k].title}</span>
              <span className="gk-on-pill">{copy.shield.on}</span>
            </div>
          ))}
        </div>
        <div className="gk-list-foot">{copy.shield.settingsIntro}</div>

        <div className="gk-list-head">{s.privacy}</div>
        <div className="gk-list">
          <div className="gk-li static"><span className="gk-li-lead">{I.lock_fill!()}</span><span className="gk-li-main">{s.textStays}{s.textStaysBody && <small>{s.textStaysBody}</small>}</span></div>
          <div className="gk-li static"><span className="gk-li-lead">{I.number!()}</span><span className="gk-li-main">{s.numbersMasked}</span></div>
          <div className="gk-li static"><span className="gk-li-lead">{I.hand_raised_fill!()}</span><span className="gk-li-main">{s.reportsConsent}</span></div>
        </div>

        <div className="gk-list-head">{s.about}</div>
        <div className="gk-list">
          <button className="gk-li" onClick={() => setConfirm('unlink')}>
            <span className="gk-li-lead" style={{ color: 'var(--gk-red)' }}>{I.square_arrow_right!()}</span>
            <span className="gk-li-main" style={{ color: 'var(--gk-red)' }}>{s.unlink}</span>
          </button>
        </div>
        <div className="gk-list-foot">{copy.safety.neverAsks}</div>
        <div style={{ height: 30 }} />
      </Page>
      {confirm && (
        <div className="gk-alert" onClick={() => setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <h3>{confirm === 'unlink' ? s.unlinkConfirm : fill(copy.banks.removeTitle, { bank: session.bankName })}</h3>
            <p>{confirm === 'unlink' ? s.unlinkBody : fill(copy.banks.removeBody, { bank: session.bankName })}</p>
            <div className="gk-alert-actions">
              <button onClick={() => setConfirm(null)}>{copy.app.common.cancel}</button>
              <button className="destructive" onClick={() => { device.signOut(session.phone); onSignOut(); }}>{confirm === 'unlink' ? s.unlinkAction : copy.banks.remove}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <motion.div className="gk-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div className="gk-sheet-peek" initial={{ opacity: 0 }} animate={{ opacity: 0.75 }} exit={{ opacity: 0 }} />
      <motion.div
        className="gk-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={spring}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, i) => (i.offset.y > 110 || i.velocity.y > 600) && onClose()}
      >
        <div className="gk-sheet-head">
          <span className="gk-headline gk-grow">{title}</span>
          <button className="gk-done" onClick={onClose}>{copy.app.common.done}</button>
        </div>
        {children}
      </motion.div>
    </>
  );
}

type Tone = 'tint' | 'blue' | 'orange' | 'grey';
const TONE: Record<Tone, string> = { tint: 'var(--gk-tint)', blue: 'var(--gk-blue)', orange: 'var(--gk-orange)', grey: 'var(--gk-grey)' };

function Hero({ v }: { v: { art: string; tone: Tone; tag: string; title: string; body: string } }) {
  const c = TONE[v.tone];
  return (
    <>
      <div className="gk-hero">
        <div className="gk-glow" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${c} 28%, transparent), transparent 70%)` }} />
        <img className="gk-art" src={art(v.art)} alt="" />
      </div>
      <div className="gk-center gk-reveal">
        {v.tag && <span className="gk-tag" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{v.tag}</span>}
        {v.title && <h2 className="gk-title1" style={{ margin: '0 0 10px' }}>{v.title}</h2>}
        <p className="gk-callout" style={{ color: 'var(--gk-label-2)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{v.body}</p>
      </div>
    </>
  );
}

function contactKind(contact: { type: string; value: string; platform?: string }, match?: { as?: string[]; platforms?: string[] }): string {
  const k = copy.official.contact.kinds;
  let type = contact.type;
  if (match?.as?.length && !match.as.includes(type)) type = match.as[0]!;
  const names = copy.official.contact.platforms as Record<string, string>;
  if (type === 'handle') return fill(k.social, { platform: `@${contact.value}` });
  if (type === 'social') {
    const p = match?.platforms?.[0] ?? contact.platform;
    return fill(k.social, { platform: p ? (names[p] ?? p) : `@${contact.value}` });
  }
  return (k as Record<string, string>)[type] ?? type;
}

export function ResultSheet({ req, phone, bank, onClose }: { req: CheckReq; phone: string; bank: string; onClose: () => void }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [link, setLink] = useState<LinkResult | null | 'failed'>(null);
  const [contact, setContact] = useState<ContactCheck | null>(null);
  const [explanation, setExplanation] = useState<Explained | null | 'loading' | undefined>(undefined);
  const [slow, setSlow] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    let on = true;
    const t = setTimeout(() => on && setSlow(true), 180);
    void (async () => {
      if (req.kind === 'link') {
        const l = await device.verifyLink(phone, req.text);
        if (on) setLink(l ?? 'failed');
      } else if (req.kind === 'contact') {
        const k = await device.verifyContact(phone, req.text);
        if (on) setContact(k);
      } else {
        const v = await device.verify(phone, req.text);
        if (!on) return;
        setResult(v);
        if (v.verdict === 'not_confirmed' && req.text.trim()) {
          setExplanation('loading');
          const e = await device.explain(phone, req.text);
          if (on) setExplanation(e);
        }
      }
    })();
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [req.key]);

  const done = result !== null || link !== null || contact !== null;
  const lr = link && link !== 'failed' ? link : null;
  const orgName = (result && 'bank' in result ? result.bank : null) ?? lr?.bank ?? bank;
  const heading = req.kind === 'contact' ? copy.official.app.contactCheck : req.kind === 'link' ? (lr?.verdict === 'official_app' || lr?.app ? copy.official.app.appCheck : copy.app.result.linkCheck) : copy.app.result.messageCheck;

  const view = (): { art: string; tone: Tone; tag: string; title: string; body: string } => {
    const cannot = { art: 'verdict_cannot_check', tone: 'grey' as Tone, tag: copy.verdict.cannot_check.short, title: copy.verdict.cannot_check.title, body: copy.verdict.cannot_check.body };
    if (contact) {
      const t = copy.official.contact;
      if (contact.verdict === 'official') return { art: 'shield', tone: 'blue', tag: t.official.short, title: t.official.title, body: contact.matches.map((m) => fill(t.official.body, { org: m.name, contact: contactKind(contact.contact, m) })).join('\n') };
      if (contact.verdict === 'not_official')
        return {
          art: 'verdict_not_confirmed',
          tone: 'orange',
          tag: t.not_official.short,
          title: t.not_official.title,
          body: contact.organisation ? fill(t.not_official.body, { org: contact.organisation.name, contact: contactKind(contact.contact) }) : fill(t.not_official.bodyAny, { contact: contactKind(contact.contact) }),
        };
      if (contact.verdict === 'not_a_contact') return { art: 'verdict_cannot_check', tone: 'grey', tag: '', title: '', body: t.notAContact };
      return { ...cannot, body: t.cannotCheckBody };
    }
    if (req.kind === 'link') {
      if (!lr) return cannot;
      if (lr.verdict === 'official_app') return { art: 'link', tone: 'blue', tag: copy.official.apps.short, title: fill(copy.official.apps.officialTitle, { org: orgName }), body: fill(copy.official.apps.officialBody, { org: orgName }) };
      if (lr.verdict === 'belongs') return { art: 'link', tone: 'blue', tag: copy.link.belongs.short, title: copy.link.belongs.title, body: fill(copy.link.belongs.body, { domain: lr.matchedDomain ?? '', bank: orgName }) };
      return { art: 'verdict_not_confirmed', tone: 'orange', tag: copy.verdict.not_confirmed.short, title: copy.link.not_confirmed.title, body: fill(copy.link.not_confirmed.body, { bank: orgName }) };
    }
    if (result?.verdict === 'confirmed')
      return {
        art: 'verdict_confirmed',
        tone: 'tint',
        tag: copy.verdict.confirmed.short,
        title: copy.verdict.confirmed.title,
        body: fill(copy.verdict.confirmed.body, { bank: result.bank, channel: channelText(result.channel), date: dateText(result.sentAt), time: timeText(result.sentAt) }),
      };
    if (result?.verdict === 'not_confirmed') return { art: 'verdict_not_confirmed', tone: 'orange', tag: copy.verdict.not_confirmed.short, title: copy.verdict.not_confirmed.title, body: fill(copy.verdict.not_confirmed.body, { bank: orgName }) };
    return cannot;
  };

  const report = async () => {
    setAsking(false);
    const ok = await device.report(phone, req.text, explanation && explanation !== 'loading' ? explanation.indicators : []).then(() => true, () => false);
    setReported(ok);
  };

  const warnings = result?.warnings ?? [];
  const reasons = lr && lr.verdict === 'not_confirmed'
    ? [
        ...(lr.reasons.includes('apk') ? [copy.official.apps.apk] : lr.reasons.includes('fake_app') ? [fill(copy.official.apps.fakeApp, { org: orgName })] : []),
        ...(lr.reasons.includes('shortened') ? [copy.link.shortened] : []),
        ...(lr.reasons.includes('lookalike') || lr.reasons.includes('punycode') ? [copy.link.lookalike] : []),
      ]
    : [];

  return (
    <Sheet title={heading} onClose={onClose}>
      {!done ? (
        <div className="gk-loading" style={{ opacity: slow ? 1 : 0, transition: 'opacity 0.2s' }}>
          <span className="gk-spinner" />
          <p className="gk-subhead">{copy.app.result.checking}</p>
        </div>
      ) : (
        <div className="gk-sheet-body">
          <Hero v={view()} />
          {warnings.includes('sim_swapped_recently') && <SimBanner title={copy.simswap.title} body={copy.simswap.body} color="var(--gk-red)" />}
          {!warnings.includes('sim_swapped_recently') && warnings.includes('sim_status_unknown') && <SimBanner title={copy.simswap.unknownTitle} body={copy.simswap.unknownBody} color="var(--gk-orange)" />}

          {lr && lr.verdict === 'not_confirmed' && (lr.host || reasons.length > 0) && (
            <div className="gk-card gk-reveal" style={{ marginTop: 22 }}>
              {lr.host && (
                <>
                  <p className="gk-caption gk-strong" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{copy.app.result.address}</p>
                  <p className="gk-headline gk-mono" style={{ fontSize: 16, marginTop: 4, wordBreak: 'break-all' }}>{lr.host}</p>
                </>
              )}
              {reasons.map((r) => <div key={r} className="gk-warning" style={{ marginTop: 12 }}>{I.exclamationmark_triangle_fill!()}<p className="gk-subhead gk-label">{r}</p></div>)}
            </div>
          )}

          {contact && (contact.verdict === 'official' || contact.verdict === 'not_official') && (
            <>
              <div className="gk-card gk-reveal" style={{ marginTop: 22, padding: '2px 18px' }}>
                <div className="gk-detail-row"><span className="gk-body">{copy.official.app.contact}</span><span className="gk-body">{contact.contact.type === 'handle' ? `@${contact.contact.value}` : contact.contact.value}</span></div>
                {contact.verdict === 'official' && <div className="gk-detail-row"><span className="gk-body">{copy.official.app.organisation}</span><span className="gk-body">{orList(contact.matches.map((m) => m.name))}</span></div>}
              </div>
              {contact.verdict === 'not_official' &&
                contact.impersonates.map((o) => <div key={o.id} className="gk-warning" style={{ marginTop: 14 }}>{I.exclamationmark_triangle_fill!()}<p className="gk-subhead gk-label">{fill(copy.official.contact.impersonation, { org: o.name })}</p></div>)}
              {contact.verdict === 'official' && <div className="gk-warning blue" style={{ marginTop: 14 }}>{I.info_circle_fill!()}<p className="gk-subhead gk-label">{copy.official.contact.spoofNote}</p></div>}
            </>
          )}

          {result?.verdict === 'confirmed' && (
            <div className="gk-card gk-reveal" style={{ marginTop: 26, padding: '2px 18px', animationDelay: '120ms' }}>
              <div className="gk-detail-row"><span className="gk-body">{copy.app.result.from}</span><span className="gk-body">{result.bank}</span></div>
              <div className="gk-detail-row"><span className="gk-body">{copy.app.result.channel}</span><span className="gk-body">{channelText(result.channel)}</span></div>
              <div className="gk-detail-row"><span className="gk-body">{copy.app.result.type}</span><span className="gk-body">{cap(categoryText(result.category))}</span></div>
              <div className="gk-detail-row"><span className="gk-body">{copy.app.result.sent}</span><span className="gk-body">{dateText(result.sentAt)}, {timeText(result.sentAt)}</span></div>
            </div>
          )}

          {result?.verdict === 'not_confirmed' && (
            <>
              <div className="gk-card gk-row top gk-reveal" style={{ marginTop: 26, gap: 14, animationDelay: '100ms' }}>
                <span className="gk-icon-tile s36">{I.clock_fill!({ size: 19 })}</span>
                <span className="gk-grow">
                  <span className="gk-headline" style={{ display: 'block' }}>{copy.activity.heading}</span>
                  <span className="gk-subhead" style={{ display: 'block', marginTop: 4 }}>{result.activityText}</span>
                </span>
              </div>
              <div className="gk-card gk-reveal" style={{ marginTop: 14, animationDelay: '180ms' }}>
                <div className="gk-row" style={{ gap: 14 }}>
                  <span className="gk-icon-tile s36 orange">{I.sparkles!({ size: 19 })}</span>
                  <span className="gk-headline gk-grow">{copy.explain.heading}</span>
                </div>
                <div style={{ marginTop: 14 }}>
                  {explanation === 'loading' ? (
                    <Shimmer />
                  ) : (
                    <>
                      {explanation && explanation.indicators.length > 0 && (
                        <div className="gk-chips">{explanation.indicators.map((i) => <span key={i}>{(copy.indicators as Record<string, string>)[i] ?? i}</span>)}</div>
                      )}
                      <p className="gk-subhead gk-label">{explanation?.explanation ?? copy.explain.fallback}</p>
                      <p className="gk-subhead gk-label gk-strong" style={{ marginTop: 10 }}>{explanation?.action ?? copy.explain.action}</p>
                      {explanation?.source === 'model' && <p className="gk-caption" style={{ marginTop: 10 }}>{copy.explain.aiNote}</p>}
                    </>
                  )}
                </div>
              </div>
              <div style={{ height: 22 }} />
              {reported ? (
                <div className="gk-row" style={{ justifyContent: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--gk-green)', display: 'inline-flex' }}>{I.checkmark_circle_fill!({ size: 20 })}</span>
                  <p className="gk-subhead">{copy.report.thanks}</p>
                </div>
              ) : (
                <Primary label={copy.app.result.reportFake} icon={I.flag_fill!()} red onClick={() => setAsking(true)} />
              )}
            </>
          )}
          <p className="gk-caption gk-center" style={{ marginTop: 26 }}>{copy.safety.neverAsks}</p>
        </div>
      )}
      <AnimatePresence>
        {asking && (
          <motion.div className="gk-actionsheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAsking(false)}>
            <motion.div initial={{ y: 200 }} animate={{ y: 0 }} exit={{ y: 200 }} transition={spring} onClick={(e) => e.stopPropagation()}>
              <div className="gk-actionsheet">
                <p>{copy.report.prompt}</p>
                <button className="destructive" onClick={() => void report()}>{copy.report.consent}</button>
              </div>
              <div className="gk-actionsheet"><button className="cancel" onClick={() => setAsking(false)}>{copy.app.common.cancel}</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function SimBanner({ title, body, color }: { title: string; body: string; color: string }) {
  return (
    <div className="gk-sim-banner" role="status" style={{ marginTop: 18, background: `color-mix(in srgb, ${color} 10%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)` }}>
      <span style={{ color, display: 'inline-flex' }}>{I.exclamationmark_triangle_fill!({ size: 20 })}</span>
      <span className="gk-grow">
        <span className="gk-subhead gk-label" style={{ display: 'block', fontWeight: 700 }}>{title}</span>
        <span className="gk-footnote gk-label" style={{ display: 'block', marginTop: 4, lineHeight: 1.4 }}>{body}</span>
      </span>
    </div>
  );
}

export function LicenceSheet({ phone, onClose }: { phone: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [checking, setChecking] = useState(false);
  const [r, setR] = useState<LicenceResult | null>(null);
  const t = copy.licence;
  const can = q.trim().length >= 2 && !checking;
  const check = async () => {
    if (!can) return;
    setChecking(true);
    setR(await device.checkLicence(phone, q.trim()));
    setChecking(false);
  };
  const categoryOf = (k: string) => (t.categories as Record<string, string>)[k] ?? k;
  const v = (res: LicenceResult): { art: string; tone: Tone; tag: string; title: string; body: string } => {
    if (res.verdict === 'licensed') return { art: 'shield', tone: 'blue', tag: t.licensed.short, title: t.licensed.title, body: fill(t.licensed.body, { name: res.firm.name, regulator: res.firm.regulator, category: categoryOf(res.firm.category) }) };
    if (res.verdict === 'not_listed') {
      const regs = orList(res.regulators.map((x) => x.name));
      return { art: 'verdict_not_confirmed', tone: 'orange', tag: t.not_listed.short, title: t.not_listed.title, body: fill(t.not_listed.body, { regulators: regs || 'FCCPC, CBN, SEC' }) };
    }
    return { art: 'verdict_cannot_check', tone: 'grey', tag: t.cannot_check.short, title: t.cannot_check.title, body: t.cannot_check.body };
  };
  return (
    <Sheet title={t.title} onClose={onClose}>
      <div className="gk-sheet-body" style={{ paddingTop: 8 }}>
        <p className="gk-subhead">{t.intro}</p>
        <div className="gk-card" style={{ marginTop: 14, padding: '12px 16px' }}>
          <input value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder={t.placeholder} onKeyDown={(e) => e.key === 'Enter' && void check()} aria-label={t.placeholder} />
        </div>
        <div style={{ height: 14 }} />
        <Primary label={t.check} icon={I.checkmark_seal_fill!()} gradient={can} disabled={!can && !checking} loading={checking} onClick={() => void check()} />
        {checking && <p className="gk-subhead gk-center" style={{ marginTop: 18 }}>{t.checking}</p>}
        {r && !checking && (
          <div style={{ marginTop: 18 }}>
            {(() => {
              const x = v(r);
              const c = TONE[x.tone];
              return (
                <div className="gk-center gk-reveal" role="status">
                  <img className="gk-art" src={art(x.art)} alt="" width={132} height={132} style={{ margin: '0 auto 8px' }} />
                  <span className="gk-tag" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{x.tag}</span>
                  <h2 className="gk-title2" style={{ margin: '0 0 10px' }}>{x.title}</h2>
                  <p className="gk-callout" style={{ color: 'var(--gk-label-2)', lineHeight: 1.45 }}>{x.body}</p>
                </div>
              );
            })()}
            {r.verdict === 'not_listed' && r.similarTo && (
              <div className="gk-card gk-warning" style={{ marginTop: 16 }}>{I.exclamationmark_triangle_fill!()}<p className="gk-subhead gk-label gk-strong">{fill(t.similar, { name: r.similarTo.name })}</p></div>
            )}
            {r.verdict === 'licensed' && (
              <div className="gk-card" style={{ marginTop: 18, padding: '2px 18px' }}>
                <div className="gk-detail-row"><span className="gk-body">{t.regulator}</span><span className="gk-body">{r.firm.regulator}</span></div>
                <div className="gk-detail-row"><span className="gk-body">{t.category}</span><span className="gk-body">{cap(categoryOf(r.firm.category))}</span></div>
                {r.firm.status && <div className="gk-detail-row"><span className="gk-body">{t.status}</span><span className="gk-body">{r.firm.status}</span></div>}
                <div className="gk-detail-row"><span className="gk-body">{t.source}</span><span className="gk-body">{r.firm.source.title}</span></div>
                <div className="gk-detail-row"><span className="gk-body">{t.listDate}</span><span className="gk-body">{r.firm.source.retrievedAt}</span></div>
              </div>
            )}
            {r.verdict === 'not_listed' && r.sources.length > 0 && (
              <p className="gk-caption gk-center" style={{ marginTop: 14 }}>{fill(t.listsChecked, { lists: [...new Map(r.sources.map((s) => [s.regulator, `${s.regulator} (${s.retrievedAt})`])).values()].join(', ') })}</p>
            )}
            {r.regulators.length > 0 && <p className="gk-caption gk-center" style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{r.regulators.map((x) => `${x.name}: ${x.url}`).join('\n')}</p>}
            {((r.verdict === 'licensed' && r.firm.source.sample) || (r.verdict === 'not_listed' && r.sources.some((s) => s.sample))) && <p className="gk-caption gk-center" style={{ marginTop: 8 }}>{t.sample}</p>}
          </div>
        )}
        <p className="gk-caption gk-center" style={{ marginTop: 26 }}>{copy.safety.neverAsks}</p>
      </div>
    </Sheet>
  );
}

export type { ContactResult };
