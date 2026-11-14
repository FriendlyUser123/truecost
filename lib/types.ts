/**
 * TrueCost domain types.
 *
 * MONEY IS ALWAYS INTEGER CENTS inside the engine. Floating-point dollars
 * silently drift by a cent over a 12-month adjudication and a judge who adds
 * up the bar strip by hand will find it. Formatting to dollars happens once,
 * at the edge, in `lib/money.ts`.
 */

export type Cents = number;

export type TierNumber = 1 | 2 | 3 | 4;

/** How a plan charges the member for a drug once the deductible phase is done. */
export type CostShare =
  | { kind: 'copay'; copay: Cents }
  | { kind: 'coinsurance'; rate: number; monthlyMax?: Cents };

export interface PlanTier {
  tier: TierNumber;
  label: string;
  /** Tier 1 generics on this plan are exempt: they never touch the deductible. */
  deductibleExempt: boolean;
  costShare: CostShare;
}

export interface Plan {
  id: string;
  name: string;
  carrier: string;
  planType: 'HDHP' | 'PPO' | 'HMO';
  /** Full individual deductible for the year. */
  deductible: Cents;
  /** What is LEFT on it as of `accumulatorsAsOf`. */
  deductibleRemaining: Cents;
  outOfPocketMax: Cents;
  outOfPocketAccrued: Cents;
  accumulatorsAsOf: string;
  tiers: PlanTier[];
}

export interface Drug {
  id: string;
  /** Generic / molecule name. */
  name: string;
  brand: string | null;
  /** Therapeutic class — the comparison panel only ever compares within a class. */
  therapeuticClass: string;
  /** Manufacturer list price per 30-day supply. */
  listPrice: Cents;
  /**
   * What the PLAN actually pays the pharmacy — the negotiated rate. Member
   * cost share is computed off this, not off list. This is the single most
   * common reason a patient-facing price estimate is wrong.
   */
  allowedAmount: Cents;
  tier: TierNumber;
  priorAuthRequired: boolean;
  /** Same-class alternatives, by drug id. */
  classAlternatives: string[];
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  city: string;
  state: string;
  zip: string;
  householdSize: number;
  annualHouseholdIncome: Cents;
  /** Federal poverty level multiple, precomputed from the 2026 guidelines. */
  incomeFplMultiple: number;
  insuranceType: 'commercial' | 'government' | 'uninsured';
  planId: string;
  diagnosis: string;
  a1c: number;
  preferredLanguage: 'en' | 'es';
  nessieCustomerId: string;
}

/* ── Assistance rules engine ─────────────────────────────────────────────── */

export type Predicate =
  | { field: 'insuranceType'; op: 'eq' | 'neq'; value: string }
  | { field: 'incomeFplMultiple'; op: 'lte' | 'gte'; value: number }
  | { field: 'state'; op: 'in'; value: string[] }
  | { field: 'age'; op: 'gte' | 'lte'; value: number }
  | { field: 'drugId'; op: 'in'; value: string[] }
  | { field: 'fundingOpen'; op: 'isTrue'; value: true }
  | { field: 'annualCapRemaining'; op: 'gte'; value: number }
  /** True when the program's remaining benefit covers the projected plan-year outlay. */
  | { field: 'annualCapRemaining'; op: 'coversProjected'; value: true };

export interface AssistanceCriterion {
  /** Human sentence rendered next to the green check or the red X. */
  label: string;
  predicate: Predicate;
}

export type AssistanceKind = 'copay-card' | 'manufacturer-pap' | 'foundation-grant' | 'government';

export interface AssistanceProgram {
  id: string;
  name: string;
  sponsor: string;
  kind: AssistanceKind;
  /** Member pays at most this per 30-day fill while enrolled. */
  patientPaysMonthly: Cents | null;
  /** null = the program covers the drug outright. */
  annualBenefitCap: Cents | null;
  annualCapRemaining: Cents;
  durationMonths: number;
  fundingOpen: boolean;
  enrollmentUrl: string;
  criteria: AssistanceCriterion[];
}

export interface CriterionResult {
  label: string;
  passed: boolean;
  /** Why it failed, in the patient's actual numbers. */
  detail: string;
}

export interface ProgramEvaluation {
  program: AssistanceProgram;
  eligible: boolean;
  criteria: CriterionResult[];
  /** Projected 12-month member cost IF enrolled. null when ineligible. */
  projectedAnnualOop: Cents | null;
  savingsVsBaseline: Cents | null;
}

/* ── Benefit engine ──────────────────────────────────────────────────────── */

export type Phase = 'deductible' | 'coinsurance' | 'copay' | 'oop-max-met';

export interface MonthCost {
  monthIndex: number;
  label: string;
  /** What the plan allowed for the fill. */
  allowed: Cents;
  patientPays: Cents;
  appliedToDeductible: Cents;
  phase: Phase;
  deductibleRemainingAfter: Cents;
  oopAccruedAfter: Cents;
  /** One line of arithmetic, readable aloud verbatim. */
  explanation: string;
}

export interface BenefitResult {
  drugId: string;
  drugLabel: string;
  tier: TierNumber;
  listPriceMonthly: Cents;
  allowedMonthly: Cents;
  months: MonthCost[];
  projectedAnnualOop: Cents;
  firstNinetyDayOop: Cents;
  /** Full step-by-step derivation. This is the answer to "where did that number come from". */
  trace: string[];
}

/* ── Capacity engine (Nessie) ────────────────────────────────────────────── */

export interface RecurringObligation {
  merchantName: string;
  merchantId: string;
  averageAmount: Cents;
  occurrences: number;
  /** Coefficient of variation on the amount, as a percentage. */
  amountVariancePct: number;
  dayOfMonth: number;
  lastSeen: string;
  nextDue: string;
}

export interface IncomeSignal {
  source: string;
  averageAmount: Cents;
  /** Median gap between deposits, in days. */
  intervalDays: number;
  cadence: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'irregular';
  confidence: number;
  observations: number;
  lastPayday: string;
  nextPaydays: string[];
}

export interface CapacityResult {
  checkingBalance: Cents;
  savingsBalance: Cents;
  liquidTotal: Cents;
  income: IncomeSignal | null;
  monthlyIncome: Cents;
  recurring: RecurringObligation[];
  recurringMonthly: Cents;
  variableMonthly: Cents;
  discretionaryMonthly: Cents;
  safeToPayToday: Cents;
  obligationsBeforeNextPayday: Cents;
  bufferFloor: Cents;
  trace: string[];
  /** 'live' = real Nessie HTTP. 'recorded' = replayed cache. 'demo' = local simulated ledger. */
  source: DataSource;
}

export type DataSource = 'live' | 'recorded' | 'demo';

/* ── Scheduling ──────────────────────────────────────────────────────────── */

export interface Installment {
  n: number;
  dueDate: string;
  amount: Cents;
  status: 'executed' | 'scheduled';
  nessieBillId?: string;
  nessieTransferId?: string;
}

export interface ScheduleResult {
  totalScheduled: Cents;
  installments: Installment[];
  perInstallment: Cents;
  safeToPayToday: Cents;
  withinCapacity: boolean;
  trace: string[];
}

/* ── Top-level API payloads ──────────────────────────────────────────────── */

export interface AffordabilityVerdict {
  affordable: boolean;
  label: string;
  abandonmentRisk: 'low' | 'moderate' | 'high';
  /** Modelled probability the script is never picked up. */
  abandonmentProbability: number;
  annualShortfall: Cents;
  ninetyDayShortfall: Cents;
  /** First fill cost minus what she can safely pay today. The number at the counter. */
  firstFillGap: Cents;
  firstFillCost: Cents;
  rationale: string[];
}

export interface TrueCostResult {
  generatedAt: string;
  patient: Patient;
  plan: Plan;
  drug: Drug;
  benefit: BenefitResult;
  capacity: CapacityResult;
  verdict: AffordabilityVerdict;
  comparison: BenefitResult[];
  assistance: ProgramEvaluation[];
  best: ProgramEvaluation | null;
  /** Annual OOP after the best eligible program is applied. */
  residualAnnualOop: Cents;
  dataSources: { nessie: DataSource; catalog: 'atlas' | 'fixtures' };
}

/* ── Household basket (the "average American" segment) ───────────────────── */

/** The slice of a patient the assistance predicates actually read. */
export type EligibilityProfile = Pick<
  Patient,
  | 'firstName'
  | 'age'
  | 'city'
  | 'state'
  | 'householdSize'
  | 'annualHouseholdIncome'
  | 'incomeFplMultiple'
  | 'insuranceType'
>;

export interface Household {
  label: string;
  /** insuranceType here is a placeholder; the chosen coverage level overrides it. */
  profile: EligibilityProfile;
  /** Share of gross income that reaches disposable income after taxes. */
  disposableShare: number;
  /** Share of disposable income left unspent — the household's slack. */
  savingRate: number;
  paycheckIntervalDays: number;
  lastPayday: string;
}

export type CoverageId = 'generous' | 'average' | 'hdhp' | 'uninsured';

export interface CoverageLevel {
  id: CoverageId;
  label: string;
  blurb: string;
  /** null = uninsured: nothing to adjudicate, only the cash routes exist. */
  plan: Plan | null;
  insuranceType: Patient['insuranceType'];
}

export interface BasketDrug extends Drug {
  /** 1 = most prescribed in the U.S. */
  rank: number;
  /** Estimated U.S. prescriptions in the ranking year. */
  prescriptions: number;
  /** Typical discount-card price per 30-day fill. Never above list. */
  cashPrice: Cents;
  defaultSelected: boolean;
}

/**
 * How one drug is paid for.
 *  plan     — adjudicated by the insurer, counts toward the shared accumulators
 *  discount — paid in cash at a discount-card price; invisible to the insurer
 *  retail   — paid in cash at the counter price (the uninsured default)
 */
export type Route = 'plan' | 'discount' | 'retail';

export interface BasketLine {
  drugId: string;
  label: string;
  rank: number;
  prescriptions: number;
  tier: TierNumber;
  priorAuthRequired: boolean;
  listPrice: Cents;
  allowedAmount: Cents;
  cashPrice: Cents;
  asIssuedRoute: Route;
  route: Route;
  /** 12-month cost paying the default way: through the plan, or at the counter if uninsured. */
  asIssuedAnnual: Cents;
  /** 12-month cost on the chosen route, before any assistance. */
  routedAnnual: Cents;
  /** 12-month cost after the program that claimed this drug, if any. */
  finalAnnual: Cents;
  program: string | null;
  why: string;
}

export interface AppliedProgram {
  program: AssistanceProgram;
  scope: 'drug' | 'household';
  drugIds: string[];
  saved: Cents;
}

export interface HouseholdCapacity {
  grossMonthly: Cents;
  disposableMonthly: Cents;
  slackMonthly: Cents;
  slackAnnual: Cents;
  trace: string[];
  /**
   * Present when capacity was read from a bank ledger (Nessie) rather than
   * modelled from published ratios. Absent only in engine tests that call the
   * engine directly without a ledger.
   */
  ledger?: {
    source: DataSource;
    checkingBalance: Cents;
    savingsBalance: Cents;
    safeToPayToday: Cents;
    income: IncomeSignal | null;
    recurring: RecurringObligation[];
    recurringMonthly: Cents;
    variableMonthly: Cents;
  };
}

export type BasketVerdictLabel = 'AFFORDABLE' | 'AFFORDABLE IF LEVELLED' | 'NOT AFFORDABLE';

export interface BasketVerdict {
  label: BasketVerdictLabel;
  affordable: boolean;
  slackMonthly: Cents;
  peakMonth: Cents;
  averageMonth: Cents;
  /** Average monthly cost as a fraction of monthly slack. */
  shareOfSlack: number;
  annualShortfall: Cents;
  asIssuedLabel: BasketVerdictLabel;
  asIssuedAnnualShortfall: Cents;
  rationale: string[];
}

export interface BasketInstallment {
  n: number;
  dueDate: string;
  amount: Cents;
  /** Set on a receipt: installment one executes as a transfer, the rest are bills. */
  status?: 'executed' | 'scheduled';
  nessieBillId?: string;
  nessieTransferId?: string;
}

export interface BasketSchedule {
  installments: BasketInstallment[];
  perInstallment: Cents;
  paychecksPerYear: number;
  perPaycheck: Cents;
  total: Cents;
  /** Whether installment one fits inside today's safe-to-pay ceiling. Null when there is no ledger to ask. */
  firstInstallmentFits: boolean | null;
  trace: string[];
}

export interface BasketMonth {
  label: string;
  total: Cents;
  /** True when the deductible was still being paid down this month. */
  deductibleActive: boolean;
}

export interface BasketResult {
  generatedAt: string;
  household: Household;
  profile: EligibilityProfile;
  coverage: CoverageLevel;
  lines: BasketLine[];
  months: BasketMonth[];
  asIssuedAnnual: Cents;
  routedAnnual: Cents;
  finalAnnual: Cents;
  /** As-issued minus final, split into what changing routes did and what programs did. */
  routeSavings: Cents;
  assistanceSavings: Cents;
  assistance: ProgramEvaluation[];
  applied: AppliedProgram[];
  capacity: HouseholdCapacity;
  verdict: BasketVerdict;
  schedule: BasketSchedule;
  /** BLS: what the average U.S. household spends on drugs in a year, OTC included. */
  referenceDrugSpend: Cents;
  optimizer: { combinations: number; trace: string[] };
  /** Where the bank data came from. Null only when the engine was run with no ledger at all. */
  dataSources: { nessie: DataSource | null };
  trace: string[];
}

/**
 * The household's counterpart of ActivationResult: the payday plan written to
 * the bank. Installment one is a Transfer, the rest are Bills pinned to
 * paydays, and the balance is refetched afterwards rather than computed.
 */
export interface BasketActivation {
  reference: string;
  /** Coverage + medications. Activating the same scenario twice returns this same result. */
  signature: string;
  coverageLabel: string;
  schedule: BasketSchedule;
  balanceBefore: Cents;
  balanceAfter: Cents;
  executedTransferId: string;
  billIds: string[];
  activatedAt: string;
  source: DataSource;
}

export interface ActivationResult {
  confirmationNumber: string;
  program: AssistanceProgram;
  schedule: ScheduleResult;
  balanceBefore: Cents;
  balanceAfter: Cents;
  executedTransferId: string;
  billIds: string[];
  activatedAt: string;
  source: DataSource;
}
