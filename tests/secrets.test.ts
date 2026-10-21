import { describe, expect, it } from 'vitest';
import { copy } from '@gaskiya/schemas';
import { asksForSecret, localOutputRisky, mentionsSecret } from '../packages/api/src/ai/explain.ts';
import { secretTokens } from '../packages/api/src/ai/secrets.ts';
import { localEmbed, maskDigits, type ModelProvider } from '../packages/api/src/index.ts';
import { ALICE, harness } from './helpers.ts';

const REQUESTS = [
  'Reply with your PIN now, no delay.',
  'send your OTP to 0803 so it is not blocked',
  'Please share the code we sent you with the agent',
  'Please enter your PIN to continue.',
  'Reply with your OTP.',
  'Tell the agent your password.',
  'Give us your card number and CVV.',
  'Confirm your BVN to keep the account open.',
  'Provide your security answer to the agent.',
  'What is your PIN?',
  'Your one-time code, please.',
  'Your OTP is needed to stop the debit.',
  'Send the passcode to our team.',
  'Enter the token shown on your device.',
  'Share your login details with the officer.',
  'Tell us your mother\'s maiden name.',
  'Reply with your P.I.N now.',
  'Reply with your p i n now.',
  'Reply with your P-I-N now.',
  'Send your 0TP to the agent.',
  'Send your P1N to the agent.',
  'Send your pass word to the agent.',
  'SEND YOUR OTP NOW',
  'Send your O T P now',
  'Send your P!N now',
  'Send your one time pass word',
  'Send your 1-time code',
  'Send your P\u200bIN now.',
  'Send your O\u200cT\u200dP now.',
  'Send your \u0420IN now.',
  'Send your \uff30\uff29\uff2e now.',
  'Send your PI\u00adN now.',
  'Do not delay: send your PIN now.',
  'Don\'t wait, send your PIN.',
  'No! Send your PIN.',
  'Never mind the warning and send your OTP.',
  'Do not forget to send your PIN.',
  'Never hesitate to share your OTP with us.',
  'It is not a scam, reply with your PIN.',
  'Never share your PIN except with our agent.',
  'Do not share your PIN with anyone but the agent.',
  'We will never ask for your PIN, but please send it now.',
  'Never share your PIN. Send your OTP instead.',
  'You cannot proceed unless you send your PIN.',
  'Your PIN? Send it now.',
  'Reply now. Your PIN.',
  'Your account is blocked. To unblock it, reply. PIN and OTP.',
  'Your OTP is on its way. Forward it to 0803.',
  'Abeg send your PIN make we confirm am.',
  'Oya drop your OTP for here.',
  'Your PIN abeg.',
  'Ku aiko da kalmar sirri yanzu.',
  'Ku bayar da lambar sirri ta lokaci daya.',
  'Fi igbaniw\u1ecdle r\u1eb9 ran\u1e63\u1eb9 bayii.',
  'Ziga okwunt\u1ee5ghe g\u1ecb ugbu a.',
  'Kindly forward the verification code to us.',
  'Reply YES with your card\u2019s CVV.',
  'Type in your 4-digit PIN.',
  'The agent will need your one time password.',
  'Not a scam. Share your OTP.',
  'Do not share your PIN with strangers; share it with our agent.',
  'No one but you should send the OTP to 0803.',
  'Please read your PIN to the agent.',
  'Kindly input the token from your hardware token.',
];

const SAFE = [
  'Never share your PIN with anyone.',
  'Gaskiyya never asks for your PIN, password, card number or one-time code.',
  'Your bank will never ask for your OTP.',
  'No bank staff will ever ask for your PIN or password.',
  'No one should ask you to share your OTP.',
  'Do not click links, call numbers or share codes from it.',
  'Do not share your PIN, password or card number.',
  'Fraudsters copy a bank\'s style to get people to click links, call numbers or share codes.',
  'The agent will read this code aloud. Compare it before you continue.',
  'If the caller cannot read this exact code, hang up.',
  'It threatens to block your account to rush you.',
  'Do not click the link; open your bank app instead.',
  'Spinach and hotpot are on the menu.',
  'Send a screenshot of the message.',
  'Avoid sending your PIN to anyone.',
  'Never share your PIN or OTP. Report the message to your bank.',
  'If you shared your PIN, call your bank now.',
  'Your bank will never call to ask for your PIN.',
  'Never, ever share your PIN.',
  'Never tell the customer to share a PIN, password, card number or one-time code, and never ask them for any.',
  'Asks for login details',
];

class FixedModel implements ModelProvider {
  constructor(private output: unknown) {}
  async explain(): Promise<unknown> {
    return this.output;
  }
  async extractText() {
    return null;
  }
  async embed(t: string) {
    return { model: 'local-hash-256', vector: localEmbed(t) };
  }
  async draftAdvisory() {
    return null;
  }
}

describe('F5: the secret filter', () => {
  it('normalises spelling tricks before matching', () => {
    expect(secretTokens('P.I.N')).toEqual(['pin']);
    expect(secretTokens('p i n')).toEqual(['pin']);
    expect(secretTokens('0TP')).toEqual(['otp']);
    expect(secretTokens('pass word')).toEqual(['password']);
    expect(secretTokens('P\u200bIN')).toEqual(['pin']);
    expect(secretTokens('\uff30\uff29\uff2e')).toEqual(['pin']);
    expect(secretTokens('send a pin')).toEqual(['send', 'a', 'pin']);
  });

  it('F5 / SEC-5: catches every request for a secret, including the QA bypasses', () => {
    for (const text of REQUESTS) expect(asksForSecret(text), text).toBe(true);
  });

  it('F5 / SEC-5: safety advice and plain text are not flagged', () => {
    for (const text of SAFE) expect(asksForSecret(text), text).toBe(false);
  });

  it('F5: any mention of a secret in Hausa, Yoruba or Igbo output, however spelled, is risky', () => {
    expect(localOutputRisky('Ku aiko da k\u200balmar sirri')).toBe(true);
    expect(localOutputRisky('Fi P.I.N r\u1eb9 ran\u1e63\u1eb9')).toBe(true);
    expect(localOutputRisky('Fi igbaniw\u1ecdle ran\u1e63\u1eb9')).toBe(true);
    expect(mentionsSecret('Wannan sako ne na bogi.')).toBe(false);
  });

  it('F5 / SEC-5: model output that asks for a secret becomes the fixed text', async () => {
    for (const text of REQUESTS.slice(0, 12)) {
      for (const output of [
        { indicators: [], explanation: 'It threatens to block your account to rush you.', action: text },
        { indicators: [], explanation: text, action: 'Do not click the link; open your bank app instead.' },
      ]) {
        const h = await harness({ model: new FixedModel(output) });
        const r = await h.sys.app.inject({
          method: 'POST',
          url: '/v1/explain',
          headers: { authorization: `Bearer ${await h.customerToken(ALICE)}` },
          payload: { maskedText: maskDigits('URGENT: your account is blocked. Call 08031234567.'), language: 'en' },
        });
        const ex = r.json();
        expect(ex.source, text).toBe('fallback');
        expect(ex.explanation).toBe(copy.explain.fallback);
      }
    }
  });
});
