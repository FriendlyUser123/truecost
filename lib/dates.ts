/**
 * All demo dates are anchored to a fixed "today" so the screen a judge sees at
 * 9:00 AM is the screen we rehearsed. Override with DEMO_TODAY=YYYY-MM-DD.
 */
export const DEMO_TODAY = process.env.DEMO_TODAY ?? '2026-09-19';

const MS_DAY = 86_400_000;

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  return toISO(new Date(parseISO(iso).getTime() + n * MS_DAY));
}

/** Add whole months, clamping to the target month's last day (Jan 31 + 1 month = Feb 28). */
export function addMonthsISO(iso: string, n: number): string {
  const d = parseISO(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / MS_DAY);
}

export function dayOfMonth(iso: string): number {
  return parseISO(iso).getUTCDate();
}

/** "Oct 2" */
export function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Oct 2, 2026" */
export function longDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Month labels for the 12-month strip, starting the month after today. */
export function monthLabels(from: string, count: number): string[] {
  const start = parseISO(from);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    out.push(d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
  }
  return out;
}

/**
 * The next monthly occurrence of `dayOfMonth` strictly after `from`, clamped
 * for short months (a bill due on the 31st lands on the 30th in November).
 *
 * ONE implementation on purpose. lib/ready/liquidity.ts projects obligations
 * forward to find the Ready Day and lib/ready/card.ts projects the same
 * obligations to draw the balance curve underneath it; when those two stepped
 * through the calendar with separate copies of this function, a drift in
 * either would have put a curve on screen that disagreed with the date
 * printed above it. Same month-step as lib/engine/capacity.ts.
 */
export function nextMonthlyOccurrence(from: string, dayOfMonth: number): string {
  const d = parseISO(from);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay))));
}

/** One projected deposit: the day it lands and what lands. */
export interface ProjectedPayday {
  on: string;
  amount: number;
  source: string;
}

/**
 * Every payday strictly after `today` and not after `until`.
 *
 * Also one implementation on purpose, and for a sharper reason: HARDENING 7d
 * is two surfaces disagreeing about when the next payday falls. Stepping from
 * the LAST observed payday by the measured median interval is the only rule
 * in this build, and both the classifier and the balance curve call it here.
 */
export function projectPaydays(
  income: { lastPayday: string; intervalDays: number; averageAmount: number; source: string } | null,
  today: string,
  until: string,
): ProjectedPayday[] {
  if (!income) return [];
  const step = Math.max(1, Math.round(income.intervalDays));
  const out: ProjectedPayday[] = [];
  let cursor = income.lastPayday;
  // 400 is far past any horizon this build scans; it exists so a degenerate
  // interval can never spin here.
  for (let i = 0; i < 400; i++) {
    cursor = addDays(cursor, step);
    if (cursor > until) break;
    if (cursor > today) out.push({ on: cursor, amount: income.averageAmount, source: income.source });
  }
  return out;
}

/** Median of a numeric list; 0 for an empty list. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid] as number;
  return ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Coefficient of variation, as a percentage. */
export function cvPct(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return (Math.sqrt(variance) / mean) * 100;
}
