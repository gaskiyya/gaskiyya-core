export type SenderWarning = 'unknown_sender';

function normalise(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function senderWarnings(sender: string | null, senderIds: string[]): SenderWarning[] {
  if (!sender?.trim() || senderIds.length === 0) return [];
  const known = new Set(senderIds.map(normalise));
  return known.has(normalise(sender)) ? [] : ['unknown_sender'];
}
