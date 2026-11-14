import { fmt } from '../money';
import type {
  AssistanceProgram,
  BenefitResult,
  Cents,
  CriterionResult,
  Drug,
  EligibilityProfile,
  Predicate,
  ProgramEvaluation,
} from '../types';

/**
 * A predicate engine, not a lookup table.
 *
 * Each program declares structured criteria. We evaluate every one of them
 * even after the first failure, because the value of the panel is the reasons:
 * a clinician who sees "Lilly Cares — FAILED: 197% FPL, program stops at 150%"
 * learns something. A clinician who sees an empty list learns nothing and
 * stops trusting the tool.
 */

export interface EvalContext {
  patient: EligibilityProfile;
  drug: Drug;
  program: AssistanceProgram;
  /** What the program would have to pay out over the plan year to hit its promise. */
  requiredOutlay: Cents;
  /**
   * Replaces the drug-list sentence. The household basket evaluates a program
   * against several medications at once, and "the order is X" would be wrong.
   */
  drugDetail?: (passed: boolean, covered: string[]) => string;
}

export function evaluatePredicate(p: Predicate, ctx: EvalContext): { passed: boolean; detail: string } {
  const { patient, drug, program, requiredOutlay } = ctx;

  switch (p.field) {
    case 'insuranceType': {
      const actual = patient.insuranceType;
      const passed = p.op === 'eq' ? actual === p.value : actual !== p.value;
      return {
        passed,
        detail: passed
          ? `Coverage on file: ${actual}.`
          : p.op === 'eq'
            ? `Requires ${p.value} coverage; ${patient.firstName} has ${actual} coverage.`
            : `Excludes ${p.value} coverage; ${patient.firstName} has ${actual} coverage.`,
      };
    }
    case 'incomeFplMultiple': {
      const actual = patient.incomeFplMultiple;
      const passed = p.op === 'lte' ? actual <= p.value : actual >= p.value;
      const asPct = (n: number) => `${Math.round(n * 100)}%`;
      return {
        passed,
        detail: passed
          ? `Household income ${fmt(patient.annualHouseholdIncome)} for ${patient.householdSize} = ${asPct(actual)} FPL, within the ${asPct(p.value)} limit.`
          : `Household income ${fmt(patient.annualHouseholdIncome)} for ${patient.householdSize} = ${asPct(actual)} FPL; this program ${p.op === 'lte' ? 'stops at' : 'starts at'} ${asPct(p.value)}.`,
      };
    }
    case 'state': {
      const passed = p.value.includes(patient.state);
      return {
        passed,
        detail: passed
          ? `${patient.city}, ${patient.state} is in the service area.`
          : `Service area is ${p.value.join(', ')}; ${patient.firstName} is in ${patient.state}.`,
      };
    }
    case 'age': {
      const passed = p.op === 'gte' ? patient.age >= p.value : patient.age <= p.value;
      return {
        passed,
        detail: passed
          ? `Age ${patient.age}.`
          : `Age ${patient.age}; the program requires ${p.op === 'gte' ? 'at least' : 'at most'} ${p.value}.`,
      };
    }
    case 'drugId': {
      const passed = p.value.includes(drug.id);
      if (ctx.drugDetail) return { passed, detail: ctx.drugDetail(passed, p.value) };
      return {
        passed,
        detail: passed
          ? `${drug.brand ?? drug.name} is on the covered-product list.`
          : `Covers ${p.value.join(', ')}; the order is ${drug.brand ?? drug.name}.`,
      };
    }
    case 'fundingOpen': {
      const passed = program.fundingOpen;
      return {
        passed,
        detail: passed
          ? 'Accepting new enrollments today.'
          : 'Funding exhausted for this grant cycle — closed to new applicants.',
      };
    }
    case 'annualCapRemaining': {
      if (p.op === 'coversProjected') {
        const passed = program.annualCapRemaining >= requiredOutlay;
        return {
          passed,
          detail: passed
            ? `${fmt(program.annualCapRemaining)} of benefit remaining against a projected ${fmt(requiredOutlay)} plan-year outlay.`
            : `Only ${fmt(program.annualCapRemaining)} of benefit remains; this order needs ${fmt(requiredOutlay)}.`,
        };
      }
      const passed = program.annualCapRemaining >= p.value;
      return {
        passed,
        detail: passed
          ? `${fmt(program.annualCapRemaining)} of benefit remaining.`
          : `${fmt(program.annualCapRemaining)} remaining, below the ${fmt(p.value)} floor.`,
      };
    }
  }
}

/** What a program can still pay this plan year. Infinity = it covers the drug outright. */
export function initialCap(program: AssistanceProgram): number {
  return program.annualBenefitCap === null ? Number.POSITIVE_INFINITY : program.annualCapRemaining;
}

/**
 * Applies a program month by month against a series of member payments.
 * The benefit cap is a real constraint: once a program's remaining benefit is
 * spent, the member goes back to paying plan rates for the rest of the year.
 * `capLeft` is passed in and returned so several drugs can draw on one cap.
 */
export function applyToSeries(
  program: AssistanceProgram,
  series: readonly Cents[],
  capLeft: number,
): { paid: Cents[]; capLeft: number } {
  const target = program.patientPaysMonthly ?? 0;
  const paid: Cents[] = [];
  for (let i = 0; i < series.length; i++) {
    const base = series[i] as Cents;
    if (i >= program.durationMonths) {
      paid.push(base);
      continue;
    }
    const cover = Math.min(Math.max(0, base - target), capLeft);
    capLeft -= cover;
    paid.push(base - cover);
  }
  return { paid, capLeft };
}

/** What the program must pay out to fully deliver on its headline promise. */
export function requiredOutlayForSeries(program: AssistanceProgram, series: readonly Cents[]): Cents {
  const target = program.patientPaysMonthly ?? 0;
  let outlay = 0;
  for (let i = 0; i < Math.min(program.durationMonths, series.length); i++) {
    outlay += Math.max(0, (series[i] as Cents) - target);
  }
  return outlay;
}

function applyProgram(program: AssistanceProgram, baseline: BenefitResult): Cents {
  const series = baseline.months.map((m) => m.patientPays);
  const { paid } = applyToSeries(program, series, initialCap(program));
  return paid.reduce((a, b) => a + b, 0);
}

function requiredOutlayFor(program: AssistanceProgram, baseline: BenefitResult): Cents {
  return requiredOutlayForSeries(
    program,
    baseline.months.map((m) => m.patientPays),
  );
}

/** Eligible first, then by what the patient actually ends up paying. */
export function rankEvaluations(evaluations: ProgramEvaluation[]): ProgramEvaluation[] {
  return evaluations.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible && b.eligible) {
      return (a.projectedAnnualOop ?? 0) - (b.projectedAnnualOop ?? 0);
    }
    const aFails = a.criteria.filter((c) => !c.passed).length;
    const bFails = b.criteria.filter((c) => !c.passed).length;
    return aFails - bFails;
  });
}

export function evaluateAssistance(
  programs: AssistanceProgram[],
  patient: EligibilityProfile,
  drug: Drug,
  baseline: BenefitResult,
): ProgramEvaluation[] {
  const evaluations = programs.map((program) => {
    const requiredOutlay = requiredOutlayFor(program, baseline);
    const criteria: CriterionResult[] = program.criteria.map((c) => {
      const r = evaluatePredicate(c.predicate, { patient, drug, program, requiredOutlay });
      return { label: c.label, passed: r.passed, detail: r.detail };
    });
    const eligible = criteria.every((c) => c.passed);
    const projectedAnnualOop = eligible ? applyProgram(program, baseline) : null;
    return {
      program,
      eligible,
      criteria,
      projectedAnnualOop,
      savingsVsBaseline:
        projectedAnnualOop === null ? null : baseline.projectedAnnualOop - projectedAnnualOop,
    };
  });

  return rankEvaluations(evaluations);
}

export function bestProgram(evaluations: ProgramEvaluation[]): ProgramEvaluation | null {
  return evaluations.find((e) => e.eligible) ?? null;
}
