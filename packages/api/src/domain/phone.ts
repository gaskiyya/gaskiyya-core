export function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const phone = `+${raw.replace(/\D/g, '')}`;
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}
