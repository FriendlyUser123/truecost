import { addDays, addMonthsISO, longDate, monthLabels } from '../dates';
import { applyRate, fmt, pct } from '../money';
import {
  applyToSeries,
  evaluatePredicate,
  initialCap,
  rankEvaluations,
  requiredOutlayForSeries,
} from './assistance';
import type {
  AppliedProgram,
  AssistanceProgram,
  BasketDrug,
  BasketInstallment,
  BasketLine,
  BasketMonth,
  BasketResult,
  BasketSchedule,
  BasketVerdict,
  BasketVerdictLabel,
  CapacityResult,
  Cents,
  CoverageLevel,
  CriterionResult,
  DataSource,
  EligibilityProfile,
  Household,
  HouseholdCapacity,
  IncomeSignal,
  Plan,
  PlanTier,
  ProgramEvaluation,
  Route,
} from '../types';

/**
 * The household basket engine.
 *
 * The single-drug engine (benefit.ts) prices ONE drug against ONE member's accumulators. A
 * household with ten prescriptions cannot be priced by running that ten times:
 * the deductible and the out-of-pocket maximum are shared, so ten independent
 * runs would each spend the full deductible and overstate the bill. This file
 * adjudicates every fill of every drug through one set of accumulators, in a
 * fixed order, month by month.
 *
 * Then it does what the panel does — assistance, then a payday schedule — and
 * one thing the panel has no need for: it chooses HOW each drug is paid for.
 * A generic paid in cash at a discount-card price never touches the insurer, so
 * it also never counts toward the deductible. That trade-off is real, and
 * because it is coupled across drugs the choice is made by evaluating every
 * combination exactly (2^n, n <= 14) rather than by a per-drug rule of thumb.
 *
 * Money is integer cents throughout.
 */

const MONTHS = 12;

const sum = (xs: readonly Cents[]): Cents => xs.reduce((a, b) => a + b, 0);

/* ── 1. joint adjudication ───────────────────────────────────────────────── */

export interface PlanRun {
  /** perDrug[k][m] — what the member pays for drug k in month m. */
  perDrug: Cents[][];
  deductibleMonths: boolean[];
  total: Cents;
}

function tierFor(plan: Plan, tier: number): PlanTier {
  const t = plan.tiers.find((x) => x.tier === tier);
  if (!t) throw new Error(`plan ${plan.id} has no tier ${tier}`);
  return t;
}

/**
 * Same rules as `resolvePlanCost`, applied to many drugs against one set of
 * accumulators: out-of-pocket maximum first, then deductible (unless the tier
 * is exempt), then the tier's cost share, never more than the allowed amount.
 * Drugs are filled in array order within each month. The order only decides
 * WHICH drug absorbs the deductible, never the month's total.
 *
 * `tests/run.ts` proves a one-drug basket reproduces `resolvePlanCost` to the cent.
 */
export function adjudicateBasket(drugs: readonly BasketDrug[], plan: Plan, months = MONTHS): PlanRun {
  const tiers = drugs.map((d) => tierFor(plan, d.tier));
  const perDrug: Cents[][] = drugs.map(() => new Array<Cents>(months).fill(0));
  const deductibleMonths = new Array<boolean>(months).fill(false);

  let ded = plan.deductibleRemaining;
  let oop = plan.outOfPocketAccrued;
  let total = 0;

  for (let m = 0; m < months; m++) {
    for (let k = 0; k < drugs.length; k++) {
      const headroom = plan.outOfPocketMax - oop;
      if (headroom <= 0) continue;

      const allowed = (drugs[k] as BasketDrug).allowedAmount;
      const tier = tiers[k] as PlanTier;
      const toDeductible = tier.deductibleExempt ? 0 : Math.min(ded, allowed);
      const afterDeductible = allowed - toDeductible;

      let share: Cents;
      if (tier.costShare.kind === 'copay') {
        share = afterDeductible === 0 ? 0 : Math.min(tier.costShare.copay, afterDeductible);
      } else {
        share = applyRate(afterDeductible, tier.costShare.rate);
        if (tier.costShare.monthlyMax !== undefined) share = Math.min(share, tier.costShare.monthlyMax);
      }

      const pay = Math.min(toDeductible + share, headroom);
      ded = Math.max(0, ded - toDeductible);
      oop += pay;
      total += pay;
      if (toDeductible > 0) deductibleMonths[m] = true;
      (perDrug[k] as Cents[])[m] = pay;
    }
  }
  return { perDrug, deductibleMonths, total };
}

/* ── 2. assistance, evaluated against a basket ───────────────────────────── */

/** The covered-drug list of a program, or null when it is household-wide (a grant, say). */
export function drugScope(program: AssistanceProgram): string[] | null {
  for (const c of program.criteria) {
    if (c.predicate.field === 'drugId') return c.predicate.value;
  }
  return null;
}

function drugLabel(d: BasketDrug): string {
  return d.brand ?? d.name;
}

/**
 * Every criterion of every program, evaluated against the household. A program
 * that names covered drugs is scored against the selected medications on that
 * list only; a household-wide program is scored against the whole basket.
 * `series[k]` is drug k's monthly cost on the route being evaluated.
 */
export function evaluateBasketAssistance(
  programs: readonly AssistanceProgram[],
  profile: EligibilityProfile,
  drugs: readonly BasketDrug[],
  series: readonly (readonly Cents[])[],
): ProgramEvaluation[] {
  const total = sum(series.map((s) => sum(s)));
  const household = Array.from({ length: MONTHS }, (_, m) => sum(series.map((s) => s[m] as Cents)));

  const evaluations = programs.map((program): ProgramEvaluation => {
    const scope = drugScope(program);
    const idx = drugs.map((_, k) => k).filter((k) => scope === null || scope.includes((drugs[k] as BasketDrug).id));
    const requiredOutlay =
      scope === null
        ? requiredOutlayForSeries(program, household)
        : idx.reduce((a, k) => a + requiredOutlayForSeries(program, series[k] as readonly Cents[]), 0);

    // With no covered drug selected, evaluate against the first one: its
    // drug-list criterion then fails, correctly, and every other criterion is
    // still scored so the reasons are shown.
    const ctxDrug = drugs[idx[0] ?? 0] as BasketDrug;
    const names = idx.map((k) => drugLabel(drugs[k] as BasketDrug));
    const drugDetail = (passed: boolean, covered: string[]): string =>
      passed
        ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} on the covered-product list.`
        : `Covers ${covered.join(', ')}; none of the selected medications is on that list.`;

    const criteria: CriterionResult[] = program.criteria.map((c) => {
      const r = evaluatePredicate(c.predicate, { patient: profile, drug: ctxDrug, program, requiredOutlay, drugDetail });
      return { label: c.label, passed: r.passed, detail: r.detail };
    });
    const eligible = criteria.every((c) => c.passed);

    let saved = 0;
    if (eligible) {
      let cap = initialCap(program);
      if (scope === null) {
        const r = applyToSeries(program, household, cap);
        saved = sum(household) - sum(r.paid);
      } else {
        for (const k of idx) {
          const s = series[k] as readonly Cents[];
          const r = applyToSeries(program, s, cap);
          cap = r.capLeft;
          saved += sum(s) - sum(r.paid);
        }
      }
    }
    return {
      program,
      eligible,
      criteria,
      projectedAnnualOop: eligible ? total - saved : null,
      savingsVsBaseline: eligible ? saved : null,
    };
  });

  return rankEvaluations(evaluations);
}

/**
 * Turns a set of eligible programs into one realistic outcome.
 *
 * Programs that name drugs claim them first, one program per drug — manufacturer
 * cards and patient-assistance programs do not stack on the same fill. A copay
 * card is applied at the pharmacy claim, so it only claims a drug that is being
 * run through the plan. Household-wide programs (grants) then draw down the
 * remaining monthly total, each against its own cap, and may stack.
 */
export function applyPortfolio(
  eligible: readonly ProgramEvaluation[],
  drugs: readonly BasketDrug[],
  series: readonly (readonly Cents[])[],
  routes: readonly Route[],
): { after: Cents[][]; household: Cents[]; applied: AppliedProgram[] } {
  const after = series.map((s) => s.slice());
  const claimed = new Set<number>();
  const applied: AppliedProgram[] = [];

  for (const e of eligible) {
    const scope = drugScope(e.program);
    if (scope === null) continue;
    let cap = initialCap(e.program);
    let saved = 0;
    const touched: string[] = [];
    for (let k = 0; k < drugs.length; k++) {
      const drug = drugs[k] as BasketDrug;
      if (claimed.has(k) || !scope.includes(drug.id)) continue;
      if (e.program.kind === 'copay-card' && routes[k] !== 'plan') continue;
      const cur = after[k] as Cents[];
      const r = applyToSeries(e.program, cur, cap);
      cap = r.capLeft;
      const gain = sum(cur) - sum(r.paid);
      if (gain > 0) {
        after[k] = r.paid;
        claimed.add(k);
        saved += gain;
        touched.push(drug.id);
      }
    }
    if (saved > 0) applied.push({ program: e.program, scope: 'drug', drugIds: touched, saved });
  }

  let household = Array.from({ length: MONTHS }, (_, m) => sum(after.map((s) => s[m] as Cents)));
  for (const e of eligible) {
    if (drugScope(e.program) !== null) continue;
    const r = applyToSeries(e.program, household, initialCap(e.program));
    const gain = sum(household) - sum(r.paid);
    if (gain > 0) {
      household = r.paid;
      applied.push({ program: e.program, scope: 'household', drugIds: [], saved: gain });
    }
  }
  return { after, household, applied };
}

/* ── 3. routing ──────────────────────────────────────────────────────────── */

export interface Priced {
  run: PlanRun | null;
  /** Monthly member cost per drug, before any program. */
  series: Cents[][];
  after: Cents[][];
  household: Cents[];
  applied: AppliedProgram[];
  /** Sum of `series` — the cost of these routes before assistance. */
  routed: Cents;
  /** Sum of `household` — the cost after assistance. */
  total: Cents;
}

const discountPrice = (d: BasketDrug): Cents => Math.min(d.cashPrice, d.listPrice);

/** Prices one complete routing of the basket. */
export function priceRoutes(
  drugs: readonly BasketDrug[],
  coverage: CoverageLevel,
  routes: readonly Route[],
  eligible: readonly ProgramEvaluation[],
): Priced {
  const planIdx = drugs.map((_, k) => k).filter((k) => routes[k] === 'plan');
  let run: PlanRun | null = null;
  if (planIdx.length > 0) {
    if (!coverage.plan) throw new Error('an uninsured household has no plan route');
    run = adjudicateBasket(
      planIdx.map((k) => drugs[k] as BasketDrug),
      coverage.plan,
    );
  }

  const series: Cents[][] = drugs.map((d, k) => {
    if (routes[k] === 'plan') return (run as PlanRun).perDrug[planIdx.indexOf(k)] as Cents[];
    return new Array<Cents>(MONTHS).fill(routes[k] === 'discount' ? discountPrice(d) : d.listPrice);
  });

  const routed = sum(series.map((s) => sum(s)));
  if (eligible.length === 0) {
    const household = Array.from({ length: MONTHS }, (_, m) => sum(series.map((s) => s[m] as Cents)));
    return { run, series, after: series, household, applied: [], routed, total: routed };
  }
  const p = applyPortfolio(eligible, drugs, series, routes);
  return { run, series, after: p.after, household: p.household, applied: p.applied, routed, total: sum(p.household) };
}

export interface RoutePlan {
  routes: Route[];
  priced: Priced;
  combinations: number;
  /** flipDelta[k] — extra annual cost if drug k alone took the other route. Never negative. */
  flipDelta: Cents[];
}

/**
 * Chooses the route for every drug that minimises the household's total,
 * assistance included. Insured: every one of the 2^n plan/discount
 * combinations is priced — exact, and ~16k evaluations at the maximum of 14
 * drugs. Ties resolve toward keeping a drug on the plan, so a route only
 * changes when it strictly saves money.
 */
export function chooseRoutes(
  drugs: readonly BasketDrug[],
  coverage: CoverageLevel,
  eligible: readonly ProgramEvaluation[],
): RoutePlan {
  const n = drugs.length;

  if (!coverage.plan) {
    const routes: Route[] = drugs.map((d) => (d.cashPrice < d.listPrice ? 'discount' : 'retail'));
    const priced = priceRoutes(drugs, coverage, routes, eligible);
    const flipDelta = drugs.map((_, k) => {
      const flipped = routes.slice();
      flipped[k] = routes[k] === 'discount' ? 'retail' : 'discount';
      return priceRoutes(drugs, coverage, flipped, eligible).total - priced.total;
    });
    return { routes, priced, combinations: 1, flipDelta };
  }

  const totals = new Float64Array(1 << n);
  const routesFor = (mask: number): Route[] => drugs.map((_, k) => (mask & (1 << k) ? 'discount' : 'plan'));
  let best = 0;
  totals[0] = priceRoutes(drugs, coverage, routesFor(0), eligible).total;
  for (let mask = 1; mask < 1 << n; mask++) {
    const t = priceRoutes(drugs, coverage, routesFor(mask), eligible).total;
    totals[mask] = t;
    if (t < (totals[best] as number)) best = mask;
  }

  const routes = routesFor(best);
  const priced = priceRoutes(drugs, coverage, routes, eligible);
  const flipDelta = drugs.map((_, k) => (totals[best ^ (1 << k)] as number) - (totals[best] as number));
  return { routes, priced, combinations: 1 << n, flipDelta };
}

/* ── 4. capacity, verdict, schedule ──────────────────────────────────────── */

export function readHousehold(h: Household): HouseholdCapacity {
  const gross = h.profile.annualHouseholdIncome;
  const disposableAnnual = Math.round(gross * h.disposableShare);
  const slackAnnual = Math.round(disposableAnnual * h.savingRate);
  const slackMonthly = Math.floor(slackAnnual / 12);
  return {
    grossMonthly: Math.round(gross / 12),
    disposableMonthly: Math.round(disposableAnnual / 12),
    slackMonthly,
    slackAnnual,
    trace: [
      `Gross household income is ${fmt(gross)} a year (U.S. Census Bureau median, 2024), or ${fmt(Math.round(gross / 12))} a month.`,
      `About ${pct(h.disposableShare)} of that reaches disposable income after taxes, ${fmt(disposableAnnual)} a year. This is an aggregate ratio, not the household's own return.`,
      `Households keep about ${pct(h.savingRate)} of disposable income unspent (BEA personal saving rate, July 2026): ${fmt(slackAnnual)} a year, or ${fmt(slackMonthly)} a month. That slack is what a new monthly cost has to fit inside without cutting something else.`,
    ],
  };
}

const SOURCE_PHRASE: Record<DataSource, string> = {
  live: "Capital One's Nessie sandbox, read live",
  recorded: 'a recorded replay of the Nessie sandbox',
  demo: 'the seeded Nessie ledger (no sandbox attached)',
};

/**
 * The household's capacity, read off its bank ledger by the same detector that
 * reads Maria's. Nothing here is asserted: income is the payroll the detector
 * found, and the slack is what is left after the fixed bills it found and the
 * everyday spending it measured. The result is the CapacityResult the
 * Ready board already produces, reshaped for the household's page.
 */
export function householdCapacityFromLedger(c: CapacityResult, h: Household): HouseholdCapacity {
  const gross = h.profile.annualHouseholdIncome;
  const slackMonthly = Math.max(0, c.discretionaryMonthly);
  return {
    grossMonthly: Math.round(gross / 12),
    disposableMonthly: c.monthlyIncome,
    slackMonthly,
    slackAnnual: slackMonthly * 12,
    trace: [
      `Read from the household's bank account: ${SOURCE_PHRASE[c.source]}. Nothing on this page about what the household can spare is typed in; it is derived from the transactions below.`,
      `For scale, gross household income is ${fmt(gross)} a year (U.S. Census Bureau median, 2024). The ledger's payroll is take-home, after taxes.`,
      ...c.trace,
    ],
    ledger: {
      source: c.source,
      checkingBalance: c.checkingBalance,
      savingsBalance: c.savingsBalance,
      safeToPayToday: c.safeToPayToday,
      income: c.income,
      recurring: c.recurring,
      recurringMonthly: c.recurringMonthly,
      variableMonthly: c.variableMonthly,
    },
  };
}

function assess(monthly: readonly Cents[], capacity: HouseholdCapacity) {
  const total = sum(monthly);
  const peak = Math.max(...monthly, 0);
  const average = Math.round(total / Math.max(1, monthly.length));
  const slack = capacity.slackMonthly;
  const label: BasketVerdictLabel =
    peak <= slack ? 'AFFORDABLE' : average <= slack ? 'AFFORDABLE IF LEVELLED' : 'NOT AFFORDABLE';
  // Against the annual figure, not monthly x 12: the monthly one is floored to
  // the cent and the two would disagree by a few cents on screen.
  return { label, peak, average, total, annualShortfall: Math.max(0, total - capacity.slackAnnual) };
}

/**
 * Twelve installments, one per fill, each pinned to the last payday on or
 * before its fill date. The total is levelled across the year (the clinician
 * panel does the same) so a deductible-heavy month does not land as one bad
 * paycheck.
 *
 * With a bank ledger, the payday cadence is the one DETECTED from the deposits
 * (not the one configured on the household), and installment one is checked
 * against today's safe-to-pay ceiling exactly as Maria's is. Without a ledger
 * it falls back to the configured cadence and makes no claim about the account.
 */
export function buildBasketSchedule(
  finalMonthly: readonly Cents[],
  household: Household,
  today: string,
  ledger?: { income: IncomeSignal | null; safeToPayToday: Cents; checkingBalance: Cents },
): BasketSchedule {
  const total = sum(finalMonthly);
  const months = finalMonthly.length;
  const base = Math.floor(total / months);
  const remainder = total - base * months;
  const amounts = Array.from({ length: months }, (_, i) => base + (i < remainder ? 1 : 0));

  const detected = ledger?.income ?? null;
  const intervalDays = detected?.intervalDays ?? household.paycheckIntervalDays;
  const lastPayday = detected?.lastPayday ?? household.lastPayday;

  const paydays: string[] = [];
  let cursor = lastPayday;
  for (let i = 0; i < 40 && cursor <= addMonthsISO(today, months + 1); i++) {
    paydays.push(cursor);
    cursor = addDays(cursor, intervalDays);
  }

  const installments: BasketInstallment[] = amounts.map((amount, i) => {
    const fill = addMonthsISO(today, i);
    const dueDate = [...paydays].filter((p) => p <= fill).pop() ?? (paydays[0] as string);
    return { n: i + 1, dueDate, amount };
  });

  const paychecksPerYear = Math.floor(364 / intervalDays);
  const perPaycheck = Math.ceil(total / paychecksPerYear);
  const first = amounts[0] ?? 0;
  const firstInstallmentFits = ledger ? first <= ledger.safeToPayToday : null;

  const trace: string[] = [
    `Twelve-month total after routing and assistance is ${fmt(total)}. Split across ${months} fills: ${fmt(base)} each${
      remainder > 0 ? `, with ${remainder} cent(s) of rounding absorbed by the first installment(s)` : ''
    }.`,
    detected
      ? `Payroll cadence is the one detected in the bank deposits: ${fmt(detected.averageAmount)} every ${detected.intervalDays} days (${detected.cadence}), last paid ${longDate(detected.lastPayday)}.`
      : `Payroll is every ${intervalDays} days, last paid ${longDate(lastPayday)} (configured, not detected: there is no ledger).`,
    'Each installment is set aside from the last payday on or before its fill date, so the money is already in hand when the pharmacy asks for it.',
    `Spread across ${paychecksPerYear} paychecks instead, that is ${fmt(perPaycheck)} a paycheck.`,
  ];
  if (ledger) {
    trace.push(
      firstInstallmentFits
        ? `Installment one of ${fmt(first)} is inside today's safe-to-pay ceiling of ${fmt(ledger.safeToPayToday)}, so it can execute now as a transfer.`
        : `Installment one of ${fmt(first)} exceeds today's safe-to-pay ceiling of ${fmt(ledger.safeToPayToday)}, so it is held: nothing is transferred until it fits.`,
    );
  } else {
    trace.push('There is no ledger here, so nothing about the account is checked and nothing can be transferred.');
  }

  return {
    installments,
    perInstallment: first,
    paychecksPerYear,
    perPaycheck,
    total,
    firstInstallmentFits,
    trace,
  };
}

/* ── 5. the whole thing ──────────────────────────────────────────────────── */

export interface BasketInput {
  household: Household;
  coverage: CoverageLevel;
  drugs: readonly BasketDrug[];
  programs: readonly AssistanceProgram[];
  today: string;
  referenceDrugSpend: Cents;
  /**
   * The household's bank, as the capacity detector read it. When absent the
   * engine falls back to capacity modelled from published ratios, which is what
   * the pure engine tests use; the app itself always passes a ledger.
   */
  ledger?: { capacity: CapacityResult };
}

function routeLabel(r: Route): string {
  return r === 'plan' ? 'through the plan' : r === 'discount' ? 'with a discount card' : 'at the counter price';
}

export function buildBasket(input: BasketInput): BasketResult {
  const { household, coverage, drugs, programs, today, referenceDrugSpend } = input;
  if (drugs.length === 0) throw new Error('a basket needs at least one medication');

  const profile: EligibilityProfile = { ...household.profile, insuranceType: coverage.insuranceType };
  const capacity = input.ledger
    ? householdCapacityFromLedger(input.ledger.capacity, household)
    : readHousehold(household);
  const insured = coverage.plan !== null;

  /* as issued: every drug paid the default way, no assistance */
  const asIssuedRoutes: Route[] = drugs.map(() => (insured ? 'plan' : 'retail'));
  const asIssued = priceRoutes(drugs, coverage, asIssuedRoutes, []);

  /* which programs are open to this household, judged against the as-issued bill */
  const assistance = evaluateBasketAssistance(programs, profile, drugs, asIssued.series);
  const eligible = assistance.filter((a) => a.eligible);

  /* the cheapest way to pay, programs included */
  const plan = chooseRoutes(drugs, coverage, eligible);
  const chosen = plan.priced;

  const lines: BasketLine[] = drugs.map((d, k) => {
    const route = plan.routes[k] as Route;
    const asIssuedAnnual = sum(asIssued.series[k] as Cents[]);
    const routedAnnual = sum(chosen.series[k] as Cents[]);
    const finalAnnual = sum(chosen.after[k] as Cents[]);
    const program = chosen.applied.find((a) => a.scope === 'drug' && a.drugIds.includes(d.id))?.program.name ?? null;
    const flip = plan.flipDelta[k] as Cents;

    let why: string;
    if (!insured) {
      why =
        route === 'discount'
          ? `Discount-card price ${fmt(discountPrice(d))} against ${fmt(d.listPrice)} at the counter saves ${fmt((d.listPrice - discountPrice(d)) * MONTHS)} a year.`
          : 'A brand-name product has no meaningful discount-card price, so the counter price stands.';
    } else {
      // Only a tier that pays the deductible can lose anything by leaving the plan.
      const feedsDeductible = coverage.plan?.tiers.find((t) => t.tier === d.tier)?.deductibleExempt === false;
      if (route === 'discount') {
        why = `The discount card beats the plan by ${fmt(flip)} a year for this drug, given the rest of the basket.${
          feedsDeductible ? ' Cash purchases never count toward the deductible; that cost is already in the total.' : ''
        }`;
      } else if (flip > 0) {
        why = `The plan beats the discount card by ${fmt(flip)} a year for this drug, given the rest of the basket.`;
      } else {
        why = `The plan and the discount card cost the same here, so it stays on the plan${
          feedsDeductible ? ', where it counts toward the deductible' : ''
        }.`;
      }
    }

    return {
      drugId: d.id,
      label: d.brand ? `${d.name} (${d.brand})` : d.name,
      rank: d.rank,
      prescriptions: d.prescriptions,
      tier: d.tier,
      priorAuthRequired: d.priorAuthRequired,
      listPrice: d.listPrice,
      allowedAmount: d.allowedAmount,
      cashPrice: d.cashPrice,
      asIssuedRoute: asIssuedRoutes[k] as Route,
      route,
      asIssuedAnnual,
      routedAnnual,
      finalAnnual,
      program,
      why,
    };
  });

  const labels = monthLabels(today, MONTHS);
  const months: BasketMonth[] = chosen.household.map((total, m) => ({
    label: labels[m] ?? `M${m + 1}`,
    total,
    deductibleActive: chosen.run?.deductibleMonths[m] ?? false,
  }));

  const asIssuedAnnual = asIssued.total;
  const routedAnnual = chosen.routed;
  const finalAnnual = chosen.total;
  const assistanceSavings = sum(chosen.applied.map((a) => a.saved));
  const routeSavings = asIssuedAnnual - finalAnnual - assistanceSavings;

  /* verdict */
  const now = assess(chosen.household, capacity);
  const before = assess(asIssued.household, capacity);
  const rationale: string[] = [
    `The household has about ${fmt(capacity.slackMonthly)} a month of slack. Paid the default way, these medications cost ${fmt(before.average)} a month on average and ${fmt(before.peak)} in the worst month: ${before.label.toLowerCase()}.`,
    `After choosing routes and applying assistance they cost ${fmt(now.average)} a month on average and ${fmt(now.peak)} in the worst month: ${now.label.toLowerCase()}.`,
  ];
  if (now.label === 'AFFORDABLE IF LEVELLED') {
    rationale.push(
      `The worst month is above the slack but the yearly average is not, so the answer depends on setting money aside each payday instead of paying each fill from whatever is in the account.`,
    );
  }
  const verdict: BasketVerdict = {
    label: now.label,
    affordable: now.label !== 'NOT AFFORDABLE',
    slackMonthly: capacity.slackMonthly,
    peakMonth: now.peak,
    averageMonth: now.average,
    shareOfSlack: capacity.slackMonthly > 0 ? now.average / capacity.slackMonthly : 0,
    annualShortfall: now.annualShortfall,
    asIssuedLabel: before.label,
    asIssuedAnnualShortfall: before.annualShortfall,
    rationale,
  };

  /* schedule */
  const schedule = buildBasketSchedule(
    chosen.household,
    household,
    today,
    capacity.ledger && {
      income: capacity.ledger.income,
      safeToPayToday: capacity.ledger.safeToPayToday,
      checkingBalance: capacity.ledger.checkingBalance,
    },
  );

  /* traces */
  const trace: string[] = [];
  trace.push(
    `${drugs.length} medication${drugs.length === 1 ? '' : 's'}, filled monthly for twelve months from ${longDate(today)}: ${drugs.map((d) => drugLabel(d)).join(', ')}.`,
  );
  if (coverage.plan) {
    const p = coverage.plan;
    trace.push(
      `${p.name}: ${fmt(p.deductible)} deductible, ${fmt(p.outOfPocketMax)} out-of-pocket maximum, ${p.tiers
        .map((t) => `tier ${t.tier} ${t.costShare.kind === 'copay' ? fmt(t.costShare.copay) : pct(t.costShare.rate)}${t.deductibleExempt ? ' (skips the deductible)' : ''}`)
        .join(', ')}.`,
    );
    trace.push(
      'Every fill of every drug on the plan is adjudicated through one shared deductible and one shared out-of-pocket maximum, in the order listed. Ten independent runs would each spend the whole deductible and overstate the bill.',
    );
  } else {
    trace.push('No insurance: nothing to adjudicate. Each drug is paid at the counter price or with a discount card.');
  }
  trace.push(
    `Paid the default way ${insured ? '(everything through the plan)' : '(everything at the counter price)'}, the twelve-month total is ${fmt(asIssuedAnnual)}.`,
  );
  for (const line of lines) {
    trace.push(
      `${line.label}: ${routeLabel(line.route)}, ${fmt(line.routedAnnual)} a year${
        line.program ? `, then ${fmt(line.finalAnnual)} after ${line.program}` : ''
      }.`,
    );
  }
  for (let m = 0; m < months.length; m++) {
    const mo = months[m] as BasketMonth;
    trace.push(`${mo.label}: ${fmt(mo.total)}${mo.deductibleActive ? ' — the deductible is still being paid down.' : '.'}`);
  }

  const optimizerTrace = [
    insured
      ? `Priced every one of the ${plan.combinations.toLocaleString('en-US')} ways to split ${drugs.length} drugs between the plan and a discount card, each with assistance applied. The cheapest split costs ${fmt(finalAnnual)} a year.`
      : `No plan to choose against. Each drug uses whichever of the discount card and the counter price is lower. Total ${fmt(finalAnnual)} a year.`,
    `Every drug was also re-priced on the other route alone; none of those single changes beats the chosen split.`,
    'Ties resolve toward the plan, so a drug only leaves it when leaving strictly saves money.',
    'Assistance is judged against the default-route bill, then applied to whichever routes win. A copay card only ever attaches to a drug that runs through the plan.',
  ];
  if (insured && chosen.applied.some((a) => a.scope === 'drug')) {
    optimizerTrace.push(
      'Assumption: manufacturer assistance dollars count toward the deductible and the out-of-pocket maximum, so a card on an expensive drug can clear the deductible for everything else on the plan. Plans that run a copay accumulator do not credit those dollars; on such a plan the deductible clears later and this bill is higher.',
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    household,
    profile,
    coverage,
    lines,
    months,
    asIssuedAnnual,
    routedAnnual,
    finalAnnual,
    routeSavings,
    assistanceSavings,
    assistance,
    applied: chosen.applied,
    capacity,
    verdict,
    schedule,
    referenceDrugSpend,
    optimizer: { combinations: plan.combinations, trace: optimizerTrace },
    dataSources: { nessie: capacity.ledger?.source ?? null },
    trace,
  };
}
