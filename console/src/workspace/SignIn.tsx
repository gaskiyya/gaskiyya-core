import { useState, type FormEvent } from 'react';
import { IconArrow, IconKey } from '../icons.tsx';
import { CODE_LENGTH, formatCode, NO_CODE, signIn, type OrgProfile, type StoredSession } from './data.ts';

const SANDBOX = __SANDBOX__;
const FIELD_LABEL = 'Bank sign-in code';

export function SignIn({ onSignedIn, demo, onSandboxDemo }: {
  onSignedIn: (s: StoredSession, p: OrgProfile, label: string) => void;
  demo: { name: string; code: string } | null;
  onSandboxDemo?: () => void;
}) {
  const [code, setCode] = useState(NO_CODE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = code.length === CODE_LENGTH;

  const go = async (value: string) => {
    setError(null);
    if (SANDBOX) {
      if (demo && value === demo.code) onSandboxDemo?.();
      else setError('This in-browser demo only holds the demo bank. Registered banks sign in on the live dashboard.');
      return;
    }
    setBusy(true);
    try {
      const r = await signIn(value);
      onSignedIn(r.session, r.profile, r.accessLabel);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (complete) void go(code);
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <img src="favicon.svg" alt="" />
          <span>Gaskiyya</span>
        </div>
        <h1>Bank console</h1>
        <p className="muted">Use the six-character code Gaskiyya issued when your organisation was registered. It opens your organisation, and only yours.</p>
        <form onSubmit={handle} className="gate-form">
          <label htmlFor="gate-field">{FIELD_LABEL}</label>
          <div className="code-input">
            <IconKey />
            <input
              id="gate-field"
              value={code}
              onChange={(e) => (setCode(formatCode(e.target.value)), setError(null))}
              placeholder="XXXXXX"
              maxLength={CODE_LENGTH + 4}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'gate-error' : undefined}
            />
          </div>
          {error && (
            <p className="form-error" id="gate-error" role="alert">
              {error}
              {SANDBOX && <> <a href={__REGISTRY_CONSOLE_URL__}>Open the live dashboard</a></>}
            </p>
          )}
          <button className="btn wide" type="submit" disabled={!complete || busy}>{busy ? 'Checking…' : 'Sign in'} {!busy && <IconArrow />}</button>
        </form>
        {demo && (
          <div className="demo-code">
            <div>
              <span className="eyebrow">Demo bank</span>
              <div className="demo-code-line">{demo.name} <code>{demo.code}</code></div>
            </div>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => (setCode(demo.code), void go(demo.code))}>Try the demo</button>
          </div>
        )}
        <p className="gate-foot small muted">No code? Gaskiyya issues one when your organisation is registered, and can replace it at any time.</p>
      </div>
    </div>
  );
}
