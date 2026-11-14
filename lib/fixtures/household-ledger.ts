import { addDays, daysBetween } from '../dates';
import { dollars } from '../money';
import type { LedgerSnapshot, NessieMerchant, NessiePurchase } from '../nessie/types';
import type { Cents } from '../types';
import { HOUSEHOLD } from './household';

/**
 * Ninety-nine days of the median household's checking account, built to the
 * same rules as Maria's so the same detectors read it:
 *
 *   - payroll lands every 14 days, so the interval clusters on exactly 14;
 *   - eight monthly obligations repeat with <10% amount variance and are found
 *     as fixed bills;
 *   - everything else repeats MORE often, or with HIGH amount variance, so a
 *     naive "same merchant twice = a bill" detector would get it wrong and ours
 *     does not;
 *   - the three autosave transfers are exactly where the savings balance came
 *     from, so the two accounts reconcile, and the opening balance is derived
 *     rather than asserted, so the ledger can never disagree with itself.
 *
 * MODELLED, and labelled so on screen. Two published figures constrain it:
 *
 *   net pay      the Census median household income, taken to disposable income
 *                at the ratio in fixtures/household.ts, split over 26 paychecks
 *   total spend  calibrated so the household spends about 97 cents of every
 *                disposable dollar — the complement of the BEA personal saving
 *                rate (3.0%, July 2026). The monthly figures below were tuned
 *                to that once, by hand; nothing at runtime forces the result.
 *
 * The spending is split across categories in rough proportion to BLS Consumer
 * Expenditure Survey 2024 (housing about a third, transportation about a sixth,
 * food about an eighth, healthcare under a tenth). It deliberately excludes the
 * household's prescription drugs: that is the new demand this ledger is being
 * asked to absorb, so counting it here too would count it twice.
 *
 * The slack the engine derives from this ledger is therefore not asserted. It
 * falls out of the transactions, exactly as Maria's does.
 */

export const HOUSEHOLD_LEDGER_START = '2026-06-12';
export const HOUSEHOLD_LEDGER_END = '2026-09-19';

export const HOUSEHOLD_CUSTOMER_ID = 'demo-median-household';
export const HOUSEHOLD_CHECKING_ID = 'acct-household-checking';
export const HOUSEHOLD_SAVINGS_ID = 'acct-household-savings';

/** Net pay per paycheck: disposable income over 26 biweekly paychecks. */
export const HOUSEHOLD_PAYROLL_AMOUNT: Cents = Math.round(
  (HOUSEHOLD.profile.annualHouseholdIncome * HOUSEHOLD.disposableShare) / 26,
);
export const HOUSEHOLD_PAYROLL_SOURCE = 'COMMONWEALTH EMPLOYER GROUP PAYROLL';

/** Eight Fridays, 14 days apart, ending on the household's last payday. */
export const HOUSEHOLD_PAYROLL_DATES: string[] = Array.from({ length: 8 }, (_, i) =>
  addDays(HOUSEHOLD.lastPayday, -14 * (7 - i)),
);

export const HOUSEHOLD_CLOSING_CHECKING: Cents = dollars(3900.0);
export const HOUSEHOLD_CLOSING_SAVINGS: Cents = dollars(540.0);

export const HOUSEHOLD_MERCHANTS: NessieMerchant[] = [
  { _id: 'mch-hh-rent', name: 'Capital City Property Mgmt', category: ['housing'] },
  { _id: 'mch-hh-electric', name: 'Dominion Energy', category: ['utilities'] },
  { _id: 'mch-hh-water', name: 'Richmond Dept of Public Utilities', category: ['utilities'] },
  { _id: 'mch-hh-internet', name: 'Comcast Xfinity', category: ['telecom'] },
  { _id: 'mch-hh-phone', name: 'Verizon Wireless', category: ['telecom'] },
  { _id: 'mch-hh-carins', name: 'GEICO', category: ['insurance'] },
  { _id: 'mch-hh-autoloan', name: 'Toyota Financial Services', category: ['auto'] },
  { _id: 'mch-hh-stream', name: 'Netflix', category: ['entertainment'] },
  { _id: 'mch-hh-kroger', name: 'Kroger Broad St', category: ['groceries'] },
  { _id: 'mch-hh-dining', name: 'Richmond Family Dining', category: ['dining'] },
  { _id: 'mch-hh-fuel', name: 'Shell Hull St', category: ['fuel'] },
  { _id: 'mch-hh-target', name: 'Target Southside', category: ['retail'] },
  { _id: 'mch-hh-online', name: 'Amazon Marketplace', category: ['retail'] },
  { _id: 'mch-hh-apparel', name: 'Old Navy Chesterfield', category: ['apparel'] },
  { _id: 'mch-hh-clinic', name: 'VCU Health Community Clinic', category: ['healthcare'] },
  { _id: 'mch-hh-dental', name: 'Bright Smiles Family Dental', category: ['healthcare'] },
  { _id: 'mch-hh-fun', name: 'Regal Short Pump + Family Fun', category: ['entertainment'] },
  { _id: 'mch-hh-school', name: 'Chesterfield County Schools Fees', category: ['education'] },
  { _id: 'mch-hh-home', name: 'Lowes Home Improvement', category: ['home'] },
];

/** [merchantId, date, dollars, description] */
type PurchaseRow = readonly [string, string, number, string];

/** Eight monthly obligations. Same merchant, ~same amount, ~30 days apart. */
const RECURRING_ROWS: PurchaseRow[] = [
  ['mch-hh-rent', '2026-07-01', 1650.0, 'RENT 3120 HULL ST APT 4B'],
  ['mch-hh-rent', '2026-08-01', 1650.0, 'RENT 3120 HULL ST APT 4B'],
  ['mch-hh-rent', '2026-09-01', 1650.0, 'RENT 3120 HULL ST APT 4B'],

  ['mch-hh-electric', '2026-07-10', 142.0, 'ELECTRIC SERVICE'],
  ['mch-hh-electric', '2026-08-10', 148.5, 'ELECTRIC SERVICE'],
  ['mch-hh-electric', '2026-09-10', 151.3, 'ELECTRIC SERVICE'],

  ['mch-hh-water', '2026-07-14', 58.0, 'WATER AND SEWER'],
  ['mch-hh-water', '2026-08-14', 58.0, 'WATER AND SEWER'],
  ['mch-hh-water', '2026-09-14', 58.0, 'WATER AND SEWER'],

  ['mch-hh-internet', '2026-06-28', 79.99, 'INTERNET 400/20'],
  ['mch-hh-internet', '2026-07-28', 79.99, 'INTERNET 400/20'],
  ['mch-hh-internet', '2026-08-28', 79.99, 'INTERNET 400/20'],

  ['mch-hh-phone', '2026-07-03', 168.0, 'WIRELESS AUTOPAY 3 LINES'],
  ['mch-hh-phone', '2026-08-03', 168.0, 'WIRELESS AUTOPAY 3 LINES'],
  ['mch-hh-phone', '2026-09-03', 168.0, 'WIRELESS AUTOPAY 3 LINES'],

  ['mch-hh-carins', '2026-06-22', 152.0, 'AUTO POLICY VA-3317'],
  ['mch-hh-carins', '2026-07-22', 152.0, 'AUTO POLICY VA-3317'],
  ['mch-hh-carins', '2026-08-22', 152.0, 'AUTO POLICY VA-3317'],

  ['mch-hh-autoloan', '2026-07-05', 448.0, 'AUTO LOAN PAYMENT'],
  ['mch-hh-autoloan', '2026-08-05', 448.0, 'AUTO LOAN PAYMENT'],
  ['mch-hh-autoloan', '2026-09-05', 448.0, 'AUTO LOAN PAYMENT'],

  ['mch-hh-stream', '2026-07-19', 22.99, 'STREAMING'],
  ['mch-hh-stream', '2026-08-19', 22.99, 'STREAMING'],
  ['mch-hh-stream', '2026-09-19', 22.99, 'STREAMING'],
];

/**
 * Everything else, generated from a monthly figure and a purchase count so the
 * amounts are exactly reproducible. The weights make every merchant's amounts
 * vary by well over 10%, which is what keeps them out of the fixed-bill
 * detector; the counts keep the frequent ones off a monthly cadence too.
 */
interface VariableSpec {
  id: string;
  monthly: number;
  count: number;
  offset: number;
  description: string;
}

const VARIABLE_SPECS: VariableSpec[] = [
  { id: 'mch-hh-kroger', monthly: 790.0, count: 14, offset: 0, description: 'GROCERY' },
  { id: 'mch-hh-dining', monthly: 330.0, count: 12, offset: 1, description: 'RESTAURANT' },
  { id: 'mch-hh-fuel', monthly: 260.0, count: 9, offset: 2, description: 'FUEL' },
  { id: 'mch-hh-target', monthly: 390.0, count: 8, offset: 3, description: 'HOUSEHOLD' },
  { id: 'mch-hh-online', monthly: 282.0, count: 10, offset: 0, description: 'ONLINE ORDER' },
  { id: 'mch-hh-apparel', monthly: 160.0, count: 5, offset: 2, description: 'CLOTHING' },
  { id: 'mch-hh-clinic', monthly: 220.0, count: 4, offset: 1, description: 'CLINIC COPAY' },
  { id: 'mch-hh-dental', monthly: 120.0, count: 3, offset: 3, description: 'DENTAL' },
  { id: 'mch-hh-fun', monthly: 150.0, count: 6, offset: 1, description: 'ENTERTAINMENT' },
  { id: 'mch-hh-school', monthly: 210.0, count: 4, offset: 0, description: 'SCHOOL FEES + ACTIVITIES' },
  { id: 'mch-hh-home', monthly: 270.0, count: 5, offset: 2, description: 'HOME AND GARDEN' },
];

/** The same repeating weight pattern for everyone: its coefficient of variation is about 18%. */
const WEIGHTS = [0.72, 1.18, 0.95, 1.31, 0.84, 1.06, 1.22, 0.78, 1.12, 0.9, 1.27, 0.81, 1.04, 1.15];

const WINDOW_DAYS = daysBetween(HOUSEHOLD_LEDGER_START, HOUSEHOLD_LEDGER_END);

/** Split a total across weights so the pieces are whole cents and sum exactly to the total. */
function distribute(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const out = raw.map(Math.floor);
  let remainder = totalCents - out.reduce((a, b) => a + b, 0);
  const byFraction = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of byFraction) {
    if (remainder <= 0) break;
    out[i] = (out[i] as number) + 1;
    remainder--;
  }
  return out;
}

function variableRows(): PurchaseRow[] {
  const rows: PurchaseRow[] = [];
  for (const spec of VARIABLE_SPECS) {
    const totalCents = Math.round(((spec.monthly * 100) / 30.4375) * WINDOW_DAYS);
    const weights = Array.from({ length: spec.count }, (_, i) => WEIGHTS[(i + spec.offset) % WEIGHTS.length] as number);
    const amounts = distribute(totalCents, weights);
    const start = addDays(HOUSEHOLD_LEDGER_START, 1 + spec.offset);
    const step = Math.floor((WINDOW_DAYS - 4 - spec.offset) / Math.max(1, spec.count - 1));
    amounts.forEach((cents, i) => {
      rows.push([spec.id, addDays(start, i * step), cents / 100, spec.description]);
    });
  }
  return rows;
}

/** Where the $540 savings balance came from. Excluded from "spending". */
const SAVINGS_TRANSFER_ROWS: readonly (readonly [string, number])[] = [
  ['2026-07-09', 180.0],
  ['2026-08-13', 180.0],
  ['2026-09-10', 180.0],
];

function purchases(): NessiePurchase[] {
  const rows = [...RECURRING_ROWS, ...variableRows()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  return rows.map((r, i) => ({
    _id: `hpur-${String(i + 1).padStart(3, '0')}`,
    merchant_id: r[0],
    payer_id: HOUSEHOLD_CHECKING_ID,
    purchase_date: r[1],
    amount: r[2],
    status: 'completed',
    medium: 'balance' as const,
    description: r[3],
  }));
}

function netFlowCents(): number {
  const inflow = HOUSEHOLD_PAYROLL_DATES.length * HOUSEHOLD_PAYROLL_AMOUNT;
  const out =
    purchases().reduce((a, p) => a + dollars(p.amount), 0) +
    SAVINGS_TRANSFER_ROWS.reduce((a, t) => a + dollars(t[1]), 0);
  return inflow - out;
}

/** Derived, not asserted: what the balance must have been for the ledger to close where it does. */
export const HOUSEHOLD_OPENING_CHECKING: Cents = HOUSEHOLD_CLOSING_CHECKING - netFlowCents();

export function buildHouseholdLedger(): LedgerSnapshot {
  return {
    customerId: HOUSEHOLD_CUSTOMER_ID,
    checking: {
      _id: HOUSEHOLD_CHECKING_ID,
      type: 'Checking',
      nickname: 'Family Checking',
      rewards: 0,
      balance: HOUSEHOLD_CLOSING_CHECKING / 100,
      account_number: '2000000000003120',
      customer_id: HOUSEHOLD_CUSTOMER_ID,
    },
    savings: {
      _id: HOUSEHOLD_SAVINGS_ID,
      type: 'Savings',
      nickname: 'Rainy Day',
      rewards: 0,
      balance: HOUSEHOLD_CLOSING_SAVINGS / 100,
      account_number: '2000000000007744',
      customer_id: HOUSEHOLD_CUSTOMER_ID,
    },
    merchants: HOUSEHOLD_MERCHANTS,
    deposits: HOUSEHOLD_PAYROLL_DATES.map((d, i) => ({
      _id: `hdep-${String(i + 1).padStart(3, '0')}`,
      type: 'deposit' as const,
      transaction_date: d,
      status: 'completed',
      payee_id: HOUSEHOLD_CHECKING_ID,
      medium: 'balance' as const,
      amount: HOUSEHOLD_PAYROLL_AMOUNT / 100,
      description: HOUSEHOLD_PAYROLL_SOURCE,
    })),
    withdrawals: [],
    purchases: purchases(),
    transfers: SAVINGS_TRANSFER_ROWS.map((t, i) => ({
      _id: `htrf-${String(i + 1).padStart(3, '0')}`,
      type: 'transfer' as const,
      transaction_date: t[0],
      status: 'completed',
      medium: 'balance' as const,
      payer_id: HOUSEHOLD_CHECKING_ID,
      payee_id: HOUSEHOLD_SAVINGS_ID,
      amount: t[1],
      description: 'AUTOSAVE',
    })),
    bills: [],
  };
}
