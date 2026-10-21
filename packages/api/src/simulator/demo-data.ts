import type { Category } from '@gaskiya/schemas';

export const DEMO_CUSTOMERS = [
  { name: 'Amina Bello', phone: '+2348012345678' },
  { name: 'Tunde Okafor', phone: '+2348098765432' },
  { name: 'Chidinma Eze', phone: '+2348031112222' },
];

const money = (n: number) => n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rand = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const stamp = (d: Date) =>
  d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).replace(',', '');

export function genuineTemplate(category: Category, bank: string, phone: string, now = new Date(), domain = 'demobank.ng'): { text: string; hasLink: boolean; linkDomains: string[]; asksCallback: boolean } {
  const last4 = phone.slice(-4);
  switch (category) {
    case 'transaction_alert': {
      const merchants = ['POS SHOPRITE IKEJA', 'TRF TO ADAEZE O.', 'AIRTIME MTN', 'POS CHICKEN REPUBLIC', 'WEB JUMIA NG'];
      return {
        text: `${bank}: Debit\nAmt: NGN${money(rand(1, 90) * 500)}\nAcc: ***${last4}\nDesc: ${merchants[rand(0, merchants.length - 1)]}\nDate: ${stamp(now)}\nBal: NGN${money(rand(20_000, 900_000) + rand(0, 99) / 100)}`,
        hasLink: false,
        linkDomains: [],
        asksCallback: false,
      };
    }
    case 'otp':
      return {
        text: `Your ${bank} one-time code is ${rand(100000, 999999)}. It expires in 5 minutes. ${bank} staff will never ask you for it.`,
        hasLink: false,
        linkDomains: [],
        asksCallback: false,
      };
    case 'security_notice':
      return {
        text: `${bank}: a new device signed in to your profile on ${stamp(now)}. If this was not you, open the ${bank} app and tap Help.`,
        hasLink: false,
        linkDomains: [],
        asksCallback: false,
      };
    case 'service_update':
      return {
        text: `${bank}: our app now has instant card controls. Update today at https://www.${domain}/app`,
        hasLink: true,
        linkDomains: [domain],
        asksCallback: false,
      };
    case 'marketing':
      return {
        text: `${bank}: save 10% of every credit automatically with Smart Save. Learn more at https://${domain}/smartsave`,
        hasLink: true,
        linkDomains: [domain],
        asksCallback: false,
      };
    case 'call_follow_up':
      return {
        text: `${bank}: thank you for speaking with us today. Your request ${rand(10000, 99999)} is being processed.`,
        hasLink: false,
        linkDomains: [],
        asksCallback: false,
      };
  }
}

export function tamper(text: string): string {
  const link = text.match(/https?:\/\/(www\.)?([a-z0-9-]+)\./i);
  if (link) {
    const name = link[2]!;
    const mid = Math.max(1, Math.floor(name.length / 2));
    const fake = `${name.slice(0, mid)}-${name.slice(mid)}`;
    return text.replace(name, fake);
  }
  const amount = text.match(/NGN(\d)/);
  if (amount) {
    const d = amount[1]!;
    return text.replace(`NGN${d}`, `NGN${d === '9' ? '8' : String(Number(d) + 1)}`);
  }
  return text.replace(/e/, '\u0435');
}

export const FAKE_TEMPLATES = [
  (bank: string, lookalike = 'demobank-restore.com') => `${bank}: Your account has been restricted due to incomplete BVN. Restore access within 24 hours at https://${lookalike} or it will be blocked.`,
  (bank: string, lookalike = 'demobank-restore.com') => `Dear customer, ${bank} BVN update required. Visit https://${lookalike}/bvn to avoid suspension of your account.`,
  (bank: string, lookalike = 'demobank-restore.com') => `FINAL NOTICE from ${bank}: verify your details now at ${lookalike}/secure to keep your card active.`,
  (bank: string) => `${bank}: Congratulations! You have won NGN250,000 in our anniversary promo. Call 0809 555 0101 to claim your reward today.`,
];

// Made up: 999xxx codes are not issued to banks.
export const DEMO_BANK_CODE = '999001';

export const demoAccount = (phone: string) => phone.replace(/\D/g, '').slice(-10);

export function sessionId(bankCode: string, now = new Date()): string {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const stamp = lagos.slice(2, 19).replace(/\D/g, '');
  let tail = '';
  while (tail.length < 12) tail += Math.floor(Math.random() * 10);
  return `${bankCode}${stamp}${tail}`;
}

export const naira = (kobo: number) => `NGN${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface Transfer {
  id: string;
  kind: 'genuine' | 'fake_amount' | 'fake_reference';
  payer: string;
  merchant: string;
  account: string;
  amountKobo: number;
  reference: string;
  valueDate: string;
  at: string;
  registered: boolean;
  check: { verdict: 'received' | 'not_confirmed' | 'cannot_check'; paidFrom?: string; registeredAt?: string } | null;
}

export function fakeReceipt(source: Transfer, kind: 'fake_amount' | 'fake_reference', bankCode: string, id: string, now = new Date()): Transfer {
  return {
    ...source,
    id,
    kind,
    amountKobo: kind === 'fake_amount' ? source.amountKobo * 10 : source.amountKobo,
    reference: kind === 'fake_reference' ? sessionId(bankCode, now) : source.reference,
    at: now.toISOString(),
    registered: false,
    check: null,
  };
}

export function fakeCustomerCareMessage(bank: string, whatsapp: string): string {
  return `${bank} customer care: your account has been placed on hold. Chat with our help desk now on WhatsApp https://wa.me/${whatsapp.replace(/\D/g, '')} to restore it.`;
}

export function advisoryToSend(
  c: { advisory: { status: string; text: string; expiresAt?: string | null } } | undefined,
  now = new Date(),
): { ok: true; text: string } | { ok: false; status: number; code: string; message: string } {
  if (!c) return { ok: false, status: 404, code: 'not_found', message: 'No such campaign' };
  const a = c.advisory;
  if (a.status !== 'approved') return { ok: false, status: 409, code: 'not_approved', message: 'Only an approved advisory can be sent to customers' };
  if (a.expiresAt && Date.parse(a.expiresAt) <= now.getTime()) return { ok: false, status: 409, code: 'expired', message: 'This advisory has expired' };
  const text = a.text.trim();
  if (!text) return { ok: false, status: 409, code: 'empty', message: 'The advisory has no text' };
  return { ok: true, text };
}

export function FAKE_CREDIT_ALERT(bank: string, phone: string, now = new Date()): string {
  return `${bank}: Credit\nAmt: NGN${money(rand(30, 120) * 5_000)}\nAcc: ***${phone.slice(-4)}\nDesc: TRF FROM CHUKWUEMEKA O.\nDate: ${stamp(now)}\nBal: NGN${money(rand(400_000, 1_400_000) + rand(0, 99) / 100)}`;
}

export function rememberSignIn(list: Map<string, string>, phone: string, now = new Date()): void {
  list.delete(phone);
  list.set(phone, now.toISOString());
  while (list.size > 30) list.delete(list.keys().next().value!);
}

export const recentSignIns = (list: Map<string, string>) => [...list].reverse().map(([phone, at]) => ({ phone, at }));

export interface FraudCall {
  id: string;
  phone: string;
  from: string;
  status: 'ringing' | 'answered' | 'ended';
  at: string;
  expiresAt: string;
}

export function newFraudCall(b: { phone?: unknown; from?: unknown }, id: string, now = new Date()): { ok: true; call: FraudCall } | { ok: false; message: string } {
  if (typeof b.phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(b.phone)) return { ok: false, message: 'phone must be E.164' };
  const from = typeof b.from === 'string' ? b.from.trim() : '';
  if (from && !/^\+?[\d\s()-]{3,24}$/.test(from)) return { ok: false, message: 'from must be a phone number' };
  return { ok: true, call: { id, phone: b.phone, from, status: 'ringing', at: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() } };
}

export function listFraudCalls(calls: Map<string, FraudCall>, now = Date.now()): FraudCall[] {
  for (const c of calls.values()) if (c.status === 'ringing' && Date.parse(c.expiresAt) <= now) c.status = 'ended';
  return [...calls.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
}
