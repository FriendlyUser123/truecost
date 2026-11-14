import { applyRate, fmt, pct } from '../money';
import { monthLabels } from '../dates';
import type { BenefitResult, Cents, Drug, MonthCost, Phase, Plan, PlanTier } from '../types';

/**
 * Deterministic 12-month benefit adjudication.
 *
 * No model touches this function. Given a drug, a plan and the member's
 * accumulators it walks month by month applying, in order:
 *
 *   1. out-of-pocket maximum      -> member pays 0 once the OOP max is met
 *   2. deductible                 -> member pays the full allowed amount until
 *                                    the remaining deductible is exhausted
 *                                    (unless the tier is deductible-exempt)
 *   3. tier cost share            -> flat copay, or coinsurance, optionally
 *                                    capped per fill
 *
 * The member never pays more than the allowed amount for a fill, which is why
 * a $10 tier-1 copay on an $8.40 generic resolves to $8.40 and not $10.
 *
 * Every step appends a sentence to `trace`. That array is the answer to the
 * only question that matters at a science fair: "where did that number come
 * from?"
 */

function tierFor(plan: Plan, tier: number): PlanTier {
  const t = plan.tiers.find((x) => x.tier === tier);
  if (!t) throw new Error(`plan ${plan.id} has no tier ${tier}`);
  return t;
}

export function resolvePlanCost(
  drug: Drug,
  plan: Plan,
  opts: { months?: number; startFrom?: string } = {},
): BenefitResult {
  const months = opts.months ?? 12;
  const labels = monthLabels(opts.startFrom ?? plan.accumulatorsAsOf, months);
  const tier = tierFor(plan, drug.tier);
  const allowed = drug.allowedAmount;

  const trace: string[] = [];
  trace.push(
    `${drug.name}${drug.brand ? ` (${drug.brand})` : ''} is tier ${tier.tier} — ${tier.label} — on ${plan.name}.`,
  );
  trace.push(
    `Retail cash price is ${fmt(drug.listPrice)} per 30-day fill. The plan's negotiated allowed amount is ${fmt(allowed)}, and every calculation below uses the allowed amount, not the cash price.`,
  );
  trace.push(
    tier.deductibleExempt
      ? `Tier ${tier.tier} is deductible-exempt on this plan, so the ${fmt(plan.deductibleRemaining)} of remaining deductible is not applied.`
      : `Deductible remaining as of ${plan.accumulatorsAsOf}: ${fmt(plan.deductibleRemaining)} of ${fmt(plan.deductible)}.`,
  );
  trace.push(
    tier.costShare.kind === 'copay'
      ? `After the deductible, tier ${tier.tier} is a flat ${fmt(tier.costShare.copay)} copay per fill.`
      : `After the deductible, tier ${tier.tier} is ${pct(tier.costShare.rate)} coinsurance${
          tier.costShare.monthlyMax ? `, capped at ${fmt(tier.costShare.monthlyMax)} per fill` : ''
        }.`,
  );
  trace.push(
    `Out-of-pocket maximum is ${fmt(plan.outOfPocketMax)}; ${fmt(plan.outOfPocketAccrued)} has already accrued this plan year.`,
  );

  let dedRemaining: Cents = tier.deductibleExempt ? 0 : plan.deductibleRemaining;
  let oopAccrued: Cents = plan.outOfPocketAccrued;
  const oopHeadroomStart = plan.outOfPocketMax - plan.outOfPocketAccrued;

  const out: MonthCost[] = [];

  for (let i = 0; i < months; i++) {
    const headroom = Math.max(0, plan.outOfPocketMax - oopAccrued);
    let phase: Phase;
    let toDeductible: Cents = 0;
    let pay: Cents;
    let explanation: string;

    if (headroom === 0) {
      phase = 'oop-max-met';
      pay = 0;
      explanation = `Out-of-pocket maximum of ${fmt(plan.outOfPocketMax)} already met — the plan pays 100%.`;
    } else {
      toDeductible = Math.min(dedRemaining, allowed);
      const afterDeductible = allowed - toDeductible;

      let share: Cents;
      if (tier.costShare.kind === 'copay') {
        // A copay cannot exceed the cost of the drug.
        share = afterDeductible === 0 ? 0 : Math.min(tier.costShare.copay, afterDeductible);
        phase = toDeductible > 0 ? 'deductible' : 'copay';
      } else {
        share = applyRate(afterDeductible, tier.costShare.rate);
        if (tier.costShare.monthlyMax !== undefined) {
          share = Math.min(share, tier.costShare.monthlyMax);
        }
        phase = toDeductible > 0 ? 'deductible' : 'coinsurance';
      }

      pay = Math.min(toDeductible + share, headroom);

      if (toDeductible > 0 && afterDeductible === 0) {
        explanation = `Pre-deductible: pays the full allowed amount, ${fmt(pay)}. Deductible remaining drops to ${fmt(dedRemaining - toDeductible)}.`;
      } else if (toDeductible > 0) {
        explanation = `Deductible is met mid-fill: ${fmt(toDeductible)} finishes the deductible, then ${
          tier.costShare.kind === 'copay'
            ? `a ${fmt(share)} copay`
            : `${pct(tier.costShare.rate)} of the remaining ${fmt(afterDeductible)} = ${fmt(share)}`
        }. Total ${fmt(pay)}.`;
      } else if (tier.deductibleExempt) {
        explanation = `Deductible-exempt tier: ${
          tier.costShare.kind === 'copay'
            ? `the ${fmt(tier.costShare.copay)} copay is capped at the ${fmt(allowed)} allowed amount`
            : `${pct(tier.costShare.rate)} of ${fmt(allowed)}`
        } = ${fmt(pay)}.`;
      } else {
        explanation =
          tier.costShare.kind === 'copay'
            ? `Deductible met: flat ${fmt(pay)} copay.`
            : `Deductible met: ${pct(tier.costShare.rate)} of ${fmt(allowed)} = ${fmt(pay)}.`;
      }

      if (pay === headroom && toDeductible + share > headroom) {
        explanation += ` Truncated to ${fmt(pay)} — this fill reaches the ${fmt(plan.outOfPocketMax)} out-of-pocket maximum.`;
      }
    }

    dedRemaining = Math.max(0, dedRemaining - toDeductible);
    oopAccrued += pay;

    out.push({
      monthIndex: i + 1,
      label: labels[i] ?? `M${i + 1}`,
      allowed,
      patientPays: pay,
      appliedToDeductible: toDeductible,
      phase,
      deductibleRemainingAfter: dedRemaining,
      oopAccruedAfter: oopAccrued,
      explanation,
    });
  }

  const projectedAnnualOop = out.reduce((a, m) => a + m.patientPays, 0);
  const firstNinetyDayOop = out.slice(0, 3).reduce((a, m) => a + m.patientPays, 0);

  trace.push(
    `Months 1-${months}: ${out.map((m) => fmt(m.patientPays)).join(' + ')} = ${fmt(projectedAnnualOop)}.`,
  );
  trace.push(
    projectedAnnualOop >= oopHeadroomStart
      ? `Her out-of-pocket accumulator reaches the ${fmt(plan.outOfPocketMax)} maximum during this plan year, and the plan pays 100% after that.`
      : `Year-end out-of-pocket accumulator lands at ${fmt(oopAccrued)} against a ${fmt(plan.outOfPocketMax)} maximum, so she never reaches the cap and never gets relief at the back of the year.`,
  );

  return {
    drugId: drug.id,
    drugLabel: drug.brand ? `${drug.name} (${drug.brand})` : drug.name,
    tier: drug.tier,
    listPriceMonthly: drug.listPrice,
    allowedMonthly: allowed,
    months: out,
    projectedAnnualOop,
    firstNinetyDayOop,
    trace,
  };
}

/**
 * Re-prices every drug in the same therapeutic class against THIS member's
 * accumulators. It is benefit information her plan already publishes, sorted.
 * It deliberately returns no recommendation and no selection affordance —
 * TrueCost does not choose therapy.
 */
export function compareClass(
  target: Drug,
  formulary: Drug[],
  plan: Plan,
): BenefitResult[] {
  return formulary
    .filter((d) => d.therapeuticClass === target.therapeuticClass)
    .map((d) => resolvePlanCost(d, plan))
    .sort((a, b) => a.projectedAnnualOop - b.projectedAnnualOop);
}
