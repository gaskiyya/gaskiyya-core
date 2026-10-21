import type { ReactNode } from 'react';

const Tile = ({ id, from, to, children, light = false }: { id: string; from: string; to: string; children: ReactNode; light?: boolean }) => (
  <svg viewBox="0 0 60 60" className="ios-app-svg" aria-hidden="true">
    <defs>
      <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={from} />
        <stop offset="1" stopColor={to} />
      </linearGradient>
    </defs>
    <rect width="60" height="60" fill={`url(#g-${id})`} />
    {light && <rect width="60" height="60" fill="none" stroke="rgba(0,0,0,.06)" />}
    {children}
  </svg>
);

export const AppIcon: Record<string, () => ReactNode> = {
  messages: () => (
    <Tile id="msg" from="#67f07f" to="#0cbd2a">
      <path d="M30 13c-10.5 0-19 6.9-19 15.4 0 4.9 2.8 9.2 7.2 12-.5 2.6-2 5-4.3 6.7 3.9.2 7.6-1.1 10.4-3.5 1.8.4 3.7.6 5.7.6 10.5 0 19-6.9 19-15.4S40.5 13 30 13z" fill="#fff" />
    </Tile>
  ),
  phone: () => (
    <Tile id="ph" from="#67f07f" to="#0cbd2a">
      <path d="M22.4 14.6c1.2-.7 2.7-.4 3.5.7l3.1 4.3c.8 1.1.7 2.6-.3 3.6l-2.2 2.2c1.6 3.6 4.5 6.6 8.1 8.2l2.2-2.2c1-1 2.5-1.1 3.6-.3l4.3 3.1c1.1.8 1.4 2.3.7 3.5l-1.6 2.7c-1 1.6-2.9 2.4-4.7 1.9-10.3-2.6-18.4-10.7-21-21-.5-1.8.3-3.7 1.9-4.7z" fill="#fff" />
    </Tile>
  ),
  safari: () => (
    <Tile id="saf" from="#ffffff" to="#e8e8ed" light>
      <circle cx="30" cy="30" r="21" fill="#1a8cff" />
      <circle cx="30" cy="30" r="18.5" fill="none" stroke="#fff" strokeWidth="0.8" strokeDasharray="0.8 2.1" />
      <path d="M30 30l11-11-7.6 14.6z" fill="#ff3b30" />
      <path d="M30 30L19 41l7.6-14.6z" fill="#fff" />
    </Tile>
  ),
  music: () => (
    <Tile id="mus" from="#ff6a88" to="#fa233b">
      <path d="M38 14.5v20.8a5 5 0 1 1-2.6-4.4V20.3l-11.6 2.6v15.9a5 5 0 1 1-2.6-4.4V19.1z" fill="#fff" />
    </Tile>
  ),
  gaskiyya: () => (
    <Tile id="gk" from="#17a374" to="#075c40">
      <g transform="translate(6 6) scale(0.75)" fill="none" stroke="#f6f5f1" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M47.76 19.69A20 20 0 1 0 52 32" />
        <path d="M30 35.5l7 7L52 32" />
      </g>
    </Tile>
  ),
  bank: () => (
    <Tile id="bk" from="#3b3fd8" to="#1b1f6e">
      <path d="M30 12l17 8.5v3H13v-3z" fill="#fff" />
      <rect x="16" y="26" width="4" height="15" rx="1" fill="#fff" />
      <rect x="24" y="26" width="4" height="15" rx="1" fill="#fff" />
      <rect x="32" y="26" width="4" height="15" rx="1" fill="#fff" />
      <rect x="40" y="26" width="4" height="15" rx="1" fill="#fff" />
      <rect x="13" y="43.5" width="34" height="4" rx="1.2" fill="#ffcf4d" />
    </Tile>
  ),
  camera: () => (
    <Tile id="cam" from="#d8d8de" to="#9a9aa2">
      <rect x="11" y="20" width="38" height="25" rx="5" fill="#2c2c2e" />
      <path d="M23 20l2.5-4h9L37 20z" fill="#2c2c2e" />
      <circle cx="30" cy="32.5" r="8.5" fill="#48484a" stroke="#c7c7cc" strokeWidth="1.6" />
      <circle cx="30" cy="32.5" r="4.5" fill="#1c3a5e" />
      <circle cx="42.5" cy="25" r="1.6" fill="#ffd60a" />
    </Tile>
  ),
  photos: () => (
    <Tile id="pho" from="#ffffff" to="#f2f2f7" light>
      {['#ff9f0a', '#ffd60a', '#a4e04b', '#30d158', '#40c8e0', '#5e5ce6', '#bf5af2', '#ff375f'].map((c, i) => (
        <ellipse key={c} cx="30" cy="19" rx="6" ry="10" fill={c} opacity="0.88" transform={`rotate(${i * 45} 30 30)`} style={{ mixBlendMode: 'multiply' }} />
      ))}
    </Tile>
  ),
  mail: () => (
    <Tile id="mail" from="#4fc3ff" to="#1477f8">
      <rect x="11" y="18" width="38" height="25" rx="3.5" fill="#fff" />
      <path d="M12 19.5l18 13 18-13" fill="none" stroke="#1477f8" strokeOpacity="0.35" strokeWidth="2" strokeLinejoin="round" />
    </Tile>
  ),
  notes: () => (
    <Tile id="notes" from="#ffffff" to="#f4f4f6" light>
      <rect width="60" height="15" fill="#ffd34d" />
      {[24, 31, 38, 45].map((y) => <rect key={y} x="9" y={y} width="42" height="1" fill="#d1d1d6" />)}
      <path d="M9 15h42" stroke="#e0b62e" strokeWidth="1" />
    </Tile>
  ),
  clock: () => (
    <Tile id="clk" from="#1c1c1e" to="#000000">
      <circle cx="30" cy="30" r="21" fill="#fff" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="29.4" y="10.8" width="1.2" height={i % 3 === 0 ? 3.6 : 2} fill="#1c1c1e" transform={`rotate(${i * 30} 30 30)`} />
      ))}
      <path d="M30 30V17.5M30 30l7.5 5" stroke="#1c1c1e" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M30 30l-5 11" stroke="#ff9500" strokeWidth="1" strokeLinecap="round" />
      <circle cx="30" cy="30" r="1.6" fill="#ff9500" />
    </Tile>
  ),
  settings: () => (
    <Tile id="set" from="#a3a3ab" to="#6d6d75">
      <g transform="translate(30 30)">
        {Array.from({ length: 12 }, (_, i) => <rect key={i} x="-2.6" y="-19" width="5.2" height="7" rx="1.2" fill="#3a3a3c" transform={`rotate(${i * 30})`} />)}
        <circle r="14" fill="#3a3a3c" />
        <circle r="10.5" fill="#c7c7cc" />
        <circle r="5" fill="#3a3a3c" />
      </g>
    </Tile>
  ),
};

export const Glyph = {
  signal: () => (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
      <rect x="0" y="7.5" width="3" height="4.5" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  ),
  wifi: () => (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
      <path d="M8 2.4c2.4 0 4.6.9 6.3 2.4.2.2.5.2.7 0l.9-.9c.2-.2.2-.5 0-.7C13.8 1.2 11 0 8 0S2.2 1.2.1 3.2c-.2.2-.2.5 0 .7l.9.9c.2.2.5.2.7 0C3.4 3.3 5.6 2.4 8 2.4z" />
      <path d="M8 6.1c1.4 0 2.6.5 3.6 1.3.2.2.5.2.7 0l.9-.9c.2-.2.2-.5 0-.7C11.8 4.6 10 3.8 8 3.8s-3.8.8-5.2 2c-.2.2-.2.5 0 .7l.9.9c.2.2.5.2.7 0 1-.8 2.2-1.3 3.6-1.3z" />
      <path d="M10.2 9.2c.2-.2.2-.5 0-.7C9.6 8 8.8 7.7 8 7.7s-1.6.3-2.2.8c-.2.2-.2.5 0 .7l1.9 1.9c.2.2.5.2.7 0z" />
    </svg>
  ),
  battery: () => (
    <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity="0.4" />
      <rect x="2" y="2" width="16" height="9" rx="2.5" fill="currentColor" />
      <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  ),
  back: () => (
    <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevron: () => (
    <svg width="7" height="12" viewBox="0 0 7 12" aria-hidden="true"><path d="M1 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  compose: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  ),
  search: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="7" cy="7" r="5.2" /><path d="M11 11l3.6 3.6" /></svg>
  ),
  person: () => (
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="7" fill="#fff" /><path d="M6.5 34c1.5-6.5 7-10.5 13.5-10.5S32 27.5 33.5 34" fill="#fff" /></svg>
  ),
  plus: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
  mic: () => (
    <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="4" y="1" width="6" height="10" rx="3" /><path d="M1 8a6 6 0 0 0 12 0M7 14v3" /></svg>
  ),
  handset: ({ down = false }: { down?: boolean }) => (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style={down ? { transform: 'rotate(135deg)' } : undefined}>
      <path d="M6.6 3.5h2.2l1.6 4-2 1.3a11 11 0 0 0 6.8 6.8l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" fill="#fff" />
    </svg>
  ),
  copy: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="6.5" y="6.5" width="10" height="11" rx="2" /><path d="M13.5 6.5V4.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
  ),
  reply: () => (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4L3 9l5 5" /><path d="M3 9h8a6 6 0 0 1 6 6v1" /></svg>
  ),
  close: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
  shield: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12l2.2 2.2 4.3-4.4" /></svg>
  ),
  flag: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
  ),
  sun: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="5.5" fill="#ffd60a" />{Array.from({ length: 8 }, (_, i) => <rect key={i} x="12.1" y="1.5" width="1.8" height="4" rx="0.9" fill="#ffd60a" transform={`rotate(${i * 45} 13 13)`} />)}</svg>
  ),
  cloudSun: () => (
    <svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true"><circle cx="11" cy="9" r="5" fill="#ffd60a" /><path d="M10 22h13a5 5 0 0 0 0-10 6.5 6.5 0 0 0-12.4 2A4 4 0 0 0 10 22z" fill="#fff" /></svg>
  ),
  keypadBtn: (label: string) => <span>{label}</span>,
};

export const CallGlyph: Record<string, () => ReactNode> = {
  mute: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16" /></svg>
  ),
  keypad: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={6 + c * 6} cy={5 + r * 6} r="1.9" />))}<circle cx="12" cy="23" r="1.9" /></svg>
  ),
  audio: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" /></svg>
  ),
  add: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  video: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="M17 10.5l4.5-3v9l-4.5-3z" /></svg>
  ),
  contacts: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5z" /></svg>
  ),
};
