import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asksForSecret } from '../packages/api/src/ai/secrets.ts';
import { DEMO_BANKS, DEMO_ORGS } from '../packages/api/src/simulator/index.ts';

const AUDIO = 'console/public/audio/agent';
const manifest = () => JSON.parse(readFileSync(`${AUDIO}/voice.json`, 'utf8'));
const DIGIT_IDS = [...'0123456789'].flatMap((d) => [`digit-${d}-mid`, `digit-${d}-last`]);
const OPENING_IDS = [...Object.keys({ ...DEMO_BANKS, ...DEMO_ORGS }), 'generic'].map((id) => `opening-${id}`);

describe('agent voice on the console phone call', () => {
  it('VOICE-1: the agent only greets, says who is calling and reads the code', () => {
    const m = manifest();
    expect(Object.keys(m.clips).sort()).toEqual([...OPENING_IDS, ...DIGIT_IDS].sort());
    for (const id of OPENING_IDS) expect(m.clips[id].text, id).toMatch(/^Hello, good day\. I am calling from [^.]+\. Your code is$/);
    for (const [id, c] of Object.entries(m.clips) as [string, { text: string }][]) {
      expect(asksForSecret(c.text), `${id}: ${c.text}`).toBe(false);
      expect(c.text, id).not.toMatch(/\b(match|never|PIN|password|one-time|OTP|app)\b/i);
    }
  });

  it('VOICE-2: the voice is a Nigerian English female voice, and every clip is 24 kHz mono 16-bit with quiet edges', () => {
    const m = manifest();
    expect(m).toMatchObject({ voice: 'en-NG-EzinneNeural', sampleRate: 24000 });
    for (const id of Object.keys(m.clips)) {
      const f = `${AUDIO}/${id}.wav`;
      expect(existsSync(f), f).toBe(true);
      const b = readFileSync(f);
      expect(b.toString('ascii', 0, 4)).toBe('RIFF');
      expect(b.readUInt16LE(22)).toBe(1);
      expect(b.readUInt32LE(24)).toBe(24000);
      expect(b.readUInt16LE(34)).toBe(16);
      expect(Math.round(((b.length - 44) / 2 / 24000) * 1000)).toBe(m.clips[id].ms);
      expect(Math.abs(b.readInt16LE(44))).toBeLessThan(64);
      expect(Math.abs(b.readInt16LE(b.length - 2))).toBeLessThan(64);
    }
  });

  it('VOICE-3: the call screen shows no transcript, and the phone plays the opening then the digits, the last one falling', () => {
    const device = readFileSync('console/src/device/Device.tsx', 'utf8');
    expect(device).not.toMatch(/caption/i);
    const player = readFileSync('console/src/device/agentVoice.ts', 'utf8');
    expect(player).toContain('opening-generic');
    expect(player).toContain("i === digits.length - 1 ? 'last' : 'mid'");
  });
});
