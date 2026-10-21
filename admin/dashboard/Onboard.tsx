import { useState, type ReactNode } from 'react';
import { admin, ApiError, FEATURES, type OrgDetail } from './api.ts';
import { AccessSection, emptyDraft, IdentitySection, IntegrationSection, PublicSection, toInput, type Draft } from './OrgForm.tsx';
import { Badge, errorsByField } from './ui.tsx';

const STEPS = [
  { id: 'identity', title: 'Organisation', fields: ['id', 'name', 'legalName', 'kind', 'bankCode'] },
  { id: 'public', title: 'Official identity', fields: ['domains', 'senderIds', 'officialContacts.phones', 'officialContacts.whatsapp', 'officialContacts.emails', 'officialContacts.social', 'officialApps.android', 'officialApps.ios'] },
  { id: 'integration', title: 'Integration', fields: ['tokenKeysUrl', 'tokenKeys', 'customerTokenUrl', 'alertEmails', 'technicalContact', 'recordTtlDays'] },
  { id: 'access', title: 'Access and limits', fields: ['mode', 'features', 'limits', 'notes'] },
  { id: 'review', title: 'Review', fields: [] },
] as const;

export function Onboard({ onCreated, onCancel }: { onCreated: (d: OrgDetail) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const errs = errorsByField(errors);

  const check = async (): Promise<string[]> => {
    const { body, errors: local } = toInput(d, 'create');
    if (local.length) return local;
    const r = await admin.validate(body);
    return r.errors;
  };

  // Moves on when the fields of this step (and every earlier one) pass the server's checks.
  const next = async () => {
    setBusy(true);
    try {
      const all = await check();
      const upTo = new Set(STEPS.slice(0, step + 1).flatMap((s) => s.fields as readonly string[]));
      const byField = errorsByField(all);
      const blocking = all.filter((e) => {
        const key = Object.keys(errorsByField([e]))[0]!;
        return upTo.has(key);
      });
      setErrors(blocking);
      if (blocking.length === 0) setStep(step + 1);
      else {
        const first = STEPS.findIndex((s) => (s.fields as readonly string[]).some((f) => byField[f]));
        if (first >= 0 && first < step) setStep(first);
      }
    } catch (err) {
      setErrors([`_general: ${(err as Error).message}`]);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const all = await check();
      if (all.length) {
        setErrors(all);
        return;
      }
      const { body } = toInput(d, 'create');
      onCreated(await admin.create(body));
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  };

  const current = STEPS[step]!;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Onboard an organisation</h1>
          <p>Register a bank, agency or company. When you finish, it has its own hashing key and can be given API credentials straight away; nothing needs a restart.</p>
        </div>
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <ol className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step} onClick={() => i < step && setStep(i)}>
              <span className="step-n">{i < step ? '\u2713' : i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="card form-card">
        {errs._general && (
          <div className="notice error" role="alert">
            {errs._general.map((e) => <div key={e}>{e}</div>)}
          </div>
        )}
        {current.id === 'identity' && <IdentitySection d={d} set={set} errs={errs} />}
        {current.id === 'public' && <PublicSection d={d} set={set} errs={errs} />}
        {current.id === 'integration' && <IntegrationSection d={d} set={set} errs={errs} />}
        {current.id === 'access' && <AccessSection d={d} set={set} errs={errs} />}
        {current.id === 'review' && <Review d={d} errors={errors} />}
        <div className="form-actions">
          {step > 0 && <button className="btn secondary" disabled={busy} onClick={() => (setErrors([]), setStep(step - 1))}>Back</button>}
          <span className="spacer" />
          {current.id !== 'review' ? (
            <button className="btn" disabled={busy} onClick={next}>{busy ? 'Checking\u2026' : 'Continue'}</button>
          ) : (
            <button className="btn" disabled={busy} onClick={create}>{busy ? 'Creating\u2026' : 'Create organisation'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="review-row">
      <span className="muted">{k}</span>
      <span>{v || <span className="muted">Not set</span>}</span>
    </div>
  );
}

const list = (xs: string[]) => (xs.length ? <span className="mono small">{xs.join(', ')}</span> : null);

function Review({ d, errors }: { d: Draft; errors: string[] }) {
  return (
    <div className="stack">
      <div className="form-section-head">
        <h3>Review</h3>
        <p className="muted small">Check each value. On create, Gaskiyya makes the organisation's first hashing key (version 1), stored encrypted. You issue API credentials on the next screen.</p>
      </div>
      {errors.length > 0 && (
        <div className="notice error" role="alert">
          <b>Fix these before creating:</b>
          <ul>{errors.map((e) => <li key={e}>{e.replace(/^_general: /, '')}</li>)}</ul>
        </div>
      )}
      <div className="review-grid">
        <div className="card inset">
          <h3>Organisation</h3>
          <Row k="ID" v={<code>{d.id}</code>} />
          <Row k="Display name" v={d.name} />
          <Row k="Legal name" v={d.legalName} />
          <Row k="Kind" v={d.kind} />
          <Row k="NIBSS bank code" v={d.bankCode} />
        </div>
        <div className="card inset">
          <h3>Official identity</h3>
          <Row k="Domains" v={list(d.domains)} />
          <Row k="Sender IDs" v={list(d.senderIds)} />
          <Row k="Phones" v={list(d.phones)} />
          <Row k="WhatsApp" v={list(d.whatsapp)} />
          <Row k="Emails" v={list(d.emails)} />
          <Row k="Social" v={list(d.social.filter((s) => s.handle).map((s) => `${s.platform}: ${s.handle}`))} />
          <Row k="Apps" v={list([...d.android, ...d.ios])} />
        </div>
        <div className="card inset">
          <h3>Integration</h3>
          <Row k="Token keys" v={d.keysMode === 'url' ? <span className="mono small">{d.tokenKeysUrl}</span> : d.tokenKeysJson ? 'Inline JWKS' : ''} />
          <Row k="Sign-in URL" v={<span className="mono small">{d.customerTokenUrl}</span>} />
          <Row k="Alert emails" v={list(d.alertEmails)} />
          <Row k="Technical contact" v={[d.techName, d.techEmail, d.techPhone].filter(Boolean).join(', ')} />
          <Row k="Record lifetime" v={d.recordTtlDays ? `${d.recordTtlDays} days` : 'Platform default'} />
        </div>
        <div className="card inset">
          <h3>Access</h3>
          <Row k="Mode" v={d.mode === 'live' ? <Badge tone="blue">Live</Badge> : <Badge tone="orange">Sandbox</Badge>} />
          <Row k="Features" v={FEATURES.filter((f) => d.features[f.id]).map((f) => f.label).join(', ')} />
          <Row k="API limit" v={d.bankApiPerMinute ? `${d.bankApiPerMinute} per minute` : 'No extra limit'} />
          <Row k="Customer checks" v={d.customerChecksPerMinute ? `${d.customerChecksPerMinute} per minute` : 'Platform default'} />
        </div>
      </div>
    </div>
  );
}
