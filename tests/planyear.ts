/**
 * The plan-year crossing — checked against hand arithmetic.
 *
 * This is the join between the benefit engine and the capacity engine, so the
 * assertions below deliberately re-derive both sides rather than trusting
 * either. Every expected value is computed by hand in the comment above it.
 */
import { buildPlanYear } from '../lib/ready/planyear';
import { readCapacity } from '../lib/engine/capacity';
import { drugById } from '../lib/fixtures/formulary';
import { ANTHEM_HSA_3400 } from '../lib/fixtures/plan';
import { buildLedger } from '../lib/fixtures/ledger';
import { dollars } from '../lib/money';

export type EqFn = (label: string, actual: unknown, expected: unknown) => void;
export type OkFn = (label: string, condition: boolean, detail?: string) => void;

export function runPlanYearTests(eq: EqFn, ok: OkFn): void {
  const capacity = readCapacity(buildLedger(), 'demo');
  const sema = drugById('semaglutide');
  if (!sema) throw new Error('semaglutide missing from the formulary');
  const py = buildPlanYear({ drug: sema, plan: ANTHEM_HSA_3400, capacity });

  /* ── the two inputs ──────────────────────────────────────────────────── */

  // income 2,572.88 - recurring 1,639.17 - variable => discretionary 262.50
  eq('plan-year: monthly capacity is the discretionary figure', py.capacityMonthly, dollars(262.5));

  eq('plan-year: twelve months', py.months.length, 12);

  /* ── the deductible phase ────────────────────────────────────────────── */

  // allowed 997.58, deductible remaining 2,850.00, so months 1 and 2 are
  // wholly deductible: 997.58 each, leaving 2,850.00 - 1,995.16 = 854.84
  eq('plan-year: month 1 is the full allowed amount', py.months[0]?.patientPays, dollars(997.58));
  eq('plan-year: month 1 is the deductible phase', py.months[0]?.phase, 'deductible');
  eq('plan-year: month 2 is also wholly deductible', py.months[1]?.patientPays, dollars(997.58));

  // month 3: 854.84 of deductible left, then 20% coinsurance on the rest
  //          854.84 + 0.20 * (997.58 - 854.84) = 854.84 + 28.55 = 883.39
  eq('plan-year: month 3 straddles the deductible', py.months[2]?.patientPays, dollars(883.39));

  // month 4 onward: 20% of 997.58 = 199.516 -> 199.52 half-up
  eq('plan-year: month 4 is pure coinsurance', py.months[3]?.patientPays, dollars(199.52));
  eq('plan-year: month 4 phase', py.months[3]?.phase, 'coinsurance');

  /* ── the crossing ────────────────────────────────────────────────────── */

  // 997.58 > 262.50, 997.58 > 262.50, 883.39 > 262.50, then 199.52 <= 262.50
  eq('plan-year: three months are blocked', py.monthsBlocked, 3);
  eq('plan-year: the crossing is month 4', py.firstClearingMonth?.monthIndex, py.months[3]?.monthIndex);
  ok('plan-year: the crossing month clears', py.firstClearingMonth?.clears === true);

  // 997.58 - 262.50 = 735.08
  eq('plan-year: month 1 shortfall', py.months[0]?.shortBy, dollars(735.08));
  // 883.39 - 262.50 = 620.89
  eq('plan-year: month 3 shortfall', py.months[2]?.shortBy, dollars(620.89));
  eq('plan-year: a clearing month is short by nothing', py.months[3]?.shortBy, 0);

  // 997.58 + 997.58 + 883.39 = 2,878.55
  eq('plan-year: outlay to reach the crossing', py.blockedOutlay, dollars(2878.55));

  // every blocked month precedes every clearing month — the curve only falls
  const firstClear = py.months.findIndex((m) => m.clears);
  ok(
    'plan-year: once it clears it stays cleared',
    py.months.slice(firstClear).every((m) => m.clears),
    py.months.map((m) => `${m.label}:${m.clears ? 'y' : 'n'}`).join(' '),
  );

  /* ── the annual figure agrees with the benefit engine ────────────────── */

  // 997.58 + 997.58 + 883.39 + 199.52 * 9 = 2,878.55 + 1,795.68 = 4,674.23
  eq('plan-year: annual out of pocket', py.annualOop, dollars(4674.23));

  const summed = py.months.reduce((t, m) => t + m.patientPays, 0);
  eq('plan-year: the months sum to the annual figure', summed, py.annualOop);

  /* ── the narrative ───────────────────────────────────────────────────── */

  ok('plan-year: the headline names both halves', /unaffordable for 3 months/.test(py.headline), py.headline);
  ok('plan-year: the trace is populated', py.trace.length >= 5);
  ok(
    'plan-year: no month claims to clear while above capacity',
    py.months.every((m) => m.clears === m.patientPays <= py.capacityMonthly),
  );
}
