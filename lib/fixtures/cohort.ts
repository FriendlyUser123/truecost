/**
 * The panel board cohort — twelve patients on one prescriber's panel.
 *
 * lib/fixtures/ledger.ts is one household written out line by line, because
 * Maria's ledger has to reconcile to the cent on screen. Twelve of those would
 * be four thousand literals nobody can audit, so this file parameterises the
 * same construction rather than duplicating it: the same derived-opening-balance
 * trick, the same "bills repeat monthly at a stable amount / essentials repeat
 * often at an unstable one" shape that makes the capacity detectors earn their
 * keep, the same 2026-09-19 close.
 *
 * Every patient exists to produce a DIFFERENT verdict, because a panel board
 * showing twelve identical rows proves nothing. Each spec carries a comment
 * saying which class it should produce and the arithmetic that gets it there;
 * tests/liquidity.ts then asserts those classes, so a fixture that drifts out
 * of its story fails the build rather than quietly ruining the demo.
 *
 * Observation window: 2026-06-01 through 2026-09-19. June, July and August are
 * complete calendar months, so the essential-floor median has three real
 * buckets to choose from rather than two half-months.
 */

import { addDays, parseISO, toISO } from '../dates';
import { dollars } from '../money';
import type {
  LedgerSnapshot,
  NessieDeposit,
  NessieMerchant,
  NessiePurchase,
  NessieWithdrawal,
} from '../nessie/types';
import type { PanelCandidate } from '../ready/types';

export const COHORT_START = '2026-06-01';
export const COHORT_END = '2026-09-19';

/* ── merchants ───────────────────────────────────────────────────────────── */

/**
 * One shared catalog; each patient shops at a subset. The categories are the
 * Nessie strings as they actually arrive — "groceries", "utilities" — not our
 * enums, because the classifier has to cope with that and does.
 */
export const COHORT_MERCHANTS: NessieMerchant[] = [
  { _id: 'mch-cardinal-ridge', name: 'Cardinal Ridge Apartments', category: ['housing'] },
  { _id: 'mch-hollins-mill', name: 'Hollins Mill Rentals', category: ['housing'] },
  { _id: 'mch-freedom-mtg', name: 'Freedom First Mortgage', category: ['housing'] },
  { _id: 'mch-appalachian-pwr', name: 'Appalachian Power', category: ['utilities'] },
  { _id: 'mch-wv-water', name: 'Western Virginia Water Authority', category: ['utilities'] },
  { _id: 'mch-verizon', name: 'Verizon Wireless', category: ['telecom'] },
  { _id: 'mch-cox', name: 'Cox Communications', category: ['telecom'] },
  { _id: 'mch-progressive', name: 'Progressive Insurance', category: ['insurance'] },
  { _id: 'mch-planet-fitness', name: 'Planet Fitness Roanoke', category: ['fitness'] },
  { _id: 'mch-kroger', name: 'Kroger #412 Roanoke', category: ['groceries'] },
  { _id: 'mch-aldi', name: 'ALDI Melrose Ave', category: ['groceries'] },
  { _id: 'mch-food-lion', name: 'Food Lion Vinton', category: ['groceries'] },
  { _id: 'mch-exxon', name: 'Exxon Williamson Rd', category: ['fuel'] },
  { _id: 'mch-shell', name: 'Shell Brambleton', category: ['fuel'] },
  { _id: 'mch-valley-metro', name: 'Valley Metro Transit', category: ['transit'] },
  { _id: 'mch-cvs', name: 'CVS Pharmacy #3391', category: ['pharmacy'] },
  { _id: 'mch-walgreens', name: 'Walgreens Grandin', category: ['pharmacy'] },
  { _id: 'mch-kiddie-academy', name: 'Kiddie Academy Roanoke', category: ['childcare'] },
  { _id: 'mch-walmart', name: 'Walmart Supercenter Roanoke', category: ['retail'] },
  { _id: 'mch-dollar-general', name: 'Dollar General #8821', category: ['retail'] },
];

/* ── spec shapes ─────────────────────────────────────────────────────────── */

/**
 * A monthly fixed obligation. Emitted on the same day of month across the
 * window, so capacity.ts sees a ~30-day gap; `drift` steps the amount a couple
 * of percent so the amount CV lands near 1.6% — under the detector's 10% bar,
 * but not three identical numbers, which no real utility ever bills.
 */
export interface BillSpec {
  merchantId: string;
  dayOfMonth: number;
  /** Dollars. */
  amount: number;
  description: string;
  /** Multipliers applied in order, cycling. Default: flat. */
  drift?: readonly number[];
}

/**
 * Non-deferrable spend. `everyDays` is deliberately never in 26..35 and
 * `amounts` deliberately varies, so nothing in here can be mistaken for a bill
 * — failing both tests at once is the point of the detector.
 */
export interface SpendSpec {
  merchantId: string;
  everyDays: number;
  /** Dollars, cycled in order. */
  amounts: readonly number[];
  description: string;
  /** Defaults to COHORT_START. */
  from?: string;
}

export interface PayrollSpec {
  source: string;
  /** Deposit dates, oldest first. Written out so a judge can count the gaps. */
  dates: readonly string[];
  /** Dollars per deposit. */
  amount: number;
  /** Per-deposit dollars when income is irregular; overrides `amount`. */
  amounts?: readonly number[];
}

export interface CohortLedgerSpec {
  customerId: string;
  /** Closing checking balance in dollars on COHORT_END. Opening is DERIVED. */
  checking: number;
  savings: number;
  payroll: PayrollSpec;
  bills: readonly BillSpec[];
  spend: readonly SpendSpec[];
  /** Retail spend, in dollars per month. See discretionaryRows. */
  discretionaryMonthly: number;
}

/* ── generators ──────────────────────────────────────────────────────────── */

/** [merchantId, date, dollars, description] — same row shape as ledger.ts. */
type PurchaseRow = readonly [string, string, number, string];

/** Every occurrence of `dayOfMonth` inside the window, clamped for short months. */
function monthlyDates(dom: number, from: string, to: string): string[] {
  const start = parseISO(from);
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth() + i;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const iso = toISO(new Date(Date.UTC(year, month, Math.min(dom, lastDay))));
    if (iso >= from && iso <= to) out.push(iso);
  }
  return out;
}

function billRows(spec: BillSpec): PurchaseRow[] {
  const drift = spec.drift ?? [1];
  return monthlyDates(spec.dayOfMonth, COHORT_START, COHORT_END).map((date, i) => {
    const mult = drift[i % drift.length] as number;
    return [
      spec.merchantId,
      date,
      Math.round(spec.amount * mult * 100) / 100,
      spec.description,
    ] as PurchaseRow;
  });
}

function spendRows(spec: SpendSpec): PurchaseRow[] {
  const out: PurchaseRow[] = [];
  let date = spec.from ?? COHORT_START;
  let i = 0;
  while (date <= COHORT_END) {
    out.push([spec.merchantId, date, spec.amounts[i % spec.amounts.length] as number, spec.description]);
    date = addDays(date, spec.everyDays);
    i++;
  }
  return out;
}

/** Mean 1.0 over a full cycle, so `discretionaryMonthly` means what it says. */
const DISCRETIONARY_CYCLE = [0.72, 1.18, 0.88, 1.24, 0.81, 1.17] as const;

/**
 * Everything that is neither a bill nor a necessity: the Walmart run, the
 * Dollar General run.
 *
 * It is invisible to the Ready Day arithmetic on purpose — the projection only
 * counts committed obligations and the non-deferrable floor, because a copay
 * competes with rent, not with a bag of chips. It still has to be in the ledger,
 * because an account where income exceeds observed spending by $1,000 a month
 * and still closes at $88 is an account no judge believes, and the derived
 * opening balance would come out negative and say so.
 *
 * Merchants alternate, which keeps each one on a 14-day gap: neither can be
 * mistaken for a monthly bill.
 */
function discretionaryRows(monthlyDollars: number): PurchaseRow[] {
  if (monthlyDollars <= 0) return [];
  const perWeek = (monthlyDollars * 12) / 52.1786;
  const out: PurchaseRow[] = [];
  let date = '2026-06-03';
  let i = 0;
  while (date <= COHORT_END) {
    const mult = DISCRETIONARY_CYCLE[i % DISCRETIONARY_CYCLE.length] as number;
    const retail = i % 2 === 0;
    out.push([
      retail ? 'mch-walmart' : 'mch-dollar-general',
      date,
      Math.round(perWeek * mult * 100) / 100,
      retail ? 'HOUSEHOLD' : 'HOUSEHOLD + SUNDRIES',
    ]);
    date = addDays(date, 7);
    i++;
  }
  return out;
}

function purchaseRows(spec: CohortLedgerSpec): PurchaseRow[] {
  return [
    ...spec.bills.flatMap(billRows),
    ...spec.spend.flatMap(spendRows),
    ...discretionaryRows(spec.discretionaryMonthly),
  ].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1].localeCompare(b[1])));
}

function depositAmount(spec: PayrollSpec, i: number): number {
  return spec.amounts ? (spec.amounts[i % spec.amounts.length] as number) : spec.amount;
}

/**
 * Derived, not asserted — exactly as in ledger.ts. Whatever the opening balance
 * must have been for the account to close where the panel board says it closes.
 * The transaction list and the balance can therefore never disagree.
 */
export function openingChecking(spec: CohortLedgerSpec): number {
  const inflow = spec.payroll.dates.reduce((a, _d, i) => a + dollars(depositAmount(spec.payroll, i)), 0);
  const outflow = purchaseRows(spec).reduce((a, r) => a + dollars(r[2]), 0);
  return dollars(spec.checking) - (inflow - outflow);
}

export function buildCohortLedger(spec: CohortLedgerSpec): LedgerSnapshot {
  const checkingId = `acct-${spec.customerId}-chk`;
  const savingsId = `acct-${spec.customerId}-sav`;

  const purchases: NessiePurchase[] = purchaseRows(spec).map((r, i) => ({
    _id: `pur-${spec.customerId}-${String(i + 1).padStart(3, '0')}`,
    merchant_id: r[0],
    payer_id: checkingId,
    purchase_date: r[1],
    amount: r[2],
    status: 'completed',
    medium: 'balance',
    description: r[3],
  }));

  const deposits: NessieDeposit[] = spec.payroll.dates.map((d, i) => ({
    _id: `dep-${spec.customerId}-${String(i + 1).padStart(3, '0')}`,
    type: 'deposit',
    transaction_date: d,
    status: 'completed',
    payee_id: checkingId,
    medium: 'balance',
    amount: depositAmount(spec.payroll, i),
    description: spec.payroll.source,
  }));

  const withdrawals: NessieWithdrawal[] = [];

  return {
    customerId: spec.customerId,
    checking: {
      _id: checkingId,
      type: 'Checking',
      nickname: 'Everyday Checking',
      rewards: 0,
      balance: spec.checking,
      customer_id: spec.customerId,
    },
    savings: {
      _id: savingsId,
      type: 'Savings',
      nickname: 'Savings',
      rewards: 0,
      balance: spec.savings,
      customer_id: spec.customerId,
    },
    merchants: COHORT_MERCHANTS,
    deposits,
    withdrawals,
    purchases,
    transfers: [],
    bills: [],
  };
}

/* ── shared spend shapes ─────────────────────────────────────────────────── */

/**
 * Weekly groceries. Amount CV above 20% and a 7-day gap, so this fails BOTH
 * fixed-bill tests. It lands in the essential floor instead, which is where a
 * household's grocery money actually belongs.
 */
function groceries(merchantId: string, amounts: readonly number[]): SpendSpec {
  return { merchantId, everyDays: 7, amounts, description: 'GROCERY' };
}

/** Fuel every 10 days. Not monthly, so never a bill; still not deferrable. */
function fuel(merchantId: string, amounts: readonly number[]): SpendSpec {
  return { merchantId, everyDays: 10, amounts, description: 'FUEL' };
}

/** Pharmacy on a 21-day cycle — refills and test strips, not a subscription. */
function pharmacy(merchantId: string, amounts: readonly number[]): SpendSpec {
  return { merchantId, everyDays: 21, amounts, description: 'RX + SUPPLIES' };
}

/* ── the twelve ledgers ──────────────────────────────────────────────────── */

/**
 * 1. NORA B. — REFUSED (verdict TIMING, ready today).
 *
 * Biweekly warehouse payroll, $1,380 in checking, a $25 generic. She clears
 * TODAY, so the liquidity engine has nothing urgent to say. She is in the
 * cohort to be refused a slot: her only signal is the claims-side no-fill, and
 * one source does not buy a prescriber's attention.
 *   income  1,280 x 365.25/14/12 = $2,783/mo
 *   fixed   1,295 + ~164 + 88 + 132        = $1,679/mo
 *   floor   groceries + fuel               ~   $457/mo
 *   surplus                                ~   $647 >> $25
 */
const NORA: CohortLedgerSpec = {
  customerId: 'cust-nora-b',
  checking: 1380.42,
  savings: 2400.0,
  discretionaryMonthly: 545,
  payroll: {
    source: 'BLUE RIDGE LOGISTICS PAYROLL',
    amount: 1280.0,
    dates: [
      '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17',
      '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11',
    ],
  },
  bills: [
    { merchantId: 'mch-cardinal-ridge', dayOfMonth: 1, amount: 1295.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 12, amount: 164.0, description: 'ELECTRIC SERVICE', drift: [0.98, 1.0, 1.02] },
    { merchantId: 'mch-verizon', dayOfMonth: 18, amount: 88.0, description: 'WIRELESS AUTOPAY' },
    { merchantId: 'mch-progressive', dayOfMonth: 24, amount: 132.0, description: 'AUTO POLICY' },
  ],
  spend: [
    groceries('mch-kroger', [72, 48, 95, 61, 84, 55]),
    fuel('mch-exxon', [38, 52, 44, 47]),
  ],
};

/**
 * 2. DARNELL W. — TIMING, six days out.
 *
 * Paid on the 10th and the 25th. Today is the 19th, so payday is 2026-09-25 and
 * nothing before it clears a $62 copay: $191.18 in checking with the $142 power
 * bill landing on the 22nd leaves him $100.82 under the buffer. Rent follows the
 * payday on the 11th, so it is not inside the week after 2026-09-25 and does not
 * claw the Ready Day back.
 *   ready 2026-09-25: 191.18 + 1,094.00 payroll - 142.00 power - 90.09 essentials
 *                   = 1,053.09, less $0 of bills in the next 7 days, less the
 *                     150.00 buffer = 903.09, which covers 62.00.
 *
 * Note the cadence label: gaps of 15/15/15/15/15/16 days are twice-monthly, but
 * capacity.ts tests the biweekly band first and reports "biweekly". The label is
 * cosmetic — the projection runs off the 15-day median interval either way.
 */
const DARNELL: CohortLedgerSpec = {
  customerId: 'cust-darnell-w',
  checking: 191.18,
  savings: 60.0,
  discretionaryMonthly: 370,
  payroll: {
    source: 'CARILION CLINIC PAYROLL',
    amount: 1094.0,
    dates: [
      '2026-06-10', '2026-06-25', '2026-07-10', '2026-07-25',
      '2026-08-10', '2026-08-25', '2026-09-10',
    ],
  },
  bills: [
    { merchantId: 'mch-hollins-mill', dayOfMonth: 11, amount: 985.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 22, amount: 142.0, description: 'ELECTRIC SERVICE', drift: [1.0, 0.99, 1.01] },
    { merchantId: 'mch-cox', dayOfMonth: 14, amount: 79.0, description: 'INTERNET' },
  ],
  spend: [
    groceries('mch-food-lion', [64, 41, 88, 52, 73, 46]),
    fuel('mch-shell', [35, 48, 29, 41]),
    pharmacy('mch-cvs', [24, 41, 18, 33]),
  ],
};

/**
 * 3. PRIYA S. — STALE.
 *
 * Paid once a month on the 1st. The next deposit is 2026-10-01 and the first
 * day that clears a $145 insulin copay is 2026-10-02. Her script was written
 * 2026-09-08 with a 14-day clinical window, so the window closes 2026-09-22 — ten days
 * before her money arrives. She can afford this drug. She cannot afford it in
 * time, which is a different problem with a different fix: bridge it or re-write
 * it, do not substitute the drug and do not chart "declined".
 */
const PRIYA: CohortLedgerSpec = {
  customerId: 'cust-priya-s',
  checking: 128.6,
  savings: 310.0,
  discretionaryMonthly: 535,
  payroll: {
    source: 'MONTGOMERY COUNTY SCHOOLS PAYROLL',
    amount: 2380.0,
    dates: ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
  },
  bills: [
    { merchantId: 'mch-cardinal-ridge', dayOfMonth: 3, amount: 1180.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 15, amount: 151.0, description: 'ELECTRIC SERVICE', drift: [1.01, 1.0, 0.99] },
    { merchantId: 'mch-verizon', dayOfMonth: 9, amount: 92.0, description: 'WIRELESS AUTOPAY' },
    { merchantId: 'mch-planet-fitness', dayOfMonth: 20, amount: 24.0, description: 'MEMBERSHIP' },
  ],
  spend: [
    groceries('mch-kroger', [78, 55, 92, 60, 81, 49]),
    fuel('mch-exxon', [42, 36, 55, 40]),
    pharmacy('mch-walgreens', [28, 19, 37, 22]),
  ],
};

/**
 * 4. CURTIS L. — STRUCTURAL, on the surplus test.
 *
 * A specialty biologic at $1,240 every 30 days against a household that nets a
 * few hundred dollars a month. The classifier never reaches the calendar: the
 * monthly surplus is below the monthly cost of the drug, so no date exists, in
 * this horizon or any other.
 *   income  1,240 x 365.25/14/12          = $2,696/mo
 *   fixed   1,205 + ~198 + 68 + 148 + 89  = $1,707/mo
 *   floor   groceries + fuel + pharmacy   ~   $620/mo
 *   surplus                               ~   $369 < $1,240
 * Sending this man a refill reminder is the cruelty the current alert commits
 * twelve times a year. The routing is a patient assistance program.
 */
const CURTIS: CohortLedgerSpec = {
  customerId: 'cust-curtis-l',
  checking: 402.9,
  savings: 95.0,
  discretionaryMonthly: 275,
  payroll: {
    source: 'ROANOKE CITY PUBLIC WORKS PAYROLL',
    amount: 1240.0,
    dates: [
      '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17',
      '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11',
    ],
  },
  bills: [
    { merchantId: 'mch-freedom-mtg', dayOfMonth: 1, amount: 1205.0, description: 'MORTGAGE' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 11, amount: 198.0, description: 'ELECTRIC SERVICE', drift: [0.98, 1.0, 1.02] },
    { merchantId: 'mch-wv-water', dayOfMonth: 16, amount: 68.0, description: 'WATER + SEWER' },
    { merchantId: 'mch-progressive', dayOfMonth: 26, amount: 148.0, description: 'AUTO POLICY' },
    { merchantId: 'mch-cox', dayOfMonth: 7, amount: 89.0, description: 'INTERNET' },
  ],
  spend: [
    groceries('mch-kroger', [95, 68, 112, 74, 101, 63]),
    fuel('mch-shell', [51, 44, 62, 48]),
    pharmacy('mch-cvs', [35, 48, 26, 41]),
  ],
};

/**
 * 5. ANGELA M. — TIMING, on an irregular income.
 *
 * Gig driver. Deposits land every Friday like clockwork, so the cadence detector
 * locks on at 7 days with zero timing variance, but the AMOUNTS run from $258 to
 * $786 — which is what irregular income actually looks like in a ledger:
 * reliable timing, unreliable size. Confidence drops accordingly and the engine
 * says so in the trace.
 *
 * She clears $85 on the Friday deposit, 2026-09-25, inside the 30-day window on
 * a script written 2026-09-15. Her displaced obligation is the phone bill on the
 * 21st, which for a driver is the job.
 */
const ANGELA: CohortLedgerSpec = {
  customerId: 'cust-angela-m',
  checking: 96.44,
  savings: 0.0,
  discretionaryMonthly: 515,
  payroll: {
    source: 'DASHFORCE WEEKLY PAYOUT',
    amount: 0,
    amounts: [506, 329, 725, 407, 258, 786, 472, 364, 620, 426, 280, 575, 441, 337, 640, 371],
    dates: [
      '2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26',
      '2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24',
      '2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21',
      '2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18',
    ],
  },
  bills: [
    { merchantId: 'mch-hollins-mill', dayOfMonth: 6, amount: 845.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 13, amount: 118.0, description: 'ELECTRIC SERVICE', drift: [1.02, 1.0, 0.98] },
    { merchantId: 'mch-verizon', dayOfMonth: 21, amount: 74.0, description: 'WIRELESS AUTOPAY' },
  ],
  spend: [
    groceries('mch-aldi', [52, 38, 71, 44, 60, 33]),
    fuel('mch-exxon', [64, 58, 72, 61]),
  ],
};

/**
 * 6. TOMÁS R. — already filled.
 *
 * His ledger is unremarkable on purpose. He is here so the board can prove it
 * drops a patient the instant the claims index says the prescription was picked
 * up. An alert about a filled script is the fastest way to teach a prescriber to
 * ignore the channel, and the channel is the asset.
 */
const TOMAS: CohortLedgerSpec = {
  customerId: 'cust-tomas-r',
  checking: 742.15,
  savings: 900.0,
  discretionaryMonthly: 495,
  payroll: {
    source: 'VIRGINIA TECH PAYROLL',
    amount: 1180.0,
    dates: [
      '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17',
      '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11',
    ],
  },
  bills: [
    { merchantId: 'mch-cardinal-ridge', dayOfMonth: 1, amount: 1340.0, description: 'RENT' },
    { merchantId: 'mch-cox', dayOfMonth: 10, amount: 94.0, description: 'INTERNET' },
    { merchantId: 'mch-progressive', dayOfMonth: 23, amount: 121.0, description: 'AUTO POLICY' },
  ],
  spend: [
    groceries('mch-kroger', [69, 51, 86, 57, 77, 48]),
    fuel('mch-shell', [40, 33, 49, 37]),
  ],
};

/**
 * 7. BEV H. — TIMING, fifteen days out.
 *
 * Retired. Social Security lands on the 3rd, the margin is thin and the pharmacy
 * floor is heavy. The $40 copay does not clear until the October deposit has
 * landed and the rent behind it has cleared. The right action is a fill
 * scheduled for that date, not a phone call on the 19th asking why she did not
 * pick it up.
 */
const BEV: CohortLedgerSpec = {
  customerId: 'cust-bev-h',
  checking: 214.77,
  savings: 520.0,
  discretionaryMonthly: 540,
  payroll: {
    source: 'SSA TREAS 310 XXSOC SEC',
    amount: 1742.0,
    dates: ['2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03'],
  },
  bills: [
    { merchantId: 'mch-hollins-mill', dayOfMonth: 5, amount: 780.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 17, amount: 126.0, description: 'ELECTRIC SERVICE', drift: [1.0, 1.02, 0.98] },
    { merchantId: 'mch-verizon', dayOfMonth: 26, amount: 61.0, description: 'WIRELESS AUTOPAY' },
  ],
  spend: [
    groceries('mch-food-lion', [44, 31, 58, 37, 50, 28]),
    pharmacy('mch-cvs', [62, 44, 81, 53]),
    { merchantId: 'mch-valley-metro', everyDays: 9, amounts: [12, 8, 15], description: 'BUS FARE' },
  ],
};

/**
 * 8. JALEN F. — TIMING, two days out, and NO displacement.
 *
 * Paid every Monday. $88 in checking on a Saturday, and a $12 generic. Monday's
 * deposit clears it outright, and because his rent share falls on the 8th and
 * his phone on the 19th, nothing at all is due in the next fourteen days: paying
 * the $12 today displaces nothing, and the card says so instead of inventing a
 * consequence.
 */
const JALEN: CohortLedgerSpec = {
  customerId: 'cust-jalen-f',
  checking: 88.31,
  savings: 40.0,
  discretionaryMonthly: 580,
  payroll: {
    source: 'MACADO S RESTAURANT PAYROLL',
    amount: 385.0,
    dates: [
      '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22',
      '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20',
      '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17',
      '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14',
    ],
  },
  bills: [
    { merchantId: 'mch-hollins-mill', dayOfMonth: 8, amount: 720.0, description: 'RENT SHARE' },
    { merchantId: 'mch-verizon', dayOfMonth: 19, amount: 55.0, description: 'WIRELESS AUTOPAY' },
  ],
  spend: [
    groceries('mch-aldi', [38, 26, 51, 33, 44, 24]),
    fuel('mch-exxon', [28, 35, 22, 31]),
  ],
};

/**
 * 9. MARISOL D. — STRUCTURAL, on the floor rather than the drug price.
 *
 * Two children at $600 a fortnight in day care. Childcare is an essential
 * category but NOT a fixed bill — a 14-day cadence fails the monthly test — so
 * it lands in the floor, and the floor is what kills her: roughly $1,700 a month
 * of non-deferrable spend on top of rent leaves nothing behind for a $95 copay.
 *   income  1,418 x 365.25/14/12   = $3,083/mo
 *   fixed   1,150 + ~137 + 96      = $1,383/mo
 *   floor   childcare + groceries + fuel ~ $1,700/mo
 *   surplus                        = -$53.78, i.e. below zero and below $95
 * This is the case a drug-price tool cannot see at all: nothing about the
 * prescription is expensive. The household is. She is also the one patient here
 * whose window is not net-flat: she opens at $871.68 and closes at $173.05,
 * because a structural shortfall looks exactly like a balance draining.
 */
const MARISOL: CohortLedgerSpec = {
  customerId: 'cust-marisol-d',
  checking: 173.05,
  savings: 25.0,
  discretionaryMonthly: 0,
  payroll: {
    source: 'AMAZON ROANOKE DVA2 PAYROLL',
    amount: 1418.0,
    dates: [
      '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17',
      '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11',
    ],
  },
  bills: [
    { merchantId: 'mch-cardinal-ridge', dayOfMonth: 1, amount: 1150.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 14, amount: 137.0, description: 'ELECTRIC SERVICE', drift: [0.99, 1.0, 1.01] },
    { merchantId: 'mch-verizon', dayOfMonth: 20, amount: 96.0, description: 'WIRELESS AUTOPAY' },
  ],
  spend: [
    { merchantId: 'mch-kiddie-academy', everyDays: 14, amounts: [600], description: 'CHILD CARE TUITION', from: '2026-06-05' },
    groceries('mch-kroger', [88, 63, 104, 71, 93, 58]),
    fuel('mch-shell', [44, 38, 53, 41]),
  ],
};

/**
 * 10. GRANT P. — TIMING, six days out, WITH a displacement.
 *
 * The case the whole displacement idea exists for. He clears a $210 copay on
 * payday, 2026-09-25. If he pays it today instead, the $96 water bill on the
 * 24th goes under the line — a real obligation, mined from three posted
 * charges, not a fabricated overdraft fee. "Fill it Friday and your water bill
 * survives" is a sentence no prescriber has ever been handed.
 */
const GRANT: CohortLedgerSpec = {
  customerId: 'cust-grant-p',
  checking: 312.4,
  savings: 150.0,
  discretionaryMonthly: 570,
  payroll: {
    source: 'NORFOLK SOUTHERN PAYROLL',
    amount: 1120.0,
    dates: [
      '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17',
      '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11',
    ],
  },
  bills: [
    { merchantId: 'mch-cardinal-ridge', dayOfMonth: 5, amount: 1050.0, description: 'RENT' },
    { merchantId: 'mch-wv-water', dayOfMonth: 24, amount: 96.0, description: 'WATER + SEWER' },
    { merchantId: 'mch-cox', dayOfMonth: 8, amount: 85.0, description: 'INTERNET' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 13, amount: 121.0, description: 'ELECTRIC SERVICE', drift: [1.01, 1.0, 0.99] },
  ],
  spend: [
    groceries('mch-food-lion', [70, 49, 91, 58, 79, 47]),
    fuel('mch-exxon', [41, 34, 50, 38]),
  ],
};

/**
 * 11. HYUN-JU K. — CLEARED (verdict TIMING, ready today).
 *
 * Paid on the 1st and the 16th, $612 in checking three days after a deposit, an
 * $18 inhaler. Claims say no-fill; the ledger says she has the money. Two
 * independent sources, so the alert is worth a slot — and what it carries is the
 * least dramatic and most useful thing the board can print: she can fill this
 * today, so the barrier is not money and somebody should ask what it is.
 */
const HYUNJU: CohortLedgerSpec = {
  customerId: 'cust-hyunju-k',
  checking: 612.9,
  savings: 1100.0,
  discretionaryMonthly: 685,
  payroll: {
    source: 'LEWISGALE MEDICAL PAYROLL',
    amount: 1050.0,
    dates: [
      '2026-06-01', '2026-06-16', '2026-07-01', '2026-07-16',
      '2026-08-01', '2026-08-16', '2026-09-01', '2026-09-16',
    ],
  },
  bills: [
    { merchantId: 'mch-cardinal-ridge', dayOfMonth: 4, amount: 1020.0, description: 'RENT' },
    { merchantId: 'mch-wv-water', dayOfMonth: 18, amount: 52.0, description: 'WATER + SEWER' },
    { merchantId: 'mch-progressive', dayOfMonth: 27, amount: 108.0, description: 'AUTO POLICY' },
  ],
  spend: [
    groceries('mch-aldi', [58, 42, 74, 47, 66, 39]),
    fuel('mch-shell', [33, 27, 42, 30]),
  ],
};

/**
 * 12. DESHAWN A. — STALE for the other reason.
 *
 * Not a distant Ready Day: an already-closed window. The script was written
 * 2026-08-16 with a 30-day clinical window, so the window closed 2026-09-15, four days
 * before the board ran. His Ready Day is 2026-09-25 — he is ten days late for a
 * bill he can pay. Nothing in healthcare today distinguishes his row from
 * Curtis's, and the two need opposite interventions: Deshawn needs the script
 * re-written and bridged, Curtis needs a PAP.
 */
const DESHAWN: CohortLedgerSpec = {
  customerId: 'cust-deshawn-a',
  checking: 147.28,
  savings: 80.0,
  discretionaryMonthly: 660,
  payroll: {
    source: 'ELIZABETH ARDEN LOGISTICS PAYROLL',
    amount: 1120.0,
    dates: [
      '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17',
      '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11',
    ],
  },
  bills: [
    { merchantId: 'mch-hollins-mill', dayOfMonth: 4, amount: 1095.0, description: 'RENT' },
    { merchantId: 'mch-appalachian-pwr', dayOfMonth: 21, amount: 129.0, description: 'ELECTRIC SERVICE', drift: [1.0, 0.98, 1.02] },
    { merchantId: 'mch-verizon', dayOfMonth: 11, amount: 83.0, description: 'WIRELESS AUTOPAY' },
  ],
  spend: [
    groceries('mch-kroger', [66, 47, 83, 54, 75, 44]),
    fuel('mch-exxon', [37, 31, 46, 35]),
  ],
};

/* ── the board ───────────────────────────────────────────────────────────── */

export const COHORT_LEDGER_SPECS: Readonly<Record<string, CohortLedgerSpec>> = {
  'cust-nora-b': NORA,
  'cust-darnell-w': DARNELL,
  'cust-priya-s': PRIYA,
  'cust-curtis-l': CURTIS,
  'cust-angela-m': ANGELA,
  'cust-tomas-r': TOMAS,
  'cust-bev-h': BEV,
  'cust-jalen-f': JALEN,
  'cust-marisol-d': MARISOL,
  'cust-grant-p': GRANT,
  'cust-hyunju-k': HYUNJU,
  'cust-deshawn-a': DESHAWN,
};

/** The name behind each Nessie customer id. Server-side only — see ReadyClaim. */
export const COHORT_NAMES: Readonly<Record<string, string>> = {
  'cust-nora-b': 'Nora B.',
  'cust-darnell-w': 'Darnell W.',
  'cust-priya-s': 'Priya S.',
  'cust-curtis-l': 'Curtis L.',
  'cust-angela-m': 'Angela M.',
  'cust-tomas-r': 'Tomás R.',
  'cust-bev-h': 'Bev H.',
  'cust-jalen-f': 'Jalen F.',
  'cust-marisol-d': 'Marisol D.',
  'cust-grant-p': 'Grant P.',
  'cust-hyunju-k': 'Hyun-ju K.',
  'cust-deshawn-a': 'Deshawn A.',
};

/**
 * The twelve prescriptions the board ranks.
 *
 * `claimsIndexEvent` is the signal we concede Surescripts already produces, and
 * it is ONE source. A row only buys a slot when the ledger corroborates it,
 * which is why rx-1041 can never be sent however tidy its verdict looks, and
 * why rx-1046 is dropped outright.
 */
export const PANEL_CANDIDATES: PanelCandidate[] = [
  {
    ref: 'rx-1041',
    drugId: 'atorvastatin',
    drugLabel: 'Atorvastatin 20mg',
    copay: dollars(25),
    writtenOn: '2026-09-14',
    clinicalWindowDays: 30,
    clinicalWeight: 0.35,
    nessieCustomerId: 'cust-nora-b',
    claimsIndexEvent: null,
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1042',
    drugId: 'empagliflozin',
    drugLabel: 'Empagliflozin 10mg (Jardiance)',
    copay: dollars(62),
    writtenOn: '2026-09-16',
    clinicalWindowDays: 30,
    clinicalWeight: 0.72,
    nessieCustomerId: 'cust-darnell-w',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1043',
    drugId: 'insulin-glargine',
    drugLabel: 'Insulin glargine (Lantus)',
    copay: dollars(145),
    writtenOn: '2026-09-08',
    clinicalWindowDays: 14,
    clinicalWeight: 0.95,
    nessieCustomerId: 'cust-priya-s',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1044',
    drugId: 'tirzepatide',
    drugLabel: 'Tirzepatide (Mounjaro)',
    copay: dollars(1240),
    writtenOn: '2026-09-10',
    clinicalWindowDays: 30,
    clinicalWeight: 0.68,
    nessieCustomerId: 'cust-curtis-l',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1045',
    drugId: 'sitagliptin',
    drugLabel: 'Sitagliptin 100mg (Januvia)',
    copay: dollars(85),
    writtenOn: '2026-09-15',
    clinicalWindowDays: 30,
    clinicalWeight: 0.6,
    nessieCustomerId: 'cust-angela-m',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1046',
    drugId: 'semaglutide',
    drugLabel: 'Semaglutide (Ozempic)',
    copay: dollars(300),
    writtenOn: '2026-09-09',
    clinicalWindowDays: 30,
    clinicalWeight: 0.7,
    nessieCustomerId: 'cust-tomas-r',
    claimsIndexEvent: 'filled',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1047',
    drugId: 'levothyroxine',
    drugLabel: 'Levothyroxine 88mcg',
    copay: dollars(40),
    writtenOn: '2026-09-12',
    clinicalWindowDays: 60,
    clinicalWeight: 0.5,
    nessieCustomerId: 'cust-bev-h',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'government',
  },
  {
    ref: 'rx-1048',
    drugId: 'metformin-er',
    drugLabel: 'Metformin ER 1000mg',
    copay: dollars(12),
    writtenOn: '2026-09-17',
    clinicalWindowDays: 30,
    clinicalWeight: 0.55,
    nessieCustomerId: 'cust-jalen-f',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1049',
    drugId: 'dulaglutide',
    drugLabel: 'Dulaglutide (Trulicity)',
    copay: dollars(95),
    writtenOn: '2026-09-13',
    clinicalWindowDays: 30,
    clinicalWeight: 0.66,
    nessieCustomerId: 'cust-marisol-d',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1050',
    drugId: 'escitalopram',
    drugLabel: 'Escitalopram 10mg',
    copay: dollars(210),
    writtenOn: '2026-09-18',
    clinicalWindowDays: 30,
    clinicalWeight: 0.8,
    nessieCustomerId: 'cust-grant-p',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1051',
    drugId: 'albuterol-hfa',
    drugLabel: 'Albuterol HFA (ProAir)',
    copay: dollars(18),
    writtenOn: '2026-09-17',
    clinicalWindowDays: 30,
    clinicalWeight: 0.88,
    nessieCustomerId: 'cust-hyunju-k',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
  {
    ref: 'rx-1052',
    drugId: 'insulin-glargine',
    drugLabel: 'Insulin glargine (Lantus)',
    copay: dollars(118),
    writtenOn: '2026-08-16',
    clinicalWindowDays: 30,
    clinicalWeight: 0.92,
    nessieCustomerId: 'cust-deshawn-a',
    claimsIndexEvent: 'no-fill',
    insuranceType: 'commercial',
  },
];

/** The ledger behind one panel row. Throws rather than silently faking one. */
export function cohortLedger(nessieCustomerId: string): LedgerSnapshot {
  const spec = COHORT_LEDGER_SPECS[nessieCustomerId];
  if (!spec) throw new Error(`no cohort ledger for ${nessieCustomerId}`);
  return buildCohortLedger(spec);
}

/** Every panel ledger, keyed by customer id. Built on demand, no caching. */
export function cohortLedgers(): Record<string, LedgerSnapshot> {
  const out: Record<string, LedgerSnapshot> = {};
  for (const [id, spec] of Object.entries(COHORT_LEDGER_SPECS)) out[id] = buildCohortLedger(spec);
  return out;
}

/**
 * Low-water mark of the running checking balance, in cents, replaying every
 * posted transaction from the derived opening balance.
 *
 * It is NOT asserted to be positive, and saying why matters: a household with
 * $191 in checking and $985 of rent genuinely touches the bottom of the account
 * every month, and a fixture that pretended otherwise would be a fixture about
 * somebody else. What the tests do assert is that each window is net-flat —
 * opening within a few dollars of closing — which is the actual claim these
 * ledgers make: paycheck to paycheck, not accumulating, not collapsing.
 */
export function lowestBalance(spec: CohortLedgerSpec): number {
  const ledger = buildCohortLedger(spec);
  const flows = [
    ...ledger.deposits.map((d) => ({ d: d.transaction_date, c: dollars(d.amount) })),
    ...ledger.purchases.map((p) => ({ d: p.purchase_date, c: -dollars(p.amount) })),
  ].sort((a, z) => (a.d === z.d ? z.c - a.c : a.d.localeCompare(z.d)));

  let running = openingChecking(spec);
  let lowest = running;
  for (const f of flows) {
    running += f.c;
    lowest = Math.min(lowest, running);
  }
  return lowest;
}
