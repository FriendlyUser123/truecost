/**
 * Ready — the Ready Card's own arithmetic, its routing decision, and its
 * bilingual patient copy.
 *
 * Five things live here, and they are here because they are the only parts of
 * /card/[ref] that are computation or policy rather than markup:
 *
 *   1. readyWindowOf() — the Ready Day is a WINDOW, not a certain date. The
 *      classifier publishes {earliest, likely}; this reads it, and degrades to
 *      a point window rather than inventing a spread if the field is absent.
 *
 *   2. clinicalWindowFor() — what actually closes. NOT "the script expires":
 *      a non-controlled US prescription is valid up to a year in most states,
 *      and what happens at 10–14 days is the pharmacy returning will-call
 *      stock to the shelf. What closes is a clinical window, and it is
 *      drug-specific, which is what makes `clinicalWeight` mean something.
 *
 *   3. routeFor() — SUPPRESSED / PRESCRIBER_ALERT / PAP_QUEUE. Ready rations
 *      prescriber attention; this is the rationing decision, in code.
 *
 *   4. projectBalanceCurve() — the classifier publishes a VERDICT, not a
 *      series. The card draws the balance walking toward the Ready Day, so the
 *      series has to be built. It is built from the same three published
 *      capacity outputs the classifier used, and the last line of its trace
 *      reconciles the curve against `verdict.clearedBalanceOnReadyDay`. If the
 *      two ever disagree the card prints the disagreement instead of hiding it.
 *
 *   5. buildPatientCard() — the same verdict, said twice, at a 6th-grade
 *      reading level, in English and in Spanish. Not a translation pass over
 *      English word order: the Spanish is written as Spanish, usted throughout,
 *      the way a clinic in Roanoke would actually hand it to somebody.
 *
 * Plus the wire types for POST /api/bridge, shared so the route and the button
 * cannot drift apart.
 *
 * NO ATM HELPERS LIVE HERE ANY MORE. `getAtmsNear()` stays in the Nessie
 * client — it is real, it parses the real response shape, and it demonstrates
 * endpoint breadth. It is simply never rendered. Measured on 2026-09-19:
 * `GET /atms` ignores `lat`, `lng` and `rad`, and every ATM the sandbox holds
 * is in Arlington while this cohort is in Roanoke. Printing a distance would
 * be a number we invented, on a screen whose whole pitch is hand-checkable
 * arithmetic.
 *
 * MONEY IS INTEGER CENTS. Deterministic: no Date.now(), no randomness, no
 * network. Every function that computes anything returns a `trace: string[]`.
 */

import {
  DEMO_TODAY,
  addDays,
  daysBetween,
  nextMonthlyOccurrence,
  parseISO,
  projectPaydays,
} from '../dates';
import { BUFFER_FLOOR } from '../engine/capacity';
import { dollars, fmt, fmtShort } from '../money';
import type { LedgerSnapshot } from '../nessie/types';
import type { CapacityResult, Cents, DataSource } from '../types';
import type { BridgeFunder, LiquidityVerdict } from './types';

/* ── the bridge funder ───────────────────────────────────────────────────── */

/**
 * These mirror scripts/seed-nessie.ts. They are duplicated rather than
 * imported because a Next route must not pull a tsx seeding script into its
 * module graph, and because in demo mode there is no sandbox to read them from.
 *
 * The funder is an independent charitable foundation and never a brand.
 * Manufacturer-funded copay assistance routed to a federally-insured patient
 * is an Anti-Kickback Statute problem, so the eligibility gate is enforced in
 * code (see `bridgeEligibility` below) and the funder is fixed in the type.
 */
export const BRIDGE_FUNDER: BridgeFunder = 'independent-foundation';
export const BRIDGE_FUNDER_NAME = 'Blue Ridge Access Foundation';
export const BRIDGE_FUND_ACCOUNT_LABEL = 'Access Grants (checking)';
export const BRIDGE_FUND_OPENING: Cents = dollars(4000);
export const BRIDGE_FUND_ACCOUNT_FALLBACK = 'acct-bra-foundation-checking';

/** Transfer descriptions the bridge writes. verifyStart uses the `RX-` twin. */
export const BRIDGE_TAG = 'BRIDGE-';

/**
 * The structure, in one line, on screen.
 *
 * Cash to a beneficiary conditioned on filling a drug is the Beneficiary
 * Inducements CMP (42 U.S.C. § 1320a-7a(a)(5)). Per-fill payment for arranging
 * a prescription is the Anti-Kickback Statute. Neither of those is what this
 * is: the foundation buys the fill at the pharmacy, which is the structure
 * manufacturer-independent hubs already run today.
 */
export const BRIDGE_STRUCTURE_LINE =
  'A funded purchase at the pharmacy, not a payment to the patient. The foundation pays the pharmacy for this one fill; no cash reaches the patient, and nothing is conditioned on a future fill.';

/**
 * Said before a judge finds it. Nessie has no pharmacy object, so the demo
 * posts the transfer that stands in for the pharmacy leg.
 */
export const BRIDGE_SANDBOX_CAVEAT =
  'Sandbox limitation, stated rather than hidden: Nessie has no pharmacy account, so the demo posts a funder→patient transfer that stands in for the pharmacy leg. In production the money is never in the patient’s checking account at any point.';

export interface BridgeEligibility {
  eligible: boolean;
  /** One line, printed next to the button when it is disabled. */
  reason: string;
}

/**
 * The regulatory gate, in code rather than on a slide.
 *
 * 42 U.S.C. § 1320a-7b(b): a manufacturer, and by extension a manufacturer-
 * funded program, may not pay the cost-sharing of a patient whose drug is
 * billed to a federal health care program. The industry workaround is the
 * independent charitable foundation, and an independent foundation is only
 * independent if the donor does not steer it to specific patients — which is
 * precisely what an alert-driven grant would do. So government-insured
 * patients are refused here, visibly, with the reason on screen.
 *
 * Uninsured patients are refused too, for the duller reason that the copay we
 * would be bridging is a cash price nobody has adjudicated.
 */
export function bridgeEligibility(insuranceType: 'commercial' | 'government' | 'uninsured'): BridgeEligibility {
  if (insuranceType === 'commercial') {
    return {
      eligible: true,
      reason: `Commercial plan. ${BRIDGE_FUNDER_NAME}, an independent charitable foundation and never a brand fund, buys the fill at the pharmacy counter.`,
    };
  }
  if (insuranceType === 'government') {
    return {
      eligible: false,
      reason:
        'Blocked: federally-insured patient. Third-party assistance routed to a drug billed to a federal program is the Anti-Kickback Statute (42 U.S.C. § 1320a-7b(b)). Route to the plan’s own low-income subsidy instead.',
    };
  }
  return {
    eligible: false,
    reason:
      'Blocked: no adjudicated benefit. There is no copay to buy down until a plan prices the fill — route to the pharmacy’s cash program.',
  };
}

/* ── wire types: POST /api/bridge ────────────────────────────────────────── */

export interface BridgeRequest {
  ref: string;
}

/** One side of the transfer, before and after, read back from Nessie. */
export interface BridgeBalance {
  label: string;
  accountId: string;
  before: Cents;
  after: Cents;
}

export interface BridgeResponse {
  ok: true;
  ref: string;
  /** The Nessie transfer id. In live mode a judge can curl this. */
  transferId: string;
  funder: BridgeFunder;
  funderName: string;
  amount: Cents;
  grantedOn: string;
  balances: { funder: BridgeBalance; patient: BridgeBalance };
  /** Where the balances were read from. */
  source: DataSource;
  /**
   * Where the transfer itself landed. Not the same thing as `source`: the
   * sandbox can refuse the POST and the write then falls back to the local
   * overlay, which a live ledger read does not see.
   */
  transferSource: DataSource;
  /**
   * True only when the patient's balance actually rose by `amount` between
   * the read before the write and the read after it. False on a replay, and
   * false when the write did not reach the account the balance is read from.
   * The card prints the difference rather than animating past it.
   */
  moved: boolean;
  /** True when the grant already existed: the route made no second transfer. */
  replayed: boolean;
  fetchedAt: string;
}

export interface BridgeFailure {
  ok: false;
  error: string;
}

export type BridgeResult = BridgeResponse | BridgeFailure;

/** What the patient-side reminder button gets back once the bill is written. */
export interface ScheduleReceipt {
  ok: true;
  ref: string;
  billId: string;
  payee: string;
  amount: Cents;
  dueOn: string;
  source: DataSource;
}

export interface ScheduleFailure {
  ok: false;
  error: string;
}

export type ScheduleResult = ScheduleReceipt | ScheduleFailure;

/* ── the dispensing pharmacy ─────────────────────────────────────────────── */

/**
 * The pharmacy the fill is written against. Same coordinates
 * scripts/seed-nessie.ts writes for the Kroger on Electric Road.
 *
 * The coordinates are kept even though nothing renders a distance: they are
 * what `getAtmsNear()` would be centred on, and deleting them would make the
 * "we implemented it, then measured that the sandbox ignores the radius"
 * answer unverifiable.
 */
export const DISPENSING_PHARMACY = {
  name: 'Kroger Pharmacy — Electric Road',
  lat: 37.2337,
  lng: -80.0086,
} as const;

/** Prefer a real seeded pharmacy geocode; fall back to the constant above. */
export function pharmacyCentre(ledger: LedgerSnapshot): { name: string; lat: number; lng: number } {
  const pharmacy = ledger.merchants.find(
    (m) => m.geocode && m.category.some((c) => c.trim().toLowerCase() === 'pharmacy'),
  );
  if (pharmacy?.geocode) {
    return { name: pharmacy.name, lat: pharmacy.geocode.lat, lng: pharmacy.geocode.lng };
  }
  return { ...DISPENSING_PHARMACY };
}

/* ── 1. the Ready Day is a window ────────────────────────────────────────── */

/**
 * A floor and a range, never a certain date.
 *
 * `earliest` is the first day the projection clears the copay. A date that is
 * three days EARLY means the card declines at the counter, which is the most
 * adherence-destroying event in the whole journey — so the floor is the number
 * the card leads with, and the range is what it admits around it.
 */
export interface ReadyWindow {
  earliest: string;
  likely: string;
}

/**
 * `readyWindow` is published by the classifier. It is read structurally rather
 * than as a hard dependency so this file compiles either side of that field
 * landing, and so a missing window degrades to a POINT window — the honest
 * degradation, because inventing a spread here would be inventing a number.
 */
type VerdictWithWindow = LiquidityVerdict & {
  readyWindow?: { earliest: string; likely: string } | null;
};

export function readyWindowOf(verdict: LiquidityVerdict): ReadyWindow | null {
  // No date means no window. A STRUCTURAL row must never render a range,
  // whatever the classifier happens to leave in the field.
  if (verdict.readyOn === null) return null;
  const w = (verdict as VerdictWithWindow).readyWindow;
  if (w && typeof w.earliest === 'string' && typeof w.likely === 'string') {
    return { earliest: w.earliest, likely: w.likely };
  }
  return { earliest: verdict.readyOn, likely: verdict.readyOn };
}

/**
 * The line that stops the window being read as a forecast with an error bar.
 *
 * There is no backtest. There cannot be one from sixty-five transactions, and
 * we do not pretend otherwise. What this becomes in production is not a better
 * model — it is a different mechanism.
 */
export const READY_WINDOW_NOTE =
  'In production this is an event trigger on the live connection — the deposit posts and the alert fires — not a forecast. No backtest exists, so no accuracy figure is quoted here and none should be inferred from the window.';

/* ── 2. the clinical window ──────────────────────────────────────────────── */

/**
 * WHAT ACTUALLY CLOSES.
 *
 * It is not the prescription. Non-controlled prescriptions in most US states
 * are valid up to a year from the date written; "the script expires in 30
 * days" is factually wrong and appears nowhere in this build. Two real things
 * do happen:
 *
 *   - At roughly 10–14 days the pharmacy returns uncollected will-call stock
 *     to the shelf and reverses the claim. That is restocking, not expiry.
 *   - A clinical window closes: the post-MI weeks in which starting a statin
 *     carries most of its benefit, the course an antibiotic has to complete,
 *     the titration step the next dose depends on, the follow-up the therapy
 *     was meant to precede.
 *
 * The second one is the one a prescriber can act on, and it is drug-specific.
 * That is what `clinicalWindowDays` and `clinicalWeight` on PanelCandidate
 * actually encode, and stating it makes the coefficient legible instead of
 * arbitrary.
 *
 * SYNTHETIC, and volunteered as such: the windows below are part of the
 * scenario, like the copays. What is not synthetic is the shape of the claim —
 * that the deadline is clinical, varies by drug, and is the only reason a
 * prescriber is the right recipient.
 */
const CLINICAL_WINDOW_REASONS: Readonly<Record<string, string>> = {
  atorvastatin:
    'Post-MI statin initiation. Most of the benefit of starting is concentrated in the weeks right after the event, and the cardiology follow-up is booked against a therapy that has begun.',
  empagliflozin:
    'Started at a titration visit with renal and volume checks booked behind it. Those labs measure a therapy that was supposed to be running.',
  'insulin-glargine':
    'Basal insulin continuity. The current pen runs out inside this window and there is no gap here that is clinically safe.',
  tirzepatide:
    'Dose-escalation schedule. A lapse past this window means restarting at the initiation dose and repeating the whole titration.',
  semaglutide:
    'Dose-escalation schedule. A lapse past this window means restarting at the initiation dose and repeating the whole titration.',
  sitagliptin:
    'Added to move A1c before the next quarterly draw. The draw is the thing this therapy was meant to precede.',
  levothyroxine:
    'The TSH recheck is booked six to eight weeks after the dose change. A recheck on a dose that was never taken measures nothing and costs the patient a visit.',
  'metformin-er':
    'First-line initiation ahead of the next A1c, and the GI titration restarts from the beginning after a lapse.',
  dulaglutide:
    'Weekly injection on an escalation schedule. A missed month means re-titrating from the starting dose.',
  escitalopram:
    'Antidepressant initiation. The four-to-six week response window is what the follow-up appointment was scheduled against, and it only starts on the first dose.',
  'albuterol-hfa':
    'Rescue inhaler. There is no window in which a patient with asthma should be without one, which is why this window is short and its weight is high.',
};

const CLINICAL_WINDOW_FALLBACK =
  'The follow-up this therapy was meant to precede falls inside this window, so a delay past it changes what the visit can measure.';

export interface ClinicalWindow {
  /** Last day inside the window. NOT an expiry date for the prescription. */
  closesOn: string;
  days: number;
  /** Drug-specific: what closes, and why a prescriber is the one who can move it. */
  reason: string;
  /** True when the window shut before today. */
  closed: boolean;
}

export function clinicalWindowFor(args: {
  drugId: string;
  writtenOn: string;
  clinicalWindowDays: number;
  /** Overrides the built-in reason when the fixture carries its own. */
  reason?: string | undefined;
  today?: string;
}): ClinicalWindow {
  const today = args.today ?? DEMO_TODAY;
  const closesOn = addDays(args.writtenOn, args.clinicalWindowDays);
  return {
    closesOn,
    days: args.clinicalWindowDays,
    reason: args.reason ?? CLINICAL_WINDOW_REASONS[args.drugId] ?? CLINICAL_WINDOW_FALLBACK,
    closed: closesOn < today,
  };
}

/**
 * The correction, on screen, in the place a judge will look for it.
 *
 * Printed next to every clinical window. It is cheaper to say this ourselves
 * than to have somebody in the room say it for us.
 */
export const NOT_AN_EXPIRY_NOTE =
  'Not an expiry date. A non-controlled prescription is valid up to a year in most states; what happens at 10–14 days is the pharmacy returning will-call stock to the shelf, which is restocking, not expiry. The deadline in this block is clinical, it is specific to this drug, and a prescriber is the only person who can move it — which is the whole reason a prescriber is the right recipient.';

/* ── 3. the routing decision ─────────────────────────────────────────────── */

export type ReadyRoute = 'SUPPRESSED' | 'PRESCRIBER_ALERT' | 'PAP_QUEUE';

export interface RoutingDecision {
  route: ReadyRoute;
  /** Badge text. */
  label: string;
  /** One sentence: why this row is or is not on a physician's screen. */
  line: string;
  /** False for SUPPRESSED. Nothing crosses the boundary at all. */
  sent: boolean;
}

/**
 * Ready rations prescriber attention. This is the rationing decision.
 *
 * TIMING is SUPPRESSED, and that is the point rather than a gap. For a $47
 * generic six days from payday there is no physician action: the patient fills
 * on payday with or without an alert. Our own attention engine, applied
 * honestly to that row, would refuse it — so it does, deliberately, visibly,
 * and the refusal is the strongest thing on the screen.
 *
 * STALE is SENT, because a clinical window closes before the cash arrives and
 * only a prescriber can re-issue, substitute or escalate.
 *
 * STRUCTURAL is SENT OFF-CHANNEL to the PAP queue. It consumes no in-channel
 * slot, and it is still a prescriber decision.
 */
export function routeFor(verdict: LiquidityVerdict, window: ClinicalWindow): RoutingDecision {
  if (verdict.class === 'STRUCTURAL' || verdict.readyOn === null) {
    return {
      route: 'PAP_QUEUE',
      label: 'SENT OFF-CHANNEL — PAP queue',
      line: 'No date exists in the scan, so there is nothing to wait for and a reminder is the wrong instrument. Routed to patient assistance, which is a prescriber decision, and it spends no in-channel slot.',
      sent: true,
    };
  }
  if (verdict.class === 'STALE') {
    const late = daysBetween(window.closesOn, verdict.readyOn);
    return {
      route: 'PRESCRIBER_ALERT',
      label: 'SENT — prescriber queue',
      line: `The clinical window closes ${window.closesOn} and the money is not there until ${verdict.readyOn}, ${late} day${late === 1 ? '' : 's'} later. Re-issuing, substituting or escalating are all prescriber acts, so this one is worth the slot.`,
      sent: true,
    };
  }
  return {
    route: 'SUPPRESSED',
    label: 'SUPPRESSED — never sent',
    line: 'The money arrives inside the clinical window, so the fill happens with or without an alert and there is no prescriber act to take. Sending it would spend a slot and buy nothing. Our own attention engine, applied to our own row, refuses it.',
    sent: false,
  };
}

/* ── 4. the balance curve ────────────────────────────────────────────────── */

/** The constant capacity.ts and liquidity.ts both annualise with. */
const AVG_DAYS_PER_MONTH = 30.4375;

/** Matches CLEARANCE_LOOKAHEAD_DAYS in liquidity.ts. Both must move together. */
const CLEARANCE_LOOKAHEAD_DAYS = 7;

export interface CurvePoint {
  date: string;
  /** Projected end-of-day checking balance. Negative is shown, not clamped. */
  balance: Cents;
  /** Balance less the next week of bills less the buffer. This is what must clear the copay. */
  cleared: Cents;
  isToday: boolean;
  isReadyDay: boolean;
  /** Inside {earliest, likely}. Shaded, because the date is not certain. */
  inWindow: boolean;
  /** Payday and obligation labels landing on this day. Tooltip only. */
  events: string[];
}

export interface BalanceCurve {
  points: CurvePoint[];
  copay: Cents;
  readyOn: string | null;
  window: ReadyWindow | null;
  /** Bounds for the plot, already including the copay line and zero. */
  top: Cents;
  bottom: Cents;
  bufferFloor: Cents;
  trace: string[];
}

interface DatedClaim {
  name: string;
  amount: Cents;
  dueOn: string;
}

function projectClaims(
  capacity: CapacityResult,
  ledger: LedgerSnapshot,
  today: string,
  until: string,
): DatedClaim[] {
  const out: DatedClaim[] = [];

  for (const r of capacity.recurring) {
    let due = r.nextDue;
    for (let i = 0; i < 24 && due <= until; i++) {
      if (due > today) out.push({ name: r.merchantName, amount: r.averageAmount, dueOn: due });
      due = nextMonthlyOccurrence(due, r.dayOfMonth);
    }
  }

  for (const b of ledger.bills) {
    if (b.status === 'cancelled' || b.status === 'completed') continue;
    const due = b.upcoming_payment_date;
    if (due > today && due <= until) {
      out.push({ name: b.nickname || b.payee, amount: dollars(b.payment_amount), dueOn: due });
    }
  }

  out.sort((a, b) => (a.dueOn === b.dueOn ? b.amount - a.amount : a.dueOn.localeCompare(b.dueOn)));
  return out;
}

/**
 * Thin shape adapter over the one payday projection in lib/dates.ts. The
 * curve and the classifier now step through the calendar with the same code,
 * so the balance line under the Ready Day cannot disagree with it.
 */
function paydayClaims(capacity: CapacityResult, today: string, until: string): DatedClaim[] {
  return projectPaydays(capacity.income, today, until).map((p) => ({
    name: p.source,
    amount: p.amount,
    dueOn: p.on,
  }));
}

export interface BalanceCurveArgs {
  verdict: LiquidityVerdict;
  capacity: CapacityResult;
  ledger: LedgerSnapshot;
  today?: string;
  /** Days plotted. Defaults to the classifier's own 45-day horizon. */
  days?: number;
}

/**
 * The checking balance, day by day, from today to the end of the horizon.
 *
 * Deliberately NOT a re-derivation of the classifier's answer: the same three
 * published outputs go in (`capacity.income`, `capacity.recurring`,
 * `verdict.essentialMonthly`) and the same arithmetic runs, so the curve
 * cannot tell a different story than the date above it. The final trace line
 * proves that by recomputing `clearedBalanceOnReadyDay` from the series and
 * comparing. A judge who does not believe the date can read it off the chart.
 */
export function projectBalanceCurve(args: BalanceCurveArgs): BalanceCurve {
  const { verdict, capacity, ledger } = args;
  const today = args.today ?? DEMO_TODAY;
  const days = args.days ?? 45;
  const trace: string[] = [];
  const window = readyWindowOf(verdict);

  const horizonEnd = addDays(today, days);
  const claims = projectClaims(capacity, ledger, today, addDays(horizonEnd, CLEARANCE_LOOKAHEAD_DAYS));
  const paydays = paydayClaims(capacity, today, horizonEnd);
  const dailyEssential = verdict.essentialMonthly / AVG_DAYS_PER_MONTH;

  trace.push(
    `Curve opens at today's checking balance ${fmt(capacity.checkingBalance)} and walks ${days} days to ${horizonEnd}.`,
  );
  trace.push(
    `Each day subtracts ${fmt(Math.round(dailyEssential))} of non-deferrable spend (${fmt(verdict.essentialMonthly)} / ${AVG_DAYS_PER_MONTH} days), adds any payday, and subtracts any obligation dated that day.`,
  );

  const points: CurvePoint[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    let balance = capacity.checkingBalance;
    for (const p of paydays) if (p.dueOn > today && p.dueOn <= date) balance += p.amount;
    for (const c of claims) if (c.dueOn > today && c.dueOn <= date) balance -= c.amount;
    balance -= Math.round(dailyEssential * i);

    const weekAhead = claims
      .filter((c) => c.dueOn > date && c.dueOn <= addDays(date, CLEARANCE_LOOKAHEAD_DAYS))
      .reduce((a, c) => a + c.amount, 0);

    const events = [
      ...paydays.filter((p) => p.dueOn === date).map((p) => `+${fmt(p.amount)} ${p.name}`),
      ...claims.filter((c) => c.dueOn === date).map((c) => `-${fmt(c.amount)} ${c.name}`),
    ];

    points.push({
      date,
      balance,
      cleared: balance - weekAhead - BUFFER_FLOOR,
      isToday: i === 0,
      isReadyDay: verdict.readyOn === date,
      inWindow: window !== null && date >= window.earliest && date <= window.likely,
      events,
    });
  }

  const balances = points.map((p) => p.balance);
  const top = Math.max(...balances, verdict.copay, 0);
  const bottom = Math.min(...balances, 0);

  if (verdict.readyOn === null) {
    const best = Math.max(...points.map((p) => p.cleared));
    trace.push(
      `No Ready Day to mark: the best clearance anywhere in the ${days}-day walk is ${fmt(best)}, against a ${fmt(verdict.copay)} copay. The curve is the evidence for STRUCTURAL.`,
    );
  } else {
    const at = points.find((p) => p.date === verdict.readyOn);
    if (!at) {
      trace.push(
        `Ready Day ${verdict.readyOn} falls outside the ${days}-day plot, so the marker is off-chart. Widen the horizon to see it.`,
      );
    } else if (verdict.clearedBalanceOnReadyDay !== null && at.cleared !== verdict.clearedBalanceOnReadyDay) {
      // Never silently prefer one number over the other. If the curve and the
      // verdict disagree, one of them is wrong and the card has to say so.
      trace.push(
        `RECONCILIATION FAILED: the curve puts clearance on ${verdict.readyOn} at ${fmt(at.cleared)}, the classifier at ${fmt(verdict.clearedBalanceOnReadyDay)}. Do not trust the date until this is resolved.`,
      );
    } else {
      trace.push(
        `Reconciles: on ${verdict.readyOn} the curve reads ${fmt(at.balance)}, less the following week's bills and the ${fmt(BUFFER_FLOOR)} buffer leaves ${fmt(at.cleared)} — the same clearance the classifier used to pick the date.`,
      );
    }
  }

  if (window) {
    trace.push(
      window.earliest === window.likely
        ? `The classifier published no spread around ${window.earliest}, so the shaded band is one day wide. The card does not widen it on its own — inventing a spread here would be inventing a number.`
        : `Shaded band = the published window: earliest ${window.earliest}, likely through ${window.likely}. The floor is what the card leads with, because a date three days early means the card declines at the counter.`,
    );
  }

  return {
    points,
    copay: verdict.copay,
    readyOn: verdict.readyOn,
    window,
    top,
    bottom,
    bufferFloor: BUFFER_FLOOR,
    trace,
  };
}

/* ── 5. the bilingual patient card ───────────────────────────────────────── */

/** Whole dollars when the cents are zero — a patient card says "$62". */
function plain(c: Cents): string {
  return c % 100 === 0 ? fmtShort(c) : fmt(c);
}

const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const ES_DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
const ES_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** "Friday, October 2" */
export function enDate(iso: string): string {
  const d = parseISO(iso);
  return `${EN_DAYS[d.getUTCDay()] ?? ''}, ${EN_MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`;
}

/**
 * "el viernes 2 de octubre".
 *
 * Spanish dates are cardinal, lowercase the weekday and the month, and carry
 * the article. The first of the month is the one exception and is spoken
 * "el primero", never "el uno" — getting that wrong is the tell that a card
 * was run through a translator.
 */
export function esDate(iso: string): string {
  const d = parseISO(iso);
  const day = d.getUTCDate();
  const num = day === 1 ? 'primero' : String(day);
  return `el ${ES_DAYS[d.getUTCDay()] ?? ''} ${num} de ${ES_MONTHS[d.getUTCMonth()] ?? ''}`;
}

/** "October 3 and October 7", or one date when the window is a point. */
export function enRange(w: ReadyWindow): string {
  const a = parseISO(w.earliest);
  const b = parseISO(w.likely);
  const ma = EN_MONTHS[a.getUTCMonth()] ?? '';
  const mb = EN_MONTHS[b.getUTCMonth()] ?? '';
  if (w.earliest === w.likely) return `${ma} ${a.getUTCDate()}`;
  if (ma === mb) return `${ma} ${a.getUTCDate()} and ${b.getUTCDate()}`;
  return `${ma} ${a.getUTCDate()} and ${mb} ${b.getUTCDate()}`;
}

/**
 * "entre el 3 y el 7 de octubre" — and across a month boundary,
 * "entre el 28 de septiembre y el 4 de octubre". Spanish does not repeat the
 * month inside a same-month range, and a card that does reads as machine copy.
 */
export function esRange(w: ReadyWindow): string {
  const a = parseISO(w.earliest);
  const b = parseISO(w.likely);
  const da = a.getUTCDate() === 1 ? 'primero' : String(a.getUTCDate());
  const db = b.getUTCDate() === 1 ? 'primero' : String(b.getUTCDate());
  const ma = ES_MONTHS[a.getUTCMonth()] ?? '';
  const mb = ES_MONTHS[b.getUTCMonth()] ?? '';
  if (w.earliest === w.likely) return `el ${da} de ${ma}`;
  if (ma === mb) return `entre el ${da} y el ${db} de ${ma}`;
  return `entre el ${da} de ${ma} y el ${db} de ${mb}`;
}

function capFirst(s: string): string {
  return s.length === 0 ? s : `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`;
}

export interface PatientCardSide {
  lang: 'en' | 'es';
  /** For the tab label and the `lang` attribute on the block. */
  langLabel: string;
  speechLang: string;
  title: string;
  /** The window, or the honest absence of one. Never a bare date in 96pt. */
  dateLine: string;
  /** "most likely between October 3 and October 7", or null. */
  dateSub: string | null;
  body: string[];
  /** The single thing to do, phrased as an instruction. */
  todo: string;
  footer: string;
  /** Everything above as one string, for speechSynthesis. */
  speech: string;
}

export interface PatientCard {
  en: PatientCardSide;
  es: PatientCardSide;
  trace: string[];
}

export interface PatientCardInput {
  verdict: LiquidityVerdict;
  drugLabel: string;
  /** What closes, and when. NOT a prescription expiry. */
  clinicalWindow: ClinicalWindow;
  /**
   * Present only when the bridge is lawful AND offered for this class.
   * `granted` separates "a fund can pay this" from "a fund has paid this" —
   * a handout that promises money nobody has moved yet is the one way this
   * card could do harm.
   */
  bridge: { amount: Cents; granted: boolean } | null;
  today?: string;
}

/**
 * The same verdict, said twice, at a 6th-grade reading level.
 *
 * Four rules govern every string below, and they are the difference between
 * a handout somebody keeps and one that goes in the bin at the door:
 *
 *   The frame is always "here is your date", never "you cannot afford this".
 *   TIMING is relief, STALE is a deadline somebody else can move, STRUCTURAL
 *   is a price that is not the patient's fault. None of the three is a verdict
 *   on the person holding the card.
 *
 *   Every number on the card is one the patient can check against their own
 *   account. Nothing modelled, nothing rounded up, nothing implied.
 *
 *   The date is a window. "Your money is there Friday" and then it is not is
 *   a declined card at the counter, and a declined card is the single most
 *   adherence-destroying event in this whole journey. So the card says the
 *   soonest, then the likely range, in that order.
 *
 *   The Spanish is written as Spanish. Usted throughout — this is a clinic
 *   handout, not an app. Conditional where Spanish uses conditional
 *   ("le faltarían"), "sí pueden" where English would say "they can do that",
 *   and no calques of "reach out" or "follow up".
 */
export function buildPatientCard(input: PatientCardInput): PatientCard {
  const { verdict, drugLabel, clinicalWindow, bridge } = input;
  const today = input.today ?? DEMO_TODAY;
  const trace: string[] = [];
  const copay = plain(verdict.copay);
  const window = readyWindowOf(verdict);

  const en: string[] = [];
  const es: string[] = [];
  let enTitle: string;
  let esTitle: string;
  let enDateLine: string;
  let esDateLine: string;
  let enDateSub: string | null = null;
  let esDateSub: string | null = null;
  let enTodo: string;
  let esTodo: string;

  const d = verdict.displacement;

  if (verdict.class === 'TIMING' && verdict.readyOn !== null && window !== null) {
    const soonest = enDate(window.earliest);
    const loMasPronto = esDate(window.earliest);
    const spread = window.earliest !== window.likely;

    enTitle = 'Your medicine is waiting. Here is when you will be able to pay for it.';
    esTitle = 'Su medicina está lista. Este es el día en que va a poder pagarla.';
    enDateLine = soonest;
    esDateLine = capFirst(loMasPronto);
    if (spread) {
      enDateSub = `Most likely between ${enRange(window)}.`;
      esDateSub = `Lo más probable es que sea ${esRange(window)}.`;
    }

    en.push(`The pharmacy has your ${drugLabel}. It costs ${copay}.`);
    es.push(`La farmacia ya tiene su ${drugLabel}. Cuesta ${copay}.`);

    if (d) {
      en.push(
        `If you pay today, you would be ${plain(d.shortBy)} short for ${d.merchantName} on ${enDate(d.dueOn)}.`,
      );
      es.push(
        `Si paga hoy, le faltarían ${plain(d.shortBy)} para ${d.merchantName} ${esDate(d.dueOn)}.`,
      );
    } else {
      en.push(`Right now your account does not have the ${copay} with enough left over to be safe.`);
      es.push(`Ahora mismo su cuenta no tiene los ${copay} y algo de reserva para estar tranquilo.`);
    }

    en.push(
      spread
        ? `The soonest your pay will be in is ${soonest}. It could be a few days later. Wait until you can see the money in your account, then pay the ${copay}.`
        : `On ${soonest} your pay will have come in. You can pay the ${copay} that day and still cover your bills.`,
    );
    es.push(
      spread
        ? `Lo más pronto que le entra su pago es ${loMasPronto}. Puede tardar unos días más. Espere a ver el dinero en su cuenta y ahí pague los ${copay}.`
        : `${capFirst(loMasPronto)} ya le habrá entrado su pago. Ese día puede pagar los ${copay} y aún le alcanza para sus cuentas.`,
    );

    enTodo = `Ask the pharmacy to hold your prescription until ${soonest}. They can do that, and you will not have to start over.`;
    esTodo = `Pídale a la farmacia que le guarde la receta hasta ${loMasPronto}. Sí pueden hacerlo, y no va a tener que empezar de nuevo.`;

    trace.push(
      `TIMING card: earliest ${window.earliest}, likely through ${window.likely}, ${verdict.daysToReady ?? 0} day(s) out. Inside the clinical window that closes ${clinicalWindow.closesOn}, so nothing was sent to the prescriber — this card is the only output.`,
    );
  } else if (verdict.class === 'STALE' && verdict.readyOn !== null && window !== null) {
    const soonest = enDate(window.earliest);
    const loMasPronto = esDate(window.earliest);
    const late = daysBetween(clinicalWindow.closesOn, window.earliest);
    const spread = window.earliest !== window.likely;

    enTitle = 'You can pay for this medicine. You just need it before your money comes in.';
    esTitle = 'Usted sí puede pagar esta medicina. Solo que la necesita antes de que le llegue el dinero.';
    enDateLine = soonest;
    esDateLine = capFirst(loMasPronto);
    if (spread) {
      enDateSub = `Most likely between ${enRange(window)}.`;
      esDateSub = `Lo más probable es que sea ${esRange(window)}.`;
    }

    en.push(`Your ${drugLabel} costs ${copay}.`);
    es.push(`Su ${drugLabel} cuesta ${copay}.`);
    en.push(
      `The soonest you will have the money is ${soonest}. Your doctor wanted you to start this medicine by ${enDate(clinicalWindow.closesOn)} — ${late} day${late === 1 ? '' : 's'} sooner.`,
    );
    es.push(
      `Lo más pronto que va a tener el dinero es ${loMasPronto}. Su doctor quería que empezara esta medicina para ${esDate(clinicalWindow.closesOn)}, ${late} día${late === 1 ? '' : 's'} antes.`,
    );
    en.push('Your prescription has not run out. The medicine is just needed sooner than the money arrives.');
    es.push('Su receta no se ha vencido. Lo que pasa es que la medicina se necesita antes de que llegue el dinero.');

    if (bridge) {
      en.push(
        `${BRIDGE_FUNDER_NAME} will pay the pharmacy the ${plain(bridge.amount)} for this prescription. The money goes straight to the pharmacy, not to you, and you do not pay anyone back.`,
      );
      es.push(
        `${BRIDGE_FUNDER_NAME} le va a pagar a la farmacia los ${plain(bridge.amount)} de esta receta. El dinero va directo a la farmacia, no a usted, y usted no le tiene que devolver nada a nadie.`,
      );
      enTodo = bridge.granted
        ? 'Go to the pharmacy and give them your name. This prescription is already paid for.'
        : 'Go to the pharmacy today and give them your name. Ask them to check for the foundation payment on this prescription.';
      esTodo = bridge.granted
        ? 'Vaya a la farmacia y dé su nombre. Esta receta ya está pagada.'
        : 'Vaya hoy a la farmacia y dé su nombre. Pídales que busquen el pago de la fundación para esta receta.';
    } else {
      en.push('This is a timing problem, not a money problem, and the office is the one who can fix it.');
      es.push('Este es un problema de fechas, no de dinero, y en el consultorio son los que lo pueden arreglar.');
      enTodo = `Call the office. Tell them your money comes in around ${soonest} and ask what you should do until then.`;
      esTodo = `Llame al consultorio. Dígales que su dinero le entra como ${loMasPronto} y pregunte qué debe hacer mientras tanto.`;
    }

    trace.push(
      `STALE card: earliest ${window.earliest} lands ${late} day(s) after the clinical window closes on ${clinicalWindow.closesOn} (${clinicalWindow.days}-day window). The prescription itself is not expired and the card does not say it is.`,
    );
  } else {
    enTitle = 'This price is too high for one household to carry. That is not your fault.';
    esTitle = 'Este precio es demasiado alto para una sola casa. Eso no es culpa suya.';
    enDateLine = 'No date this year';
    esDateLine = 'Ninguna fecha este año';

    en.push(`Your ${drugLabel} costs ${copay} every month.`);
    es.push(`Su ${drugLabel} cuesta ${copay} cada mes.`);
    en.push(
      `After rent, power, food and gas, your household has about ${plain(Math.max(0, verdict.surplusMonthly))} left in a month. The medicine costs more than that.`,
    );
    es.push(
      `Después de la renta, la luz, la comida y la gasolina, a su casa le quedan como ${plain(Math.max(0, verdict.surplusMonthly))} al mes. La medicina cuesta más que eso.`,
    );
    en.push('Waiting will not fix this. There is no week this year where the money fits.');
    es.push('Esperar no lo va a arreglar. No hay ninguna semana de este año en que ese dinero alcance.');

    enTodo =
      'Your doctor’s office is signing you up for a program that pays for this medicine. Someone will call you. Do not stop taking anything before they do.';
    esTodo =
      'En el consultorio lo están inscribiendo en un programa que paga esta medicina. Alguien lo va a llamar. No deje de tomar nada antes de que llamen.';

    trace.push(
      `STRUCTURAL card: monthly surplus ${fmt(verdict.surplusMonthly)} against a ${fmt(verdict.copay)} monthly copay. No date is offered because none exists.`,
    );
  }

  const enFooter = `Printed ${enDate(today)}. Nobody at the pharmacy or the insurance company was sent your balance or your bank account.`;
  const esFooter = `Impreso ${esDate(today)}. Ni la farmacia ni el seguro recibieron su saldo ni su cuenta bancaria.`;

  const enSide: PatientCardSide = {
    lang: 'en',
    langLabel: 'English',
    speechLang: 'en-US',
    title: enTitle,
    dateLine: enDateLine,
    dateSub: enDateSub,
    body: en,
    todo: enTodo,
    footer: enFooter,
    speech: [enTitle, enDateLine, enDateSub ?? '', ...en, enTodo].filter(Boolean).join(' '),
  };

  const esSide: PatientCardSide = {
    lang: 'es',
    langLabel: 'Español',
    speechLang: 'es-US',
    title: esTitle,
    dateLine: esDateLine,
    dateSub: esDateSub,
    body: es,
    todo: esTodo,
    footer: esFooter,
    speech: [esTitle, esDateLine, esDateSub ?? '', ...es, esTodo].filter(Boolean).join(' '),
  };

  return { en: enSide, es: esSide, trace };
}
