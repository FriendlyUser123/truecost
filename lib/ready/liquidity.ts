/**
 * Ready — the liquidity classifier.
 *
 * Surescripts can already tell a prescriber that a prescription was never
 * picked up. This file answers the next two questions, and they are the whole
 * product:
 *
 *   WHY  — TIMING (can afford it, not this week) / STALE (can afford it, but
 *          after the clinical window shuts) / STRUCTURAL (no such date exists).
 *          Today all three arrive as the identical abandonment alert and get
 *          the identical chart note, "patient declined". They need opposite
 *          interventions: schedule it, bridge it, or route it to a PAP.
 *
 *   WHEN — the Ready Day. The earliest calendar date this patient's own cash
 *          flow clears this copay without pushing a committed obligation under
 *          the line. A claims database cannot produce this date, a PBM cannot,
 *          an EHR cannot, a real-time benefit tool cannot. Only a ledger can.
 *
 * Everything here is built on `readCapacity()` in lib/engine/capacity.ts — the
 * payroll cadence, the mined fixed obligations and the buffer floor all come
 * from there. This file adds the essential-spend floor, the forward balance
 * projection, and the three-way branch.
 *
 * MONEY IS INTEGER CENTS. Determinism is a hard requirement: no Date.now(), no
 * randomness, no network. Every branch pushes a plain sentence into `trace[]`
 * so a judge holding a calculator can reproduce any number on screen.
 */

import {
  DEMO_TODAY,
  addDays,
  daysBetween,
  median,
  nextMonthlyOccurrence,
  projectPaydays,
  toISO,
} from '../dates';
import { BUFFER_FLOOR } from '../engine/capacity';
import { dollars, fmt } from '../money';
import type { LedgerSnapshot } from '../nessie/types';
import type { CapacityResult, Cents } from '../types';
import type { Displacement, LiquidityVerdict } from './types';

/* ── two fields the verdict grew, declared here ──────────────────────────── */

/**
 * The Ready Day is a projection, not an appointment.
 *
 * `earliest` is `readyOn` — the floor, the first day the arithmetic clears.
 * `likely` is the far edge of the band. The band is derived from the payroll
 * cadence's own measured jitter, so a household whose deposits land on the dot
 * gets a tight window and a gig worker gets a wide one. In production this
 * stops being a forecast at all: it is an event trigger on the live bank
 * connection, and the window collapses to the day the money actually lands.
 */
export interface ReadyWindow {
  /** Always equal to `readyOn`. The band never opens backwards. */
  earliest: string;
  /** `earliest` + `slackDays`. Print as "earliest X, likely X–Y". */
  likely: string;
  slackDays: number;
  /** `IncomeSignal.confidence`, carried through so the UI can hedge honestly. */
  confidence: number;
  basis: string;
}

/**
 * An obligation that fails WITHOUT the prescription.
 *
 * This is the honest signal that replaces a displacement claim we cannot make.
 * If the shortfall on a bill is larger than the copay, then the bill was going
 * under whether or not this prescription is ever filled — "paying this pushes
 * your power bill under the line" is then simply false, and the true statement
 * is the harder one: this household is already behind.
 */
export interface AlreadyShort {
  merchantName: string;
  amount: Cents;
  dueOn: string;
  /** Shortfall with the copay NOT paid. Strictly positive by construction. */
  shortBy: Cents;
}

/**
 * Both fields belong on `LiquidityVerdict`, but `lib/ready/types.ts` is owned
 * by another workstream this weekend, so they are merged in from here rather
 * than edited in there. They are optional so that the hand-built verdict
 * literals in tests/attention.ts and tests/exchange.ts keep compiling.
 *
 * TODO: fold these two members into `LiquidityVerdict` in ./types.ts and
 * delete this block. Nothing else has to change when that happens.
 */
declare module './types' {
  interface LiquidityVerdict {
    /** null exactly when `readyOn` is null. */
    readyWindow?: ReadyWindow | null;
    /** An obligation already failing before the copay is considered. */
    alreadyShort?: AlreadyShort | null;
  }
}

/** Same constant capacity.ts annualises with. If one changes, both change. */
const AVG_DAYS_PER_MONTH = 30.4375;

/** Default scan horizon. 45 days covers three biweekly cycles plus slack. */
const DEFAULT_HORIZON_DAYS = 45;

/** How far past a candidate Ready Day we look for bills that would undo it. */
const CLEARANCE_LOOKAHEAD_DAYS = 7;

/** How far forward the displacement walk goes once the copay is paid today. */
const DISPLACEMENT_WINDOW_DAYS = 14;

/**
 * The narrowest Ready Window we will ever print, even for a payroll that has
 * never once moved. Sixty-five transactions is about five weeks — barely one
 * billing cycle — and there is no backtest behind this date, so a single
 * certain day would be a precision we have not earned. A date printed three
 * days EARLY means the card declines at the counter, which is the most
 * adherence-destroying event in the journey; the floor therefore stays the
 * earliest day and the band only ever opens forward.
 */
const READY_WINDOW_BASE_DAYS = 2;

/** Past two weeks a "window" is not a forecast any more, so we stop widening. */
const MAX_READY_WINDOW_DAYS = 14;

/**
 * Why STRUCTURAL never reports a displacement. Displacement prices the choice
 * between filling today and filling on the Ready Day; with no Ready Day there
 * is no second branch to price, and a one-sided counterfactual is not a
 * finding. The PAP route is the answer for these rows, not a dollar figure.
 */
const STRUCTURAL_NO_COUNTERFACTUAL =
  'there is no Ready Day at all for this patient, so there is no "pay it today instead" to compare against. A counterfactual with no second branch is not a finding.';

/** Same reasoning at the other extreme: the Ready Day and today are one day. */
const READY_TODAY_NO_COUNTERFACTUAL =
  'the Ready Day is today, so "pay it today instead" and "pay it today" are the same plan.';

/**
 * Spend a household cannot defer by a week. Nessie merchant categories are
 * free text and inconsistently pluralised ("groceries", "utilities"), so the
 * five spec categories are expanded into the aliases that actually appear on
 * the wire. Anything not in here — dining, retail, telecom, auto — is
 * deferrable and therefore is NOT part of the floor.
 */
const ESSENTIAL_CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  grocery: ['grocery', 'groceries', 'supermarket', 'food'],
  fuel: ['fuel', 'gas', 'gasoline', 'transit'],
  utility: ['utility', 'utilities', 'electric', 'power', 'water'],
  pharmacy: ['pharmacy', 'drugstore', 'rx'],
  childcare: ['childcare', 'child care', 'daycare', 'day care'],
};

const ESSENTIAL_CATEGORIES: ReadonlySet<string> = new Set(
  Object.values(ESSENTIAL_CATEGORY_ALIASES).flat(),
);

/**
 * Housing and insurance, which are non-deferrable but are NOT part of the
 * spending floor.
 *
 * The floor above is a *rate* mined from repeated variable purchases. Rent and
 * a monthly premium are neither variable nor a rate — capacity.ts already mines
 * them as dated fixed obligations, and `computeEssentialMonthly` deliberately
 * subtracts anything already counted there. Adding them to the floor would
 * double-count them and manufacture STRUCTURAL verdicts out of arithmetic.
 *
 * They are still the least deferrable money a household spends, so they are
 * eligible to be *displaced*. That is the only thing this second tier does.
 */
const OBLIGATION_ESSENTIAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  housing: ['housing', 'rent', 'mortgage', 'apartment', 'apartments', 'rentals', 'lease', 'landlord'],
  insurance: ['insurance', 'premium'],
};

/**
 * Which obligations may be reported as displaced by a copay — one taxonomy,
 * built FROM the floor's, not a second copy of it.
 *
 * The whole force of a displacement claim is that the household is choosing
 * between the drug and something it genuinely cannot defer. "Fill your insulin
 * and lose your gym membership" is not that argument; it invites the obvious
 * reply, *cancel the gym*. Housing, utilities, water, fuel/transit, groceries,
 * pharmacy, childcare and insurance are eligible. Telecom, fitness,
 * subscriptions, retail and dining are not, at any amount.
 */
const DISPLACEABLE_CATEGORIES: ReadonlySet<string> = new Set([
  ...ESSENTIAL_CATEGORIES,
  ...Object.values(OBLIGATION_ESSENTIAL_ALIASES).flat(),
]);

/**
 * Named deferrables. Only consulted when a merchant arrives with no Nessie
 * category at all (a bare withdrawal description, or a Nessie bill payee), so
 * that "VERIZON WIRELESS AUTOPAY" is refused by name and not merely by the
 * absence of a category.
 */
const DEFERRABLE_NAME_TOKENS: ReadonlySet<string> = new Set([
  'telecom', 'phone', 'wireless', 'mobile', 'cable', 'internet', 'broadband',
  'fitness', 'gym',
  'subscription', 'subscriptions', 'streaming', 'membership',
  'retail', 'shopping',
  'dining', 'restaurant', 'coffee',
]);

/** Lowercase word tokens of a merchant name: "Planet Fitness Roanoke" -> 3. */
function nameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 0);
}

/**
 * Is this obligation eligible to be named as the thing a copay displaced?
 *
 * The Nessie category is authoritative when there is one — it is the merchant's
 * own classification, not our reading of its name. Only when a merchant carries
 * no category (withdrawal-derived obligations and Nessie bills do not) do we
 * fall back to the name, and an unrecognised name is NOT eligible: reporting a
 * displacement we cannot categorise is exactly the defect this gate exists to
 * stop.
 */
function judgeEssentiality(
  merchantName: string,
  categories: readonly string[] | undefined,
): { essential: boolean; basis: string } {
  if (categories !== undefined && categories.length > 0) {
    const hit = categories.find((c) => DISPLACEABLE_CATEGORIES.has(c.trim().toLowerCase()));
    const label = categories.join('/');
    if (hit !== undefined) return { essential: true, basis: `category "${label}"` };
    return { essential: false, basis: `category "${label}" is deferrable` };
  }

  const tokens = nameTokens(merchantName);
  if (tokens.some((t) => DEFERRABLE_NAME_TOKENS.has(t))) {
    return { essential: false, basis: 'name reads as deferrable and no category was supplied' };
  }
  if (tokens.some((t) => DISPLACEABLE_CATEGORIES.has(t))) {
    return { essential: true, basis: 'name matches an essential category and no category was supplied' };
  }
  return { essential: false, basis: 'uncategorised, so not eligible to be reported as displaced' };
}

/** A dated claim on the account: a mined fixed obligation or a Nessie bill. */
interface Obligation {
  merchantName: string;
  amount: Cents;
  dueOn: string;
  kind: 'recurring' | 'bill';
  /** False for telecom, fitness, subscriptions, retail, dining, unknown. */
  essential: boolean;
  /** Why, in the words that go into the trace. */
  essentialBasis: string;
}

interface Payday {
  on: string;
  amount: Cents;
}

/* ── the essential floor ─────────────────────────────────────────────────── */

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** First and last calendar day of a "YYYY-MM" bucket. */
function monthBounds(key: string): { first: string; last: string } {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  // Day 0 of the NEXT month is the last day of this one — handles February.
  return { first: `${key}-01`, last: toISO(new Date(Date.UTC(year, month, 0))) };
}

interface EssentialFloor {
  essentialMonthly: Cents;
  trace: string[];
}

/**
 * Median monthly spend at merchants in an essential category.
 *
 * Two deliberate choices a judge will ask about:
 *
 *   MEDIAN, NOT MEAN — one back-to-school Target run or a $200 pharmacy month
 *   should not raise the floor for the whole year. The median month is the
 *   month this household actually lives in.
 *
 *   DISJOINT FROM `recurringMonthly` — the surplus formula subtracts both
 *   terms, so a merchant that capacity.ts already mined as a fixed obligation
 *   (the power company is a utility AND a bill) is removed from the essential
 *   pool. Counting the electric bill twice would manufacture STRUCTURAL
 *   verdicts out of arithmetic rather than out of the patient's cash flow.
 *
 * Only calendar months lying wholly inside the observation window are eligible;
 * a half-observed September would drag the median down by construction. With
 * no complete month at all we fall back to a simple rate over the window.
 */
function computeEssentialMonthly(
  ledger: LedgerSnapshot,
  capacity: CapacityResult,
  today: string,
): EssentialFloor {
  const trace: string[] = [];

  const essentialMerchantIds = new Set<string>();
  const alreadyFixed = new Set(capacity.recurring.map((r) => r.merchantId));
  const merchantName = new Map(ledger.merchants.map((m) => [m._id, m.name]));
  const skippedAsFixed: string[] = [];

  // A shared merchant catalog carries shops this patient has never walked into.
  // Only merchants with a posted charge are part of anyone's floor.
  const shoppedAt = new Set(ledger.purchases.filter((p) => p.purchase_date <= today).map((p) => p.merchant_id));

  for (const m of ledger.merchants) {
    if (!shoppedAt.has(m._id)) continue;
    const essential = m.category.some((c) => ESSENTIAL_CATEGORIES.has(c.trim().toLowerCase()));
    if (!essential) continue;
    if (alreadyFixed.has(m._id)) {
      skippedAsFixed.push(m.name);
      continue;
    }
    essentialMerchantIds.add(m._id);
  }

  if (skippedAsFixed.length > 0) {
    trace.push(
      `Essential-category merchants already counted as fixed obligations, so excluded from the floor to avoid double-counting them: ${skippedAsFixed.join(', ')}.`,
    );
  }

  const byMonth = new Map<string, Cents>();
  let total = 0;
  for (const p of ledger.purchases) {
    if (!essentialMerchantIds.has(p.merchant_id)) continue;
    if (p.purchase_date > today) continue;
    const cents = dollars(p.amount);
    total += cents;
    byMonth.set(monthKey(p.purchase_date), (byMonth.get(monthKey(p.purchase_date)) ?? 0) + cents);
  }

  const allDates = [
    ...ledger.purchases.map((p) => p.purchase_date),
    ...ledger.deposits.map((d) => d.transaction_date),
    ...ledger.withdrawals.map((w) => w.transaction_date),
  ].sort();
  const windowStart = allDates[0] ?? today;

  const complete: { key: string; cents: Cents }[] = [];
  for (const [key, cents] of [...byMonth].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { first, last } = monthBounds(key);
    if (first >= windowStart && last <= today) complete.push({ key, cents });
  }

  const names = [...essentialMerchantIds].map((id) => merchantName.get(id) ?? id);
  trace.push(
    `Essential floor drawn from ${essentialMerchantIds.size} merchant(s) in ${Object.keys(ESSENTIAL_CATEGORY_ALIASES).join('/')}: ${names.join(', ') || 'none'}.`,
  );

  if (complete.length === 0) {
    const windowDays = Math.max(1, daysBetween(windowStart, today));
    const rate = Math.round(total / (windowDays / AVG_DAYS_PER_MONTH));
    trace.push(
      `No calendar month sits wholly inside the window ${windowStart}..${today}, so the floor is a rate: ${fmt(total)} over ${windowDays} days = ${fmt(rate)}/month.`,
    );
    return { essentialMonthly: rate, trace };
  }

  const essentialMonthly = Math.round(median(complete.map((c) => c.cents)));
  trace.push(
    `Essential spend by complete month: ${complete.map((c) => `${c.key} ${fmt(c.cents)}`).join(', ')}. Median = ${fmt(essentialMonthly)}/month.`,
  );
  return { essentialMonthly, trace };
}

/* ── forward projection ──────────────────────────────────────────────────── */

/**
 * Every dated claim on the account between today and `until`.
 *
 * capacity.ts only publishes the NEXT due date per obligation. Over a 45-day
 * horizon rent lands twice, and a projection that forgets the second one will
 * happily promise a Ready Day the patient cannot keep, so the monthly cadence
 * is rolled forward here.
 */
function projectObligations(
  capacity: CapacityResult,
  ledger: LedgerSnapshot,
  today: string,
  until: string,
): Obligation[] {
  const out: Obligation[] = [];
  const categoriesOf = new Map(ledger.merchants.map((m) => [m._id, m.category]));

  for (const r of capacity.recurring) {
    const { essential, basis } = judgeEssentiality(r.merchantName, categoriesOf.get(r.merchantId));
    let due = r.nextDue;
    // 24 iterations is far past any horizon we scan; it exists so a malformed
    // dayOfMonth can never spin here.
    for (let i = 0; i < 24 && due <= until; i++) {
      if (due > today) {
        out.push({
          merchantName: r.merchantName,
          amount: r.averageAmount,
          dueOn: due,
          kind: 'recurring',
          essential,
          essentialBasis: basis,
        });
      }
      due = nextMonthlyOccurrence(due, r.dayOfMonth);
    }
  }

  // Nessie bills are already dated, so they are taken at face value — one
  // occurrence each, no cadence inference.
  for (const b of ledger.bills) {
    if (b.status === 'cancelled' || b.status === 'completed') continue;
    const due = b.upcoming_payment_date;
    if (due > today && due <= until) {
      const name = b.nickname || b.payee;
      // A Nessie bill carries a payee string and no merchant record, so there
      // is no category to read and the name is all we have.
      const { essential, basis } = judgeEssentiality(name, undefined);
      out.push({
        merchantName: name,
        amount: dollars(b.payment_amount),
        dueOn: due,
        kind: 'bill',
        essential,
        essentialBasis: basis,
      });
    }
  }

  out.sort((a, b) => (a.dueOn === b.dueOn ? b.amount - a.amount : a.dueOn.localeCompare(b.dueOn)));
  return out;
}

/** Thin shape adapter over the one payday projection in lib/dates.ts. */
function paydaysFor(capacity: CapacityResult, today: string, until: string): Payday[] {
  return projectPaydays(capacity.income, today, until).map((p) => ({
    on: p.on,
    amount: p.amount,
  }));
}

/* ── the confidence band on the Ready Day ────────────────────────────────── */

/**
 * Turn the Ready Day into a window with a floor.
 *
 * `detectIncome` already scores every payroll cadence it locks:
 *
 *     confidence = 1 - gapCv/100 - amountCv/200
 *
 * so `(1 - confidence) x intervalDays` is, term by term, one standard
 * deviation of the observed gap in days plus a half-weighted allowance for
 * amount jitter. That is the whole derivation — the band is the cadence's own
 * measured variance, not a number we chose. It is rounded UP to a whole day so
 * the window is never narrower than the jitter we actually observed, and a
 * floor of two days is added because no backtest exists behind any of this and
 * five weeks of transactions cannot support a single certain date.
 *
 * `earliest` stays the day the arithmetic clears. Widening forward can only
 * make the card more cautious; widening backwards would put a patient at the
 * counter with a card that declines.
 */
function computeReadyWindow(
  readyOn: string,
  today: string,
  income: CapacityResult['income'],
  trace: string[],
): ReadyWindow {
  if (readyOn === today) {
    const w: ReadyWindow = {
      earliest: readyOn,
      likely: readyOn,
      slackDays: 0,
      confidence: income?.confidence ?? 0,
      basis: 'The money is already on the account today, so there is nothing to forecast and the window is one day.',
    };
    trace.push(`Ready Window ${readyOn} only: ${w.basis}`);
    return w;
  }

  if (!income) {
    const likely = addDays(readyOn, MAX_READY_WINDOW_DAYS);
    const w: ReadyWindow = {
      earliest: readyOn,
      likely,
      slackDays: MAX_READY_WINDOW_DAYS,
      confidence: 0,
      basis: 'No payroll cadence was detected, so the date is not anchored to an income event and the window opens to its full width.',
    };
    trace.push(`Ready Window ${readyOn} to ${likely} (${MAX_READY_WINDOW_DAYS} days): ${w.basis}`);
    return w;
  }

  const jitterDays = (1 - income.confidence) * income.intervalDays;
  const slackDays = Math.min(
    MAX_READY_WINDOW_DAYS,
    READY_WINDOW_BASE_DAYS + Math.ceil(jitterDays),
  );
  const likely = addDays(readyOn, slackDays);

  const basis =
    `Cadence confidence ${(income.confidence * 100).toFixed(1)}% on a ${income.intervalDays}-day cycle, ` +
    `so the observed jitter is (1 - ${income.confidence}) x ${income.intervalDays} = ${jitterDays.toFixed(2)} days, ` +
    `rounded up to ${Math.ceil(jitterDays)} and added to the ${READY_WINDOW_BASE_DAYS}-day floor.`;

  trace.push(
    `Ready Window: earliest ${readyOn}, likely ${readyOn} to ${likely} (${slackDays} day(s) of slack). ${basis} ` +
      'The Ready Day is the floor of this window, never a promise of a single date — in production it stops being a forecast and becomes an event trigger on the live bank connection.',
  );

  return { earliest: readyOn, likely, slackDays, confidence: income.confidence, basis };
}

/* ── the classifier ──────────────────────────────────────────────────────── */

export interface ClassifyLiquidityArgs {
  copay: Cents;
  /** Date the prescription was written. STALE is measured from here. */
  writtenOn: string;
  today?: string;
  horizonDays?: number;
  capacity: CapacityResult;
  ledger: LedgerSnapshot;
  /** Days from `writtenOn` until the script can no longer be filled. */
  clinicalWindowDays: number;
}

export function classifyLiquidity(args: ClassifyLiquidityArgs): LiquidityVerdict {
  const { copay, writtenOn, capacity, ledger, clinicalWindowDays } = args;
  const today = args.today ?? DEMO_TODAY;
  const horizonDays = args.horizonDays ?? DEFAULT_HORIZON_DAYS;

  const trace: string[] = [];
  const horizonEnd = addDays(today, horizonDays);
  // NOT an expiry date, and the variable is not named like one. Non-controlled
  // prescriptions stay valid up to a year in most states; what closes here is
  // the CLINICAL window — post-MI statin initiation, an antibiotic course, a
  // titration schedule. "The script expires in 30 days" is factually wrong and
  // appears neither in a trace nor in an identifier.
  const windowClosesOn = addDays(writtenOn, clinicalWindowDays);

  trace.push(
    `Copay ${fmt(copay)}. Written ${writtenOn}, with a ${clinicalWindowDays}-day clinical window, so the window closes ${windowClosesOn}. Scanning ${today} through ${horizonEnd}.`,
  );

  const floor = computeEssentialMonthly(ledger, capacity, today);
  trace.push(...floor.trace);
  const essentialMonthly = floor.essentialMonthly;

  const surplusMonthly = capacity.monthlyIncome - capacity.recurringMonthly - essentialMonthly;
  trace.push(
    `Surplus = income ${fmt(capacity.monthlyIncome)} - fixed obligations ${fmt(capacity.recurringMonthly)} - essential floor ${fmt(essentialMonthly)} = ${fmt(surplusMonthly)} per month.`,
  );

  const dailyEssential = essentialMonthly / AVG_DAYS_PER_MONTH;
  trace.push(
    `Essential spend accrues at ${fmt(Math.round(dailyEssential))} a day (${fmt(essentialMonthly)} / ${AVG_DAYS_PER_MONTH}).`,
  );

  // Obligations are projected one clearance lookahead past the horizon, because
  // clearsOn(d) asks what lands in the week AFTER d.
  const obligations = projectObligations(
    capacity,
    ledger,
    today,
    addDays(horizonEnd, CLEARANCE_LOOKAHEAD_DAYS),
  );
  const paydays = paydaysFor(capacity, today, horizonEnd);

  if (capacity.income) {
    trace.push(
      `Payroll projected forward: ${fmt(capacity.income.averageAmount)} every ${capacity.income.intervalDays} days from ${capacity.income.lastPayday} — ${
        paydays.length > 0 ? paydays.map((p) => p.on).join(', ') : 'no payday inside the horizon'
      }.`,
    );
  } else {
    trace.push('No repeating deposit source cleared the payroll threshold, so no future income is projected.');
  }

  trace.push(
    `Dated obligations inside the scan: ${
      obligations.length > 0
        ? obligations.map((o) => `${o.merchantName} ${fmt(o.amount)} on ${o.dueOn}`).join('; ')
        : 'none'
    }.`,
  );

  /**
   * Balance on date `d`.
   *
   * `bound` decides whether that day's own bills have posted yet:
   *   'close' — end of day d, everything dated d has cleared. Used to decide
   *             whether d can be the Ready Day, which is the conservative read.
   *   'open'  — the morning of d, before that day's bills present. Used by the
   *             displacement walk, where the question is what is on hand when
   *             an obligation arrives, not what is left after it.
   */
  const balanceOn = (d: string, bound: 'close' | 'open'): Cents => {
    const within = (x: string): boolean => x > today && (bound === 'close' ? x <= d : x < d);
    let balance = capacity.checkingBalance;
    for (const p of paydays) if (within(p.on)) balance += p.amount;
    for (const o of obligations) if (within(o.dueOn)) balance -= o.amount;
    balance -= Math.round(dailyEssential * daysBetween(today, d));
    return balance;
  };

  const obligationsDue = (from: string, to: string): Cents =>
    obligations.filter((o) => o.dueOn > from && o.dueOn <= to).reduce((a, o) => a + o.amount, 0);

  const clearanceOn = (d: string): Cents =>
    balanceOn(d, 'close') - obligationsDue(d, addDays(d, CLEARANCE_LOOKAHEAD_DAYS)) - BUFFER_FLOOR;

  /**
   * STRUCTURAL, test one. A chronic prescription is refilled every 30 days, so
   * the monthly-equivalent cost of this copay is the copay itself. If the
   * household's monthly surplus cannot carry it, no calendar date inside any
   * horizon fixes that — the answer is a patient assistance program or a
   * substitution, and the fix is not a reminder.
   */
  if (surplusMonthly < copay) {
    trace.push(
      `STRUCTURAL: monthly surplus ${fmt(surplusMonthly)} is below the ${fmt(copay)} this fill costs every 30 days. No date inside the plan year clears it; route to assistance, do not send a reminder.`,
    );
    // No Ready Day means no counterfactual, so no displacement — but "already
    // short" is copay-independent and is exactly the signal a PAP queue wants.
    const scan = scanObligations(copay, today, obligations, balanceOn, STRUCTURAL_NO_COUNTERFACTUAL, trace);
    return {
      class: 'STRUCTURAL',
      readyOn: null,
      readyWindow: null,
      daysToReady: null,
      copay,
      surplusMonthly,
      essentialMonthly,
      clearedBalanceOnReadyDay: null,
      displacement: null,
      alreadyShort: scan.alreadyShort,
      trace,
    };
  }

  trace.push(
    `Surplus ${fmt(surplusMonthly)} covers the ${fmt(copay)} copay, so a Ready Day exists in principle. Scanning day by day for the first one.`,
  );

  let readyOn: string | null = null;
  for (let i = 0; i <= horizonDays; i++) {
    const d = addDays(today, i);
    if (clearanceOn(d) >= copay) {
      readyOn = d;
      break;
    }
  }

  /**
   * STRUCTURAL, test two. The surplus says yes on paper but the ledger never
   * actually gets there — the obligations are stacked such that the balance
   * never clears the copay plus the buffer. Same routing as test one.
   */
  if (readyOn === null) {
    const endClearance = clearanceOn(horizonEnd);
    trace.push(
      `STRUCTURAL: no day in the ${horizonDays}-day scan clears ${fmt(copay)} after obligations and the ${fmt(BUFFER_FLOOR)} buffer. Best available on ${horizonEnd} was ${fmt(endClearance)}.`,
    );
    const scan = scanObligations(copay, today, obligations, balanceOn, STRUCTURAL_NO_COUNTERFACTUAL, trace);
    return {
      class: 'STRUCTURAL',
      readyOn: null,
      readyWindow: null,
      daysToReady: null,
      copay,
      surplusMonthly,
      essentialMonthly,
      clearedBalanceOnReadyDay: null,
      displacement: null,
      alreadyShort: scan.alreadyShort,
      trace,
    };
  }

  const daysToReady = daysBetween(today, readyOn);
  const cleared = clearanceOn(readyOn);
  const projected = balanceOn(readyOn, 'close');
  const weekAhead = obligationsDue(readyOn, addDays(readyOn, CLEARANCE_LOOKAHEAD_DAYS));

  trace.push(
    `Ready Day ${readyOn} (${daysToReady} day(s) out): projected balance ${fmt(projected)} - ${fmt(weekAhead)} of bills in the following ${CLEARANCE_LOOKAHEAD_DAYS} days - ${fmt(BUFFER_FLOOR)} buffer = ${fmt(cleared)}, which covers the ${fmt(copay)} copay.`,
  );

  const klass = readyOn > windowClosesOn ? 'STALE' : 'TIMING';
  if (klass === 'STALE') {
    trace.push(
      `STALE: the Ready Day ${readyOn} falls after the clinical window closes on ${windowClosesOn} (${daysBetween(windowClosesOn, readyOn)} day(s) late). The patient can afford this drug, just not in time — and only a prescriber can re-issue, substitute or escalate. Do not switch the drug on price alone and do not chart a refusal.`,
    );
  } else {
    trace.push(
      `TIMING: the Ready Day ${readyOn} is inside the clinical window that closes ${windowClosesOn}. Schedule the fill for that date. This is not a refusal and it is not a formulary problem.`,
    );
  }

  const readyWindow = computeReadyWindow(readyOn, today, capacity.income, trace);

  // Filling on the Ready Day IS filling today, so there is no "instead" to
  // price and displacement is vacuous. The already-short walk still runs: it
  // never mentions the copay, so it is true either way.
  if (readyOn === today) {
    trace.push('Today is the Ready Day, so filling now displaces nothing — there is no later date to compare it against.');
  }
  const scan = scanObligations(
    copay,
    today,
    obligations,
    balanceOn,
    readyOn === today ? READY_TODAY_NO_COUNTERFACTUAL : null,
    trace,
  );

  return {
    class: klass,
    readyOn,
    readyWindow,
    daysToReady,
    copay,
    surplusMonthly,
    essentialMonthly,
    clearedBalanceOnReadyDay: cleared,
    displacement: scan.displacement,
    alreadyShort: scan.alreadyShort,
    trace,
  };
}

/* ── displacement ────────────────────────────────────────────────────────── */

interface ObligationScan {
  displacement: Displacement | null;
  alreadyShort: AlreadyShort | null;
}

/**
 * What paying today actually costs, stated honestly.
 *
 * Not an overdraft fee and not revolving interest: Nessie emits neither, so
 * either number would be authored by us and presented as observation. What we
 * can observe is a real recurring obligation, mined from posted transactions,
 * that the copay pushes under the line inside the next two weeks.
 *
 * Three rules, and the first two are the ones a hostile reader checks:
 *
 *   ATTRIBUTABLE  `shortBy <= copay`, always. Write the shortfall out:
 *
 *       shortBy = amount - (onHand - copay) = (amount - onHand) + copay
 *
 *   so `shortBy > copay` is algebraically identical to `amount > onHand` —
 *   the obligation was going under with the copay never paid at all. Claiming
 *   the prescription caused that is false, and the guard is therefore not a
 *   clamp bolted on afterwards but the definition of attributable. Where it
 *   fires we report the different, harder, true thing: `alreadyShort`.
 *
 *   ESSENTIAL     only an obligation the household genuinely cannot defer may
 *   be named. See `DISPLACEABLE_CATEGORIES`. A gym membership going under is
 *   not an argument, it is an invitation to cancel the gym.
 *
 *   FIRST         the walk stops at the first obligation that fails, either
 *   way. Past that point the projection is running on a balance that assumed a
 *   bill cleared when it did not, so every number after it is fiction.
 */
function scanObligations(
  copay: Cents,
  today: string,
  obligations: readonly Obligation[],
  balanceOn: (d: string, bound: 'close' | 'open') => Cents,
  /** null runs the displacement branch; a sentence suppresses it, and says why. */
  suppressDisplacement: string | null,
  trace: string[],
): ObligationScan {
  const walkEnd = addDays(today, DISPLACEMENT_WINDOW_DAYS);
  const window = obligations.filter((o) => o.dueOn > today && o.dueOn <= walkEnd);

  const skipped = window.filter((o) => !o.essential);
  if (skipped.length > 0) {
    trace.push(
      `Not eligible to be reported as displaced, because a household can defer them: ${skipped
        .map((o) => `${o.merchantName} (${fmt(o.amount)} on ${o.dueOn}, ${o.essentialBasis})`)
        .join('; ')}.`,
    );
  }

  for (const o of window) {
    if (!o.essential) continue;

    const onHand = balanceOn(o.dueOn, 'open');
    const shortWithoutCopay = o.amount - onHand;

    if (shortWithoutCopay > 0) {
      trace.push(
        `ALREADY SHORT, not displaced: ${o.merchantName} (${fmt(o.amount)}, due ${o.dueOn}) is short by ${fmt(shortWithoutCopay)} with the ${fmt(copay)} copay NOT paid — ${fmt(onHand)} on hand that morning. This obligation fails with or without the prescription, so the prescription is not the cause and we do not claim it is. The honest signal is that this household is already behind.`,
      );
      return {
        displacement: null,
        alreadyShort: {
          merchantName: o.merchantName,
          amount: o.amount,
          dueOn: o.dueOn,
          shortBy: shortWithoutCopay,
        },
      };
    }

    const afterCopay = onHand - copay;
    if (afterCopay < o.amount) {
      // = shortWithoutCopay + copay, and shortWithoutCopay <= 0 here, so this
      // is <= copay by construction. Nothing clamps it.
      const shortBy = o.amount - afterCopay;
      if (suppressDisplacement !== null) {
        trace.push(
          `Displacement suppressed: ${o.merchantName} would go short by ${fmt(shortBy)} if the copay were paid today, but ${suppressDisplacement}`,
        );
        return { displacement: null, alreadyShort: null };
      }
      trace.push(
        `Displacement: pay the ${fmt(copay)} copay today and ${o.merchantName} (${fmt(o.amount)}, due ${o.dueOn}) is the first obligation the household cannot defer that goes under — ${fmt(onHand)} on hand that morning, ${fmt(afterCopay)} once the copay is gone, short by ${fmt(shortBy)}. The shortfall is ${fmt(shortBy)} against a ${fmt(copay)} copay, so every cent of it is attributable to this fill.`,
      );
      return {
        displacement: { merchantName: o.merchantName, amount: o.amount, dueOn: o.dueOn, shortBy },
        alreadyShort: null,
      };
    }
  }

  trace.push(
    `No obligation displaced: paying ${fmt(copay)} today still covers every obligation the household cannot defer, due through ${walkEnd}.`,
  );
  return { displacement: null, alreadyShort: null };
}
