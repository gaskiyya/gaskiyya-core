import type { ReactNode } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const SHIELD = 'M12 2.6 19.6 5.5v5.7c0 4.9-3.2 9-7.6 10.3-4.4-1.3-7.6-5.4-7.6-10.3V5.5z';
const PHONE =
  'M6.6 3.2c.5-.4 1.3-.3 1.7.3l1.9 2.9c.3.5.3 1.1-.1 1.5L8.9 9.2c.9 2.3 3.6 5 5.9 5.9l1.3-1.2c.4-.4 1-.4 1.5-.1l2.9 1.9c.6.4.7 1.2.3 1.7l-1.4 1.8c-.6.8-1.7 1.1-2.6.8-5.5-1.7-9.8-6-11.5-11.5-.3-.9 0-2 .8-2.6z';
const GEAR =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';

const svg = (children: ReactNode, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const I: Record<string, (p?: { size?: number }) => ReactNode> = {
  checkmark_shield: (p) => svg(<><path d={SHIELD} {...S} /><path d="m8.6 12.1 2.4 2.4 4.6-4.9" {...S} /></>, p?.size),
  checkmark_shield_fill: (p) => svg(<><path d={SHIELD} fill="currentColor" /><path d="m8.6 12.1 2.4 2.4 4.6-4.9" {...S} stroke="var(--gk-on-tint, #fff)" strokeWidth={2.2} /></>, p?.size),
  phone: (p) => svg(<path d={PHONE} {...S} />, p?.size),
  phone_fill: (p) => svg(<path d={PHONE} fill="currentColor" />, p?.size),
  clock: (p) => svg(<><circle cx="12" cy="12" r="9" {...S} /><path d="M12 6.8V12H8.2" {...S} /></>, p?.size),
  clock_fill: (p) => svg(<><circle cx="12" cy="12" r="9.5" fill="currentColor" /><path d="M12 6.8V12H8.2" {...S} stroke="var(--gk-hole, #fff)" strokeWidth={2} /></>, p?.size),
  gear: (p) => svg(<><path d={GEAR} {...S} strokeWidth={1.5} /><circle cx="12" cy="12" r="3" {...S} strokeWidth={1.5} /></>, p?.size),
  gear_solid: (p) => svg(<><path d={GEAR} fill="currentColor" stroke="currentColor" strokeWidth={1.5} /><circle cx="12" cy="12" r="3.2" fill="var(--gk-hole, #fff)" /></>, p?.size),
  doc_on_clipboard: (p) => svg(<><rect x="7.5" y="5.5" width="11" height="15" rx="2.2" {...S} /><path d="M5.5 16.5V5.6c0-1.2.9-2.1 2.1-2.1h7.9" {...S} /><path d="M10.5 10h5M10.5 13.5h5" {...S} /></>, p?.size),
  photo: (p) => svg(<><rect x="3" y="4.5" width="18" height="15" rx="2.5" {...S} /><circle cx="8.5" cy="9.5" r="1.6" fill="currentColor" /><path d="m3.5 17 5-5 4 4 3-3 5 5" {...S} /></>, p?.size),
  person_check: (p) => svg(<><circle cx="10" cy="8" r="3.6" {...S} /><path d="M3.5 19.5c.8-3.3 3.4-5.2 6.5-5.2 1.4 0 2.6.3 3.6.9" {...S} /><path d="m15 17.6 2 2 4-4.2" {...S} /></>, p?.size),
  xmark_circle_fill: (p) => svg(<><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="m8.8 8.8 6.4 6.4m0-6.4-6.4 6.4" {...S} stroke="var(--gk-card, #fff)" strokeWidth={2} /></>, p?.size),
  link: (p) => svg(<><path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1" {...S} /><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1" {...S} /></>, p?.size),
  checkmark_seal_fill: (p) =>
    svg(
      <>
        <path d="M12 2.2l2.3 1.7 2.8-.2.9 2.7 2.4 1.5-.8 2.7.8 2.7-2.4 1.5-.9 2.7-2.8-.2L12 19.0l-2.3 1.4-2.8.2-.9-2.7-2.4-1.5.8-2.7-.8-2.7 2.4-1.5.9-2.7 2.8.2z" fill="currentColor" transform="translate(0 1.4)" />
        <path d="m8.6 12.6 2.3 2.3 4.5-4.7" {...S} stroke="#fff" strokeWidth={2} />
      </>,
      p?.size,
    ),
  chevron_forward: (p) => svg(<path d="m9 5 7 7-7 7" {...S} strokeWidth={2.4} />, p?.size),
  lock_shield_fill: (p) => svg(<><path d={SHIELD} fill="currentColor" /><rect x="9" y="11" width="6" height="5" rx="1" fill="var(--gk-bg, #fff)" /><path d="M10.2 11V9.6a1.8 1.8 0 0 1 3.6 0V11" {...S} stroke="var(--gk-bg, #fff)" strokeWidth={1.5} /></>, p?.size),
  arrow_clockwise: (p) => svg(<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" {...S} strokeWidth={2} /><path d="M19.6 4.2v4.3h-4.3" {...S} strokeWidth={2} /></>, p?.size),
  bolt_fill: (p) => svg(<path d="M13.4 2.5 5 13.6h6l-1 7.9 8.5-11.2h-6z" fill="currentColor" />, p?.size),
  exclamationmark_triangle_fill: (p) => svg(<><path d="M10.3 3.6a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z" fill="currentColor" /><path d="M12 8.8v4.6" {...S} stroke="#fff" strokeWidth={2.2} /><circle cx="12" cy="16.7" r="1.25" fill="#fff" /></>, p?.size),
  exclamationmark_circle: (p) => svg(<><circle cx="12" cy="12" r="9.5" {...S} /><path d="M12 7.5v5.5" {...S} strokeWidth={2} /><circle cx="12" cy="16.3" r="1.1" fill="currentColor" /></>, p?.size),
  sparkles: (p) => svg(<><path d="M10 3.5 11.7 8.3 16.5 10 11.7 11.7 10 16.5 8.3 11.7 3.5 10 8.3 8.3z" fill="currentColor" /><path d="m17.5 13.5.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" /></>, p?.size),
  flag_fill: (p) => svg(<><path d="M5 21V4" {...S} strokeWidth={2} /><path d="M5 4.5c2.6-1.6 5.1 1.4 7.6 0s4.6-.9 6.4 0v9c-1.8-.9-3.9-1.4-6.4 0s-5-1.6-7.6 0z" fill="currentColor" /></>, p?.size),
  checkmark_circle_fill: (p) => svg(<><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="m7.8 12.3 2.8 2.8 5.6-6" {...S} stroke="#fff" strokeWidth={2.2} /></>, p?.size),
  info_circle_fill: (p) => svg(<><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M12 11v6" {...S} stroke="#fff" strokeWidth={2.2} /><circle cx="12" cy="7.6" r="1.3" fill="#fff" /></>, p?.size),
  minus_circle_fill: (p) => svg(<><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M7.5 12h9" {...S} stroke="#fff" strokeWidth={2.4} /></>, p?.size),
  add_circled_solid: (p) => svg(<><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M12 7.5v9M7.5 12h9" {...S} stroke="#fff" strokeWidth={2.2} /></>, p?.size),
  globe: (p) => svg(<><circle cx="12" cy="12" r="9" {...S} /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" {...S} /></>, p?.size),
  lock_fill: (p) => svg(<><rect x="5" y="10.5" width="14" height="10.5" rx="2.4" fill="currentColor" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" {...S} strokeWidth={2.2} /></>, p?.size),
  number: (p) => svg(<path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 8.5h17M3 15.5h17" {...S} />, p?.size),
  hand_raised_fill: (p) =>
    svg(
      <path
        d="M8 11V5.2a1.4 1.4 0 0 1 2.8 0V10V3.9a1.4 1.4 0 0 1 2.8 0V10V5a1.4 1.4 0 0 1 2.8 0v6.5V8.4a1.4 1.4 0 0 1 2.8 0v6.3c0 3.7-2.8 6.8-6.6 6.8-2.3 0-4.3-1.2-5.4-3.1l-2.5-4.2a1.5 1.5 0 0 1 2.4-1.7z"
        fill="currentColor"
      />,
      p?.size,
    ),
  square_arrow_right: (p) => svg(<><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" {...S} /><path d="M3.5 12h11M11 8.5l3.5 3.5-3.5 3.5" {...S} /></>, p?.size),
  exclamationmark_shield_fill: (p) => svg(<><path d={SHIELD} fill="currentColor" /><path d="M12 7.6v5" {...S} stroke="#fff" strokeWidth={2.2} /><circle cx="12" cy="15.9" r="1.25" fill="#fff" /></>, p?.size),
  xmark_shield_fill: (p) => svg(<><path d={SHIELD} fill="currentColor" /><path d="m9.4 9.4 5.2 5.2m0-5.2-5.2 5.2" {...S} stroke="#fff" strokeWidth={2.2} /></>, p?.size),
  shield: (p) => svg(<path d={SHIELD} {...S} />, p?.size),
  xmark_octagon_fill: (p) => svg(<><path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z" fill="currentColor" /><path d="m9 9 6 6m0-6-6 6" {...S} stroke="#fff" strokeWidth={2} /></>, p?.size),
  number_square_fill: (p) => svg(<><rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" /><path d="M10.4 6.8 9.2 17.2M14.8 6.8l-1.2 10.4M7 10h10.5M6.5 14H17" {...S} stroke="#fff" strokeWidth={1.6} /></>, p?.size),
  arrows_square_fill: (p) => svg(<><rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" /><path d="M7 9.5h10m-3-3 3 3-3 3M17 14.5H7m3-3-3 3 3 3" {...S} stroke="#fff" strokeWidth={1.6} /></>, p?.size),
  gift_fill: (p) => svg(<><rect x="3.5" y="8" width="17" height="4.5" rx="1.2" fill="currentColor" /><rect x="5" y="12.5" width="14" height="8.5" rx="1.4" fill="currentColor" /><path d="M12 8v13M12 8C10.5 4 7 4.4 7.6 6.6 8 8 12 8 12 8zm0 0c1.5-4 5-3.6 4.4-1.4C16 8 12 8 12 8z" {...S} stroke="var(--gk-card, #fff)" strokeWidth={1.4} /></>, p?.size),
  creditcard_fill: (p) => svg(<><rect x="2.5" y="5" width="19" height="14" rx="2.8" fill="currentColor" /><path d="M2.5 9.5h19" stroke="var(--gk-card, #fff)" strokeWidth={2.2} /><path d="M6 15h4" {...S} stroke="var(--gk-card, #fff)" /></>, p?.size),
  checkmark_alt: (p) => svg(<path d="m5 12.5 4.5 4.5L19 7.5" {...S} strokeWidth={2.4} />, p?.size),
  xmark: (p) => svg(<path d="m6.5 6.5 11 11m0-11-11 11" {...S} strokeWidth={2.2} />, p?.size),
  chevron_back: (p) => svg(<path d="m15 4.5-7.5 7.5 7.5 7.5" {...S} strokeWidth={2.6} />, p?.size),
};
