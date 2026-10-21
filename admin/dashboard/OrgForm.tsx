import type { ReactNode } from 'react';
import { FEATURES, type Feature, type OrgDetail, type OrgKind, type Social } from './api.ts';
import { Field, ListInput } from './ui.tsx';

export interface Draft {
  id: string;
  name: string;
  legalName: string;
  kind: OrgKind;
  bankCode: string;
  domains: string[];
  senderIds: string[];
  phones: string[];
  whatsapp: string[];
  emails: string[];
  social: Social[];
  android: string[];
  ios: string[];
  alertEmails: string[];
  keysMode: 'url' | 'inline';
  tokenKeysUrl: string;
  tokenKeysJson: string;
  customerTokenUrl: string;
  recordTtlDays: string;
  techName: string;
  techEmail: string;
  techPhone: string;
  mode: 'live' | 'sandbox';
  features: Record<Feature, boolean>;
  bankApiPerMinute: string;
  customerChecksPerMinute: string;
  notes: string;
}

export const emptyDraft = (): Draft => ({
  id: '',
  name: '',
  legalName: '',
  kind: 'bank',
  bankCode: '',
  domains: [],
  senderIds: [],
  phones: [],
  whatsapp: [],
  emails: [],
  social: [],
  android: [],
  ios: [],
  alertEmails: [],
  keysMode: 'url',
  tokenKeysUrl: '',
  tokenKeysJson: '',
  customerTokenUrl: '',
  recordTtlDays: '',
  techName: '',
  techEmail: '',
  techPhone: '',
  mode: 'sandbox',
  // USSD and WhatsApp serve the one organisation named in USSD_TENANT_ID / WHATSAPP_TENANT_ID.
  features: { messages: true, calls: true, receipts: true, simSwap: true, advisories: true, ussd: false, whatsapp: false },
  bankApiPerMinute: '',
  customerChecksPerMinute: '',
  notes: '',
});

export function draftFrom(d: OrgDetail): Draft {
  const o = d.org;
  return {
    id: o.id,
    name: o.name,
    legalName: o.legalName ?? '',
    kind: o.kind,
    bankCode: o.bankCode ?? '',
    domains: o.domains ?? [],
    senderIds: o.senderIds ?? [],
    phones: o.officialContacts?.phones ?? [],
    whatsapp: o.officialContacts?.whatsapp ?? [],
    emails: o.officialContacts?.emails ?? [],
    social: o.officialContacts?.social ?? [],
    android: o.officialApps?.android ?? [],
    ios: o.officialApps?.ios ?? [],
    alertEmails: o.alertEmails ?? [],
    keysMode: o.tokenKeys && !o.tokenKeysUrl ? 'inline' : 'url',
    tokenKeysUrl: o.tokenKeysUrl ?? '',
    tokenKeysJson: o.tokenKeys ? JSON.stringify(o.tokenKeys, null, 2) : '',
    customerTokenUrl: o.customerTokenUrl ?? '',
    recordTtlDays: o.recordTtlDays ? String(o.recordTtlDays) : '',
    techName: o.technicalContact?.name ?? '',
    techEmail: o.technicalContact?.email ?? '',
    techPhone: o.technicalContact?.phone ?? '',
    mode: o.mode,
    features: { ...o.features },
    bankApiPerMinute: o.limits?.bankApiPerMinute ? String(o.limits.bankApiPerMinute) : '',
    customerChecksPerMinute: o.limits?.customerChecksPerMinute ? String(o.limits.customerChecksPerMinute) : '',
    notes: d.meta.notes ?? '',
  };
}

const int = (s: string) => (s.trim() === '' ? null : Number(s));

// Builds the request body. Only JSON syntax is checked here; every other check is the server's.
export function toInput(d: Draft, mode: 'create' | 'update'): { body: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  let tokenKeys: unknown = null;
  if (d.keysMode === 'inline' && d.tokenKeysJson.trim()) {
    try {
      tokenKeys = JSON.parse(d.tokenKeysJson);
    } catch {
      errors.push('tokenKeys: is not valid JSON');
    }
  }
  const create = mode === 'create';
  const opt = <T,>(v: T | null | '' | undefined): T | null | undefined => (v === '' || v === null || v === undefined ? (create ? undefined : null) : v);
  const tech = d.techName.trim() || d.techEmail.trim() || d.techPhone.trim() ? { name: d.techName.trim(), email: d.techEmail.trim(), ...(d.techPhone.trim() ? { phone: d.techPhone.trim() } : {}) } : null;
  const body: Record<string, unknown> = {
    ...(create ? { id: d.id.trim() } : {}),
    name: d.name.trim(),
    legalName: opt(d.legalName.trim()),
    kind: d.kind,
    bankCode: opt(d.bankCode.trim()),
    domains: d.domains,
    senderIds: d.senderIds,
    officialContacts: { phones: d.phones, whatsapp: d.whatsapp, emails: d.emails, social: d.social.filter((s) => s.handle.trim()) },
    officialApps: { android: d.android, ios: d.ios },
    alertEmails: d.alertEmails,
    tokenKeysUrl: d.keysMode === 'url' ? opt(d.tokenKeysUrl.trim()) : create ? undefined : null,
    tokenKeys: d.keysMode === 'inline' ? opt(tokenKeys) : create ? undefined : null,
    customerTokenUrl: opt(d.customerTokenUrl.trim()),
    recordTtlDays: opt(int(d.recordTtlDays)),
    technicalContact: opt(tech),
    mode: d.mode,
    features: d.features,
    limits: { bankApiPerMinute: int(d.bankApiPerMinute), customerChecksPerMinute: int(d.customerChecksPerMinute) },
    notes: d.notes,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return { body, errors };
}

type SectionProps = { d: Draft; set: (patch: Partial<Draft>) => void; errs: Record<string, string[]>; editing?: boolean };

export function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <h3>{title}</h3>
        {intro && <p className="muted small">{intro}</p>}
      </div>
      <div className="form-grid">{children}</div>
    </section>
  );
}

export function IdentitySection({ d, set, errs, editing }: SectionProps) {
  return (
    <Section title="Organisation" intro="Who the organisation is. The name is what customers see in every verdict.">
      <Field label="Organisation ID" error={errs.id} help="Lowercase letters, digits and dashes, 3 to 32 characters. It becomes the iss claim of customer tokens and cannot change later." doc="apps/web/docs/CONFIGURATION.md, Tenant entry">
        <input value={d.id} disabled={editing} placeholder="e.g. firstcitybank" onChange={(e) => set({ id: e.target.value.toLowerCase() })} />
      </Field>
      <Field label="Display name" error={errs.name} help="Short name shown to customers, e.g. in &quot;Sent by First City Bank&quot;.">
        <input value={d.name} placeholder="First City Bank" onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Registered legal name" optional error={errs.legalName} help="As on the CBN licence or CAC certificate. Kept for the operator record; not shown to customers.">
        <input value={d.legalName} placeholder="First City Bank Plc" onChange={(e) => set({ legalName: e.target.value })} />
      </Field>
      <Field label="Kind" error={errs.kind} help="Agencies and companies register messages and calls exactly like banks; customer text names them instead of saying &quot;your bank&quot;." doc="decision 0014">
        <select value={d.kind} onChange={(e) => set({ kind: e.target.value as OrgKind })}>
          <option value="bank">Bank</option>
          <option value="agency">Government agency</option>
          <option value="company">Company</option>
        </select>
      </Field>
      <Field label="NIBSS bank code" optional={d.kind !== 'bank'} error={errs.bankCode} help="The 6-digit NIP institution code (CBN-licensed banks). Needed for transfer receipts paid into this bank; unique across organisations." doc="decision 0015">
        <input value={d.bankCode} inputMode="numeric" maxLength={6} placeholder="999001" onChange={(e) => set({ bankCode: e.target.value.replace(/\D/g, '') })} />
      </Field>
    </Section>
  );
}

export function PublicSection({ d, set, errs }: SectionProps) {
  const social = (i: number, patch: Partial<Social>) => set({ social: d.social.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Section title="Official identity" intro="What the organisation publishes as its own. Customers can check a link, number, email or handle against these; only an exact match is official.">
      <Field label="Official domains" error={errs.domains} help="Press Enter after each. Links on these domains or their subdomains belong to the organisation.">
        <ListInput value={d.domains} onChange={(v) => set({ domains: v.map((x) => x.toLowerCase()) })} placeholder="firstcitybank.ng" mono />
      </Field>
      <Field label="SMS sender IDs" error={errs.senderIds} help="Alphanumeric sender names and short codes the organisation sends from (up to 11 characters each). A message from another sender ID gets a warning.">
        <ListInput value={d.senderIds} onChange={(v) => set({ senderIds: v })} placeholder="FirstCity" mono />
      </Field>
      <Field label="Customer care phone numbers" optional error={errs['officialContacts.phones']} help="E.164, e.g. +2342019000000. A local 0 number is read as Nigerian.">
        <ListInput value={d.phones} onChange={(v) => set({ phones: v })} placeholder="+2342019000000" mono />
      </Field>
      <Field label="WhatsApp numbers" optional error={errs['officialContacts.whatsapp']}>
        <ListInput value={d.whatsapp} onChange={(v) => set({ whatsapp: v })} placeholder="+2349060000000" mono />
      </Field>
      <Field label="Customer care emails" optional error={errs['officialContacts.emails']}>
        <ListInput value={d.emails} onChange={(v) => set({ emails: v })} placeholder="care@firstcitybank.ng" mono />
      </Field>
      <Field label="Social media handles" optional error={errs['officialContacts.social']} help="A leading @ is ignored.">
        <div className="stack tight">
          {d.social.map((s, i) => (
            <div key={i} className="row nowrap">
              <select value={s.platform} onChange={(e) => social(i, { platform: e.target.value as Social['platform'] })} style={{ maxWidth: 150 }}>
                <option value="x">X</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="telegram">Telegram</option>
              </select>
              <input value={s.handle} placeholder="@FirstCityNG" onChange={(e) => social(i, { handle: e.target.value })} />
              <button type="button" className="btn plain" onClick={() => set({ social: d.social.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn plain start" onClick={() => set({ social: [...d.social, { platform: 'x', handle: '' }] })}>+ Add a handle</button>
        </div>
      </Field>
      <Field label="Android app package IDs" optional error={errs['officialApps.android']} help="A Play Store link to one of these checks as the official app. An APK download never does.">
        <ListInput value={d.android} onChange={(v) => set({ android: v })} placeholder="ng.firstcitybank.mobile" mono />
      </Field>
      <Field label="iOS App Store IDs" optional error={errs['officialApps.ios']} help="1234567890, id1234567890 or an apps.apple.com URL.">
        <ListInput value={d.ios} onChange={(v) => set({ ios: v })} placeholder="1234567890" mono />
      </Field>
    </Section>
  );
}

export function IntegrationSection({ d, set, errs }: SectionProps) {
  return (
    <Section title="Integration" intro="How the organisation's systems and customers connect. The bank API reference (apps/web/banks.html) describes each call.">
      <Field label="Customer token keys" error={[...(errs.tokenKeysUrl ?? []), ...(errs.tokenKeys ?? [])]} help="The JSON Web Key Set that verifies customer tokens: iss = organisation ID, sub = the customer's E.164 number, aud = gaskiya, ES256, RS256 or EdDSA, at most 15 minutes." doc="apps/web/docs/CONFIGURATION.md, tokenKeysUrl">
        <div className="segmented" role="tablist">
          <button type="button" className={d.keysMode === 'url' ? 'on' : ''} onClick={() => set({ keysMode: 'url' })}>JWKS URL</button>
          <button type="button" className={d.keysMode === 'inline' ? 'on' : ''} onClick={() => set({ keysMode: 'inline' })}>Paste JWKS</button>
        </div>
        {d.keysMode === 'url' ? (
          <input value={d.tokenKeysUrl} placeholder="https://api.firstcitybank.ng/.well-known/jwks.json" onChange={(e) => set({ tokenKeysUrl: e.target.value })} />
        ) : (
          <textarea className="mono" rows={6} value={d.tokenKeysJson} placeholder='{ "keys": [ { "kty": "EC", "crv": "P-256", "x": "...", "y": "...", "kid": "k1" } ] }' onChange={(e) => set({ tokenKeysJson: e.target.value })} />
        )}
      </Field>
      <Field label="Customer sign-in URL" optional error={errs.customerTokenUrl} help="Where the Gaskiyya app signs this organisation's customers in. It answers POST { phone } with { token, expiresIn } once the bank has authenticated the customer. Without it, customers verify only inside the organisation's own app." doc="apps/web/docs/CONFIGURATION.md, customerTokenUrl">
        <input value={d.customerTokenUrl} placeholder="https://api.firstcitybank.ng/gaskiyya/customer-token" onChange={(e) => set({ customerTokenUrl: e.target.value })} />
      </Field>
      <Field label="Fraud desk and security alert emails" optional error={errs.alertEmails} help="Campaign alerts, registration alerts (unknown link domains, volume spikes) and SIM swap notices go here.">
        <ListInput value={d.alertEmails} onChange={(v) => set({ alertEmails: v })} placeholder="fraud-desk@firstcitybank.ng" mono />
      </Field>
      <div className="field">
        <span className="field-label">Technical contact <span className="optional">Recommended</span></span>
        <div className="form-grid three">
          <input value={d.techName} placeholder="Name" aria-label="Technical contact name" onChange={(e) => set({ techName: e.target.value })} />
          <input value={d.techEmail} placeholder="Email" aria-label="Technical contact email" onChange={(e) => set({ techEmail: e.target.value })} />
          <input value={d.techPhone} placeholder="Phone (+234...)" aria-label="Technical contact phone" onChange={(e) => set({ techPhone: e.target.value })} />
        </div>
        <span className="field-help">The engineer Gaskiyya calls about the integration: rotations, outages, incidents.</span>
        {errs.technicalContact?.map((e) => <span key={e} className="field-error" role="alert">{e}</span>)}
      </div>
      <Field label="Record lifetime (days)" optional error={errs.recordTtlDays} help="How long a registered message stays checkable. Empty uses the platform default (RECORD_TTL_DAYS, 30).">
        <input value={d.recordTtlDays} inputMode="numeric" placeholder="30" onChange={(e) => set({ recordTtlDays: e.target.value.replace(/\D/g, '') })} />
      </Field>
    </Section>
  );
}

export function AccessSection({ d, set, errs }: SectionProps) {
  return (
    <Section title="Access and limits" intro="Sandbox organisations can use every API, but are not listed in the public directory and their contacts are not vouched for. Switch to live once the checklist is complete.">
      <Field label="Mode" error={errs.mode}>
        <div className="segmented">
          <button type="button" className={d.mode === 'sandbox' ? 'on' : ''} onClick={() => set({ mode: 'sandbox' })}>Sandbox</button>
          <button type="button" className={d.mode === 'live' ? 'on' : ''} onClick={() => set({ mode: 'live' })}>Live</button>
        </div>
      </Field>
      <Field label="Features" error={errs.features} help="A switched-off feature answers 403 feature_disabled to the organisation's API calls.">
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <label key={f.id} className="check feature">
              <input type="checkbox" checked={d.features[f.id]} onChange={(e) => set({ features: { ...d.features, [f.id]: e.target.checked } })} />
              <span>
                <b>{f.label}</b>
                <span className="muted small"> {f.help}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Bank API rate limit (per minute)" optional error={errs.limits} help="Across all of the organisation's API clients. Empty means no extra limit.">
        <input value={d.bankApiPerMinute} inputMode="numeric" placeholder="No limit" onChange={(e) => set({ bankApiPerMinute: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Field label="Customer checks per customer (per minute)" optional help="Overrides VERIFY_RATE_LIMIT_PER_MINUTE for this organisation's customers.">
        <input value={d.customerChecksPerMinute} inputMode="numeric" placeholder="Platform default" onChange={(e) => set({ customerChecksPerMinute: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Field label="Operator notes" optional error={errs.notes} help="Internal only: contract reference, onboarding ticket, contacts. Never put secrets here.">
        <textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </Section>
  );
}
