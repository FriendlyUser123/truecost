import { DEMO_TODAY, addDays, cvPct, dayOfMonth, daysBetween, median, parseISO, toISO } from '../dates';
import { dollars, fmt } from '../money';
import type { LedgerSnapshot } from '../nessie/types';
import type { CapacityResult, Cents, DataSource, IncomeSignal, RecurringObligation } from '../types';

/**
 * Turns raw Nessie transactions into a defensible statement about how much
 * money this person can actually commit, and when.
 *
 * Three rules, all stated out loud in the trace so a judge can audit them:
 *
 *   PAYROLL      >= 3 deposits from the same source whose gaps cluster tightly
 *                (interval CV < 15%). The median gap is the cadence, and
 *                future paydays are projected from the last one.
 *   FIXED BILL   >= 3 purchases at the same merchant, amount CV < 10%, median
 *                gap between 26 and 35 days. Groceries fail this on amount
 *                variance and fuel fails it on cadence, which is the point:
 *                "same merchant twice" is not a bill.
 *   SHOCK        a one-off outflow over $200 from a merchant seen fewer than
 *                twice. Excluded from the baseline spend rate, because an ER
 *                visit is not a monthly habit.
 */

export const BUFFER_FLOOR: Cents = dollars(150);
const SHOCK_THRESHOLD: Cents = dollars(200);
const AVG_DAYS_PER_MONTH = 30.4375;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function classifyCadence(days: number): IncomeSignal['cadence'] {
  if (days >= 6 && days <= 8) return 'weekly';
  if (days >= 13 && days <= 16) return 'biweekly';
  if (days >= 14.5 && days <= 16.5) return 'semimonthly';
  if (days >= 28 && days <= 32) return 'monthly';
  return 'irregular';
}

function detectIncome(ledger: LedgerSnapshot, today: string): { signal: IncomeSignal | null; trace: string[] } {
  const trace: string[] = [];
  const groups = new Map<string, { date: string; amount: number }[]>();
  for (const d of ledger.deposits) {
    const key = d.description.trim().toUpperCase();
    const g = groups.get(key) ?? [];
    g.push({ date: d.transaction_date, amount: d.amount });
    groups.set(key, g);
  }

  let best: IncomeSignal | null = null;
  for (const [source, rowsRaw] of groups) {
    const rows = [...rowsRaw].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 3) {
      trace.push(`Deposit source "${source}": only ${rows.length} observation(s) — not enough to call a cadence.`);
      continue;
    }
    const gaps: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      gaps.push(daysBetween(rows[i - 1]!.date, rows[i]!.date));
    }
    const intervalDays = median(gaps);
    const gapCv = cvPct(gaps);
    const amounts = rows.map((r) => Math.round(r.amount * 100));
    const avg = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    const cadence = classifyCadence(intervalDays);
    // Confidence falls off with both timing jitter and amount jitter.
    const confidence = Math.max(
      0,
      Math.min(1, 1 - gapCv / 100 - cvPct(amounts) / 200),
    );

    trace.push(
      `Deposit source "${source}": ${rows.length} deposits averaging ${fmt(avg)}, gaps ${gaps.join('/')} days -> median ${intervalDays} days (${cadence}), timing variance ${gapCv.toFixed(1)}%.`,
    );

    if (cadence === 'irregular' || gapCv > 15) continue;

    const last = rows[rows.length - 1]!.date;
    const nextPaydays: string[] = [];
    let cursor = last;
    while (nextPaydays.length < 6) {
      cursor = addDays(cursor, Math.round(intervalDays));
      if (cursor > today) nextPaydays.push(cursor);
    }

    const signal: IncomeSignal = {
      source,
      averageAmount: avg,
      intervalDays: Math.round(intervalDays),
      cadence,
      confidence: Number(confidence.toFixed(3)),
      observations: rows.length,
      lastPayday: last,
      nextPaydays,
    };
    if (!best || signal.averageAmount * signal.observations > best.averageAmount * best.observations) {
      best = signal;
    }
  }

  if (best) {
    trace.push(
      `Payroll locked: ${fmt(best.averageAmount)} every ${best.intervalDays} days (${best.cadence}), confidence ${(best.confidence * 100).toFixed(0)}%. Last payday ${best.lastPayday}, next ${best.nextPaydays[0]}.`,
    );
  } else {
    trace.push('No repeating deposit source met the payroll threshold.');
  }
  return { signal: best, trace };
}

interface Outflow {
  key: string;
  name: string;
  date: string;
  cents: Cents;
}

function nextDueFrom(lastSeen: string, dom: number, today: string): string {
  const base = parseISO(lastSeen);
  for (let add = 1; add <= 3; add++) {
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + add;
    const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const candidate = toISO(new Date(Date.UTC(y, m, Math.min(dom, lastDayOfMonth))));
    if (candidate > today) return candidate;
  }
  return addDays(today, 30);
}

function detectRecurring(
  outflows: Outflow[],
  today: string,
): { recurring: RecurringObligation[]; recurringKeys: Set<string>; trace: string[] } {
  const trace: string[] = [];
  const groups = new Map<string, Outflow[]>();
  for (const o of outflows) {
    const g = groups.get(o.key) ?? [];
    g.push(o);
    groups.set(o.key, g);
  }

  const recurring: RecurringObligation[] = [];
  const recurringKeys = new Set<string>();

  for (const [key, rowsRaw] of groups) {
    const rows = [...rowsRaw].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 3) continue;
    const amounts = rows.map((r) => r.cents);
    const amountCv = cvPct(amounts);
    const gaps: number[] = [];
    for (let i = 1; i < rows.length; i++) gaps.push(daysBetween(rows[i - 1]!.date, rows[i]!.date));
    const gap = median(gaps);
    const name = rows[0]!.name;

    if (amountCv >= 10) {
      trace.push(
        `${name}: ${rows.length} charges but amount variance ${amountCv.toFixed(1)}% >= 10% — variable spending, not a fixed bill.`,
      );
      continue;
    }
    if (gap < 26 || gap > 35) {
      trace.push(
        `${name}: ${rows.length} charges, stable amounts, but median gap ${gap} days is not monthly — variable spending, not a fixed bill.`,
      );
      continue;
    }

    const avg = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    const lastSeen = rows[rows.length - 1]!.date;
    const dom = Math.round(median(rows.map((r) => dayOfMonth(r.date))));
    const nextDue = nextDueFrom(lastSeen, dom, today);
    recurring.push({
      merchantName: name,
      merchantId: key,
      averageAmount: avg,
      occurrences: rows.length,
      amountVariancePct: Number(amountCv.toFixed(2)),
      dayOfMonth: dom,
      lastSeen,
      nextDue,
    });
    recurringKeys.add(key);
    trace.push(
      `${name}: FIXED OBLIGATION — ${rows.length} charges averaging ${fmt(avg)}, amount variance ${amountCv.toFixed(2)}%, median gap ${gap} days, due on the ${ordinal(dom)}. Next due ${nextDue}.`,
    );
  }

  recurring.sort((a, b) => b.averageAmount - a.averageAmount);
  return { recurring, recurringKeys, trace };
}

export function readCapacity(ledger: LedgerSnapshot, source: DataSource, today = DEMO_TODAY): CapacityResult {
  const trace: string[] = [];
  const merchantName = new Map(ledger.merchants.map((m) => [m._id, m.name]));

  const outflows: Outflow[] = [
    ...ledger.purchases.map((p) => ({
      key: p.merchant_id,
      name: merchantName.get(p.merchant_id) ?? p.merchant_id,
      date: p.purchase_date,
      cents: dollars(p.amount),
    })),
    ...ledger.withdrawals.map((w) => ({
      key: `wdl:${w.description.split(' - ')[0]!.trim()}`,
      name: w.description,
      date: w.transaction_date,
      cents: dollars(w.amount),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const dates = [
    ...outflows.map((o) => o.date),
    ...ledger.deposits.map((d) => d.transaction_date),
  ].sort();
  const windowStart = dates[0] ?? today;
  const windowDays = Math.max(1, daysBetween(windowStart, today));
  const windowMonths = windowDays / AVG_DAYS_PER_MONTH;
  trace.push(
    `Observation window ${windowStart} to ${today} — ${windowDays} days (${windowMonths.toFixed(2)} months), ${ledger.deposits.length} deposits and ${outflows.length} outflows.`,
  );

  const income = detectIncome(ledger, today);
  trace.push(...income.trace);

  const rec = detectRecurring(outflows, today);
  trace.push(...rec.trace);

  const recurringMonthly = rec.recurring.reduce((a, r) => a + r.averageAmount, 0);

  // Everything not a fixed bill: split baseline spend from one-off shocks.
  const keyCounts = new Map<string, number>();
  for (const o of outflows) keyCounts.set(o.key, (keyCounts.get(o.key) ?? 0) + 1);

  let baselineTotal = 0;
  let shockTotal = 0;
  const shocks: Outflow[] = [];
  for (const o of outflows) {
    if (rec.recurringKeys.has(o.key)) continue;
    if ((keyCounts.get(o.key) ?? 0) < 2 && o.cents > SHOCK_THRESHOLD) {
      shockTotal += o.cents;
      shocks.push(o);
      continue;
    }
    baselineTotal += o.cents;
  }
  for (const s of shocks) {
    trace.push(`One-off shock excluded from the baseline spend rate: ${s.name}, ${fmt(s.cents)} on ${s.date}.`);
  }

  const variableMonthly = Math.round(baselineTotal / windowMonths);
  const monthlyIncome = income.signal
    ? Math.round((income.signal.averageAmount * (365.25 / income.signal.intervalDays)) / 12)
    : 0;
  const discretionaryMonthly = monthlyIncome - recurringMonthly - variableMonthly;

  trace.push(
    `Income: ${fmt(monthlyIncome)}/month annualised from the detected cadence. Fixed obligations: ${fmt(recurringMonthly)}/month across ${rec.recurring.length} merchants. Baseline variable spend: ${fmt(variableMonthly)}/month (${fmt(shockTotal)} of one-off shocks excluded). Discretionary: ${fmt(discretionaryMonthly)}/month.`,
  );

  const nextPayday = income.signal?.nextPaydays[0] ?? addDays(today, 14);
  const dueBefore = rec.recurring.filter((r) => r.nextDue <= nextPayday);
  const obligationsBeforeNextPayday = dueBefore.reduce((a, r) => a + r.averageAmount, 0);

  const checkingBalance = dollars(ledger.checking.balance);
  const savingsBalance = dollars(ledger.savings.balance);
  const safeToPayToday = Math.max(0, checkingBalance - BUFFER_FLOOR - obligationsBeforeNextPayday);

  trace.push(
    `Safe-to-pay today = checking ${fmt(checkingBalance)} minus a ${fmt(BUFFER_FLOOR)} overdraft buffer minus ${fmt(obligationsBeforeNextPayday)} of bills landing before the next payday on ${nextPayday}${
      dueBefore.length ? ` (${dueBefore.map((d) => `${d.merchantName} ${fmt(d.averageAmount)} on ${d.nextDue}`).join('; ')})` : ''
    } = ${fmt(safeToPayToday)}.`,
  );

  return {
    checkingBalance,
    savingsBalance,
    liquidTotal: checkingBalance + savingsBalance,
    income: income.signal,
    monthlyIncome,
    recurring: rec.recurring,
    recurringMonthly,
    variableMonthly,
    discretionaryMonthly,
    safeToPayToday,
    obligationsBeforeNextPayday,
    bufferFloor: BUFFER_FLOOR,
    trace,
    source,
  };
}
