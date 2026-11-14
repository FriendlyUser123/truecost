import { dollars } from '../money';
import type { Plan } from '../types';

/**
 * A real-shaped HDHP. The four tiers are what make the formulary comparison
 * meaningful: tier 1 bypasses the deductible entirely, tier 2 lands on a flat
 * copay, tier 3 lands on coinsurance, tier 4 lands on coinsurance with a
 * monthly cap. Nothing here is generated; it is transcribed plan design.
 */
export const ANTHEM_HSA_3400: Plan = {
  id: 'anthem-hsa-3400',
  name: 'Anthem Blue HSA 3400',
  carrier: 'Anthem Blue Cross Blue Shield of Virginia',
  planType: 'HDHP',
  deductible: dollars(3400),
  deductibleRemaining: dollars(2850),
  outOfPocketMax: dollars(7500),
  outOfPocketAccrued: dollars(550),
  accumulatorsAsOf: '2026-09-19',
  tiers: [
    {
      tier: 1,
      label: 'Preferred generic',
      deductibleExempt: true,
      costShare: { kind: 'copay', copay: dollars(10) },
    },
    {
      tier: 2,
      label: 'Preferred brand',
      deductibleExempt: false,
      costShare: { kind: 'copay', copay: dollars(45) },
    },
    {
      tier: 3,
      label: 'Non-preferred brand',
      deductibleExempt: false,
      costShare: { kind: 'coinsurance', rate: 0.2 },
    },
    {
      tier: 4,
      label: 'Specialty',
      deductibleExempt: false,
      costShare: { kind: 'coinsurance', rate: 0.3, monthlyMax: dollars(250) },
    },
  ],
};

export const PLANS: Plan[] = [ANTHEM_HSA_3400];
