/**
 * Ready × TrueCost — the plan-year crossing.
 *
 * This module is the join between the two halves of the project, and it
 * exists because neither half can answer the question on its own.
 *
 *   The benefit engine (lib/engine/benefit.ts) knows what the plan will
 *   charge her, month by month. It does not know whether she has it.
 *
 *   The capacity engine (lib/engine/capacity.ts) knows what she can absorb in
 *   a month. It does not know what the drug will cost once the deductible
 *   turns over.
 *
 * Put them on the same axis and something falls out that nobody models: for a
 * patient on a high-deductible plan, *the same drug is a different product in
 * January than it is in July*. Maria's semaglutide is $997.58 a month while
 * the deductible is open and $199.52 once it clears. Her discretionary income
 * is $262.50. So the honest answer to "can she afford Ozempic" is not yes or
 * no — it is **not until December**, and a therapy you can only start in
 * December is a therapy you cannot start.
 *
 * Plan design and pay cycle are owned by different systems that never speak,
 * which is exactly why the crossing has never been on one screen.
 *
 * MONEY IS INTEGER CENTS. Deterministic: no Date.now(), no randomness.
 */

import { fmt } from '../money';
import { resolvePlanCost } from '../engine/benefit';
import type { CapacityResult, Cents, Drug, Phase, Plan } from '../types';

export interface PlanYearMonth {
  monthIndex: number;
  /** "Sep", "Oct", … as the benefit engine labelled it. */
  label: string;
  /** What the plan charges her for one fill that month. */
  patientPays: Cents;
  phase: Phase;
  /** What her cash flow can absorb in a month, after committed obligations. */
  capacity: Cents;
  clears: boolean;
  /** 0 when it clears; otherwise how far short she is that month. */
  shortBy: Cents;
}

export interface PlanYearCrossing {
  drugLabel: string;
  planName: string;
  months: PlanYearMonth[];
  /** The first month the fill fits inside her monthly capacity. */
  firstClearingMonth: PlanYearMonth | null;
  /** How many months at the front of the year she simply cannot start. */
  monthsBlocked: number;
  /** What the plan would charge across those blocked months, in total. */
  blockedOutlay: Cents;
  /** Her monthly capacity — the flat line the curve has to fall under. */
  capacityMonthly: Cents;
  annualOop: Cents;
  /** The single sentence the screen leads with. */
  headline: string;
  /** Every step, recomputable by hand. Rendered verbatim in the drawer. */
  trace: string[];
}

/**
 * The month-by-month capacity a household can put toward one new fill.
 *
 * `discretionaryMonthly` is income less recurring obligations less ordinary
 * variable spend — i.e. what is genuinely uncommitted. We deliberately do NOT
 * use `safeToPayToday`: that is a point-in-time ceiling for a payment made
 * now, and this is a recurring monthly charge that has to survive every month,
 * not just today.
 */
function monthlyCapacity(capacity: CapacityResult): Cents {
  return capacity.discretionaryMonthly;
}

export function buildPlanYear(args: {
  drug: Drug;
  plan: Plan;
  capacity: CapacityResult;
}): PlanYearCrossing {
  const { drug, plan, capacity } = args;
  const benefit = resolvePlanCost(drug, plan);
  const cap = monthlyCapacity(capacity);
  const trace: string[] = [];

  const drugLabel = drug.brand ? `${drug.name} (${drug.brand})` : drug.name;

  trace.push(
    `${drugLabel} on ${plan.name}. The plan's allowed amount is ${fmt(drug.allowedAmount)} per 30-day fill.`,
  );
  trace.push(
    `Her monthly capacity is ${fmt(cap)} — income ${fmt(capacity.monthlyIncome)} less ` +
      `${fmt(capacity.recurringMonthly)} of recurring obligations and ${fmt(capacity.variableMonthly)} of ordinary variable spend. ` +
      `This is a recurring fill, so it has to clear every month, not just today.`,
  );

  const months: PlanYearMonth[] = benefit.months.map((m) => {
    const clears = m.patientPays <= cap;
    return {
      monthIndex: m.monthIndex,
      label: m.label,
      patientPays: m.patientPays,
      phase: m.phase,
      capacity: cap,
      clears,
      shortBy: clears ? 0 : m.patientPays - cap,
    };
  });

  const firstClearingMonth = months.find((m) => m.clears) ?? null;
  const blocked = months.filter((m) => !m.clears);
  const monthsBlocked = blocked.length;
  const blockedOutlay = blocked.reduce((sum, m) => sum + m.patientPays, 0);

  for (const m of months.slice(0, Math.max(monthsBlocked + 1, 1))) {
    trace.push(
      m.clears
        ? `${m.label}: plan charges ${fmt(m.patientPays)} (${m.phase}) — inside ${fmt(cap)}, so it clears.`
        : `${m.label}: plan charges ${fmt(m.patientPays)} (${m.phase}) — ${fmt(m.shortBy)} more than she has in a month.`,
    );
  }

  let headline: string;
  if (monthsBlocked === 0) {
    headline = `${drugLabel} fits inside her monthly capacity from the first fill.`;
  } else if (firstClearingMonth === null) {
    headline = `There is no month this plan year in which ${drugLabel} fits inside her monthly capacity.`;
    trace.push(
      `No month clears. The deductible turns over and the fill is still above ${fmt(cap)} — this is a pricing problem, not a timing one.`,
    );
  } else {
    headline =
      `Same drug, same plan, same patient: unaffordable for ${monthsBlocked} month${monthsBlocked === 1 ? '' : 's'}, ` +
      `then affordable for ${12 - monthsBlocked}.`;
    trace.push(
      `The curve crosses her capacity in ${firstClearingMonth.label}, when the deductible clears and the fill drops to ${fmt(firstClearingMonth.patientPays)}.`,
    );
    trace.push(
      `To reach that month she would have to absorb ${fmt(blockedOutlay)} across the ${monthsBlocked} blocked months — which is the reason she does not start at all.`,
    );
  }

  return {
    drugLabel,
    planName: plan.name,
    months,
    firstClearingMonth,
    monthsBlocked,
    blockedOutlay,
    capacityMonthly: cap,
    annualOop: benefit.projectedAnnualOop,
    headline,
    trace,
  };
}
