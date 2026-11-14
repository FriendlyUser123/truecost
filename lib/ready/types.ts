/**
 * Ready — domain types.
 *
 * The product in one sentence: Surescripts can tell a prescriber that a
 * prescription was never picked up. Ready tells them *why*, and the exact
 * calendar date it can be.
 *
 * MONEY IS ALWAYS INTEGER CENTS. See lib/money.ts.
 *
 * Three ideas live in here:
 *
 *   1. LiquidityVerdict — the Ready Day and the three-way classification.
 *      Computed from the patient's own bank ledger. No claims database, PBM,
 *      EHR or real-time benefit tool holds the data required to produce it.
 *
 *   2. AttentionProfile — a prescriber's measured saturation point, derived
 *      from years of their own engagement history. Alerts are a rationed
 *      inventory, and this is the integer that rations them.
 *
 *   3. ReadyClaim — the *only* thing that crosses the boundary to the
 *      prescriber. One enum, one date. No balance, no transactions, no
 *      income, no merchant, no account number. The privacy story is a type.
 */

import type { Cents, DataSource } from '../types';

/* ── 1. Liquidity: the Ready Day ─────────────────────────────────────────── */

/**
 * Today, all three of these produce the identical Surescripts abandonment
 * alert and the identical chart note ("patient declined"). They require
 * opposite interventions.
 */
export type LiquidityClass =
  /** Can afford it — not this week. No prescriber action: the alert is suppressed. */
  | 'TIMING'
  /**
   * Can afford it, but not before the clinical window closes — the period in
   * which starting this drug still does what it was prescribed to do. NOT a
   * prescription expiry. Only a prescriber can re-issue, substitute or escalate.
   */
  | 'STALE'
  /** Cannot carry it at any point this plan year. Route: PAP / substitution. */
  | 'STRUCTURAL';

/**
 * The honest second-order cost of filling today anyway.
 *
 * Deliberately NOT an overdraft fee or revolving interest: Nessie does not
 * emit either, so any such number would be authored by us and presented as
 * observation. This is a real recurring obligation, mined from real posted
 * transactions, that paying the copay today would push under the line.
 */
export interface Displacement {
  merchantName: string;
  amount: Cents;
  dueOn: string;
  /** How far short the obligation falls if the copay is paid today. */
  shortBy: Cents;
}

export interface LiquidityVerdict {
  class: LiquidityClass;
  /** null for STRUCTURAL — no such date exists inside the horizon. */
  readyOn: string | null;
  daysToReady: number | null;
  copay: Cents;
  /** Income less recurring obligations less the essential floor. */
  surplusMonthly: Cents;
  /** Median monthly spend in categories a household cannot defer. */
  essentialMonthly: Cents;
  /** Projected balance on the Ready Day, after obligations and the floor. */
  clearedBalanceOnReadyDay: Cents | null;
  displacement: Displacement | null;
  /** Every branch above, as sentences. Rendered verbatim in the UI drawer. */
  trace: string[];
}

/* ── 2. Attention: the rationed channel ──────────────────────────────────── */

export type EngagementChannel = 'email' | 'in-app' | 'portal' | 'fax';

/** One historical touch to one prescriber. This is the Impiricus asset. */
export interface EngagementEvent {
  sentAt: string;
  channel: EngagementChannel;
  opened: boolean;
  /** Minutes from send to open; null when never opened. */
  openedAfterMin: number | null;
  replied: boolean;
  /** True when the touch carried two independent corroborating sources. */
  corroborated: boolean;
}

/**
 * How much open rate an uncorroborated send costs the channel.
 *
 * 'none'     — the interval spans zero, or sits below it. Nothing measurable.
 * 'some'     — measurably above zero, but under the materiality threshold.
 * 'material' — measurably above zero and large enough to act on.
 */
export type DebtBand = 'none' | 'some' | 'material';

/**
 * The attention-debt estimate, with its own uncertainty attached.
 *
 * A bare decimal here would be a lie: each observation is a difference of two
 * proportions measured on roughly five sends a side, so one observation
 * carries a standard error around ±32 percentage points. `display` is the
 * ONLY form of this quantity that may reach a screen — band, interval, n.
 * See `summariseDebt` in lib/ready/attention.ts for the arithmetic.
 */
export interface AttentionDebtEstimate {
  /** Point estimate, in percentage points of open rate. Never shown alone. */
  points: number;
  /** Uncorroborated sends with enough archive on both sides to measure. */
  n: number;
  /** Uncorroborated sends too isolated to measure. Skipped, not counted as 0. */
  skipped: number;
  /** Half-width of the 95% interval, in points. null when n < 2. */
  halfWidth: number | null;
  /** Interval bounds in points. null when n < 2 — i.e. unbounded. */
  low: number | null;
  high: number | null;
  band: DebtBand;
  /** The ONLY debt string that may reach a screen. Band, interval, n. */
  display: string;
  /** Long form for the trace drawer. */
  sentence: string;
}

export interface AttentionProfile {
  prescriberId: string;
  prescriberName: string;
  specialty: string;
  totalSends: number;
  openRate: number;
  replyRate: number;
  medianLatencyMin: number;
  /** 0–167, hour-of-week bucket with the highest open rate (min 8 sends). */
  bestHourOfWeek: number;
  /**
   * The weekly send count above which this prescriber's own open rate
   * collapses below half its all-time average. An integer, measured, per
   * physician. This number is computable ONLY from years of per-HCP
   * engagement history — it is the most Impiricus-native object in the build.
   */
  saturationPoint: number;
  /** Prescriber-set cap, when they have moved the slider. */
  override: number | null;
  sendsAlreadyThisWeek: number;
  /**
   * Open-rate points lost per uncorroborated send, measured from history.
   * The raw point estimate. NEVER render it: render `debt.display`.
   */
  debtPerUncorroboratedSend: number;
  /** The same quantity with its interval and sample size. This is renderable. */
  debt: AttentionDebtEstimate;
  trace: string[];
}

/* ── 3. The boundary ─────────────────────────────────────────────────────── */

/**
 * Everything the prescriber receives. Deliberately minimal — this type IS the
 * privacy argument, and the UI prints it next to the list of what was withheld.
 */
export type ReadyClaim =
  | { class: 'TIMING'; readyOn: string }
  | { class: 'STALE'; readyOn: string }
  | { class: 'STRUCTURAL' };

export const WITHHELD_FIELDS = [
  'account balance',
  'transaction history',
  'income amount',
  'employer',
  'merchant names',
  'account number',
] as const;

/* ── 4. Panel board ──────────────────────────────────────────────────────── */

export type SlotState =
  /** Corroborated, ranked inside the slot budget. Sent. */
  | 'CLEARED'
  /** Corroborated but outranked this week. Persists in the queue. */
  | 'DEFERRED'
  /** STRUCTURAL. Routed off-channel; consumes no slot. */
  | 'PAP_QUEUE'
  /**
   * TIMING. Believed completely, and still never sent: the patient reaches
   * the copay on their own money inside the clinical window, so there is no
   * physician action to take. Consumes no slot, produces no ReadyClaim, and
   * is shown on the board anyway — it is the product, not a gap in it.
   */
  | 'SUPPRESSED'
  /** Single-source. Refused, and shown refused. */
  | 'REFUSED';

export interface PanelCandidate {
  ref: string;
  drugId: string;
  drugLabel: string;
  copay: Cents;
  writtenOn: string;
  /** Days from writtenOn until the script can no longer be filled. */
  clinicalWindowDays: number;
  /** 0–1. How much the delay matters clinically. */
  clinicalWeight: number;
  nessieCustomerId: string;
  /** The claims-side signal we concede Surescripts already produces. */
  claimsIndexEvent: 'no-fill' | 'filled' | null;
  insuranceType: 'commercial' | 'government' | 'uninsured';
}

export interface RankedCandidate {
  candidate: PanelCandidate;
  liquidity: LiquidityVerdict | null;
  state: SlotState;
  /** Populated only when state === 'CLEARED'. */
  claim: ReadyClaim | null;
  /** recoverable × clinicalWeight. Higher sends first. */
  score: number;
  rank: number | null;
  /** Why this row is in the state it is in. One sentence, shown on screen. */
  reason: string;
  /** Open-rate points this send would cost, when it is uncorroborated. */
  attentionCost: number;
}

export interface PanelBoard {
  profile: AttentionProfile;
  slotBudget: number;
  slotsUsed: number;
  rows: RankedCandidate[];
  cleared: number;
  deferred: number;
  papQueue: number;
  /** TIMING rows. Not sent, no slot spent, shown anyway — this is the pitch. */
  suppressed: number;
  refused: number;
  /** cleared + papQueue. What actually leaves the building this week. */
  sent: number;
  source: DataSource;
  generatedAt: string;
}

/* ── 5. Exchange ─────────────────────────────────────────────────────────

   `ExchangeModel` and `ExchangeComparison` used to live here: a two-column
   cost-per-verified-start comparison between impressions and cleared alerts.
   HARDENING 2e retired it — it billed per cleared alert in the arithmetic and
   per verified fill in the prose, and if the invoice line really were the
   fill then cost-per-start is whatever price we typed. Nothing referenced
   these two types any more, and a dead type describing a retired claim is
   still a claim sitting in the repo, so they are gone. lib/ready/exchange.ts
   owns the replacement: a measured withholding ledger, a stated unit, and a
   break-even offered as an experiment with its prices labelled as
   assumptions.                                                              */

/* ── 6. Settlement ───────────────────────────────────────────────────────── */

/**
 * Who funds a bridge. Manufacturer copay assistance is unlawful for
 * federally-insured patients under the Anti-Kickback Statute, so the funding
 * source is part of the domain model and the eligibility gate is enforced in
 * code, not in a slide.
 */
export type BridgeFunder = 'independent-foundation' | 'brand-access-fund' | 'patient-advance';

export interface BridgeGrant {
  ref: string;
  funder: BridgeFunder;
  amount: Cents;
  toAccountId: string;
  transferId: string;
  grantedOn: string;
  source: DataSource;
}

/** A fill observed settling in the patient's own ledger. */
export interface VerifiedStart {
  ref: string;
  verified: boolean;
  observedOn: string | null;
  amount: Cents | null;
  merchantName: string | null;
  /** The Nessie object id — the receipt a judge can hit themselves. */
  settlementId: string | null;
  source: DataSource;
}

/* ── 7. Side kick ────────────────────────────────────────────────────────── */

export type PayCadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface SideKickInput {
  cadence: PayCadence;
  balance: Cents;
  copay: Cents;
  drugLabel: string;
}

export interface SideKickResult {
  class: LiquidityClass;
  readyOn: string | null;
  daysToReady: number | null;
  headline: string;
  subhead: string;
  footnote: string;
}
