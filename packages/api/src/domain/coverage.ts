export interface CoverageInput {
  registrations: number;
  registrationsByChannel: Record<string, number>;
  verifications: Record<string, number>;
  messageChecksByChannel: Record<string, number>;
}

export interface Coverage {
  registered: number;
  checked: number;
  confirmed: number;
  notConfirmed: number;
  cannotCheck: number;
  notConfirmedRate: number | null;
  cannotCheckRate: number | null;
  checksByChannel: Record<string, number>;
  registeredByChannel: Record<string, number>;
}

const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);

export function coverage(m: CoverageInput): Coverage {
  const confirmed = m.verifications.confirmed ?? 0;
  const notConfirmed = m.verifications.not_confirmed ?? 0;
  const cannotCheck = m.verifications.cannot_check ?? 0;
  const checked = confirmed + notConfirmed + cannotCheck;
  return {
    registered: m.registrations,
    checked,
    confirmed,
    notConfirmed,
    cannotCheck,
    notConfirmedRate: ratio(notConfirmed, checked),
    cannotCheckRate: ratio(cannotCheck, checked),
    checksByChannel: { ...m.messageChecksByChannel },
    registeredByChannel: { ...m.registrationsByChannel },
  };
}
