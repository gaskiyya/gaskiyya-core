import { useState, type ReactNode } from 'react';
import type { OrgProfile, ProfileEdit, Workspace } from './data.ts';
import { PageHead, Section, useActions } from './ui.tsx';

const FEATURE_NAMES: Record<string, string> = {
  messages: 'Message checks',
  calls: 'Call codes',
  receipts: 'Transfer receipts',
  simSwap: 'SIM swap checks',
  advisories: 'Customer advisories',
  ussd: 'USSD',
  whatsapp: 'WhatsApp bot',
};
const KIND: Record<OrgProfile['kind'], string> = { bank: 'Bank', agency: 'Government agency', company: 'Company' };
const PLATFORM: Record<string, string> = { x: 'X', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', telegram: 'Telegram' };

type Editing = 'contacts' | 'apps' | 'alerts' | 'tech' | null;
type Social = OrgProfile['officialContacts']['social'][number];

const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

function List({ items, mono, empty }: { items: ReactNode[]; mono?: boolean; empty: string }) {
  if (items.length === 0) return <span className="muted">{empty}</span>;
  return <div className="chips">{items.map((x, i) => <span key={i} className={`tag plain ${mono ? 'mono' : ''}`}>{x}</span>)}</div>;
}

function ListField({ label, values, onChange, placeholder, type = 'text' }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; type?: string }) {
  return (
    <div className="field-block">
      <span className="eyebrow">{label}</span>
      {values.map((v, i) => (
        <div className="edit-row" key={i}>
          <input type={type} value={v} placeholder={placeholder} aria-label={`${label} ${i + 1}`} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn plain small" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn plain small add-row" onClick={() => onChange([...values, ''])}>+ Add</button>
    </div>
  );
}

function SocialField({ values, onChange }: { values: Social[]; onChange: (v: Social[]) => void }) {
  const set = (i: number, s: Partial<Social>) => onChange(values.map((x, j) => (j === i ? { ...x, ...s } : x)));
  return (
    <div className="field-block">
      <span className="eyebrow">Social</span>
      {values.map((s, i) => (
        <div className="edit-row" key={i}>
          <select value={s.platform} aria-label={`Social platform ${i + 1}`} onChange={(e) => set(i, { platform: e.target.value })}>
            {Object.entries(PLATFORM).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
          <input value={s.handle} placeholder="@handle" aria-label={`Social handle ${i + 1}`} onChange={(e) => set(i, { handle: e.target.value })} />
          <button type="button" className="btn plain small" aria-label={`Remove social account ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn plain small add-row" onClick={() => onChange([...values, { platform: 'x', handle: '' }])}>+ Add</button>
    </div>
  );
}

export function OrganisationPage({ ws, notify }: { ws: Workspace; notify: (s: string) => void }) {
  const [p, setP] = useState(ws.profile);
  const [editing, setEditing] = useState<Editing>(null);
  const [contacts, setContacts] = useState(p.officialContacts);
  const [apps, setApps] = useState(p.officialApps);
  const [alerts, setAlerts] = useState(p.alertEmails);
  const [tech, setTech] = useState({ name: p.technicalContact?.name ?? '', email: p.technicalContact?.email ?? '', phone: p.technicalContact?.phone ?? '' });
  const { run, busy } = useActions((e) => notify(e.message));
  const c = p.officialContacts;

  const open = (section: Exclude<Editing, null>) => {
    setContacts(p.officialContacts);
    setApps(p.officialApps);
    setAlerts(p.alertEmails);
    setTech({ name: p.technicalContact?.name ?? '', email: p.technicalContact?.email ?? '', phone: p.technicalContact?.phone ?? '' });
    setEditing(section);
  };
  const save = (section: Exclude<Editing, null>, edit: ProfileEdit) =>
    run(section, async () => {
      const next = await ws.updateProfile(edit);
      ws.profile = next;
      setP(next);
      setEditing(null);
      notify('Saved');
    });

  const actions = (section: Exclude<Editing, null>, edit: () => ProfileEdit) =>
    editing === section ? (
      <div className="row">
        <button className="btn plain small" disabled={busy(section)} onClick={() => setEditing(null)}>Cancel</button>
        <button className="btn small" disabled={busy(section)} aria-busy={busy(section)} onClick={() => void save(section, edit())}>Save</button>
      </div>
    ) : (
      <button className="btn plain small" disabled={editing !== null} onClick={() => open(section)}>Edit</button>
    );

  return (
    <div className="page">
      <PageHead title="Organisation" sub="Edit your contacts, apps and alert emails. Gaskiyya changes the rest." />
      <div className="org-hero card">
        <div className="org-mark big">{p.name.slice(0, 1)}</div>
        <div className="grow">
          <h2>{p.name}</h2>
          <p className="muted flat">{p.legalName ?? KIND[p.kind]}</p>
        </div>
        <div className="row">
          <span className={`tag ${p.status === 'active' ? 'green' : 'red'}`}>{p.status === 'active' ? 'Active' : 'Suspended'}</span>
          <span className={`tag ${p.mode === 'live' ? 'blue' : 'orange'}`}>{ws.kind === 'demo' ? 'Demo' : p.mode === 'live' ? 'Live' : 'Sandbox'}</span>
        </div>
      </div>

      <div className="grid-cards">
        <Section title="Official contacts" action={actions('contacts', () => ({ officialContacts: { phones: clean(contacts.phones), whatsapp: clean(contacts.whatsapp), emails: clean(contacts.emails), social: contacts.social.filter((s) => s.handle.trim()).map((s) => ({ platform: s.platform, handle: s.handle.trim() })) } }))}>
          {editing === 'contacts' ? (
            <>
              <ListField label="Phone" values={contacts.phones} placeholder="+234 201 999 0000" type="tel" onChange={(phones) => setContacts({ ...contacts, phones })} />
              <ListField label="WhatsApp" values={contacts.whatsapp} placeholder="+234 901 999 0000" type="tel" onChange={(whatsapp) => setContacts({ ...contacts, whatsapp })} />
              <ListField label="Email" values={contacts.emails} placeholder="care@yourbank.ng" type="email" onChange={(emails) => setContacts({ ...contacts, emails })} />
              <SocialField values={contacts.social} onChange={(social) => setContacts({ ...contacts, social })} />
            </>
          ) : (
            <>
              <div className="field-block"><span className="eyebrow">Phone</span><List items={c.phones} mono empty="None published" /></div>
              <div className="field-block"><span className="eyebrow">WhatsApp</span><List items={c.whatsapp} mono empty="None published" /></div>
              <div className="field-block"><span className="eyebrow">Email</span><List items={c.emails} empty="None published" /></div>
              <div className="field-block"><span className="eyebrow">Social</span><List items={c.social.map((s) => `${PLATFORM[s.platform] ?? s.platform} @${s.handle.replace(/^@/, '')}`)} empty="None published" /></div>
            </>
          )}
        </Section>

        <Section title="Official apps" action={actions('apps', () => ({ officialApps: { android: clean(apps.android), ios: clean(apps.ios) } }))}>
          {editing === 'apps' ? (
            <>
              <ListField label="Android package" values={apps.android} placeholder="ng.yourbank.mobile" onChange={(android) => setApps({ ...apps, android })} />
              <ListField label="App Store ID or link" values={apps.ios} placeholder="id1234567890" onChange={(ios) => setApps({ ...apps, ios })} />
            </>
          ) : (
            <>
              <div className="field-block"><span className="eyebrow">Android</span><List items={p.officialApps.android} mono empty="None listed" /></div>
              <div className="field-block"><span className="eyebrow">iPhone</span><List items={p.officialApps.ios} mono empty="None listed" /></div>
            </>
          )}
        </Section>

        <Section title="Alert email" action={actions('alerts', () => ({ alertEmails: clean(alerts) }))}>
          {editing === 'alerts' ? (
            <ListField label="Email" values={alerts} placeholder="fraud-desk@yourbank.ng" type="email" onChange={setAlerts} />
          ) : (
            <List items={p.alertEmails} empty="None set" />
          )}
          <p className="muted small flat">Scam campaigns and registration alerts are emailed here.</p>
        </Section>

        <Section
          title="Technical contact"
          action={actions('tech', () => ({ technicalContact: tech.name.trim() || tech.email.trim() ? { name: tech.name.trim(), email: tech.email.trim(), ...(tech.phone.trim() ? { phone: tech.phone.trim() } : {}) } : null }))}
        >
          {editing === 'tech' ? (
            <div className="stack" style={{ gap: 8 }}>
              <input value={tech.name} placeholder="Name" aria-label="Technical contact name" onChange={(e) => setTech({ ...tech, name: e.target.value })} />
              <input type="email" value={tech.email} placeholder="Email" aria-label="Technical contact email" onChange={(e) => setTech({ ...tech, email: e.target.value })} />
              <input type="tel" value={tech.phone} placeholder="Phone (optional)" aria-label="Technical contact phone" onChange={(e) => setTech({ ...tech, phone: e.target.value })} />
            </div>
          ) : p.technicalContact ? (
            <p className="flat">{p.technicalContact.name}<br /><span className="muted small">{p.technicalContact.email}{p.technicalContact.phone ? ` · ${p.technicalContact.phone}` : ''}</span></p>
          ) : (
            <span className="muted">None set</span>
          )}
        </Section>

        <Section title="Identity">
          <dl className="ws-kv">
            <div><dt>Organisation ID</dt><dd className="mono">{p.id}</dd></div>
            <div><dt>Type</dt><dd>{KIND[p.kind]}</dd></div>
            {p.kind === 'bank' && <div><dt>NIBSS bank code</dt><dd className="mono">{p.bankCode ?? 'Not set'}</dd></div>}
          </dl>
        </Section>

        <Section title="Domains and sender IDs">
          <div className="field-block">
            <span className="eyebrow">Web domains</span>
            <List items={p.domains} mono empty="None listed" />
          </div>
          <div className="field-block">
            <span className="eyebrow">SMS sender IDs</span>
            <List items={p.senderIds} empty="None listed" />
          </div>
          <p className="muted small flat">Links to any other domain are flagged as not yours.</p>
        </Section>

        <Section title="Features">
          <ul className="feature-list">
            {Object.entries(FEATURE_NAMES).map(([k, name]) => (
              <li key={k} className={p.features[k] ? 'on' : ''}>
                <span className="switch" aria-hidden="true" />
                <span>{name}</span>
                <span className="muted small">{p.features[k] ? 'On' : 'Off'}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
