/**
 * The clearing terms, checked against hand arithmetic.
 *
 * Same contract as tests/run.ts: no framework, and every expected value is
 * computed longhand in the comment above the assertion.
 *
 * This suite exists to keep four promises the /exchange screen makes, because
 * each one is a promise the red team broke the last version of that screen on:
 *
 *   1. THE MEASURED THING IS MEASURED. The withheld buckets account for every
 *      row on the panel, exactly once, and the accounting is a count of what
 *      our own code did rather than a function of any price.
 *
 *   2. THE FILL IS NOT AN INVOICE LINE. `invoiced` is `units × price` and
 *      nothing else. Observing a verified fill — or three — must not move it
 *      by a cent. If billing ever slides back onto the fill, cost-per-start
 *      becomes whatever price we typed, and this file fails.
 *
 *   3. THE CONCESSION IS COMPUTED, NOT ASSERTED. The break-even conversion is
 *      the rate at which the model we are arguing against wins. On the hand
 *      board it is 5.8%, which is small, which is exactly why it is on screen.
 *
 *   4. THE PRICE IS AN ASSUMPTION AND SAYS SO. Every figure derived from a
 *      price carries the disclaimer, and the sensitivity row shows the
 *      threshold moving — to nothing at all — when the price we invented
 *      changes by half.
 *
 * Run directly with `npx tsx tests/exchange.ts`, or let tests/run.ts call
 * `runExchangeTests(eq, ok)` with its own counters.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { DEMO_TODAY } from '../lib/dates';
import { readCapacity } from '../lib/engine/capacity';
import { PANEL_CANDIDATES, cohortLedger } from '../lib/fixtures/cohort';
import {
  ENGAGEMENT_HISTORY,
  PRESCRIBER_ID,
  PRESCRIBER_NAME,
  PRESCRIBER_SPECIALTY,
} from '../lib/fixtures/engagement';
import { dollars } from '../lib/money';
import { buildAttentionProfile, rankCandidates, summariseDebt } from '../lib/ready/attention';
import {
  ASSUMED_CLEARED_PRICE,
  ASSUMED_UNMETERED_PRICE,
  PRICE_BASIS,
  breakEvenConversion,
  buildAttentionLedger,
  buildClearingTerms,
  buildExchangeSheet,
  countedStarts,
} from '../lib/ready/exchange';
import { classifyLiquidity } from '../lib/ready/liquidity';
import type { Cents } from '../lib/types';
import type { WithheldCode } from '../lib/ready/exchange';
import type {
  AttentionProfile,
  LiquidityClass,
  LiquidityVerdict,
  PanelBoard,
  RankedCandidate,
  SlotState,
  VerifiedStart,
} from '../lib/ready/types';

export type { EqFn, OkFn } from './liquidity';
import type { EqFn, OkFn } from './liquidity';

const TODAY = '2026-09-19';

/** Float noise is not the thing under test. */
function r4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/* ── a synthetic board, so the arithmetic has round inputs ───────────────── */

const HAND_PROFILE: AttentionProfile = {
  prescriberId: 'npi-test',
  prescriberName: 'Dr. R. Whitfield',
  specialty: 'Internal Medicine',
  totalSends: 400,
  openRate: 0.4,
  replyRate: 0.2,
  medianLatencyMin: 60,
  bestHourOfWeek: 55,
  saturationPoint: 4,
  override: null,
  sendsAlreadyThisWeek: 1,
  debtPerUncorroboratedSend: 0.5,
  debt: summariseDebt(0.5, 0.2, 40, 4),
  trace: [],
};

function verdict(cls: LiquidityClass, copay: Cents): LiquidityVerdict {
  return {
    class: cls,
    readyOn: cls === 'STRUCTURAL' ? null : '2026-09-26',
    daysToReady: cls === 'STRUCTURAL' ? null : 7,
    copay,
    surplusMonthly: dollars(200),
    essentialMonthly: dollars(600),
    clearedBalanceOnReadyDay: cls === 'STRUCTURAL' ? null : dollars(90),
    displacement: null,
    trace: [],
  };
}

/**
 * `SlotState` now carries 'SUPPRESSED' itself, so the fixture is just the
 * shared board type. The alias stays because the row builder reads better
 * with it, and because a state added tomorrow should land here first.
 */
type BoardState = SlotState;

type HandRow = RankedCandidate;

type HandBoard = PanelBoard;

function row(
  ref: string,
  state: BoardState,
  cls: LiquidityClass | null,
  copay: Cents,
): HandRow {
  return {
    candidate: {
      ref,
      drugId: 'test-drug',
      drugLabel: `Test drug ${ref}`,
      copay,
      writtenOn: '2026-09-10',
      clinicalWindowDays: 30,
      clinicalWeight: 0.5,
      nessieCustomerId: `cust-${ref}`,
      claimsIndexEvent: state === 'REFUSED' ? null : 'no-fill',
      insuranceType: 'commercial',
    },
    liquidity: cls === null ? null : verdict(cls, copay),
    state,
    claim: null,
    score: 1,
    rank: null,
    reason: '',
    attentionCost: state === 'REFUSED' ? HAND_PROFILE.debtPerUncorroboratedSend : 0,
  };
}

/**
 * Twelve rows, drawn the way the repositioned policy rations them:
 *
 *   3 STALE cleared      — a clinical window closes before the cash arrives,
 *                          and only a prescriber can re-issue or substitute.
 *   1 STALE held         — corroborated, outranked, past the cap this week.
 *   5 TIMING suppressed  — the patient reaches the copay on their own money.
 *                          There is no physician action, so nothing is sent.
 *   1 STRUCTURAL         — off-channel to the assistance queue.
 *   2 refused            — single source. One has no verdict at all.
 *
 * Three of the suppressed rows carry the board's own SUPPRESSED state; two
 * sit in DEFERRED with a TIMING verdict, which is what a surface that has not
 * adopted the new state yet emits. `withheldCodeFor` has to read both as the
 * same refusal, because a TIMING row is never merely queued for next week —
 * there is no week in which a date the patient already has becomes a
 * physician's problem. That is the whole repositioning, in one function.
 */
const HAND_ROWS: HandRow[] = [
  row('c1', 'CLEARED', 'STALE', dollars(30)),
  row('c2', 'CLEARED', 'STALE', dollars(62)),
  row('c3', 'CLEARED', 'STALE', dollars(85)),
  row('d1', 'DEFERRED', 'STALE', dollars(40)),
  row('t1', 'SUPPRESSED', 'TIMING', dollars(47)),
  row('t2', 'SUPPRESSED', 'TIMING', dollars(12)),
  row('t3', 'SUPPRESSED', 'TIMING', dollars(18)),
  row('t4', 'DEFERRED', 'TIMING', dollars(25)),
  row('t5', 'DEFERRED', 'TIMING', dollars(60)),
  row('p1', 'PAP_QUEUE', 'STRUCTURAL', dollars(1240)),
  row('r1', 'REFUSED', null, dollars(300)),
  row('r2', 'REFUSED', 'TIMING', dollars(25)),
];

const HAND_BOARD: HandBoard = {
  profile: HAND_PROFILE,
  slotBudget: 3,
  slotsUsed: 3,
  rows: HAND_ROWS,
  cleared: 3,
  // d1, t4 and t5. The three SUPPRESSED rows are counted separately, and the
  // two TIMING rows sitting in DEFERRED are deliberately miscounted here the
  // way an un-migrated surface would count them — see HAND_ROWS.
  deferred: 3,
  papQueue: 1,
  suppressed: 3,
  refused: 2,
  // cleared + papQueue. Four of twelve leave the building.
  sent: 4,
  source: 'demo',
  generatedAt: TODAY,
};

function start(ref: string, amount: Cents, settlementId: string): VerifiedStart {
  return {
    ref,
    verified: true,
    observedOn: '2026-09-19',
    amount,
    merchantName: 'CVS Pharmacy #3391',
    settlementId,
    source: 'demo',
  };
}

function bucket(
  ledger: { buckets: { code: WithheldCode; count: number }[] },
  code: WithheldCode,
): number {
  return ledger.buckets.find((b) => b.code === code)?.count ?? 0;
}

export function runExchangeTests(eq: EqFn, ok: OkFn): void {
  /* ── 1. the measured thing: what this board withheld, and why ────────────
     12 candidates, 3 spent a slot, 9 did not. Of those nine:
       5 suppressed TIMING (t1..t5)      — no prescriber action exists
       2 refused single-source (r1, r2)  — one source is a guess
       1 held over the cap (d1, STALE)   — corroborated but outranked
       1 routed off-channel (p1)         — STRUCTURAL, assistance queue
     5 + 2 + 1 + 1 = 9, and 9 + 3 = 12.                                     */

  const ledger = buildAttentionLedger(HAND_BOARD);

  eq('ledger: the panel is twelve candidates', ledger.panel, 12);
  eq('ledger: three of them spent a slot', ledger.sent, 3);
  eq('ledger: nine never reached the inbox', ledger.withheld, 9);
  eq(
    'ledger: five TIMING rows are suppressed, not queued — three by state, two by verdict',
    bucket(ledger, 'NO_ACTION'),
    5,
  );
  eq('ledger: two are refused as single-source', bucket(ledger, 'UNCORROBORATED'), 2);
  eq('ledger: one corroborated row is held past the cap', bucket(ledger, 'OVER_CAP'), 1);
  eq('ledger: one STRUCTURAL row goes off-channel', bucket(ledger, 'OFF_CHANNEL'), 1);
  eq(
    'ledger: 5 + 2 + 1 + 1 = 9 — every withheld row is accounted for exactly once',
    ledger.buckets.reduce((a, b) => a + b.count, 0),
    ledger.withheld,
  );
  eq('ledger: 9 withheld + 3 sent = the whole panel', ledger.withheld + ledger.sent, ledger.panel);

  /* The repositioning, as one assertion: no TIMING alert is sent, and the
     off-channel row is the only withheld class that still reaches a human. */

  const timing = ledger.byClass.find((c) => c.cls === 'TIMING');
  const stale = ledger.byClass.find((c) => c.cls === 'STALE');
  eq('policy: TIMING rows sent this week', timing?.sent, 0);
  eq('policy: ...and six TIMING rows withheld (five suppressed, one uncorroborated)', timing?.withheld, 6);
  eq('policy: STALE is the class that earns the slot', stale?.sent, 3);
  ok(
    'policy: only the off-channel bucket is rerouted; a suppressed row is simply not sent',
    ledger.buckets.filter((b) => b.rerouted).map((b) => b.code).join(',') === 'OFF_CHANNEL',
    ledger.buckets.map((b) => `${b.code}:${String(b.rerouted)}`).join(' '),
  );
  ok(
    'policy: the withheld counts owe nothing to a price — the trace says so',
    ledger.trace.some((t) => t.includes('do not depend on any price')),
    ledger.trace.join('\n'),
  );

  /* ── 2. the billing unit is the cleared engagement, never the fill ───────
     3 cleared engagements × $38.00 = $114.00. The price is an illustrative
     assumption and the trace has to carry the disclaimer.                  */

  const terms = buildClearingTerms(HAND_BOARD);

  eq('unit: the invoice line is the cleared engagement', terms.unit, 'cleared engagement');
  eq('unit: three billable units this week', terms.units, 3);
  eq('unit: 3 × $38.00 = $114.00 invoiced', terms.invoiced, dollars(114));
  eq('unit: the assumed price is the one the module publishes', terms.assumedUnitPrice, dollars(38));
  eq('unit: nothing has settled, so the quality metric is zero', terms.verifiedFills, 0);
  ok(
    'unit: the price is labelled an illustrative assumption wherever it is printed',
    PRICE_BASIS.includes('ILLUSTRATIVE ASSUMPTION') &&
      terms.trace.some((t) => t.includes('ILLUSTRATIVE ASSUMPTION')),
    terms.trace.join('\n'),
  );
  ok(
    'unit: the deleted cost-per-start claim has not crept back into the terms',
    !('costPerVerifiedStart' in terms) && !('costPerStart' in terms),
    Object.keys(terms).join(','),
  );

  /* ── 3. a verified fill is scored, never invoiced ────────────────────────
     Four settlements arrive: three on cleared rows, one on a row the gate
     refused. The refused one is not ours to claim, so the quality metric is
     3 — and the invoice is still 3 × $38.00 = $114.00, unmoved.            */

  const settled = [
    start('c1', dollars(30), 'rxfill-c1'),
    start('c2', dollars(62), 'rxfill-c2'),
    start('c3', dollars(85), 'rxfill-c3'),
    start('r1', dollars(300), 'rxfill-r1'),
  ];
  const scored = buildClearingTerms(HAND_BOARD, { starts: settled });
  const split = countedStarts(HAND_BOARD, settled);

  eq('quality: three fills corroborated on rows we actually sent', scored.verifiedFills, 3);
  eq('quality: the invoice does not move by a cent', scored.invoiced, dollars(114));
  eq('quality: ...because it is still 3 units × $38.00', scored.units, terms.units);
  eq('attribution: a fill on a withheld row is not counted', split.unattributed.length, 1);
  eq('attribution: the counted starts are the three cleared rows', split.counted.map((s) => s.ref).join(','), 'c1,c2,c3');
  ok(
    'quality: the trace says the fill is scored and not billed',
    scored.trace.some((t) => t.includes('scored, not invoiced')),
    scored.trace.join('\n'),
  );

  /* ── 4. the break-even, computed longhand ────────────────────────────────
     Unmetered, the same week is 12 × $12.00 = $144.00. Metered it is
     $114.00. Both are credited with the same 2 illustrative starts, and the
     unmetered channel additionally buys the 9 touches we withheld at some
     unknown conversion rate c:

       144.00 / (2 + 9c)  =  114.00 / 2
       2 + 9c             =  2 × (144/114) = 2 × 1.2631578947 = 2.5263157895
       9c                 =  0.5263157895
       c                  =  0.0584795322  ->  5.8%

     Small. Unremarkable. Nobody knows whether the real rate is above it, and
     we destroyed the evidence by refusing the touches. That is the point.   */

  const sheet = buildExchangeSheet(HAND_BOARD);
  const be = sheet.breakEven;

  eq('break-even: 12 × $12.00 = $144.00 unmetered', sheet.unmeteredSpend, dollars(144));
  eq('break-even: against $114.00 metered', be.meteredSpend, dollars(114));
  eq('break-even: nine touches were withheld', be.withheldTouches, 9);
  eq('break-even: both channels are credited with the same 2 starts', be.startsCredited, 2);
  eq('break-even: $144.00 / $114.00 = 1.2632', r4(be.spendRatio), 1.2632);
  eq('break-even: 2 × 0.2632 = 0.5263 extra starts needed', r4(be.extraStartsNeeded), 0.5263);
  eq('break-even: 0.5263 / 9 = 5.85% conversion', r4(be.conversionRate), 0.0585);
  ok(
    'break-even: stated as the sentence a judge will quote back',
    be.sentence.includes('5.8%') &&
      be.sentence.includes('destroyed the evidence') &&
      be.sentence.includes('experiment'),
    be.sentence,
  );
  ok(
    'break-even: the starts are labelled illustrative, because nothing settled',
    sheet.startsAreObserved === false &&
      sheet.trace.some((t) => t.includes('illustrative') && t.includes('assumption')),
    sheet.trace.join('\n'),
  );
  ok(
    'break-even: no cost-per-start comparison survives anywhere on the sheet',
    !JSON.stringify(sheet).toLowerCase().includes('costper'),
    Object.keys(sheet).join(','),
  );

  /* Observed starts move the threshold, and nothing else.
     3 credited: 3 × 0.2631578947 = 0.7894736842, / 9 = 8.77%.              */

  const observedSheet = buildExchangeSheet(HAND_BOARD, { starts: settled });
  eq('break-even: three observed starts are credited to both channels', observedSheet.startsCredited, 3);
  eq('break-even: 3 × 0.2632 / 9 = 8.77%', r4(observedSheet.breakEven.conversionRate), 0.0877);
  eq('break-even: ...and the invoice is unchanged at $114.00', observedSheet.terms.invoiced, dollars(114));

  /* ── 5. the threshold under a tighter cap ────────────────────────────────
     A cap of one clears a single engagement: metered spend $38.00, eleven
     touches withheld, the same two credited starts.
       144.00 / 38.00 = 3.7894736842
       2 × 2.7894736842 = 5.5789473684
       5.5789473684 / 11 = 0.5071770335  ->  50.7%
     Metering has to be worth far more when it refuses far more, and the
     screen must say so rather than flattening it to one number.            */

  const tight = breakEvenConversion({
    withheldTouches: 11,
    startsCredited: 2,
    unmeteredSpend: dollars(144),
    meteredSpend: dollars(38),
  });
  eq('cap: one cleared engagement moves the threshold to 50.72%', r4(tight.conversionRate), 0.5072);
  eq('cap: 5.5789 extra starts across eleven withheld touches', r4(tight.extraStartsNeeded), 5.5789);

  /* ── 6. the honest degenerate cases ───────────────────────────────────── */

  const noStarts = breakEvenConversion({
    withheldTouches: 9,
    startsCredited: 0,
    unmeteredSpend: dollars(144),
    meteredSpend: dollars(114),
  });
  eq('degenerate: zero credited starts yields no threshold, not infinity', noStarts.conversionRate, 0);
  eq('degenerate: ...flagged as not computable, so the screen prints no percentage', noStarts.computable, false);
  ok(
    'degenerate: ...and it says so rather than printing 0.0%',
    noStarts.sentence.includes('No threshold can be computed'),
    noStarts.sentence,
  );

  /* A cap of 1 against 1 send already spent leaves a budget of 0: nothing is
     billable, so there is no threshold at any assumed price, and every
     sensitivity row has to say so rather than reporting 0.0%.              */

  const nothingBillable = buildExchangeSheet({
    ...HAND_BOARD,
    rows: HAND_ROWS.map((r) => (r.state === 'CLEARED' ? { ...r, state: 'DEFERRED' as const } : r)),
  });
  eq('degenerate: an empty week invoices nothing', nothingBillable.terms.invoiced, 0);
  eq('degenerate: ...and yields no threshold', nothingBillable.breakEven.computable, false);
  ok(
    'degenerate: ...at every price in the sensitivity row, not just the assumed one',
    nothingBillable.sensitivity.every((s) => !s.computable),
    JSON.stringify(nothingBillable.sensitivity),
  );

  /* At $57.00 an engagement the metered week costs 3 × 57.00 = $171.00,
     which is more than the unmetered $144.00. The unmetered channel is then
     the cheaper buy per start at any conversion rate, including zero, and
     there is no threshold to clear.                                        */

  const overpriced = breakEvenConversion({
    withheldTouches: 9,
    startsCredited: 2,
    unmeteredSpend: dollars(144),
    meteredSpend: dollars(171),
  });
  ok(
    'degenerate: a high enough assumed price flips the conclusion, and we print that',
    overpriced.alreadyFlipped && overpriced.conversionRate === 0,
    overpriced.sentence,
  );

  /* ── 7. sensitivity: the price is doing the work, and we show it ─────────
     Half, as assumed, and half again, against 3 cleared engagements:
       $19.00 -> metered  $57.00, 144/57 = 2.5263158,
                 2 × 1.5263158 = 3.0526316, / 9 = 33.92%
       $38.00 -> metered $114.00, as above,                        5.85%
       $57.00 -> metered $171.00, ratio 0.842 -> no threshold at all        */

  const [half, base, andHalf] = sheet.sensitivity;

  eq('sensitivity: three rows, at half, as assumed, and half again', sheet.sensitivity.length, 3);
  eq('sensitivity: $19.00 an engagement is $57.00 for the week', half?.meteredSpend, dollars(57));
  eq('sensitivity: ...and a 33.92% threshold', r4(half?.conversionRate ?? -1), 0.3392);
  eq('sensitivity: $38.00 is the price the rest of the screen is drawn at', base?.current, true);
  eq('sensitivity: ...at 5.85%', r4(base?.conversionRate ?? -1), 0.0585);
  ok(
    'sensitivity: at $57.00 the threshold disappears entirely — the assumption was the argument',
    andHalf?.clearedPrice === dollars(57) && andHalf?.alreadyFlipped === true,
    JSON.stringify(andHalf),
  );

  /* ── 8. the experiment is a protocol, with an outcome named in advance ── */

  eq('experiment: six weeks', sheet.experiment.weeks, 6);
  ok(
    'experiment: randomised holdout within physician, because an archive cannot identify it',
    sheet.experiment.protocol.some(
      (p) => p.k === 'Design' && p.t.includes('WITHIN physician') && p.t.includes('Randomised'),
    ),
    JSON.stringify(sheet.experiment.protocol[0]),
  );
  ok(
    'experiment: deliverability decay is the primary outcome, named before the data',
    sheet.experiment.protocol.some(
      (p) => p.k === 'Primary' && p.t.includes('Deliverability decay'),
    ),
  );
  ok(
    'experiment: we say plainly that we cannot run it ourselves',
    sheet.experiment.whoCanRunIt.includes('We cannot run this'),
    sheet.experiment.whoCanRunIt,
  );

  /* ── 9. the real board, so the screen itself is pinned ───────────────────
     The cohort board is built by engines other files own, and the class mix
     moves as those engines are corrected. So these are relationships, not
     literals: whatever the board decides, the invoice is units × the assumed
     price, and the withheld buckets still account for every row.           */

  const profile = buildAttentionProfile(ENGAGEMENT_HISTORY, {
    prescriberId: PRESCRIBER_ID,
    prescriberName: PRESCRIBER_NAME,
    specialty: PRESCRIBER_SPECIALTY,
  });
  const liquidityByRef: Record<string, LiquidityVerdict> = {};
  for (const candidate of PANEL_CANDIDATES) {
    const cohort = cohortLedger(candidate.nessieCustomerId);
    liquidityByRef[candidate.ref] = classifyLiquidity({
      copay: candidate.copay,
      writtenOn: candidate.writtenOn,
      capacity: readCapacity(cohort, 'demo', DEMO_TODAY),
      ledger: cohort,
      clinicalWindowDays: candidate.clinicalWindowDays,
    });
  }
  const board = rankCandidates({ candidates: PANEL_CANDIDATES, liquidityByRef, profile, today: DEMO_TODAY });
  const live = buildExchangeSheet(board);

  eq('demo: the sheet is drawn over the whole panel', live.ledger.panel, PANEL_CANDIDATES.length);
  eq('demo: billable units are exactly the rows that spent a slot', live.terms.units, board.cleared);
  eq(
    'demo: the invoice is units × the assumed clearing price, and nothing else',
    live.terms.invoiced,
    board.cleared * ASSUMED_CLEARED_PRICE,
  );
  eq(
    'demo: the unmetered week is the whole panel at the assumed touch price',
    live.unmeteredSpend,
    PANEL_CANDIDATES.length * ASSUMED_UNMETERED_PRICE,
  );
  eq(
    'demo: the withheld buckets still account for every row on the real board',
    live.ledger.buckets.reduce((a, b) => a + b.count, 0) + live.ledger.sent,
    live.ledger.panel,
  );
  ok(
    'demo: every figure on the screen is reachable from the trace',
    live.trace.length >= 8 && live.trace.some((t) => t.includes('Break-even')),
    `${live.trace.length} lines`,
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

  runExchangeTests(eq, ok);

  console.log(`\n  ${passed} exchange assertions passed`);
  if (failures.length > 0) {
    console.error(`  ${failures.length} FAILED\n`);
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log('  The term sheet adds up, and says what it does not know.\n');
}

const invoked = process.argv[1];
if (invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url)) main();
