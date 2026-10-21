import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' } as const;

export const IconMessage = (p: P) => (
  <svg {...base} {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" /></svg>
);
export const IconPhone = (p: P) => (
  <svg {...base} {...p}><path d="M6.6 3.5h2.2l1.6 4-2 1.3a11 11 0 0 0 6.8 6.8l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base} {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12l2.2 2.2 4.3-4.4" /></svg>
);
export const IconChart = (p: P) => (
  <svg {...base} {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const IconSpark = (p: P) => (
  <svg {...base} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>
);
export const IconWarning = (p: P) => (
  <svg {...base} {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.2M12 17.2v.1" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" /></svg>
);
export const IconReset = (p: P) => (
  <svg {...base} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" /></svg>
);
export const IconSend = (p: P) => (
  <svg {...base} {...p}><path d="M5 12h12M12 6l6 6-6 6" /></svg>
);
export const IconScissors = (p: P) => (
  <svg {...base} {...p}><circle cx="6" cy="7" r="2.5" /><circle cx="6" cy="17" r="2.5" /><path d="M8 8.5 20 17M8 15.5 20 7" /></svg>
);
export const IconTray = (p: P) => (
  <svg {...base} {...p}><path d="M3 13.5 5.5 5h13L21 13.5V19H3z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></svg>
);
export const IconKeypad = (p: P) => (
  <svg {...base} {...p}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M9 6.5h6M9.5 11h.01M12 11h.01M14.5 11h.01M9.5 14h.01M12 14h.01M14.5 14h.01M9.5 17h.01M12 17h.01M14.5 17h.01" /></svg>
);
export const IconBadge = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="4" width="17" height="13" rx="2" /><path d="M7.5 8.5h6M7.5 12h4" /><circle cx="16.5" cy="13.5" r="2.2" /><path d="m15.2 15.4-.9 4.1 2.2-1.2 2.2 1.2-.9-4.1" /></svg>
);
export const IconTransfer = (p: P) => (
  <svg {...base} {...p}><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></svg>
);
