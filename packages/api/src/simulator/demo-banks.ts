import presets from './demo-banks.json' with { type: 'json' };
import orgPresets from './demo-orgs.json' with { type: 'json' };

export interface Publishes {
  kind?: 'bank' | 'agency' | 'company';
  officialContacts?: {
    phones?: string[];
    whatsapp?: string[];
    emails?: string[];
    social?: { platform: 'x' | 'facebook' | 'instagram' | 'tiktok' | 'telegram'; handle: string }[];
  };
  officialApps?: { android?: string[]; ios?: string[] };
}

export interface DemoBank {
  description: string;
  tenant: { id: string; name: string; domains: string[]; senderIds: string[]; bankCode?: string } & Publishes;
  publishes?: Publishes;
  lookalikeDomain: string;
  fakeCustomerCare?: { whatsapp: string; handle: string };
  sampleMessage?: string;
}

export const DEMO_BANKS: Record<string, DemoBank> = presets as Record<string, DemoBank>;

export const DEMO_ORGS: Record<string, DemoBank> = orgPresets as Record<string, DemoBank>;

export function demoTenant(preset: DemoBank): DemoBank['tenant'] {
  return { ...preset.tenant, ...preset.publishes };
}

export function demoBank(key: string): DemoBank {
  const b = DEMO_BANKS[key];
  if (!b) throw new Error(`Unknown demo bank "${key}"; choose one of ${Object.keys(DEMO_BANKS).join(', ')}`);
  return b;
}
