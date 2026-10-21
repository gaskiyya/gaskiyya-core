import type { LicenceDataFile } from './index.ts';
import cbnCommercial from '../data/cbn-commercial-banks.json' with { type: 'json' };
import cbnFinance from '../data/cbn-finance-companies.json' with { type: 'json' };
import cbnMerchant from '../data/cbn-merchant-banks.json' with { type: 'json' };
import cbnMicrofinance from '../data/cbn-microfinance-banks.json' with { type: 'json' };
import cbnNonInterest from '../data/cbn-non-interest-banks.json' with { type: 'json' };
import cbnPsb from '../data/cbn-payment-service-banks.json' with { type: 'json' };
import cbnPsp from '../data/cbn-payment-service-providers.json' with { type: 'json' };
import cbnMortgage from '../data/cbn-primary-mortgage-banks.json' with { type: 'json' };
import fccpc from '../data/fccpc-digital-lenders.json' with { type: 'json' };

// Order is preference when two lists name the same firm.
export const BUNDLED_LICENCES = [fccpc, cbnCommercial, cbnMerchant, cbnNonInterest, cbnPsb, cbnMicrofinance, cbnFinance, cbnMortgage, cbnPsp] as LicenceDataFile[];
