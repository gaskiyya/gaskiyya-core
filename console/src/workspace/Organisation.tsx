import type { ReactNode } from 'react';
import type { OrgProfile, Workspace } from './data.ts';
import { PageHead, Section } from './ui.tsx';

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
const PLATFORM: Record<string, string> = { x: 'X', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', telegram: 'Telegram', linkedin: 'LinkedIn', youtube: 'YouTube' };

function List({ items, mono, empty }: { items: ReactNode[]; mono?: boolean; empty: string }) {
  if (items.length === 0) return <span className="muted">{empty}</span>;
  return <div className="chips">{items.map((x, i) => <span key={i} className={`tag plain ${mono ? 'mono' : ''}`}>{x}</span>)}</div>;
}

export function OrganisationPage({ ws }: { ws: Workspace }) {
  const p = ws.profile;
  const c = p.officialContacts;
  return (
    <div className="page">
      <PageHead
        title="Organisation"
        sub={<>What customers' apps treat as official for {p.name}. To change anything here, contact Gaskiyya; every change is reviewed and logged.</>}
      />
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
        <Section title="Identity">
          <dl className="ws-kv">
            <div><dt>Organisation ID</dt><dd className="mono">{p.id}</dd></div>
            <div><dt>Type</dt><dd>{KIND[p.kind]}</dd></div>
            {p.kind === 'bank' && <div><dt>NIBSS bank code</dt><dd className="mono">{p.bankCode ?? 'Not set'}</dd></div>}
            {p.technicalContact && <div><dt>Technical contact</dt><dd>{p.technicalContact.name}<br /><span className="muted small">{p.technicalContact.email}</span></dd></div>}
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
          <p className="muted small flat">Links to any other domain are flagged to customers as not belonging to you.</p>
        </Section>

        <Section title="Official contacts">
          <div className="field-block"><span className="eyebrow">Phone</span><List items={c.phones} mono empty="None published" /></div>
          <div className="field-block"><span className="eyebrow">WhatsApp</span><List items={c.whatsapp} mono empty="None published" /></div>
          <div className="field-block"><span className="eyebrow">Email</span><List items={c.emails} empty="None published" /></div>
          <div className="field-block"><span className="eyebrow">Social</span><List items={c.social.map((s) => `${PLATFORM[s.platform] ?? s.platform} @${s.handle.replace(/^@/, '')}`)} empty="None published" /></div>
        </Section>

        <Section title="Official apps">
          <div className="field-block"><span className="eyebrow">Android</span><List items={p.officialApps.android} mono empty="None listed" /></div>
          <div className="field-block"><span className="eyebrow">iPhone</span><List items={p.officialApps.ios} mono empty="None listed" /></div>
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

        <Section title="Alert email">
          <List items={p.alertEmails} empty={ws.kind === 'demo' ? 'The demo does not send email.' : 'None set: ask Gaskiyya to add your fraud desk address.'} />
          <p className="muted small flat">New scam campaigns, registration alerts and approved advisories are emailed here.</p>
        </Section>
      </div>
    </div>
  );
}
