import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sim, type InboxItem } from '../api.ts';
import { device } from './api.ts';
import { CodeDigits, GaskiyyaApp, LicenceSheet, loadSession, requestFor, ResultSheet, saveSession, type CheckReq, type Session } from './gaskiyya/GaskiyyaApp.tsx';
import { I } from './gaskiyya/icons.tsx';
import { callShield, messageShield, type Shield } from './shield.ts';
import { AgentVoice } from './agentVoice.ts';
import copy from '../../../packages/schemas/copy.json';
import { AppIcon, CallGlyph, Glyph } from './icons.tsx';
import './device.css';

type AppId = 'messages' | 'gaskiyya' | 'bank';
type CallPhase = 'incoming' | 'active' | 'ended';
interface PhoneCall {
  kind: 'bank' | 'fraud';
  id: string;
  status: string;
  code?: string;
  purpose?: string;
}
type SheetState = { type: 'result'; req: CheckReq } | { type: 'licence' } | null;

const SCREEN_W = 393;
const SCREEN_H = 852;
const FRAME_W = SCREEN_W + 2 * 14;
const FRAME_H = SCREEN_H + 2 * 14;

const spring: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };
const soft: Transition = { type: 'spring', stiffness: 260, damping: 30 };

const knownStore = new Map<string, Set<string>>();
const seenStore = new Map<string, Set<string>>();

const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useInterval(fn: () => void, ms: number, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, ...deps]);
}

function useDark() {
  const read = () => {
    const forced = document.documentElement.dataset.theme;
    return forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(read());
    mq.addEventListener('change', on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', on);
      mo.disconnect();
    };
  }, []);
  return dark;
}

let officialNumber: Promise<string | null> | null = null;
function bankNumber(bank: string): Promise<string | null> {
  officialNumber ??= sim
    .organisations()
    .then(({ organisations }) => organisations.find((o) => o.name === bank)?.officialContacts.phones[0] ?? null)
    .catch(() => {
      officialNumber = null;
      return null;
    });
  return officialNumber;
}
export const officialBankNumber = bankNumber;

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?|\b0\d{3}[\s-]?\d{3}[\s-]?\d{4}\b)/gi);
  return <>{parts.map((p, i) => (i % 2 ? <span className="ios-link" key={i}>{p}</span> : p))}</>;
}

export function Device({ phone, name, bank, bankId = '' }: { phone: string; name: string; bank: string; bankId?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.85);
  const now = useNow(5000);
  const dark = useDark();

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / (FRAME_W + 24), (window.innerHeight - 56) / (FRAME_H + 10)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  const [session, setSessionState] = useState<Session | null>(() => loadSession(phone));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const setSession = (s: Session | null) => {
    saveSession(phone, s);
    setSessionState(s);
  };
  const [callerId, setCallerId] = useState<string | null>(null);
  useEffect(() => {
    void bankNumber(bank).then(setCallerId);
  }, [bank]);

  const [items, setItems] = useState<InboxItem[] | null>(null);
  useInterval(() => {
    sim.inbox(phone).then((r) => setItems(r.items)).catch(() => {});
  }, 1500, [phone]);

  const [app, setApp] = useState<AppId | null>(null);
  const [origin, setOrigin] = useState({ x: SCREEN_W / 2, y: SCREEN_H / 2 });
  const [thread, setThread] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => seenStore.get(phone) ?? new Set());
  const [banner, setBanner] = useState<{ key: string; icon: ReactNode; title: string; body: string; onTap: () => void } | null>(null);
  const [gkBanner, setGkBanner] = useState<{ key: string; shield: Shield; text: string } | null>(null);

  const markSeen = useCallback(
    (ids: string[]) => {
      setSeen((s) => {
        const next = new Set(s);
        for (const id of ids) next.add(id);
        seenStore.set(phone, next);
        return next;
      });
    },
    [phone],
  );

  const openApp = (id: AppId, el?: Element | null) => {
    if (el && screen.current) {
      const r = el.getBoundingClientRect();
      const s = screen.current.getBoundingClientRect();
      setOrigin({ x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale });
    } else {
      setOrigin({ x: SCREEN_W / 2, y: 60 });
    }
    setApp(id);
  };
  const goHome = () => {
    setApp(null);
    setMenu(null);
    setSheet(null);
  };

  const openThread = () => {
    setOrigin({ x: SCREEN_W / 2, y: 60 });
    setApp('messages');
    setThread(true);
    setBanner(null);
  };

  const [menu, setMenu] = useState<{ item: InboxItem; top: number; left: number; width: number; height: number } | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);

  const openMenu = (item: InboxItem, el: HTMLElement) => {
    if (!screen.current) return;
    const r = el.getBoundingClientRect();
    const s = screen.current.getBoundingClientRect();
    setMenu({ item, top: (r.top - s.top) / scale, left: (r.left - s.left) / scale, width: r.width / scale, height: r.height / scale });
  };

  const check = (req: CheckReq) => {
    setMenu(null);
    setBanner(null);
    setGkBanner(null);
    if (!sessionRef.current) {
      openApp('gaskiyya');
      return;
    }
    setSheet({ type: 'result', req });
  };

  const viewing = app === 'messages' && thread;
  useEffect(() => {
    if (!items) return;
    let known = knownStore.get(phone);
    if (!known) {
      known = new Set(items.map((i) => i.id));
      knownStore.set(phone, known);
      markSeen(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !known!.has(i.id));
    if (!fresh.length) return;
    for (const i of fresh) known.add(i.id);
    const m = fresh[0]!;
    if (viewing) markSeen(fresh.map((i) => i.id));
    else setBanner({ key: m.id, icon: <AppIcon.messages />, title: m.from, body: m.text, onTap: openThread });
    const s = sessionRef.current;
    if (s && (!m.tenantId || m.tenantId === s.bankId)) {
      void device.verify(s.phone, m.text).then((r) => setGkBanner({ key: m.id, shield: messageShield(r, m.text, s.bankName), text: m.text }));
    }
  }, [items]);
  useEffect(() => {
    if (viewing && items) markSeen(items.map((i) => i.id));
  }, [viewing, items, markSeen]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => {
    if (!gkBanner) return;
    const t = setTimeout(() => setGkBanner(null), 9000);
    return () => clearTimeout(t);
  }, [gkBanner]);

  const unread = (items ?? []).filter((i) => !seen.has(i.id)).length;

  const [call, setCall] = useState<PhoneCall | null>(null);
  const [phase, setPhase] = useState<CallPhase | null>(null);
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null);
  const [shield, setShield] = useState<(Shield & { codes: string[] }) | 'loading' | null>(null);
  const declined = useRef(new Set<string>());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const callRef = useRef(call);
  callRef.current = call;

  const voice = useRef<AgentVoice | null>(null);
  const [muted, setMuted] = useState(false);
  const stopVoice = () => {
    voice.current?.stop();
    voice.current = null;
    setMuted(false);
  };
  useEffect(() => () => voice.current?.stop(), []);

  useInterval(() => {
    Promise.all([sim.calls(), sim.fraudCalls().catch(() => ({ calls: [] }))])
      .then(([bankCalls, fraud]) => {
        const live = (x: { phone: string; status: string; expiresAt: string; id: string }) => x.phone === phone && (x.status === 'open' || x.status === 'answered') && Date.parse(x.expiresAt) > Date.now() && !declined.current.has(x.id);
        const b = bankCalls.calls.find((x) => x.id === callRef.current?.id && live(x)) ?? bankCalls.calls.find(live);
        const f = fraud.calls.find((x) => x.phone === phone && (x.status === 'answered' || (x.status === 'ringing' && Date.parse(x.expiresAt) > Date.now())) && !declined.current.has(x.id));
        const c: PhoneCall | null = b ? { kind: 'bank', id: b.id, status: b.status, code: b.code, purpose: b.purpose } : f ? { kind: 'fraud', id: f.id, status: f.status === 'ringing' ? 'open' : 'answered' } : null;
        if (c) {
          if (callRef.current?.id !== c.id) {
            const s = sessionRef.current;
            setShield(s ? 'loading' : null);
            if (s) void device.checkCall(s.phone).then((st) => setShield(callShield(st, s.bankName)));
            stopVoice();
            if (c.kind === 'bank' && c.code) voice.current = new AgentVoice({ orgId: bankId, code: c.code });
          }
          setCall(c);
          if (c.status === 'open' && phaseRef.current !== 'incoming' && !(phaseRef.current === 'active' && callRef.current?.id === c.id)) setPhase('incoming');
          if (c.status === 'answered' && phaseRef.current !== 'active') {
            setPhase('active');
            setAcceptedAt((a) => a ?? Date.now());
          }
        } else if (phaseRef.current === 'incoming' || phaseRef.current === 'active') {
          stopVoice();
          setPhase('ended');
          setTimeout(() => {
            setPhase((p) => (p === 'ended' ? null : p));
            setCall(null);
            setAcceptedAt(null);
            setShield(null);
          }, 1600);
        }
      })
      .catch(() => {});
  }, 1500, [phone]);

  const updateCall = (c: PhoneCall, status: 'answered' | 'ended') => (c.kind === 'bank' ? sim.updateCall(c.id, status) : sim.updateFraudCall(c.id, status)).catch(() => {});
  const accept = async () => {
    if (!call) return;
    voice.current?.start();
    setPhase('active');
    setAcceptedAt(Date.now());
    setBanner(null);
    await updateCall(call, 'answered');
  };
  const hangUp = async () => {
    if (!call) return;
    stopVoice();
    declined.current.add(call.id);
    setPhase('ended');
    setBanner(null);
    await updateCall(call, 'ended');
    setTimeout(() => {
      setPhase(null);
      setCall(null);
      setAcceptedAt(null);
      setShield(null);
    }, 1400);
  };

  const statusLight = phase === 'incoming' || phase === 'active' || phase === 'ended' || app === null || app === 'bank' || (app === 'gaskiyya' && dark);
  const threadItems = useMemo(() => [...(items ?? [])].reverse(), [items]);
  const bankCallId = call?.kind === 'bank' && (phase === 'incoming' || phase === 'active') ? call.id : null;

  return (
    <div className="ios-slot" ref={wrap}>
      <div className="ios-scaler" style={{ width: FRAME_W * scale, height: FRAME_H * scale }}>
        <div className="ios-frame" style={{ transform: `scale(${scale})` }}>
          <span className="ios-btn action" /><span className="ios-btn vol-up" /><span className="ios-btn vol-down" /><span className="ios-btn power" />
          <div className="ios-screen" ref={screen}>
            <Home onOpen={openApp} unread={unread} now={now} />

            <AnimatePresence>
              {app && (
                <motion.div
                  key={app}
                  className={`ios-app ios-app-${app}`}
                  style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
                  initial={{ scale: 0.12, opacity: 0, borderRadius: 60 }}
                  animate={{ scale: 1, opacity: 1, borderRadius: 0 }}
                  exit={{ scale: 0.12, opacity: 0, borderRadius: 60 }}
                  transition={spring}
                >
                  {app === 'messages' && (
                    <MessagesApp
                      bank={bank}
                      items={items ?? []}
                      threadItems={threadItems}
                      thread={thread}
                      setThread={setThread}
                      unread={unread}
                      onHold={openMenu}
                    />
                  )}
                  {app === 'gaskiyya' && (
                    <GaskiyyaApp
                      devicePhone={phone}
                      bank={bank}
                      items={items ?? []}
                      callId={bankCallId}
                      session={session}
                      onSession={setSession}
                      onCheck={check}
                      onLicence={() => setSheet({ type: 'licence' })}
                    />
                  )}
                  {app === 'bank' && <BankApp bank={bank} name={name} items={items ?? []} onVerify={(el) => openApp('gaskiyya', el)} />}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {menu && <ContextMenu key="menu" menu={menu} onClose={() => setMenu(null)} onCheck={() => check(requestFor(menu.item.text))} />}
            </AnimatePresence>

            <AnimatePresence>
              {sheet && session && (
                <motion.div key={sheet.type === 'result' ? sheet.req.key : 'licence'} className="gk gk-overlay" exit={{ opacity: 1 }}>
                  {sheet.type === 'result' ? (
                    <ResultSheet req={sheet.req} phone={session.phone} bank={session.bankName} onClose={() => setSheet(null)} />
                  ) : (
                    <LicenceSheet phone={session.phone} onClose={() => setSheet(null)} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {phase && call && (
                <CallScreen
                  key="call"
                  phase={phase}
                  bank={bank}
                  number={callerId}
                  shield={shield}
                  muted={muted}
                  onMute={() => {
                    voice.current?.setMuted(!muted);
                    setMuted(!muted);
                  }}
                  acceptedAt={acceptedAt}
                  onAccept={accept}
                  onHangUp={hangUp}
                  onCloseShield={() => setShield(null)}
                />
              )}
            </AnimatePresence>

            <StatusBar light={statusLight} now={now} />
            <div className="ios-island" />

            <div className="ios-banners">
              <AnimatePresence>
                {banner && (
                  <motion.button
                    key={banner.key}
                    layout
                    className="ios-banner"
                    initial={{ y: -140, scale: 0.96 }}
                    animate={{ y: 0, scale: 1 }}
                    exit={{ y: -140, opacity: 0.6 }}
                    transition={soft}
                    drag="y"
                    dragConstraints={{ top: 0, bottom: 0 }}
                    onDragEnd={(_, i) => i.offset.y < -20 && setBanner(null)}
                    onClick={() => {
                      banner.onTap();
                      setBanner(null);
                    }}
                  >
                    <span className="ios-banner-icon">{banner.icon}</span>
                    <span className="ios-banner-body">
                      <span className="ios-banner-head"><b>{banner.title}</b><small>now</small></span>
                      <span className="ios-banner-text">{banner.body}</span>
                    </span>
                  </motion.button>
                )}
                {gkBanner && (
                  <motion.button
                    key={`gk-${gkBanner.key}`}
                    layout
                    className={`ios-banner gk-notice ${gkBanner.shield.tone}`}
                    initial={{ y: -160, scale: 0.96 }}
                    animate={{ y: 0, scale: 1 }}
                    exit={{ y: -160, opacity: 0.6 }}
                    transition={{ ...soft, delay: 0.15 }}
                    drag="y"
                    dragConstraints={{ top: 0, bottom: 0 }}
                    onDragEnd={(_, i) => i.offset.y < -20 && setGkBanner(null)}
                    onClick={() => {
                      check(requestFor(gkBanner.text));
                      setGkBanner(null);
                    }}
                  >
                    <span className="ios-banner-icon"><AppIcon.gaskiyya /></span>
                    <span className="ios-banner-body">
                      <span className="ios-banner-head"><span className="gk-notice-app">GASKIYYA</span><small>now</small></span>
                      <span className="gk-notice-title">{gkBanner.shield.title}</span>
                      <span className="ios-banner-text">{gkBanner.shield.body}</span>
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <button className={`ios-home-bar ${statusLight && !sheet ? 'light' : ''}`} aria-label="Go to the home screen" onClick={goHome} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBar({ light, now }: { light: boolean; now: Date }) {
  return (
    <div className={`ios-status ${light ? 'light' : ''}`}>
      <span className="ios-time">{clock(now)}</span>
      <span className="ios-status-right"><Glyph.signal /><Glyph.wifi /><Glyph.battery /></span>
    </div>
  );
}

const GRID: { id: string; label: string; open?: AppId }[] = [
  { id: 'gaskiyya', label: 'Gaskiyya', open: 'gaskiyya' },
  { id: 'bank', label: 'DemoBank', open: 'bank' },
  { id: 'camera', label: 'Camera' },
  { id: 'photos', label: 'Photos' },
  { id: 'mail', label: 'Mail' },
  { id: 'notes', label: 'Notes' },
  { id: 'clock', label: 'Clock' },
  { id: 'settings', label: 'Settings' },
];
const DOCK: { id: string; label: string; open?: AppId }[] = [
  { id: 'phone', label: 'Phone' },
  { id: 'safari', label: 'Safari' },
  { id: 'messages', label: 'Messages', open: 'messages' },
  { id: 'music', label: 'Music' },
];

function Home({ onOpen, unread, now }: { onOpen: (id: AppId, el: Element) => void; unread: number; now: Date }) {
  const icon = (a: { id: string; label: string; open?: AppId }, dock = false) => (
    <motion.button
      key={a.id}
      className="ios-icon"
      whileTap={{ scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      onClick={(e) => a.open && onOpen(a.open, e.currentTarget)}
      aria-label={a.label}
    >
      <span className="ios-icon-art">{AppIcon[a.id]!()}</span>
      {a.id === 'messages' && unread > 0 && <span className="ios-badge">{unread}</span>}
      {!dock && <span className="ios-icon-label">{a.label}</span>}
    </motion.button>
  );
  return (
    <div className="ios-home">
      <div className="ios-wallpaper" />
      <div className="ios-widgets">
        <div className="ios-widget weather">
          <div className="w-city">Lagos <span>&#x27A4;</span></div>
          <div className="w-temp">31&deg;</div>
          <div className="w-foot"><Glyph.cloudSun /><div>Partly Cloudy<br />H:33&deg; L:25&deg;</div></div>
        </div>
        <div className="ios-widget calendar">
          <div className="c-day">{now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}</div>
          <div className="c-date">{now.getDate()}</div>
          <div className="c-event">No events today</div>
        </div>
      </div>
      <div className="ios-grid">{GRID.map((a) => icon(a))}</div>
      <div className="ios-search"><Glyph.search /> Search</div>
      <div className="ios-dock">{DOCK.map((a) => icon(a, true))}</div>
    </div>
  );
}

function MessagesApp({
  bank,
  items,
  threadItems,
  thread,
  setThread,
  unread,
  onHold,
}: {
  bank: string;
  items: InboxItem[];
  threadItems: InboxItem[];
  thread: boolean;
  setThread: (b: boolean) => void;
  unread: number;
  onHold: (item: InboxItem, el: HTMLElement) => void;
}) {
  const latest = items[0];
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thread) end.current?.scrollIntoView({ block: 'end' });
  }, [thread, threadItems.length]);

  return (
    <div className="ios-msgs">
      <AnimatePresence initial={false} mode="popLayout">
        {!thread ? (
          <motion.div key="list" className="ios-page" initial={{ x: '-30%' }} animate={{ x: 0 }} exit={{ x: '-30%' }} transition={spring}>
            <div className="ios-nav-row"><span className="ios-blue">Edit</span><span className="ios-blue"><Glyph.compose /></span></div>
            <h1 className="ios-large-title">Messages</h1>
            <div className="ios-searchfield"><Glyph.search /> Search</div>
            {latest ? (
              <button className="ios-convo" onClick={() => setThread(true)}>
                <span className={`ios-unread-dot ${unread ? 'on' : ''}`} />
                <span className="ios-avatar"><Glyph.person /></span>
                <span className="ios-convo-main">
                  <span className="ios-convo-top"><b>{latest.from}</b><span>{timeLabel(latest.at)} <Glyph.chevron /></span></span>
                  <span className="ios-convo-preview">{latest.text}</span>
                </span>
              </button>
            ) : (
              <div className="ios-empty">No Messages</div>
            )}
          </motion.div>
        ) : (
          <motion.div key="thread" className="ios-page ios-thread" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring}>
            <div className="ios-thread-head">
              <button className="ios-back ios-blue" onClick={() => setThread(false)} aria-label="Back to conversations"><Glyph.back /></button>
              <div className="ios-thread-who">
                <span className="ios-avatar sm"><Glyph.person /></span>
                <span>{bank} <Glyph.chevron /></span>
              </div>
            </div>
            <div className="ios-thread-body">
              <div className="ios-thread-meta">Text Message &middot; SMS<br /><b>Today</b> {threadItems[0] ? timeLabel(threadItems[0].at) : ''}</div>
              {threadItems.map((m, i) => (
                <Bubble key={m.id} item={m} last={i === threadItems.length - 1 || threadItems[i + 1]!.from !== m.from} onHold={onHold} />
              ))}
              <div ref={end} />
            </div>
            <div className="ios-hint">Press and hold a message to check it with Gaskiyya</div>
            <div className="ios-compose">
              <span className="ios-compose-plus"><Glyph.plus /></span>
              <span className="ios-compose-field">Text Message <Glyph.mic /></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Bubble({ item, last, onHold }: { item: InboxItem; last: boolean; onHold: (item: InboxItem, el: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const fire = () => ref.current && onHold(item, ref.current);
  return (
    <motion.div
      ref={ref}
      className={`ios-bubble ${last ? 'tail' : ''}`}
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={soft}
      whileTap={{ scale: 0.97 }}
      role="button"
      tabIndex={0}
      aria-label="Message. Press to check it with Gaskiyya."
      onPointerDown={() => (timer.current = window.setTimeout(fire, 420))}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onClick={() => {
        clearTimeout(timer.current);
        fire();
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fire()}
      onContextMenu={(e) => {
        e.preventDefault();
        fire();
      }}
    >
      <Linkified text={item.text} />
    </motion.div>
  );
}

function ContextMenu({ menu, onClose, onCheck }: { menu: { item: InboxItem; top: number; left: number; width: number; height: number }; onClose: () => void; onCheck: () => void }) {
  const menuH = 186;
  const top = Math.min(Math.max(menu.top, 120), SCREEN_H - menu.height - menuH - 40);
  return (
    <motion.div className="ios-ctx" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose}>
      <motion.div className="ios-ctx-react" style={{ top: top - 58, left: menu.left }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring}>
        {['\u2764\uFE0F', '\uD83D\uDC4D', '\uD83D\uDC4E', '\uD83D\uDE02', '\u203C\uFE0F', '\u2753'].map((e) => <span key={e}>{e}</span>)}
      </motion.div>
      <motion.div className="ios-bubble tail lifted" style={{ top, left: menu.left, width: menu.width }} initial={{ top: menu.top, scale: 1 }} animate={{ top, scale: 1.03 }} exit={{ top: menu.top, scale: 1 }} transition={spring}>
        <Linkified text={menu.item.text} />
      </motion.div>
      <motion.div
        className="ios-ctx-menu"
        style={{ top: top + menu.height + 14, left: menu.left }}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.4, opacity: 0 }}
        transition={spring}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="gk" onClick={onCheck}>Check with Gaskiyya <span className="ios-ctx-gk"><AppIcon.gaskiyya /></span></button>
        <button onClick={onClose}>Reply <Glyph.reply /></button>
        <button onClick={() => { void navigator.clipboard?.writeText(menu.item.text).catch(() => {}); onClose(); }}>Copy <Glyph.copy /></button>
      </motion.div>
    </motion.div>
  );
}

const showNumber = (n: string) => {
  const d = n.replace(/\D/g, '');
  const local = d.startsWith('234') ? `0${d.slice(3)}` : d;
  return local.length === 11 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : n;
};

const SHIELD_ICON: Record<Shield['tone'], string> = { confirmed: 'checkmark_shield_fill', not_confirmed: 'xmark_shield_fill', cannot_check: 'exclamationmark_shield_fill' };

function ShieldCard({ shield, onClose }: { shield: (Shield & { codes: string[] }) | 'loading'; onClose: () => void }) {
  return (
    <motion.div className={`gk-shield ${shield === 'loading' ? '' : shield.tone}`} role="alert" initial={{ y: -16, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ ...soft, delay: 0.2 }}>
      <div className="gk-shield-head">
        <img src="img/3d-logo.webp" alt="" />
        <span>Gaskiyya &middot; {copy.shield.channelName}</span>
        <button className="gk-shield-close" onClick={onClose} aria-label={copy.shield.close}>{I.xmark!()}</button>
      </div>
      {shield === 'loading' ? (
        <div className="gk-shield-body" style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}><span className="ios-spinner sm" />{copy.app.result.checking}</div>
      ) : (
        <>
          <div className="gk-shield-title">{I[SHIELD_ICON[shield.tone]]!()}<span>{shield.title}</span></div>
          <div className="gk-shield-body">{shield.body}</div>
          {shield.codes.map((c) => <CodeDigits key={c} code={c} />)}
        </>
      )}
    </motion.div>
  );
}

function CallScreen({
  phase,
  bank,
  number,
  shield,
  muted,
  onMute,
  acceptedAt,
  onAccept,
  onHangUp,
  onCloseShield,
}: {
  phase: CallPhase;
  bank: string;
  number: string | null;
  shield: (Shield & { codes: string[] }) | 'loading' | null;
  muted: boolean;
  onMute: () => void;
  acceptedAt: number | null;
  onAccept: () => void;
  onHangUp: () => void;
  onCloseShield: () => void;
}) {
  const now = useNow(1000);
  const secs = acceptedAt ? Math.max(0, Math.floor((now.getTime() - acceptedAt) / 1000)) : 0;
  const label = phase === 'incoming' ? (number ? showNumber(number) : 'mobile') : phase === 'ended' ? 'Call Ended' : `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <motion.div className="ios-call" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={soft}>
      <div className="ios-call-bg" />
      <div className="ios-call-top">
        <motion.div className="ios-call-name" layout>{bank}</motion.div>
        <div className="ios-call-sub">{label}</div>
      </div>

      {shield && phase !== 'ended' && (
        <div className="ios-call-shield">
          <ShieldCard shield={shield} onClose={onCloseShield} />
        </div>
      )}

      {phase === 'incoming' && (
        <div className="ios-call-actions">
          <div className="ios-call-small"><span>Remind Me</span><span>Message</span></div>
          <div className="ios-call-buttons">
            <div>
              <motion.button className="ios-round decline" whileTap={{ scale: 0.9 }} onClick={onHangUp} aria-label="Decline"><Glyph.handset down /></motion.button>
              <span>Decline</span>
            </div>
            <div>
              <motion.button className="ios-round accept" whileTap={{ scale: 0.9 }} animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} onClick={onAccept} aria-label="Accept">
                <Glyph.handset />
              </motion.button>
              <span>Accept</span>
            </div>
          </div>
        </div>
      )}

      {phase !== 'incoming' && (
        <div className="ios-call-actions">
          <div className="ios-call-grid">
            {(['mute', 'keypad', 'audio', 'add', 'video', 'contacts'] as const).map((k) =>
              k === 'mute' ? (
                <div key={k}>
                  <button type="button" className={`ios-round glass${muted ? ' on' : ''}`} onClick={onMute} aria-pressed={muted} aria-label="Mute the caller">{CallGlyph[k]!()}</button>
                  <span>mute</span>
                </div>
              ) : (
                <div key={k}><span className="ios-round glass">{CallGlyph[k]!()}</span><span>{{ keypad: 'keypad', audio: 'audio', add: 'add call', video: 'FaceTime', contacts: 'contacts' }[k]}</span></div>
              ),
            )}
          </div>
          <div className="ios-call-buttons single">
            <motion.button className="ios-round decline" whileTap={{ scale: 0.9 }} onClick={onHangUp} disabled={phase === 'ended'} aria-label="End call"><Glyph.handset down /></motion.button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function BankApp({ bank, name, items, onVerify }: { bank: string; name: string; items: InboxItem[]; onVerify: (el: Element) => void }) {
  const alerts = items.filter((i) => i.kind === 'genuine' && i.category === 'transaction_alert');
  const balance = alerts[0]?.text.match(/Bal:\s*NGN([\d,]+\.\d{2})/)?.[1] ?? '664,898.26';
  const hour = new Date().getHours();
  return (
    <div className="ios-bank">
      <div className="ios-bank-head">
        <p>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'},</p>
        <h1>{name.split(' ')[0]}</h1>
        <div className="ios-bank-card">
          <small>Savings &middot; &bull;&bull;&bull;&bull;5678</small>
          <b>&#x20A6;{balance}</b>
          <small>Available balance</small>
        </div>
      </div>
      <div className="ios-bank-actions">
        {['Transfer', 'Airtime', 'Bills', 'Cards'].map((a) => <span key={a}><i />{a}</span>)}
      </div>
      <button className="ios-bank-verify" onClick={(e) => onVerify(e.currentTarget)}>
        <span className="ios-mini-icon"><AppIcon.gaskiyya /></span>
        <span><b>Got a message from &ldquo;{bank}&rdquo;?</b><small>Check it is really us before you click, call or reply.</small></span>
        <Glyph.chevron />
      </button>
      <div className="ios-bank-list">
        <div className="ios-group-title">Recent transactions</div>
        {alerts.length === 0 && <p className="ios-muted">No transactions yet.</p>}
        {alerts.slice(0, 6).map((a) => (
          <div key={a.id} className="ios-bank-tx">
            <span>{a.text.match(/Desc:\s*(.+)/)?.[1] ?? 'Debit'}</span>
            <b>-&#x20A6;{a.text.match(/Amt:\s*NGN([\d,]+\.\d{2})/)?.[1] ?? ''}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
