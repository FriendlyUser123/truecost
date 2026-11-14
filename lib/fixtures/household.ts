import { DEMO_TODAY } from '../dates';
import { dollars } from '../money';
import type { AssistanceProgram, BasketDrug, CoverageLevel, Household, Plan } from '../types';
import { ASSISTANCE_PROGRAMS } from './assistance';
import { drugById } from './formulary';

/**
 * The "average American" segment.
 *
 * Every constant below is marked SOURCED (a published statistic, with the
 * publisher and year) or MODELLED (a number we chose because no single
 * published figure exists). The UI carries the same split, because the whole
 * pitch of this project is that a judge can ask "where did that come from" and
 * get an answer that is not "a model said so".
 */

/* ── the household ───────────────────────────────────────────────────────── */

/** SOURCED — U.S. Census Bureau, Income in the United States: 2024 (P60-286). Median household income. */
export const MEDIAN_HOUSEHOLD_INCOME = dollars(83_730);

/**
 * SOURCED — HHS/ASPE 2026 poverty guidelines, 48 contiguous states, household of 3.
 * The average household is 2.5 people; FPL is defined per whole person, so we
 * round up to three rather than interpolate.
 */
export const FPL_2026_HOUSEHOLD_3 = dollars(27_320);

/** SOURCED — BLS Consumer Expenditure Survey 2024, "Drugs" line, average per household. OTC included. */
export const BLS_AVERAGE_DRUG_SPEND = dollars(658);

export const HOUSEHOLD: Household = {
  label: 'The median U.S. household',
  profile: {
    firstName: 'The household',
    // MODELLED — the U.S. median age is about 39.
    age: 39,
    // MODELLED — no state is "average". Virginia is chosen so the state-level
    // programs in the catalog can actually be evaluated.
    city: 'Richmond',
    state: 'VA',
    householdSize: 3,
    annualHouseholdIncome: MEDIAN_HOUSEHOLD_INCOME,
    incomeFplMultiple: Number((MEDIAN_HOUSEHOLD_INCOME / FPL_2026_HOUSEHOLD_3).toFixed(2)),
    insuranceType: 'commercial',
  },
  // MODELLED — BEA reports disposable income at very roughly 87 cents per
  // pre-tax dollar in aggregate. Not this household's own tax return.
  disposableShare: 0.87,
  // SOURCED — BEA personal saving rate, July 2026: 3.0 percent of disposable
  // income. What a household keeps unspent is the slack that can absorb a new
  // monthly cost without cutting something else.
  savingRate: 0.03,
  // MODELLED — biweekly, anchored the same way as the demo patient's payroll.
  paycheckIntervalDays: 14,
  lastPayday: '2026-09-18',
};

/* ── coverage levels ─────────────────────────────────────────────────────── */

const FRESH = { outOfPocketAccrued: 0, accumulatorsAsOf: DEMO_TODAY } as const;

/**
 * Twelve months from today with the deductible untouched. That is the worst
 * timing a household can have (a plan year resetting on the day of the first
 * fill) and it keeps the arithmetic checkable by hand.
 */
const PLAN_GENEROUS: Plan = {
  id: 'employer-low-deductible',
  name: 'Low-deductible employer plan',
  carrier: 'Employer group plan',
  planType: 'PPO',
  deductible: dollars(500),
  deductibleRemaining: dollars(500),
  outOfPocketMax: dollars(3000),
  ...FRESH,
  tiers: [
    { tier: 1, label: 'Preferred generic', deductibleExempt: true, costShare: { kind: 'copay', copay: dollars(10) } },
    { tier: 2, label: 'Preferred brand', deductibleExempt: true, costShare: { kind: 'copay', copay: dollars(30) } },
    { tier: 3, label: 'Non-preferred brand', deductibleExempt: false, costShare: { kind: 'copay', copay: dollars(55) } },
    { tier: 4, label: 'Specialty', deductibleExempt: false, costShare: { kind: 'coinsurance', rate: 0.25, monthlyMax: dollars(150) } },
  ],
};

const PLAN_AVERAGE: Plan = {
  id: 'employer-average-2025',
  name: 'Average employer plan',
  carrier: 'Employer group plan',
  planType: 'PPO',
  // SOURCED — KFF Employer Health Benefits Survey 2025: average general annual
  // deductible for single coverage, $1,886. A family plan's aggregate deductible
  // is usually higher; this is the published figure, not an inflated one.
  deductible: dollars(1886),
  deductibleRemaining: dollars(1886),
  // MODELLED — KFF publishes the distribution of out-of-pocket maximums, not an average.
  outOfPocketMax: dollars(4000),
  ...FRESH,
  tiers: [
    // SOURCED (secondary) — average copays among workers in plans with three or
    // more tiers, KFF 2025, as reported by summaries of Section 9: $11 / $37 / $67 / $116.
    // Verify against the KFF report before quoting them from a stage.
    // MODELLED — that tiers 1 and 2 bypass the deductible, which is common in PPOs.
    { tier: 1, label: 'Preferred generic', deductibleExempt: true, costShare: { kind: 'copay', copay: dollars(11) } },
    { tier: 2, label: 'Preferred brand', deductibleExempt: true, costShare: { kind: 'copay', copay: dollars(37) } },
    { tier: 3, label: 'Non-preferred brand', deductibleExempt: false, costShare: { kind: 'copay', copay: dollars(67) } },
    { tier: 4, label: 'Specialty', deductibleExempt: false, costShare: { kind: 'copay', copay: dollars(116) } },
  ],
};

/**
 * MODELLED — an HSA-eligible plan. The deductible is the 2026 IRS family
 * minimum for an HDHP; every tier, generics included, is subject to it. That is
 * the structural fact the segment exists to show: on this plan a generic costs
 * exactly what the plan negotiated, and insurance is not doing anything.
 */
const PLAN_HDHP: Plan = {
  id: 'hdhp-hsa-family',
  name: 'High-deductible HSA plan',
  carrier: 'Employer group plan',
  planType: 'HDHP',
  deductible: dollars(3400),
  deductibleRemaining: dollars(3400),
  outOfPocketMax: dollars(7500),
  ...FRESH,
  tiers: [
    { tier: 1, label: 'Preferred generic', deductibleExempt: false, costShare: { kind: 'coinsurance', rate: 0.2 } },
    { tier: 2, label: 'Preferred brand', deductibleExempt: false, costShare: { kind: 'coinsurance', rate: 0.2 } },
    { tier: 3, label: 'Non-preferred brand', deductibleExempt: false, costShare: { kind: 'coinsurance', rate: 0.2 } },
    { tier: 4, label: 'Specialty', deductibleExempt: false, costShare: { kind: 'coinsurance', rate: 0.3, monthlyMax: dollars(250) } },
  ],
};

export const COVERAGE_LEVELS: CoverageLevel[] = [
  {
    id: 'generous',
    label: 'Low-deductible plan',
    blurb: '$500 deductible. Generics and preferred brands skip it.',
    plan: PLAN_GENEROUS,
    insuranceType: 'commercial',
  },
  {
    id: 'average',
    label: 'Average employer plan',
    blurb: '$1,886 deductible (KFF 2025). Tier 1 and 2 drugs are flat copays.',
    plan: PLAN_AVERAGE,
    insuranceType: 'commercial',
  },
  {
    id: 'hdhp',
    label: 'High-deductible plan',
    blurb: '$3,400 deductible. Every drug, generics too, pays it down first.',
    plan: PLAN_HDHP,
    insuranceType: 'commercial',
  },
  {
    id: 'uninsured',
    label: 'No insurance',
    blurb: 'Retail counter price, or a discount card. Nothing to adjudicate.',
    plan: null,
    insuranceType: 'uninsured',
  },
];

/* ── the basket ──────────────────────────────────────────────────────────── */

/**
 * The fourteen most-prescribed medications in the U.S., ranked and counted by
 * ClinCalc DrugStats 2024 (built from AHRQ's Medical Expenditure Panel Survey).
 * SOURCED: rank, prescription count.
 *
 * The first ten are pre-selected. Ranks 11-14 are one click away, and rank 14
 * is semaglutide — the drug the clinician panel is built around — so the
 * average household can be walked from a generic-only basket to a brand-name
 * one and the gap appears exactly where the real gap is.
 *
 * MODELLED: `cashPrice`, a typical discount-card price per 30-day fill. It is
 * not a quote and it moves week to week. `listPrice` and `allowedAmount` are
 * the same fixtures the clinician panel already uses, where a drug exists in
 * both places; nothing is priced twice.
 *
 * Rank 3 is "metformin" in the ranking. The fixture is metformin ER, which is
 * what the clinician panel already prices, and the label says so.
 */
function fromFormulary(
  id: string,
  extra: Pick<BasketDrug, 'rank' | 'prescriptions' | 'cashPrice' | 'defaultSelected'>,
): BasketDrug {
  const d = drugById(id);
  if (!d) throw new Error(`basket drug ${id} is not in the formulary`);
  return { ...d, ...extra };
}

function generic(
  id: string,
  name: string,
  therapeuticClass: string,
  prices: { list: number; allowed: number; cash: number },
  extra: Pick<BasketDrug, 'rank' | 'prescriptions' | 'defaultSelected'>,
): BasketDrug {
  return {
    id,
    name,
    brand: null,
    therapeuticClass,
    listPrice: dollars(prices.list),
    allowedAmount: dollars(prices.allowed),
    tier: 1,
    priorAuthRequired: false,
    classAlternatives: [],
    cashPrice: dollars(prices.cash),
    ...extra,
  };
}

export const BASKET_DRUGS: BasketDrug[] = [
  fromFormulary('atorvastatin', { rank: 1, prescriptions: 115_678_209, cashPrice: dollars(7.5), defaultSelected: true }),
  fromFormulary('levothyroxine', { rank: 2, prescriptions: 82_380_627, cashPrice: dollars(14.0), defaultSelected: true }),
  fromFormulary('metformin-er', { rank: 3, prescriptions: 82_288_616, cashPrice: dollars(9.8), defaultSelected: true }),
  generic('amlodipine', 'Amlodipine', 'Hypertension — calcium channel blocker', { list: 12.0, allowed: 6.1, cash: 4.9 }, {
    rank: 4,
    prescriptions: 71_333_516,
    defaultSelected: true,
  }),
  fromFormulary('lisinopril', { rank: 5, prescriptions: 66_676_852, cashPrice: dollars(4.3), defaultSelected: true }),
  fromFormulary('albuterol-hfa', { rank: 6, prescriptions: 61_972_757, cashPrice: dollars(55.0), defaultSelected: true }),
  generic('losartan', 'Losartan', 'Hypertension — angiotensin receptor blocker', { list: 14.8, allowed: 7.9, cash: 6.2 }, {
    rank: 7,
    prescriptions: 59_030_486,
    defaultSelected: true,
  }),
  generic('metoprolol-succinate', 'Metoprolol succinate ER', 'Hypertension — beta blocker', { list: 22.0, allowed: 12.5, cash: 11.0 }, {
    rank: 8,
    prescriptions: 58_193_752,
    defaultSelected: true,
  }),
  generic('rosuvastatin', 'Rosuvastatin', 'Hyperlipidemia — statin', { list: 19.6, allowed: 10.3, cash: 8.9 }, {
    rank: 9,
    prescriptions: 53_688_649,
    defaultSelected: true,
  }),
  generic('omeprazole', 'Omeprazole', 'Acid reflux — proton pump inhibitor', { list: 16.4, allowed: 8.2, cash: 7.1 }, {
    rank: 10,
    prescriptions: 49_784_460,
    defaultSelected: true,
  }),
  generic('gabapentin', 'Gabapentin', 'Neuropathic pain — anticonvulsant', { list: 17.2, allowed: 9.4, cash: 8.3 }, {
    rank: 11,
    prescriptions: 46_839_967,
    defaultSelected: false,
  }),
  generic('sertraline', 'Sertraline', 'Depression — SSRI', { list: 18.3, allowed: 9.9, cash: 8.2 }, {
    rank: 12,
    prescriptions: 44_634_055,
    defaultSelected: false,
  }),
  fromFormulary('escitalopram', { rank: 13, prescriptions: 41_773_078, cashPrice: dollars(9.6), defaultSelected: false }),
  // A brand-name GLP-1 has no meaningful discount-card price: cash equals list.
  fromFormulary('semaglutide', { rank: 14, prescriptions: 40_938_165, cashPrice: dollars(1178), defaultSelected: false }),
];

/* ── assistance programs that apply to a household basket ────────────────── */

const GENERIC_IDS = BASKET_DRUGS.filter((d) => d.brand === null).map((d) => d.id);

/**
 * Two programs added for this segment, alongside the eight already in the
 * clinician panel's catalog. Both are MODELLED — realistic in shape, not a
 * transcription of any live program's rules.
 *
 * Neither carries a "cap covers projected cost" criterion. Real copay cards pay
 * until the annual maximum and then stop; the clinician panel's NovoCare card
 * models the stricter rule and this one models the common one, so the cap
 * visibly binds in the high-deductible scenario.
 */
export const BASKET_PROGRAMS: AssistanceProgram[] = [
  {
    id: 'inhaler-savings-card',
    name: 'Rescue Inhaler Savings Card',
    sponsor: 'Inhaler manufacturer (modelled)',
    kind: 'copay-card',
    patientPaysMonthly: dollars(10),
    annualBenefitCap: dollars(600),
    annualCapRemaining: dollars(600),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://example.org/inhaler-savings-card',
    criteria: [
      {
        label: 'Commercial or private insurance (the card is applied at the pharmacy claim)',
        predicate: { field: 'insuranceType', op: 'eq', value: 'commercial' },
      },
      {
        label: 'Prescribed product is covered by this card',
        predicate: { field: 'drugId', op: 'in', value: ['albuterol-hfa'] },
      },
      { label: 'Age 18 or older', predicate: { field: 'age', op: 'gte', value: 18 } },
      {
        label: 'Program is accepting new enrollments',
        predicate: { field: 'fundingOpen', op: 'isTrue', value: true },
      },
    ],
  },
  {
    id: 'free-clinic-generics',
    name: 'Community Free-Clinic Pharmacy Program',
    sponsor: 'Virginia free and charitable clinics (modelled)',
    kind: 'foundation-grant',
    patientPaysMonthly: dollars(0),
    annualBenefitCap: null,
    annualCapRemaining: dollars(0),
    durationMonths: 12,
    fundingOpen: true,
    enrollmentUrl: 'https://example.org/free-clinic-pharmacy',
    criteria: [
      { label: 'Resident of Virginia', predicate: { field: 'state', op: 'in', value: ['VA'] } },
      {
        label: 'Household income at or below 200% of the federal poverty level',
        predicate: { field: 'incomeFplMultiple', op: 'lte', value: 2.0 },
      },
      {
        label: 'Uninsured',
        predicate: { field: 'insuranceType', op: 'eq', value: 'uninsured' },
      },
      {
        label: 'Prescribed product is a generic on the clinic formulary',
        predicate: { field: 'drugId', op: 'in', value: GENERIC_IDS },
      },
    ],
  },
];

/** The clinician panel's eight programs plus the two above. Read from fixtures, not Atlas. */
export const BASKET_CATALOG: AssistanceProgram[] = [...ASSISTANCE_PROGRAMS, ...BASKET_PROGRAMS];
