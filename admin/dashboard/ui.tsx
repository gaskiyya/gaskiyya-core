import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '\u2013' : n.toLocaleString());
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '\u2013' : `${(n * 100).toFixed(1)}%`);
export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '\u2013';
  const d = new Date(iso);
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 0) return `in ${Math.ceil(-s / 60)} min`;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function Badge({ tone, children }: { tone?: 'green' | 'red' | 'orange' | 'blue'; children: ReactNode }) {
  return <span className={`tag ${tone ?? ''}`}>{children}</span>;
}

export function StatusBadges({ status, mode }: { status: string; mode: string }) {
  return (
    <span className="row tight">
      {status === 'suspended' ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}
      {mode === 'sandbox' ? <Badge tone="orange">Sandbox</Badge> : <Badge tone="blue">Live</Badge>}
    </span>
  );
}

export function Field({ label, help, error, doc, children, optional }: { label: string; help?: ReactNode; error?: string[]; doc?: string; children: ReactNode; optional?: boolean }) {
  return (
    <label className={`field ${error?.length ? 'has-error' : ''}`}>
      <span className="field-label">
        {label}
        {optional && <span className="optional">Optional</span>}
      </span>
      {children}
      {help && <span className="field-help">{help}{doc && <> See <code>{doc}</code>.</>}</span>}
      {!help && doc && <span className="field-help">See <code>{doc}</code>.</span>}
      {error?.map((e) => (
        <span key={e} className="field-error" role="alert">{e}</span>
      ))}
    </label>
  );
}

// Free list entry: Enter or comma adds a value, Backspace on empty removes the last.
export function ListInput({ value, onChange, placeholder, mono }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; mono?: boolean }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="list-input">
      {value.map((v) => (
        <span key={v} className={`chip-item ${mono ? 'mono' : ''}`}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            &times;
          </button>
        </span>
      ))}
      <input value={draft} placeholder={value.length ? '' : placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && add(draft)} />
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal card ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn secondary small-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

// A secret the server returns once and never again.
export function SecretOnce({ title, items, note, onDone, lost = 'If it is lost, rotate it.' }: { title: string; items: { label: string; value: string; secret?: boolean }[]; note: ReactNode; onDone: () => void; lost?: string }) {
  const [stored, setStored] = useState(false);
  return (
    <Modal title={title} onClose={() => stored && onDone()}>
      <div className="stack">
        <p className="notice warn">This is the only time the secret is shown. Gaskiyya keeps a one-way hash of it, so it cannot be shown again. {lost}</p>
        {items.map((i) => (
          <div key={i.label} className="secret-row">
            <span className="field-label">{i.label}</span>
            <div className="row nowrap">
              <code className={`secret ${i.secret ? 'is-secret' : ''}`}>{i.value}</code>
              <Copy text={i.value} />
            </div>
          </div>
        ))}
        <div className="muted small">{note}</div>
        <label className="check">
          <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} /> I have stored the secret in the organisation's secret manager or handed it over securely
        </label>
        <div className="row end">
          <button className="btn" disabled={!stored} onClick={onDone}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

export function Confirm({ title, body, action, danger, onCancel, onConfirm, input }: { title: string; body: ReactNode; action: string; danger?: boolean; onCancel: () => void; onConfirm: (text: string) => void; input?: { label: string; placeholder?: string; required?: boolean } }) {
  const [text, setText] = useState('');
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="stack">
        <div>{body}</div>
        {input && (
          <Field label={input.label}>
            <textarea value={text} placeholder={input.placeholder} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <div className="row end">
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'danger-solid' : ''}`} disabled={Boolean(input?.required && !text.trim())} onClick={() => onConfirm(text.trim())}>
            {action}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Bars({ data, height = 120 }: { data: { label: string; value: number; errors?: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars" style={{ height }} role="img" aria-label="Calls per day">
      {data.map((d) => (
        <div key={d.label} className="bar-col" title={`${d.label}: ${d.value.toLocaleString()} calls${d.errors ? `, ${d.errors.toLocaleString()} errors` : ''}`}>
          <div className="bar-stack" style={{ height: `${(d.value / max) * 100}%` }}>
            {d.errors ? <span className="bar-err" style={{ height: `${(d.errors / Math.max(1, d.value)) * 100}%` }} /> : null}
          </div>
          <span className="bar-label">{d.label.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function Tile({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export function useToast(): [ReactNode, (s: string, tone?: 'error') => void] {
  const [msg, setMsg] = useState<{ text: string; key: number; tone?: 'error' } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className={`toast ${msg.tone === 'error' ? 'toast-error' : ''}`} key={msg.key} role="status">{msg.text}</div> : null, (text, tone) => setMsg({ text, key: Date.now(), tone })];
}

const FIELD_KEYS = [
  'id', 'name', 'legalName', 'kind', 'bankCode', 'domains', 'senderIds',
  'officialContacts.phones', 'officialContacts.whatsapp', 'officialContacts.emails', 'officialContacts.social',
  'officialApps.android', 'officialApps.ios', 'alertEmails', 'tokenKeysUrl', 'tokenKeys', 'customerTokenUrl', 'logoUrl',
  'recordTtlDays', 'technicalContact', 'mode', 'features', 'limits', 'notes',
];

// Maps the server's validation messages (request schema and profile checks) to form fields.
export function errorsByField(errors: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    let token = e.split(/[\s:]/)[0] ?? '';
    token = token.split('.').filter((p) => !/^\d+$/.test(p)).join('.');
    let key = FIELD_KEYS.filter((k) => token === k || token.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0];
    if (!key && /^alert email/.test(e)) key = 'alertEmails';
    if (!key && /^a name/.test(e)) key = 'name';
    key ??= '_general';
    const text = e.replace(/^[A-Za-z.0-9]+: /, '');
    (out[key] ??= []).push(text.charAt(0).toUpperCase() + text.slice(1));
  }
  return out;
}
