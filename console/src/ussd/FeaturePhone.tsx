import { useEffect, useRef, useState } from 'react';
import { sim } from '../api.ts';
import './ussd.css';

type Mode =
  | { at: 'home' }
  | { at: 'waiting' }
  | { at: 'session'; screen: string }
  | { at: 'ended'; screen: string };

const KEYS: [string, string][] = [
  ['1', ''], ['2', 'abc'], ['3', 'def'],
  ['4', 'ghi'], ['5', 'jkl'], ['6', 'mno'],
  ['7', 'pqrs'], ['8', 'tuv'], ['9', 'wxyz'],
  ['*', ''], ['0', '+'], ['#', ''],
];

export interface UssdHop {
  text: string;
  reply: string;
}

export function FeaturePhone({ phone, code, onHop }: { phone: string; code: string; onHop?: (hop: UssdHop) => void }) {
  const [mode, setMode] = useState<Mode>({ at: 'home' });
  const [entry, setEntry] = useState('');
  const history = useRef<string[]>([]);
  const session = useRef('');

  useEffect(() => {
    setMode({ at: 'home' });
    setEntry('');
  }, [phone]);

  const hop = async (inputs: string[]) => {
    setMode({ at: 'waiting' });
    const text = inputs.join('*');
    try {
      const { screen } = await sim.ussd(phone, text, session.current);
      onHop?.({ text, reply: screen });
      history.current = inputs;
      const body = screen.slice(4);
      setMode(screen.startsWith('CON ') ? { at: 'session', screen: body } : { at: 'ended', screen: body });
    } catch (e) {
      setMode({ at: 'ended', screen: `Connection problem or invalid MMI code.\n${(e as Error).message}` });
    }
    setEntry('');
  };

  const dial = () => {
    if (mode.at === 'home') {
      if (entry !== code) {
        setMode({ at: 'ended', screen: 'Unknown USSD code.' });
        setEntry('');
        return;
      }
      session.current = `ATUid_${Math.random().toString(36).slice(2, 12)}`;
      void hop([]);
    } else if (mode.at === 'session' && entry) {
      void hop([...history.current, entry]);
    } else if (mode.at === 'ended') {
      setMode({ at: 'home' });
    }
  };
  const hangUp = () => {
    setMode({ at: 'home' });
    setEntry('');
  };
  const press = (k: string) => {
    if (mode.at === 'waiting') return;
    if (mode.at === 'ended') setMode({ at: 'home' });
    setEntry((e) => (e + k).slice(0, 24));
  };

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const leftSoft = mode.at === 'session' ? 'Send' : mode.at === 'ended' ? 'OK' : 'Call';
  const rightSoft = entry ? 'Clear' : mode.at === 'session' ? 'Cancel' : '';

  return (
    <div className="fp-slot">
      <div className="fp" role="group" aria-label="Feature phone">
        <div className="fp-ear" />
        <div className="fp-brand">Feature phone</div>
        <div className="fp-lcd" aria-live="polite">
          <div className="fp-bar">
            <span className="fp-signal" aria-hidden="true"><i /><i /><i /><i /></span>
            <span>{time}</span>
            <span className="fp-battery" aria-hidden="true" />
          </div>
          <div className="fp-body">
            {mode.at === 'home' && (
              <div className="fp-home">
                {entry ? <div className="fp-entry">{entry}</div> : (
                  <>
                    <div className="fp-net">Network</div>
                    <div className="fp-hint">Dial {code}</div>
                  </>
                )}
              </div>
            )}
            {mode.at === 'waiting' && <div className="fp-wait">USSD code running...</div>}
            {(mode.at === 'session' || mode.at === 'ended') && (
              <>
                <pre className="fp-screen">{mode.screen}</pre>
                {mode.at === 'session' && <div className="fp-reply">{entry || '\u00a0'}<span className="fp-caret" /></div>}
              </>
            )}
          </div>
          <div className="fp-soft">
            <span>{leftSoft}</span>
            <span>{rightSoft}</span>
          </div>
        </div>
        <div className="fp-nav">
          <button className="fp-key soft" aria-label={leftSoft} onClick={dial}>
            <span className="fp-line" />
          </button>
          <button className="fp-key pad" aria-label="Navigate" disabled />
          <button className="fp-key soft" aria-label={rightSoft || 'Back'} onClick={() => (entry ? setEntry((e) => e.slice(0, -1)) : mode.at !== 'home' && hangUp())}>
            <span className="fp-line" />
          </button>
          <button className="fp-key call" aria-label="Call or send" onClick={dial}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.2l1.6 4-2 1.3a11 11 0 0 0 6.8 6.8l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" /></svg>
          </button>
          <span />
          <button className="fp-key end" aria-label="End" onClick={hangUp}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.2l1.6 4-2 1.3a11 11 0 0 0 6.8 6.8l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" /></svg>
          </button>
        </div>
        <div className="fp-pad">
          {KEYS.map(([k, sub]) => (
            <button key={k} className="fp-key num" onClick={() => press(k)} aria-label={k}>
              <b>{k}</b>
              <small>{sub}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
