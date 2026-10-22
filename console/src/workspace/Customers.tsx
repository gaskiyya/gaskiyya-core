import { useState } from 'react';
import copy from '../../../packages/schemas/copy.json';
import type { Category } from '@gaskiya/schemas';
import { genuineTemplate } from '../../../packages/api/src/simulator/demo-data.ts';
import { sim, type AppUser, type Call, type SimConfig } from '../api.ts';
import { IconMessage, IconPhone, IconSend, IconShield, IconWarning } from '../icons.tsx';
import { ago, Empty, fmtTime, PageHead, Section, usePoll } from './ui.tsx';

const label = (map: Record<string, string>, key: string) => {
  const s = map[key] ?? key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const showPhone = (p: string) => p.replace(/^(\+\d{3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4');
const SIM_SAYS: Record<string, string> = { swapped: 'SIM changed in the last 24 hours', not_swapped: 'No SIM change in the last 24 hours', unknown: 'The network could not answer' };

export function CustomersPage({ config, notify, onCalled, onOpen }: {
  config: SimConfig;
  notify: (s: string) => void;
  onCalled: (call: Call) => void;
  onOpen: (phone: string) => void;
}) {
  const [list] = usePoll(() => sim.recentCustomers(), 4000);
  const [open, setOpen] = useState<{ phone: string; tool: 'call' | 'text' } | null>(null);
  const users = list?.customers ?? [];
  const today = users.filter((u) => Date.now() - Date.parse(u.firstSeenAt) < 86_400_000).length;

  return (
    <div className="page">
      <PageHead
        title="Customers"
        sub={`Everyone who signed in to the Gaskiyya app with their number is a ${config.bank.name} customer. Call them, text them, or test them with a scam.`}
      />
      <Section title="Registered app users" action={users.length ? <span className="muted small">{users.length} in all &middot; {today} new today</span> : undefined}>
        {!list ? (
          <p className="muted small flat">Loading&hellip;</p>
        ) : users.length === 0 ? (
          <Empty icon={<IconPhone />} title="No one has signed in to the app yet">When someone signs in to the Gaskiyya app with their number, they appear here.</Empty>
        ) : (
          <ul className="app-users">
            {users.map((u) => (
              <AppUserRow
                key={u.phone}
                user={u}
                config={config}
                tool={open?.phone === u.phone ? open.tool : null}
                setTool={(tool) => setOpen(tool ? { phone: u.phone, tool } : null)}
                notify={notify}
                onCalled={onCalled}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function AppUserRow({ user, config, tool, setTool, notify, onCalled, onOpen }: {
  user: AppUser;
  config: SimConfig;
  tool: 'call' | 'text' | null;
  setTool: (t: 'call' | 'text' | null) => void;
  notify: (s: string) => void;
  onCalled: (call: Call) => void;
  onOpen: (phone: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState(config.purposes[0]!);
  const draft = (c: string) => genuineTemplate(c as Category, config.bank.name, user.phone, new Date(), config.bank.domain).text;
  const [category, setCategory] = useState('security_notice');
  const [text, setText] = useState(() => draft('security_notice'));
  const who = showPhone(user.phone);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (t: 'call' | 'text') => setTool(tool === t ? null : t);

  return (
    <li>
      <div className="app-user">
        <span className="avatar app">{user.phone.slice(-2)}</span>
        <div className="grow">
          <div className="strong">{who}</div>
          <div className="muted small">
            Joined {fmtTime(user.firstSeenAt)} &middot; Last seen {ago(user.lastSeenAt).toLowerCase()}
          </div>
        </div>
        <div className="row app-user-actions">
          <button className="btn" aria-expanded={tool === 'call'} onClick={() => toggle('call')}><IconPhone /> Call</button>
          <button className="btn secondary" aria-expanded={tool === 'text'} onClick={() => toggle('text')}><IconMessage /> Text</button>
          <button className="btn secondary" disabled={busy} onClick={() => act(async () => { await sim.sendFake(user.phone, Math.floor(Math.random() * 4)); notify(`Scam text sent to ${who}`); })}>
            <IconWarning /> Scam test
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => act(async () => { const a = await sim.simSwapCheck(user.phone, 24); notify(`${who}: ${SIM_SAYS[a.status] ?? a.status}`); })}>
            <IconShield /> SIM check
          </button>
          <button className="btn plain" onClick={() => onOpen(user.phone)}>Open phone</button>
        </div>
      </div>
      {tool === 'call' && (
        <div className="app-user-tool stack">
          <p className="muted small flat">Gaskiyya rings {who}&apos;s app with a code before your agent dials. The agent reads the code aloud and the customer compares it.</p>
          <div className="chips" role="group" aria-label="Call purpose">
            {config.purposes.map((p) => (
              <button key={p} className={`chip ${purpose === p ? 'on' : ''}`} aria-pressed={purpose === p} onClick={() => setPurpose(p)}>{label(copy.purposes, p)}</button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" disabled={busy} onClick={() => act(async () => { onCalled(await sim.openCall(user.phone, purpose)); notify(`Calling ${who}. Their app now shows the code.`); })}>
              <IconPhone /> Announce and call
            </button>
          </div>
        </div>
      )}
      {tool === 'text' && (
        <div className="app-user-tool stack">
          <div className="chips" role="group" aria-label="Message type">
            {config.categories.map((c) => (
              <button key={c} className={`chip ${category === c ? 'on' : ''}`} aria-pressed={category === c} onClick={() => { setCategory(c); setText(draft(c)); }}>{label(copy.categories, c)}</button>
            ))}
          </div>
          <textarea aria-label={`Message to ${who}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted small">Registered with Gaskiyya first, so {who}&apos;s app shows it as sent by {config.bank.name}.</span>
            <button className="btn" disabled={busy || !text.trim()} onClick={() => act(async () => { await sim.send(user.phone, category, text.trim()); notify(`Registered and sent to ${who}`); setTool(null); setText(draft(category)); })}>
              <IconSend /> Send
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
