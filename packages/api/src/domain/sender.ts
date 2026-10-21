export type SenderWarning = 'unknown_sender';

function normalise(sender: string): string {
  return sender.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function senderWarnings(sender: string | null, senderIds: string[]): SenderWarning[] {
  if (!sender?.trim() || senderIds.length === 0) return [];
  const known = new Set(senderIds.map(normalise));
  return known.has(normalise(sender)) ? [] : ['unknown_sender'];
}
