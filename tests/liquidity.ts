/**
 * The Ready Day arithmetic, checked against hand calculations.
 *
 * Same rule as tests/run.ts: no test framework, and every expected value is
 * computed longhand in the comment above the assertion. The pitch is that a
 * judge cannot break the arithmetic, so the arithmetic is written out where
 * they can check it. If one of these fails, the demo is telling a patient the
 * wrong date and the whole thing collapses.
 *
 * Run directly with `npx tsx tests/liquidity.ts`, or let tests/run.ts call
 * `runLiquidityTests(eq, ok)` with its own counters.
 *
 * Every number below comes from the cohort fixtures at DEMO_TODAY=2026-09-19.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { DEMO_TODAY, addDays } from '../lib/dates';
import { readCapacity } from '../lib/engine/capacity';
import {
  COHORT_LEDGER_SPECS,
  PANEL_CANDIDATES,
  cohortLedger,
  openingChecking,
} from '../lib/fixtures/cohort';
import { dollars, fmt } from '../lib/money';
import { classifyLiquidity } from '../lib/ready/liquidity';
import type { LiquidityVerdict } from '../lib/ready/types';

/**
 * The shared harness signatures. Declared once here and imported by the other
 * two suites, so `npm test` cannot end up with three subtly different ideas
 * of what an assertion is.
 */
export type EqFn = (label: string, actual: unknown, expected: unknown) => void;
export type OkFn = (label: string, condition: boolean, detail?: string) => void;

/** Run one panel row end to end: raw ledger -> capacity -> liquidity verdict. */
function verdictFor(ref: string, overrides: { horizonDays?: number; clinicalWindowDays?: number } = {}): LiquidityVerdict {
  const candidate = PANEL_CANDIDATES.find((c) => c.ref === ref);
  if (!candidate) throw new Error(`no panel candidate ${ref}`);
  const ledger = cohortLedger(candidate.nessieCustomerId);
  const capacity = readCapacity(ledger, 'demo', DEMO_TODAY);
  return classifyLiquidity({
    copay: candidate.copay,
    writtenOn: candidate.writtenOn,
    capacity,
    ledger,
    clinicalWindowDays: overrides.clinicalWindowDays ?? candidate.clinicalWindowDays,
    ...(overrides.horizonDays === undefined ? {} : { horizonDays: overrides.horizonDays }),
  });
}

/**
 * The same row, with nothing changed but how much the payroll cadence is
 * trusted. The ledger, the balance, the obligations and the Ready Day are all
 * held fixed — this isolates the confidence band from the arithmetic under it.
 */
function verdictAtConfidence(ref: string, confidence: number): LiquidityVerdict {
  const candidate = PANEL_CANDIDATES.find((c) => c.ref === ref);
  if (!candidate) throw new Error(`no panel candidate ${ref}`);
  const ledger = cohortLedger(candidate.nessieCustomerId);
  const base = readCapacity(ledger, 'demo', DEMO_TODAY);
  if (!base.income) throw new Error(`${ref} has no detected payroll to re-score`);
  const capacity = { ...base, income: { ...base.income, confidence } };
  return classifyLiquidity({
    copay: candidate.copay,
    writtenOn: candidate.writtenOn,
    capacity,
    ledger,
    clinicalWindowDays: candidate.clinicalWindowDays,
  });
}

export function runLiquidityTests(eq: EqFn, ok: OkFn): void {
  /* ── 1. the essential floor, and why it is disjoint from the fixed bills ──
     Grant P. shops at Food Lion (groceries) and Exxon (fuel). Appalachian
     Power and Western Virginia Water are utilities — an essential category —
     but capacity.ts already mined both as fixed obligations, so counting them
     in the floor as well would subtract them twice from the surplus.
     Grocery + fuel by complete month:
       2026-06  472.00
       2026-07  420.00
       2026-08  416.00
     median of {416.00, 420.00, 472.00} = 420.00                             */

  const grant = verdictFor('rx-1050');

  eq('floor: Grant P. essential spend is the median month, not the mean', grant.essentialMonthly, dollars(420));
  ok(
    'floor: utilities already counted as fixed bills are excluded from it',
    grant.trace.some((t) => t.includes('avoid double-counting') && t.includes('Appalachian Power')),
    grant.trace.join('\n'),
  );

  /* income 1,120.00 every 14 days -> 1,120 x 365.25 / 14 / 12 = 2,435.00/mo
     fixed  1,050.00 rent + 96.00 water + 85.00 internet + 121.30 power
            = 1,352.30/mo
     surplus = 2,435.00 - 1,352.30 - 420.00 = 662.70                          */
  eq('surplus: income less fixed obligations less the floor', grant.surplusMonthly, dollars(662.7));

  /* ── 2. TIMING — the Ready Day is a real calendar date ───────────────────
     Grant's next payday is 2026-09-25 (last one 2026-09-11, 14-day cadence).
     dailyEssential = 42,000c / 30.4375 = 1,379.88c/day.
     projectedBalance(2026-09-25)
       = 312.40 + 1,120.00 payroll - 96.00 water (due the 24th)
         - round(13.7988 x 6) = 82.79 of essentials
       = 1,253.61
     bills in the following 7 days (to 2026-10-02): none — rent is the 5th.
     clearance = 1,253.61 - 0.00 - 150.00 buffer = 1,103.61 >= 210.00 copay    */

  eq('TIMING: Grant P. is classified TIMING', grant.class, 'TIMING');
  eq('TIMING: his Ready Day is the payday', grant.readyOn, '2026-09-25');
  eq('TIMING: six days out from 2026-09-19', grant.daysToReady, 6);
  eq('TIMING: cleared balance on the Ready Day', grant.clearedBalanceOnReadyDay, dollars(1103.61));
  ok(
    'TIMING: and the Ready Day is inside the fill window',
    grant.readyOn !== null && grant.readyOn <= addDays('2026-09-18', 30),
  );

  /* ── 3. displacement — the honest second-order cost ──────────────────────
     Pay the 210.00 copay today and walk forward 14 days. The first dated
     obligation is the water bill, 96.00 on 2026-09-24.
     On hand the morning it presents:
       312.40 - round(13.7988 x 5) = 312.40 - 68.99 = 243.41
       less the copay              = 243.41 - 210.00 = 33.41
     33.41 < 96.00, so the water bill is the displaced obligation.
       shortBy = 96.00 - 33.41 = 62.59
     Note what this is NOT: an overdraft fee. Nessie does not emit one.

     Two things make this a claim we are allowed to make at all:
       ATTRIBUTABLE  243.41 >= 96.00, so the bill cleared fine before the
                     copay. The whole 62.59 is caused by the fill, and
                     62.59 <= 210.00 follows automatically.
       ESSENTIAL     the water authority is a utility. A gym membership going
                     under would not have been reported.                      */

  eq('displacement: the named merchant', grant.displacement?.merchantName, 'Western Virginia Water Authority');
  eq('displacement: its due date', grant.displacement?.dueOn, '2026-09-24');
  eq('displacement: its amount', grant.displacement?.amount, dollars(96));
  eq('displacement: how far short it falls', grant.displacement?.shortBy, dollars(62.59));
  ok(
    'displacement: the shortfall is attributable — 62.59 <= the 210.00 copay',
    (grant.displacement?.shortBy ?? 0) <= grant.copay,
    `${fmt(grant.displacement?.shortBy ?? 0)} vs ${fmt(grant.copay)}`,
  );
  eq('displacement: and he is not already behind, so no second signal', grant.alreadyShort, null);

  /* ── 4. no displacement — the card must be able to say "nothing" ─────────
     Jalen F. is paid every Monday. His rent share is the 8th and his phone the
     19th, so between 2026-09-19 and 2026-10-03 nothing at all is due.
     dailyEssential = 25,900c / 30.4375 = 850.9c/day.
     projectedBalance(2026-09-21)
       = 88.31 + 385.00 payroll - round(8.509 x 2) = 17.02
       = 456.29
     clearance = 456.29 - 0.00 - 150.00 = 306.29 >= 12.00                      */

  const jalen = verdictFor('rx-1048');
  eq('no-displacement: Jalen F. is TIMING', jalen.class, 'TIMING');
  eq('no-displacement: his Ready Day is the Monday deposit', jalen.readyOn, '2026-09-21');
  eq('no-displacement: two days out', jalen.daysToReady, 2);
  eq('no-displacement: nothing is displaced by paying $12 today', jalen.displacement, null);
  ok(
    'no-displacement: and the trace says so in words, rather than going quiet',
    jalen.trace.some((t) => t.startsWith('No obligation displaced')),
    jalen.trace.join('\n'),
  );

  /* ── 5. STALE — affordable, after the window shuts ───────────────────────
     Priya S. is paid monthly on the 1st; the next deposit is 2026-10-02
     (last payday 2026-09-01, 31-day median interval). Her script was written
     2026-09-08 with a 14-day window, so the window closes 2026-09-22 — ten days
     before her money lands. She can afford insulin. She cannot afford it in
     time, and that is a different intervention.                              */

  const priya = verdictFor('rx-1043');
  eq('STALE: Priya S. is classified STALE', priya.class, 'STALE');
  eq('STALE: her Ready Day is the October deposit', priya.readyOn, '2026-10-02');
  eq('STALE: thirteen days out', priya.daysToReady, 13);
  ok(
    'STALE: the Ready Day genuinely falls after the window closes, 2026-09-08 + 14 = 2026-09-22',
    priya.readyOn !== null && priya.readyOn > addDays('2026-09-08', 14),
  );
  ok(
    'STALE: and the routing is a bridge, not a drug switch',
    priya.trace.some((t) => t.includes('Do not switch the drug')),
  );

  /* Priya is also the HARDENING 7b case. The first obligation in her 14-day
     walk is Planet Fitness Roanoke, 24.00 on 2026-09-20, and the engine used
     to report "fill your insulin and lose your gym membership" — which invites
     the reply *cancel the gym* and loses the argument. Fitness is deferrable,
     so it is skipped. The next obligation in the walk is Cardinal Ridge
     Apartments, 1,180.00 on 2026-10-03 — housing, eligible — and by hand:
       dailyEssential = 49,100c / 30.4375 = 1,613.14c/day
       on hand the morning of 2026-10-03, copay not yet paid
         = 128.60 + 2,380.00 payroll (2026-10-02) - 24.00 gym (09-20)
           - round(16.1314 x 14) = 225.84
         = 2,258.76
       2,258.76 - 145.00 copay = 2,113.76, which clears 1,180.00 with room.
     So nothing eligible is displaced, and the card has to say so.            */
  eq('7b: the gym membership is NOT reported as displaced', priya.displacement, null);
  eq('7b: and nothing else of hers is short either', priya.alreadyShort, null);
  ok(
    '7b: the trace names the gym and says why it was skipped',
    priya.trace.some((t) => t.includes('Planet Fitness Roanoke') && t.includes('deferrable')),
    priya.trace.join('\n'),
  );

  /* ── 6. the boundary where STALE becomes TIMING ──────────────────────────
     Deshawn A.'s Ready Day is 2026-09-25 whatever the clinical window is —
     liquidity does not know about clinical windows. His script was written
     2026-08-16, so:
       window 39 days -> closes 2026-09-24, Ready Day is 1 day late  -> STALE
       window 40 days -> closes 2026-09-25, Ready Day lands ON it    -> TIMING
     The comparison is strictly greater-than, so equality fills.              */

  const deshawn30 = verdictFor('rx-1052');
  const deshawn39 = verdictFor('rx-1052', { clinicalWindowDays: 39 });
  const deshawn40 = verdictFor('rx-1052', { clinicalWindowDays: 40 });

  eq('boundary: at the real 30-day window he is STALE', deshawn30.class, 'STALE');
  eq('boundary: one day short of the Ready Day, still STALE', deshawn39.class, 'STALE');
  eq('boundary: a window closing exactly ON the Ready Day flips to TIMING', deshawn40.class, 'TIMING');
  eq('boundary: and the Ready Day itself never moved', deshawn39.readyOn, deshawn40.readyOn);
  eq('boundary: which is 2026-09-25', deshawn40.readyOn, '2026-09-25');

  /* Deshawn is NOT a displacement. He is the HARDENING 7a case.

     THE OLD ASSERTION HERE WAS WRONG, and it was wrong in the code, not in the
     arithmetic — the two agreed with each other and both were making a false
     claim. It asserted `displacement.shortBy === 125.28` against a 118.00
     copay. A shortfall larger than the copay means the bill was going under
     with the prescription never filled, so "paying this pushes your power bill
     under the line" was simply untrue. The engine now refuses to say it.

     (The old comment also mis-stated the daily rate as 1,277.93c. It is
     38,900c / 30.4375 = 1,278.03c/day. The rounded two-day figure came out the
     same either way, which is exactly why nobody caught it.)

     By hand, the first obligation in the 14-day walk is Appalachian Power,
     129.00 on 2026-09-21 — utilities, so it IS eligible to be displaced.
     On hand the morning it presents, copay not yet paid:
       147.28 - round(12.7803 x 2) = 147.28 - 25.56 = 121.72
     121.72 < 129.00 already, so the bill fails on its own:
       alreadyShort = 129.00 - 121.72 = 7.28
     and the old, false displacement number is just that plus the copay:
       7.28 + 118.00 = 125.28. Same arithmetic, honest label.                  */
  eq('7a: the false displacement is gone', deshawn30.displacement, null);
  eq('7a: and is reported as an already-short obligation instead', deshawn30.alreadyShort?.merchantName, 'Appalachian Power');
  eq('7a: short by 7.28 WITHOUT the copay', deshawn30.alreadyShort?.shortBy, dollars(7.28));
  eq('7a: on the power bill itself', deshawn30.alreadyShort?.amount, dollars(129));
  eq('7a: due 2026-09-21', deshawn30.alreadyShort?.dueOn, '2026-09-21');
  ok(
    '7a: 7.28 + the 118.00 copay is exactly the 125.28 the old code claimed',
    (deshawn30.alreadyShort?.shortBy ?? 0) + deshawn30.copay === dollars(125.28),
  );
  ok(
    '7a: and the trace says the prescription is not the cause',
    deshawn30.trace.some((t) => t.startsWith('ALREADY SHORT') && t.includes('with or without the prescription')),
    deshawn30.trace.join('\n'),
  );

  /* ── 7. STRUCTURAL, test one: the surplus cannot carry the drug ──────────
     Curtis L. takes a specialty biologic at 1,240.00 every 30 days.
       income  1,240.00 x 365.25 / 14 / 12          = 2,695.89/mo
       fixed   1,205.00 + 197.01 + 68.00 + 148.00 + 89.00 = 1,707.01/mo
       floor   median{690.00, 569.00, 620.00}       =   620.00/mo
       surplus 2,695.89 - 1,707.01 - 620.00         =   368.88/mo
     368.88 < 1,240.00, so the classifier never reaches the calendar. No date
     exists this plan year and a reminder is the wrong artefact entirely.      */

  const curtis = verdictFor('rx-1044');
  eq('STRUCTURAL: Curtis L. is classified STRUCTURAL', curtis.class, 'STRUCTURAL');
  eq('STRUCTURAL: his floor is the median month', curtis.essentialMonthly, dollars(620));
  eq('STRUCTURAL: his monthly surplus', curtis.surplusMonthly, dollars(368.88));
  eq('STRUCTURAL: there is no Ready Day', curtis.readyOn, null);
  eq('STRUCTURAL: and therefore no day count', curtis.daysToReady, null);
  eq('STRUCTURAL: and no cleared balance to report', curtis.clearedBalanceOnReadyDay, null);
  ok(
    'STRUCTURAL: the surplus really is below the copay, 368.88 < 1,240.00',
    curtis.surplusMonthly < curtis.copay,
    `${fmt(curtis.surplusMonthly)} vs ${fmt(curtis.copay)}`,
  );
  ok(
    'STRUCTURAL: and the routing is assistance, explicitly not a reminder',
    curtis.trace.some((t) => t.includes('route to assistance, do not send a reminder')),
  );

  /* Marisol D. is the same class reached from the other direction: the drug is
     cheap and the household is not. Two children at 600.00 a fortnight is
     childcare, an essential category on a 14-day cadence, so it is a floor and
     not a bill.
       income  1,418.00 x 365.25 / 14 / 12    = 3,082.88/mo
       fixed   1,150.00 + 136.66 + 96.00      = 1,382.66/mo
       floor   median{1,754.00, 2,289.00, 1,696.00} = 1,754.00/mo
       surplus 3,082.88 - 1,382.66 - 1,754.00 =   -53.78/mo                    */

  const marisol = verdictFor('rx-1049');
  eq('STRUCTURAL: Marisol D.s surplus is negative', marisol.surplusMonthly, dollars(-53.78));
  eq('STRUCTURAL: childcare puts her floor above $1,700', marisol.essentialMonthly, dollars(1754));
  eq('STRUCTURAL: a $95 copay is structural for her', marisol.class, 'STRUCTURAL');

  /* ── 8. STRUCTURAL, test two: the surplus says yes, the calendar says no ──
     Darnell W. clears on 2026-09-25, six days out. Cut the horizon to three
     days and no date inside it clears, so the verdict falls through to the
     second STRUCTURAL branch — a different sentence, same routing. This is the
     branch that catches an obligation stack the monthly average cannot see.   */

  const darnellShort = verdictFor('rx-1042', { horizonDays: 3 });
  eq('horizon: a three-day scan finds no Ready Day', darnellShort.class, 'STRUCTURAL');
  eq('horizon: so there is no date to report', darnellShort.readyOn, null);
  ok(
    'horizon: and the trace names the exhausted scan rather than the surplus',
    darnellShort.trace.some((t) => t.includes('no day in the 3-day scan')),
    darnellShort.trace.join('\n'),
  );

  /* ── 9. TIMING again, with the full arithmetic spelled out ───────────────
     Darnell W. is paid on the 10th and the 25th, so 1,094.00 lands 2026-09-25.
       floor   median{495.00, 410.00, 457.00}   = 457.00/mo
       daily   45,700c / 30.4375                = 1,501.44c/day
       balance(2026-09-25)
         = 191.18 + 1,094.00 - 142.00 power (the 22nd)
           - round(15.0144 x 6) = 90.09
         = 1,053.09
       bills to 2026-10-02: none (rent moved to the 11th) -> clearance
         = 1,053.09 - 150.00 = 903.09 >= 62.00
     Displacement: power, 142.00 on the 22nd.
       191.18 - round(15.0144 x 3) = 45.04  ->  146.14
       146.14 - 62.00 copay = 84.14;  142.00 - 84.14 = 57.86                   */

  const darnell = verdictFor('rx-1042');
  eq('Darnell: floor', darnell.essentialMonthly, dollars(457));
  eq('Darnell: surplus 2,219.91 - 1,206.00 - 457.00', darnell.surplusMonthly, dollars(556.91));
  eq('Darnell: TIMING', darnell.class, 'TIMING');
  eq('Darnell: Ready Day', darnell.readyOn, '2026-09-25');
  eq('Darnell: cleared balance on it', darnell.clearedBalanceOnReadyDay, dollars(903.09));
  eq('Darnell: displaced obligation', darnell.displacement?.merchantName, 'Appalachian Power');
  eq('Darnell: short by', darnell.displacement?.shortBy, dollars(57.86));

  /* ── 10. ready today — zero days, and nothing displaced ──────────────────
     Hyun-ju K. has 612.90 in checking, an 18.00 inhaler, and nothing due
     before 2026-09-26 (her insurance falls on the 27th).
     clearance(today) = 612.90 - 0.00 - 150.00 = 462.90 >= 18.00                */

  const hyunju = verdictFor('rx-1051');
  eq('today: Hyun-ju K. clears on the spot', hyunju.readyOn, DEMO_TODAY);
  eq('today: zero days to ready', hyunju.daysToReady, 0);
  eq('today: cleared balance 612.90 - 150.00 buffer', hyunju.clearedBalanceOnReadyDay, dollars(462.9));
  eq('today: filling now displaces nothing, so displacement is null', hyunju.displacement, null);

  /* ── 11. the cohort itself ───────────────────────────────────────────────  */

  eq('cohort: twelve panel candidates', PANEL_CANDIDATES.length, 12);
  eq(
    'cohort: twelve distinct patients, not one patient twelve times',
    new Set(PANEL_CANDIDATES.map((c) => c.nessieCustomerId)).size,
    12,
  );

  const verdicts = PANEL_CANDIDATES.map((c) => verdictFor(c.ref));
  eq('cohort: all three classes appear on one board', new Set(verdicts.map((v) => v.class)).size, 3);
  eq('cohort: two STALE rows', verdicts.filter((v) => v.class === 'STALE').length, 2);
  eq('cohort: two STRUCTURAL rows', verdicts.filter((v) => v.class === 'STRUCTURAL').length, 2);
  eq('cohort: eight TIMING rows', verdicts.filter((v) => v.class === 'TIMING').length, 8);
  ok(
    'cohort: the Ready Days are spread, not stacked on one date',
    new Set(verdicts.map((v) => v.readyOn)).size >= 5,
    verdicts.map((v) => String(v.readyOn)).join(', '),
  );
  ok(
    'cohort: every verdict carries a trace a judge can recompute from',
    verdicts.every((v) => v.trace.length >= 8 && v.trace.every((t) => t.length > 20)),
  );
  ok(
    'cohort: every money field is integer cents, never a float dollar',
    verdicts.every(
      (v) =>
        Number.isInteger(v.copay) &&
        Number.isInteger(v.surplusMonthly) &&
        Number.isInteger(v.essentialMonthly) &&
        (v.displacement === null || Number.isInteger(v.displacement.shortBy)),
    ),
  );

  /* Every cohort window is net-flat: the derived opening balance sits within a
     few dollars of the closing balance on screen, which is the claim these
     ledgers actually make — paycheck to paycheck, neither accumulating nor
     collapsing. Marisol D. is the deliberate exception: a structural shortfall
     looks exactly like an account draining, and hers does (871.68 -> 173.05). */
  for (const [id, spec] of Object.entries(COHORT_LEDGER_SPECS)) {
    if (id === 'cust-marisol-d') continue;
    const drift = Math.abs(openingChecking(spec) - dollars(spec.checking));
    ok(
      `cohort: ${id} reconciles net-flat across the window`,
      drift <= dollars(10),
      `opening ${fmt(openingChecking(spec))} vs closing ${fmt(dollars(spec.checking))}`,
    );
  }

  ok(
    'cohort: Marisol D. is the one account that visibly drains, by design',
    openingChecking(COHORT_LEDGER_SPECS['cust-marisol-d']!) - dollars(173.05) > dollars(500),
  );

  /* ── 12. HARDENING 7a: a displacement is always ATTRIBUTABLE ─────────────
     Write the shortfall out and the guard stops looking like a clamp:

       shortBy = amount - (onHand - copay) = (amount - onHand) + copay

     so `shortBy > copay` is the same statement as `amount > onHand` — the
     obligation fails with the copay never paid at all. The invariant below is
     therefore not "we capped it", it is "we only report the part the fill
     actually caused". Checked over the whole cohort, not one hero row, because
     both 7a defects were found by running the cohort and not by a unit test. */

  for (const v of verdicts) {
    const d = v.displacement;
    if (d === null) continue;
    ok(
      `7a: ${d.merchantName} shortfall ${fmt(d.shortBy)} is attributable to the ${fmt(v.copay)} copay`,
      d.shortBy <= v.copay,
      `${fmt(d.shortBy)} > ${fmt(v.copay)} would mean the bill failed anyway`,
    );
    ok(
      `7a: ${d.merchantName} shortfall is a real shortfall, not zero`,
      d.shortBy > 0,
      fmt(d.shortBy),
    );
  }

  /* The two rows HARDENING 7a caught by name. rx-1045 Angela M. "displaced"
     Verizon by 92.06 on an 85.00 copay and rx-1052 Deshawn A. "displaced"
     Appalachian Power by 125.28 on a 118.00 copay. Neither claim is made now:
     Angela's was a telecom bill (7b as well as 7a) and Deshawn's is reported
     as already-short above. */
  const angela = verdictFor('rx-1045');
  eq('7a: Angela M. no longer displaces her phone bill', angela.displacement, null);
  ok(
    '7a: because telecom is not eligible in the first place',
    angela.trace.some((t) => t.includes('Verizon Wireless') && t.includes('deferrable')),
    angela.trace.join('\n'),
  );

  /* ── 13. HARDENING 7b: only non-deferrable obligations may be named ──────
     The taxonomy is the spending floor's, extended with housing and insurance
     — obligations capacity.ts already mines as fixed bills, which is exactly
     why they are not in the floor. Nothing in the cohort's deferrable set may
     ever appear as a displaced or already-short merchant, at any amount.     */

  const DEFERRABLE_MERCHANTS = [
    'Verizon Wireless',
    'Cox Communications',
    'Planet Fitness Roanoke',
    'Walmart Supercenter Roanoke',
    'Dollar General #8821',
  ];

  for (const name of DEFERRABLE_MERCHANTS) {
    ok(
      `7b: ${name} is never reported as displaced`,
      verdicts.every((v) => v.displacement?.merchantName !== name),
      verdicts.map((v) => String(v.displacement?.merchantName)).join(', '),
    );
    ok(
      `7b: ${name} is never reported as already short either`,
      verdicts.every((v) => v.alreadyShort?.merchantName !== name),
      verdicts.map((v) => String(v.alreadyShort?.merchantName)).join(', '),
    );
  }

  /* The positive half: every merchant we DO name has to be housing, a utility,
     water, insurance, childcare, groceries, fuel/transit or pharmacy. Listing
     the eligible names is stricter than re-running the classifier's own set
     against itself, which would pass no matter what the set contained.       */
  const ELIGIBLE_MERCHANTS = [
    'Cardinal Ridge Apartments',
    'Hollins Mill Rentals',
    'Freedom First Mortgage',
    'Appalachian Power',
    'Western Virginia Water Authority',
    'Progressive Insurance',
    'Kiddie Academy Roanoke',
  ];
  for (const v of verdicts) {
    for (const [label, m] of [['displaced', v.displacement], ['already short', v.alreadyShort]] as const) {
      if (m === null || m === undefined) continue;
      ok(
        `7b: the ${label} merchant ${m.merchantName} is one a household cannot defer`,
        ELIGIBLE_MERCHANTS.includes(m.merchantName),
        m.merchantName,
      );
    }
  }

  /* ── 14. HARDENING 7c: STRUCTURAL emits no displacement ──────────────────
     Displacement prices filling today against filling on the Ready Day. For
     STRUCTURAL there is no Ready Day, so there is no second branch and the
     comparison is empty. rx-1049 Marisol D. used to report one anyway.

     What survives for her is the copay-independent signal, and it is the more
     useful one for a PAP queue. By hand:
       dailyEssential = 175,400c / 30.4375 = 5,762.63c/day
       first ELIGIBLE obligation in the walk is Cardinal Ridge Apartments,
       1,150.00 on 2026-10-01 (the 96.00 Verizon bill on 09-20 is telecom)
       on hand the morning of 2026-10-01, copay not yet paid
         = 173.05 + 1,418.00 payroll (2026-09-25) - 96.00 phone (09-20)
           - round(57.6263 x 12) = 691.52
         = 803.53
       803.53 < 1,150.00, short by 346.47 — with her 95.00 copay never paid.
     Her rent fails by three and a half times the copay. That is not a
     prescription problem and Ready does not dress it up as one.              */

  for (const v of verdicts.filter((x) => x.class === 'STRUCTURAL')) {
    eq('7c: a STRUCTURAL row never reports a displacement', v.displacement, null);
    eq('7c: and never reports a Ready Day to displace anything against', v.readyOn, null);
  }
  /* Curtis L. is the cleanest 7c case precisely because 7a would NOT have
     caught him: his mortgage goes short by 1,194.54 against a 1,240.00 copay,
     so the shortfall is attributable and the merchant is housing. The claim
     passes every other gate and is still suppressed, because with no Ready Day
     there is nothing to compare "pay it today" against. */
  eq('7c: Curtis L. no longer displaces his mortgage', curtis.displacement, null);
  ok(
    '7c: and the trace says the counterfactual is missing, not that the number was bad',
    curtis.trace.some(
      (t) => t.startsWith('Displacement suppressed') && t.includes('Freedom First Mortgage') && t.includes('no Ready Day at all'),
    ),
    curtis.trace.join('\n'),
  );
  eq('7c: Marisol D. no longer displaces her phone bill', marisol.displacement, null);
  eq('7c: she is reported already short on rent instead', marisol.alreadyShort?.merchantName, 'Cardinal Ridge Apartments');
  eq('7c: by 346.47, with the copay never paid', marisol.alreadyShort?.shortBy, dollars(346.47));
  ok(
    '7c: which is 3.6x her 95.00 copay — not a prescription problem',
    (marisol.alreadyShort?.shortBy ?? 0) > marisol.copay * 3,
  );

  /* ── 15. HARDENING §3: the Ready Day is a window, not a promise ──────────
     detectIncome scores every cadence it locks as

       confidence = 1 - gapCv/100 - amountCv/200

     so (1 - confidence) x intervalDays is one standard deviation of the
     observed gap in days plus a half-weighted allowance for amount jitter.
     Round it UP to a whole day, add a 2-day floor (no backtest exists and
     five weeks of transactions cannot support a single certain date), cap at
     14 (past a fortnight a "window" is not a forecast), and never open the
     band backwards — a date printed three days early means the card declines
     at the counter.                                                          */

  for (const v of verdicts) {
    if (v.readyOn === null) {
      eq('window: no Ready Day means no window', v.readyWindow ?? null, null);
      continue;
    }
    const w = v.readyWindow;
    ok('window: every Ready Day carries one', w !== null && w !== undefined, String(v.readyOn));
    if (!w) continue;
    eq('window: the floor IS the Ready Day', w.earliest, v.readyOn);
    ok('window: and the band only ever opens forward', w.likely >= w.earliest, `${w.earliest}..${w.likely}`);
    ok('window: slack is a whole number of days, 0 to 14', Number.isInteger(w.slackDays) && w.slackDays >= 0 && w.slackDays <= 14, String(w.slackDays));
    eq('window: likely is earliest plus the slack', w.likely, addDays(w.earliest, w.slackDays));
  }

  /* Grant P.: confidence 1.000 on a 14-day cadence — his deposits have never
     moved a day, so (1 - 1.000) x 14 = 0.00, ceil 0, plus the 2-day floor.
       earliest 2026-09-25, likely 2026-09-25 + 2 = 2026-09-27               */
  eq('window: a perfect cadence still gets the two-day floor', grant.readyWindow?.slackDays, 2);
  eq('window: Grant P. earliest 2026-09-25', grant.readyWindow?.earliest, '2026-09-25');
  eq('window: likely through 2026-09-27', grant.readyWindow?.likely, '2026-09-27');

  /* Angela M.: confidence 0.838 on a 7-day cadence — the jitteriest payroll in
     the cohort, and the population the liquidity literature is actually about.
       (1 - 0.838) x 7 = 1.134 -> ceil 2, + 2 floor = 4
       earliest 2026-09-25, likely 2026-09-29                                 */
  eq('window: a jittery weekly cadence widens to four days', angela.readyWindow?.slackDays, 4);
  eq('window: Angela M. likely through 2026-09-29', angela.readyWindow?.likely, '2026-09-29');
  ok(
    'window: and the jittery payroll really does get the wider band',
    (angela.readyWindow?.slackDays ?? 0) > (grant.readyWindow?.slackDays ?? 0),
    `Angela ${angela.readyWindow?.slackDays} vs Grant ${grant.readyWindow?.slackDays}`,
  );

  /* Priya S.: confidence 0.985 on a 31-day cadence.
       (1 - 0.985) x 31 = 0.465 -> ceil 1, + 2 = 3
       earliest 2026-10-02, likely 2026-10-05                                 */
  eq('window: monthly payroll, three days of slack', priya.readyWindow?.slackDays, 3);
  eq('window: Priya S. likely through 2026-10-05', priya.readyWindow?.likely, '2026-10-05');

  /* Hyun-ju K. is ready TODAY. The money is on the account; there is nothing
     to forecast, so the window is a single day however jittery her payroll is
     (hers scores 0.970 and would otherwise have earned 3 days of slack).     */
  eq('window: ready today collapses the band to one day', hyunju.readyWindow?.slackDays, 0);
  eq('window: earliest and likely are the same date', hyunju.readyWindow?.likely, hyunju.readyWindow?.earliest);
  eq('window: which is today', hyunju.readyWindow?.earliest, DEMO_TODAY);
  ok(
    'window: and the card is told why, rather than silently printing one date',
    hyunju.trace.some((t) => t.startsWith('Ready Window') && t.includes('nothing to forecast')),
    hyunju.trace.join('\n'),
  );

  /* Confidence is the only input that moves the band. Hold Grant P.'s ledger
     exactly as it is and vary nothing but IncomeSignal.confidence — his Ready
     Day must not move a day, because the floor is arithmetic and the band is
     uncertainty about that arithmetic, not a second opinion on it.

       conf 1.00 -> 2 + ceil(0.00 x 14 =  0.00) =  2  -> 2026-09-27
       conf 0.90 -> 2 + ceil(0.10 x 14 =  1.40) =  4  -> 2026-09-29
       conf 0.50 -> 2 + ceil(0.50 x 14 =  7.00) =  9  -> 2026-10-04
       conf 0.20 -> 2 + ceil(0.80 x 14 = 11.20) = 14  -> 2026-10-09 (capped)
                    (2 + 12 = 14 exactly meets the cap; 0.10 would exceed it) */

  const band = (confidence: number): LiquidityVerdict => verdictAtConfidence('rx-1050', confidence);

  eq('window: confidence 1.00 -> 2 days', band(1).readyWindow?.slackDays, 2);
  eq('window: confidence 0.90 -> 4 days', band(0.9).readyWindow?.slackDays, 4);
  eq('window: confidence 0.50 -> 9 days', band(0.5).readyWindow?.slackDays, 9);
  eq('window: confidence 0.20 -> 14 days, the cap', band(0.2).readyWindow?.slackDays, 14);
  eq('window: confidence 0.10 stays at the cap', band(0.1).readyWindow?.slackDays, 14);

  eq('window: low confidence pushes "likely" out to 2026-10-04', band(0.5).readyWindow?.likely, '2026-10-04');
  eq('window: but the earliest date does not move', band(0.5).readyWindow?.earliest, '2026-09-25');
  eq('window: and neither does the Ready Day itself', band(0.5).readyOn, grant.readyOn);
  eq('window: nor the cleared balance behind it', band(0.5).clearedBalanceOnReadyDay, grant.clearedBalanceOnReadyDay);

  ok(
    'window: the band widens monotonically as confidence falls',
    [1, 0.9, 0.5, 0.2].every((c, i, xs) => {
      if (i === 0) return true;
      return (band(c).readyWindow?.slackDays ?? 0) >= (band(xs[i - 1] as number).readyWindow?.slackDays ?? 0);
    }),
  );

  ok(
    'window: and the trace states the derivation, not just the answer',
    grant.trace.some((t) => t.startsWith('Ready Window') && t.includes('Cadence confidence') && t.includes('event trigger')),
    grant.trace.join('\n'),
  );

  /* Integer-cents discipline extends to the new field. */
  ok(
    'cohort: alreadyShort is integer cents and strictly positive wherever it exists',
    verdicts.every((v) => {
      const a = v.alreadyShort;
      return a === null || a === undefined || (Number.isInteger(a.shortBy) && a.shortBy > 0);
    }),
  );
  ok(
    'cohort: no row reports a displacement and an already-short at once',
    verdicts.every((v) => !(v.displacement && v.alreadyShort)),
  );
}

/* ── standalone runner ───────────────────────────────────────────────────── */

function main(): void {
  let passed = 0;
  const failures: string[] = [];

  const eq: EqFn = (label, actual, expected) => {
    if (Object.is(actual, expected)) {
      passed++;
      return;
    }
    failures.push(`${label}\n    expected ${String(expected)}\n    actual   ${String(actual)}`);
  };

  const ok: OkFn = (label, condition, detail = '') => {
    if (condition) {
      passed++;
      return;
    }
    failures.push(`${label}${detail ? `\n    ${detail}` : ''}`);
  };

  runLiquidityTests(eq, ok);

  console.log(`\n  ${passed} liquidity assertions passed`);
  if (failures.length > 0) {
    console.error(`  ${failures.length} FAILED\n`);
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log('  Every Ready Day matches the hand calculation.\n');
}

const invoked = process.argv[1];
if (invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url)) main();
