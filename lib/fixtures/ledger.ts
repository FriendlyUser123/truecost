import { dollars } from '../money';
import type { LedgerSnapshot, NessieMerchant, NessiePurchase } from '../nessie/types';
import { MARIA } from './patient';

/**
 * Ninety-nine days of Maria's checking account, 2026-06-12 through 2026-09-19.
 *
 * Built so the detectors have something real to find:
 *   - payroll lands every 14 days, so the interval clusters on exactly 14;
 *   - five merchants repeat monthly with <10% amount variance, so they are
 *     classifiable as fixed obligations;
 *   - groceries, fuel and restaurants repeat MORE often with HIGH variance, so
 *     a naive "same merchant twice = a bill" detector would get them wrong and
 *     ours does not;
 *   - the three $60 savings transfers are exactly where her $180 savings
 *     balance came from, so the two accounts reconcile.
 *
 * The opening balance is derived (not asserted) so the ledger always sums to
 * the closing balance the demo shows. See scripts/verify-ledger.ts.
 */

export const LEDGER_START = '2026-06-12';
export const LEDGER_END = '2026-09-19';
export const CLOSING_CHECKING = dollars(412.37);
export const CLOSING_SAVINGS = dollars(180.0);

export const PAYROLL_DATES = [
  '2026-06-19',
  '2026-07-03',
  '2026-07-17',
  '2026-07-31',
  '2026-08-14',
  '2026-08-28',
  '2026-09-11',
] as const;
export const PAYROLL_AMOUNT = dollars(1183.42);
export const PAYROLL_SOURCE = 'ROANOKE HOSPITALITY GRP PAYROLL';

export const MERCHANTS: NessieMerchant[] = [
  { _id: 'mch-blueridge-prop', name: 'Blue Ridge Property Mgmt', category: ['housing'] },
  { _id: 'mch-appalachian-pwr', name: 'Appalachian Power', category: ['utilities'] },
  { _id: 'mch-verizon', name: 'Verizon Wireless', category: ['telecom'] },
  { _id: 'mch-progressive', name: 'Progressive Insurance', category: ['insurance'] },
  { _id: 'mch-cox', name: 'Cox Communications', category: ['telecom'] },
  { _id: 'mch-kroger', name: 'Kroger #412 Roanoke', category: ['groceries'] },
  { _id: 'mch-exxon', name: 'Exxon Williamson Rd', category: ['fuel'] },
  { _id: 'mch-walmart', name: 'Walmart Supercenter Roanoke', category: ['retail'] },
  { _id: 'mch-dollar-general', name: 'Dollar General #8821', category: ['retail'] },
  { _id: 'mch-el-rodeo', name: 'El Rodeo Mexican Restaurant', category: ['dining'] },
  { _id: 'mch-cvs', name: 'CVS Pharmacy #3391', category: ['pharmacy'] },
  { _id: 'mch-firestone', name: 'Firestone Complete Auto Care', category: ['auto'] },
  { _id: 'mch-target', name: 'Target Roanoke', category: ['retail'] },
];

/** [merchantId, date, dollars, description] */
type PurchaseRow = readonly [string, string, number, string];

/** Five monthly obligations. Same merchant, ~same amount, ~30 days apart. */
const RECURRING_ROWS: PurchaseRow[] = [
  ['mch-blueridge-prop', '2026-07-05', 1150.0, 'RENT 1412 PATTERSON AVE SW'],
  ['mch-blueridge-prop', '2026-08-05', 1150.0, 'RENT 1412 PATTERSON AVE SW'],
  ['mch-blueridge-prop', '2026-09-05', 1150.0, 'RENT 1412 PATTERSON AVE SW'],

  ['mch-appalachian-pwr', '2026-07-12', 181.06, 'ELECTRIC SERVICE'],
  ['mch-appalachian-pwr', '2026-08-12', 186.0, 'ELECTRIC SERVICE'],
  ['mch-appalachian-pwr', '2026-09-12', 179.44, 'ELECTRIC SERVICE'],

  ['mch-verizon', '2026-07-18', 94.0, 'WIRELESS AUTOPAY'],
  ['mch-verizon', '2026-08-18', 94.0, 'WIRELESS AUTOPAY'],
  ['mch-verizon', '2026-09-18', 94.0, 'WIRELESS AUTOPAY'],

  ['mch-progressive', '2026-06-22', 118.0, 'AUTO POLICY VA-8841'],
  ['mch-progressive', '2026-07-22', 118.0, 'AUTO POLICY VA-8841'],
  ['mch-progressive', '2026-08-22', 118.0, 'AUTO POLICY VA-8841'],

  ['mch-cox', '2026-06-26', 95.0, 'INTERNET 100/10'],
  ['mch-cox', '2026-07-26', 95.0, 'INTERNET 100/10'],
  ['mch-cox', '2026-08-26', 95.0, 'INTERNET 100/10'],
];

/** Everything else. High amount variance, irregular cadence, or one-off. */
const VARIABLE_ROWS: PurchaseRow[] = [
  ['mch-exxon', '2026-06-13', 44.75, 'FUEL'],
  ['mch-kroger', '2026-06-16', 67.32, 'GROCERY'],
  ['mch-kroger', '2026-06-23', 72.44, 'GROCERY'],
  ['mch-el-rodeo', '2026-06-24', 24.8, 'RESTAURANT'],
  ['mch-exxon', '2026-06-25', 41.2, 'FUEL'],
  ['mch-walmart', '2026-06-27', 112.4, 'HOUSEHOLD'],
  ['mch-kroger', '2026-06-30', 58.19, 'GROCERY'],
  ['mch-dollar-general', '2026-07-02', 34.18, 'HOUSEHOLD'],
  ['mch-kroger', '2026-07-07', 91.3, 'GROCERY'],
  ['mch-exxon', '2026-07-09', 52.65, 'FUEL'],
  ['mch-el-rodeo', '2026-07-11', 31.45, 'RESTAURANT'],
  ['mch-kroger', '2026-07-14', 38.96, 'GROCERY'],
  ['mch-kroger', '2026-07-21', 64.75, 'GROCERY'],
  ['mch-exxon', '2026-07-23', 33.1, 'FUEL'],
  ['mch-firestone', '2026-07-26', 268.44, 'BRAKE PADS + ROTORS'],
  ['mch-kroger', '2026-07-28', 83.11, 'GROCERY'],
  ['mch-el-rodeo', '2026-07-29', 18.9, 'RESTAURANT'],
  ['mch-kroger', '2026-08-04', 88.42, 'GROCERY'],
  ['mch-exxon', '2026-08-06', 46.85, 'FUEL'],
  ['mch-walmart', '2026-08-09', 143.22, 'HOUSEHOLD'],
  ['mch-kroger', '2026-08-11', 44.75, 'GROCERY'],
  ['mch-target', '2026-08-16', 78.9, 'SCHOOL SUPPLIES'],
  ['mch-el-rodeo', '2026-08-15', 27.35, 'RESTAURANT'],
  ['mch-kroger', '2026-08-18', 71.3, 'GROCERY'],
  ['mch-exxon', '2026-08-20', 29.3, 'FUEL'],
  ['mch-kroger', '2026-08-25', 52.68, 'GROCERY'],
  ['mch-kroger', '2026-09-01', 38.96, 'GROCERY'],
  ['mch-el-rodeo', '2026-09-02', 22.6, 'RESTAURANT'],
  ['mch-exxon', '2026-09-03', 55.4, 'FUEL'],
  ['mch-cvs', '2026-09-05', 64.0, 'RX METFORMIN 90CT + TEST STRIPS'],
  ['mch-kroger', '2026-09-08', 90.14, 'GROCERY'],
  ['mch-dollar-general', '2026-09-13', 28.44, 'HOUSEHOLD'],
  ['mch-kroger', '2026-09-15', 61.18, 'GROCERY'],
  ['mch-el-rodeo', '2026-09-16', 29.15, 'RESTAURANT'],
  ['mch-exxon', '2026-09-17', 38.95, 'FUEL'],
];

/** Cash out at an ATM. Amounts vary, so this must NOT read as a fixed bill. */
const WITHDRAWAL_ROWS: readonly (readonly [string, number, string])[] = [
  ['2026-07-06', 100.0, 'ATM WITHDRAWAL - MEMBER ONE FCU'],
  ['2026-08-07', 60.0, 'ATM WITHDRAWAL - MEMBER ONE FCU'],
  ['2026-08-22', 210.0, 'CARILION URGENT CARE - VISIT, PATIENT RESPONSIBILITY'],
  ['2026-09-15', 340.0, 'CARILION ROANOKE MEMORIAL ED - PATIENT RESPONSIBILITY'],
  ['2026-09-08', 120.0, 'ATM WITHDRAWAL - MEMBER ONE FCU'],
];

/** Where the $180 savings balance came from. Excluded from "spending". */
const SAVINGS_TRANSFER_ROWS: readonly (readonly [string, number])[] = [
  ['2026-07-08', 60.0],
  ['2026-08-17', 60.0],
  ['2026-09-14', 60.0],
];

export const CHECKING_ID = 'acct-maria-checking';
export const SAVINGS_ID = 'acct-maria-savings';

function purchases(): NessiePurchase[] {
  const rows = [...RECURRING_ROWS, ...VARIABLE_ROWS].sort((a, b) => a[1].localeCompare(b[1]));
  return rows.map((r, i) => ({
    _id: `pur-${String(i + 1).padStart(3, '0')}`,
    merchant_id: r[0],
    payer_id: CHECKING_ID,
    purchase_date: r[1],
    amount: r[2],
    status: 'completed',
    medium: 'balance' as const,
    description: r[3],
  }));
}

/** Sum of everything that leaves checking, in cents. */
function netFlowCents(): number {
  const inflow = PAYROLL_DATES.length * PAYROLL_AMOUNT;
  const out =
    purchases().reduce((a, p) => a + dollars(p.amount), 0) +
    WITHDRAWAL_ROWS.reduce((a, w) => a + dollars(w[1]), 0) +
    SAVINGS_TRANSFER_ROWS.reduce((a, t) => a + dollars(t[1]), 0);
  return inflow - out;
}

/**
 * Derived, not asserted: whatever the opening balance must have been for the
 * ledger to close at $412.37. This is why the account page and the transaction
 * list can never disagree.
 */
export const OPENING_CHECKING = CLOSING_CHECKING - netFlowCents();

export function buildLedger(): LedgerSnapshot {
  return {
    customerId: MARIA.nessieCustomerId,
    checking: {
      _id: CHECKING_ID,
      type: 'Checking',
      nickname: 'Everyday Checking',
      rewards: 0,
      balance: CLOSING_CHECKING / 100,
      account_number: '1000000000004417',
      customer_id: MARIA.nessieCustomerId,
    },
    savings: {
      _id: SAVINGS_ID,
      type: 'Savings',
      nickname: 'Rainy Day',
      rewards: 0,
      balance: CLOSING_SAVINGS / 100,
      account_number: '1000000000009820',
      customer_id: MARIA.nessieCustomerId,
    },
    merchants: MERCHANTS,
    deposits: PAYROLL_DATES.map((d, i) => ({
      _id: `dep-${String(i + 1).padStart(3, '0')}`,
      type: 'deposit' as const,
      transaction_date: d,
      status: 'completed',
      payee_id: CHECKING_ID,
      medium: 'balance' as const,
      amount: PAYROLL_AMOUNT / 100,
      description: PAYROLL_SOURCE,
    })),
    withdrawals: WITHDRAWAL_ROWS.map((w, i) => ({
      _id: `wdl-${String(i + 1).padStart(3, '0')}`,
      type: 'withdrawal' as const,
      transaction_date: w[0],
      status: 'completed',
      payer_id: CHECKING_ID,
      medium: 'balance' as const,
      amount: w[1],
      description: w[2],
    })),
    purchases: purchases(),
    transfers: SAVINGS_TRANSFER_ROWS.map((t, i) => ({
      _id: `trf-${String(i + 1).padStart(3, '0')}`,
      type: 'transfer' as const,
      transaction_date: t[0],
      status: 'completed',
      medium: 'balance' as const,
      payer_id: CHECKING_ID,
      payee_id: SAVINGS_ID,
      amount: t[1],
      description: 'AUTOSAVE',
    })),
    bills: [],
  };
}
