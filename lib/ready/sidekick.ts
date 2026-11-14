/**
 * THE READY DAY TEST — the side kick's engine.
 *
 * The clinician-facing product reads a real bank ledger: every posted deposit,
 * every mined recurring obligation, a per-day balance projection. This file
 * runs the same classifier against three taps on a phone.
 *
 * It is deliberately a *worse* instrument, and it says so out loud. What it
 * keeps is the shape of the argument: a floor you do not spend below, a rate at
 * which money actually clears, a horizon, and a three-way verdict instead of
 * the single undifferentiated "patient declined" that everyone downstream gets
 * today. One number is assumed rather than observed — MONTHLY_CLEARING — and
 * every result prints that assumption next to the date it produced.
 *
 * Pure, deterministic, no clock: `DEMO_TODAY` is the only "now" in here, so the
 * same three taps produce the same date on a judge's laptop at 9 AM as they did
 * in rehearsal. Importable by tests; imported by a client component, so it must
 * stay free of anything Node-only.
 */

import { DEMO_TODAY, addDays, daysBetween, parseISO } from '../dates';
import { BUFFER_FLOOR } from '../engine/capacity';
import { dollars, fmt } from '../money';
import type { Cents } from '../types';
import type { LiquidityClass, PayCadence, SideKickInput, SideKickResult } from './types';

/* ── model parameters, all three visible on screen ───────────────────────── */

/**
 * How far forward we look for a date. Matches the clinician-side engine: past
 * 45 days a projection built from a payday rhythm is storytelling, not
 * arithmetic, and we would rather return STRUCTURAL than a date we invented.
 */
export const HORIZON_DAYS = 45;

/**
 * A prescription written today and not collected goes back on the pharmacy
 * shelf. The clinician-side rule is `readyOn > writtenOn + 30`; the side kick
 * has no writtenOn, so it assumes the script was written today.
 */
export const STALE_AFTER_DAYS = 30;

/**
 * THE ONE ASSUMED NUMBER. The real engine mines this from the patient's own
 * posted transactions — income less recurring obligations less the essential
 * floor. Three questions cannot produce it, so the test fixes it and prints it.
 * Never present this as an observation about the person taking the test.
 */
export const MONTHLY_CLEARING: Cents = dollars(250);

/* ── the three questions ─────────────────────────────────────────────────── */

export interface CadenceChoice {
  id: PayCadence;
  label: string;
  hint: string;
}

export const CADENCE_CHOICES: readonly CadenceChoice[] = [
  { id: 'weekly', label: 'Every week', hint: 'Fridays' },
  { id: 'biweekly', label: 'Every 2 weeks', hint: 'Alternate Fridays' },
  { id: 'semimonthly', label: '1st & 15th', hint: 'Twice a month' },
  { id: 'monthly', label: 'Once a month', hint: 'The 1st' },
];

export interface DrugChoice {
  id: string;
  label: string;
  copay: Cents;
  /** One neutral, checkable sentence. No adjectives about the person. */
  note: string;
}

/**
 * Five real counter prices spanning two orders of magnitude, which is the
 * whole point: the same three taps give you a date for one of these and no
 * date at all for another.
 */
export const DRUG_CHOICES: readonly DrugChoice[] = [
  { id: 'amoxicillin', label: 'Amoxicillin', copay: dollars(12), note: '10 days. An ear infection.' },
  { id: 'adderall', label: 'Adderall', copay: dollars(47), note: '30 days. Generic, with a plan.' },
  { id: 'insulin', label: 'Insulin', copay: dollars(98), note: 'One month. Capped at $35 only on Medicare.' },
  { id: 'ozempic', label: 'Ozempic', copay: dollars(968), note: 'One month. Cash price, no coupon.' },
  { id: 'wegovy', label: 'Wegovy', copay: dollars(1349), note: 'One month. Cash price, no coupon.' },
];

export const BALANCE_MIN: Cents = dollars(0);
export const BALANCE_MAX: Cents = dollars(2000);

/* ── calendar ────────────────────────────────────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Split out because the visitor counter renders "1,247th" — grouped, then suffixed. */
export function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** 1st, 2nd, 3rd. */
export function ordinal(n: number): string {
  return `${n}${ordinalSuffix(n)}`;
}

/** "October 3rd" — the headline format. Spelled out, because it gets shared. */
export function bigDate(iso: string): string {
  const d = parseISO(iso);
  return `${MONTHS[d.getUTCMonth()] ?? ''} ${ordinal(d.getUTCDate())}`;
}

/** Friday on or before `iso`. The anchor a two-week rhythm counts from. */
function lastFridayOnOrBefore(iso: string): string {
  const dow = parseISO(iso).getUTCDay();
  return addDays(iso, -((dow - 5 + 7) % 7));
}

function isPayday(cadence: PayCadence, iso: string, anchorFriday: string): boolean {
  const d = parseISO(iso);
  const dow = d.getUTCDay();
  const dom = d.getUTCDate();
  switch (cadence) {
    case 'weekly':
      return dow === 5;
    case 'biweekly':
      return dow === 5 && daysBetween(anchorFriday, iso) % 14 === 0;
    case 'semimonthly':
      return dom === 1 || dom === 15;
    case 'monthly':
      return dom === 1;
  }
}

/** Every payday strictly after `today`, inside the horizon. */
export function paydaysAhead(cadence: PayCadence, today: string, horizonDays: number): string[] {
  const anchor = lastFridayOnOrBefore(today);
  const out: string[] = [];
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(today, i);
    if (isPayday(cadence, d, anchor)) out.push(d);
  }
  return out;
}

/** MONTHLY_CLEARING spread over the rhythm the person actually gets paid on. */
export function clearingPerPaycheck(cadence: PayCadence): Cents {
  switch (cadence) {
    case 'weekly':
      return Math.round((MONTHLY_CLEARING * 12) / 52);
    case 'biweekly':
      return Math.round((MONTHLY_CLEARING * 12) / 26);
    case 'semimonthly':
      return Math.round(MONTHLY_CLEARING / 2);
    case 'monthly':
      return MONTHLY_CLEARING;
  }
}

export const CADENCE_PHRASE: Record<PayCadence, string> = {
  weekly: 'paid every week',
  biweekly: 'paid every two weeks',
  semimonthly: 'paid on the 1st and the 15th',
  monthly: 'paid once a month',
};

/* ── the classifier ──────────────────────────────────────────────────────── */

interface Run {
  result: SideKickResult;
  /** Plain sentences. A reader with a calculator can reproduce the date. */
  trace: string[];
}

function copy(
  cls: LiquidityClass,
  readyOn: string | null,
  days: number | null,
): Pick<SideKickResult, 'headline' | 'subhead' | 'footnote'> {
  if (cls === 'STRUCTURAL') {
    return {
      headline: 'No Ready Day exists.',
      subhead: 'STRUCTURAL — there is no day this year when this clears.',
      footnote: "That's not a you problem. That's a pricing problem.",
    };
  }
  const when = readyOn === null ? '' : bigDate(readyOn);
  if (cls === 'STALE') {
    return {
      headline: `Your Ready Day is ${when}.`,
      subhead: `STALE — ${days ?? 0} days out, and the pharmacy shelves the script before then.`,
      footnote: 'Your prescriber will be told you declined. You did not. You were four weeks out.',
    };
  }
  if (days === 0) {
    return {
      headline: 'Your Ready Day is today.',
      subhead: 'TIMING — you can fill this right now.',
      footnote: '1 in 4 new prescriptions in America are never picked up at all.',
    };
  }
  return {
    headline: `Your Ready Day is ${when}.`,
    subhead: `TIMING — you can fill this. Just not today. ${days ?? 0} days.`,
    footnote: 'The chart note for those days says "patient declined." It is the wrong note.',
  };
}

function run(input: SideKickInput): Run {
  const today = DEMO_TODAY;
  const { cadence, balance, copay, drugLabel } = input;
  const trace: string[] = [];
  const perCheck = clearingPerPaycheck(cadence);

  trace.push(
    `${drugLabel} is ${fmt(copay)} at the counter. You have ${fmt(balance)} in checking today, ${today}, and you are ${CADENCE_PHRASE[cadence]}.`,
  );
  trace.push(
    `Hold ${fmt(BUFFER_FLOOR)} back as a floor — an account at zero is its own emergency — so this copay may draw on ${fmt(balance)} − ${fmt(BUFFER_FLOOR)} = ${fmt(balance - BUFFER_FLOOR)}.`,
  );
  trace.push(
    `This test asked three questions, so it assumes ${fmt(MONTHLY_CLEARING)} a month clears after committed bills: ${fmt(perCheck)} per paycheck. The clinician-side engine measures this from real deposits instead of assuming it.`,
  );

  // The structural test is about recurrence, not about this one fill. A monthly
  // copay larger than everything that clears in a month never has a date: you
  // can scrape together September and still be short on October.
  if (copay > MONTHLY_CLEARING) {
    trace.push(
      `${fmt(copay)} every 30 days is more than the ${fmt(MONTHLY_CLEARING)} that clears in 30 days. Even a month that works is followed by one that does not, so no date holds.`,
    );
    return {
      result: { class: 'STRUCTURAL', readyOn: null, daysToReady: null, ...copy('STRUCTURAL', null, null) },
      trace,
    };
  }

  let spendable: Cents = balance - BUFFER_FLOOR;
  let readyOn: string | null = null;

  if (spendable >= copay) {
    readyOn = today;
    trace.push(`${fmt(spendable)} already covers ${fmt(copay)}. The Ready Day is today.`);
  } else {
    const paydays = paydaysAhead(cadence, today, HORIZON_DAYS);
    trace.push(
      `${fmt(spendable)} does not cover ${fmt(copay)} today, so we walk forward through your next ${paydays.length} payday(s) inside a ${HORIZON_DAYS}-day horizon.`,
    );
    for (const payday of paydays) {
      spendable += perCheck;
      if (spendable >= copay) {
        readyOn = payday;
        trace.push(
          `${payday}: spendable reaches ${fmt(spendable)}, which clears ${fmt(copay)}. That is the earliest date, so that is the Ready Day.`,
        );
        break;
      }
      trace.push(`${payday}: spendable reaches ${fmt(spendable)}. Still short of ${fmt(copay)}.`);
    }
  }

  if (readyOn === null) {
    trace.push(
      `No day inside ${HORIZON_DAYS} days clears ${fmt(copay)}. Past that the projection is a story, not arithmetic, so the honest answer is that no date exists.`,
    );
    return {
      result: { class: 'STRUCTURAL', readyOn: null, daysToReady: null, ...copy('STRUCTURAL', null, null) },
      trace,
    };
  }

  const days = daysBetween(today, readyOn);
  const cls: LiquidityClass = days > STALE_AFTER_DAYS ? 'STALE' : 'TIMING';
  trace.push(
    days > STALE_AFTER_DAYS
      ? `${days} days is past the ${STALE_AFTER_DAYS} a pharmacy holds an unclaimed script. You can afford it; you cannot afford it in time. STALE.`
      : `${days} days is inside the ${STALE_AFTER_DAYS} a pharmacy holds an unclaimed script. TIMING — the fill just needs scheduling, not substituting.`,
  );

  return {
    result: { class: cls, readyOn, daysToReady: days, ...copy(cls, readyOn, days) },
    trace,
  };
}

/* ── exports ─────────────────────────────────────────────────────────────── */

/** Pure. Same input, same date, forever. */
export function computeSideKick(input: SideKickInput): SideKickResult {
  return run(input).result;
}

/**
 * The same computation, as sentences. `SideKickResult` has no `trace` field —
 * the type contract is fixed — so the drawer under the date reads this.
 */
export function explainSideKick(input: SideKickInput): string[] {
  return run(input).trace;
}
