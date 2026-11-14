import type { Metadata } from 'next';
import EverydayRx from '@/components/EverydayRx';
import { computeBasket } from '@/lib/basket';
import { BASKET_DRUGS, COVERAGE_LEVELS } from '@/lib/fixtures/household';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ready — the median American household and its medications',
  description:
    'The fourteen most-prescribed drugs in the U.S., priced against a median household’s bank account and a choice of insurance, with the cheapest way to pay for each and a payday plan written to the bank.',
};

export default async function Page() {
  return (
    <EverydayRx
      initial={await computeBasket()}
      catalog={BASKET_DRUGS.map((d) => ({
        id: d.id,
        label: d.brand ? `${d.name} (${d.brand})` : d.name,
        rank: d.rank,
        prescriptions: d.prescriptions,
        defaultSelected: d.defaultSelected,
      }))}
      coverages={COVERAGE_LEVELS.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb }))}
    />
  );
}
