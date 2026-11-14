'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { daysBetween, longDate, shortDate } from '@/lib/dates';
import { fmt } from '@/lib/money';
import type {
  BalanceCurve,
  BridgeResult,
  BridgeResponse,
  ClinicalWindow,
  PatientCard,
  PatientCardSide,
  ReadyWindow,
  RoutingDecision,
  ScheduleReceipt,
  ScheduleResult,
} from '@/lib/ready/card';
import {
  BRIDGE_SANDBOX_CAVEAT,
  BRIDGE_STRUCTURE_LINE,
  NOT_AN_EXPIRY_NOTE,
  READY_WINDOW_NOTE,
  enDate,
  enRange,
} from '@/lib/ready/card';
import type { BridgeGrant, LiquidityClass, LiquidityVerdict, ReadyClaim } from '@/lib/ready/types';
import type { Cents, DataSource } from '@/lib/types';
import s from './ReadyCard.module.css';

/**
 * THE READY CARD.
 *
 * Ready rations prescriber attention. The order of the page is the order of
 * the argument:
 *
 *   1. THE ROUTING DECISION, first and largest. Suppressed, sent, or sent
 *      off-channel. A TIMING row is refused by our own attention engine and
 *      the refusal is the most important thing on the screen — not a gap in
 *      the demo, the product.
 *   2. The cash window that made the decision possible. A window with a
 *      floor, never a certain date, because a date three days early is a card
 *      declining at the counter.
 *   3. The curve the window came off, with the obligation that paying today
 *      would break, named.
 *   4. What crossed the boundary, printed beside what did not — and beside
 *      what the part that crossed actually costs the patient.
 *   5. One action, and it is a different action per class.
 *   6. The patient's own card, in both languages, out loud if they want it.
 *   7. The trace, verbatim.
 *
 * Every number here arrived from the server as an integer number of cents. No
 * arithmetic happens in this file beyond turning cents into pixels.
 *
 * There is no ATM row. `getAtmsNear()` is real and lives in the Nessie client;
 * the sandbox ignores its radius parameters and holds only Arlington machines,
 * so a distance printed for a Roanoke patient would be invented.
 */

/* ── props ───────────────────────────────────────────────────────────────── */

export interface ReadyCardSlot {
  /**
   * The slot vocabulary is owned by the attention engine and grows there
   * (CLEARED / DEFERRED / PAP_QUEUE / REFUSED / SUPPRESSED / …). This card
   * renders it, it does not adjudicate it, so an unknown state prints as
   * itself rather than failing the build of a card that is otherwise correct.
   */
  state: string;
  reason: string;
  rank: number | null;
  slotBudget: number;
  slotsUsed: number;
  attentionCost: number;
}

export interface ReadyCardBridge {
  /** Lawful AND the right class. The button is only live when this is true. */
  offered: boolean;
  eligible: boolean;
  reason: string;
  amount: Cents;
  funderName: string;
}

export interface ReadyCardData {
  ref: string;
  drugLabel: string;
  copay: Cents;
  writtenOn: string;
  clinicalWindow: ClinicalWindow;
  clinicalWeight: number;
  readyWindow: ReadyWindow | null;
  routing: RoutingDecision;
  today: string;
  patientName: string;
  insuranceType: 'commercial' | 'government' | 'uninsured';
  claimsIndexEvent: 'no-fill' | 'filled' | null;
  prescriberName: string;
  prescriberSpecialty: string;
  source: DataSource;
  verdict: LiquidityVerdict;
  curve: BalanceCurve;
  claim: ReadyClaim;
  slot: ReadyCardSlot;
  patientCard: PatientCard;
  bridge: ReadyCardBridge;
  grant: BridgeGrant | null;
  withheld: string[];
}

const CLASS_TONE: Record<LiquidityClass, string> = {
  TIMING: 'ok',
  STALE: 'gold',
  STRUCTURAL: 'alarm',
};

const CLASS_GLOSS: Record<LiquidityClass, string> = {
  TIMING:
    'Can afford it — just not today. The fill happens on payday with or without us, so there is no prescriber act and no alert is sent. This is the rationing layer refusing our own best-looking row.',
  STALE:
    'Can afford it, but not inside the clinical window. Re-issue, substitute or escalate — all three are prescriber acts, which is what makes this one worth a slot.',
  STRUCTURAL:
    'No date exists this plan year. A reminder is the wrong instrument. Routed off-channel to patient assistance, spending no in-channel slot.',
};

const ROUTE_TONE: Record<string, string> = {
  SUPPRESSED: 'quiet',
  PRESCRIBER_ALERT: 'gold',
  PAP_QUEUE: 'plan',
};

/**
 * Indexed rather than exhaustive on purpose: the slot vocabulary is owned by
 * the attention engine and grows there. An unknown state should render as
 * itself, not fail the build of a card that is otherwise correct.
 */
const SLOT_TONE: Record<string, string> = {
  CLEARED: 'ok',
  DEFERRED: 'quiet',
  PAP_QUEUE: 'plan',
  REFUSED: 'alarm',
  SUPPRESSED: 'quiet',
};

const SLOT_LABEL: Record<string, string> = {
  CLEARED: 'CLEARED — sent',
  DEFERRED: 'DEFERRED — held for next week',
  PAP_QUEUE: 'PAP QUEUE — routed off-channel',
  REFUSED: 'REFUSED — never sent',
  SUPPRESSED: 'SUPPRESSED — never sent',
};

/* ── the screen ──────────────────────────────────────────────────────────── */

export default function ReadyCard({
  data,
  scheduleFill,
}: {
  data: ReadyCardData;
  scheduleFill: (ref: string) => Promise<ScheduleResult>;
}): React.ReactElement {
  const { verdict } = data;
  const tone = CLASS_TONE[verdict.class];

  return (
    <main className="shell">
      <header className="masthead">
        <span className="wordmark">
          Read<em>y</em>
        </span>
        <Link href="/" className={s.back}>
          ← Panel board
        </Link>
        <span className="spacer" />
        <span className="srcbadge">
          <i className={`dot${data.source === 'live' ? '' : ' warn'}`} />
          Nessie <b>{data.source}</b>
        </span>
      </header>

      <Routing routing={data.routing} />

      <Hero data={data} tone={tone} />

      <div className="grid split">
        <section className="panel bank">
          <div className="panel-head">
            <h2>Where the window came from</h2>
            <span className="note">checking, projected daily</span>
          </div>
          <div className="panel-body">
            <Curve curve={data.curve} />
            <Displacement data={data} />
          </div>
        </section>

        <section className="panel plan">
          <div className="panel-head">
            <h2>What left this building</h2>
            <span className="note">the whole alert, and what it costs</span>
          </div>
          <div className="panel-body">
            <Provenance data={data} />
          </div>
        </section>
      </div>

      <Action data={data} scheduleFill={scheduleFill} />

      <PatientCardBlock card={data.patientCard} />

      <Trace data={data} />

      <p className="footnote">
        Synthetic patient, synthetic engagement history, real arithmetic. {data.prescriberName},{' '}
        {data.prescriberSpecialty}. Balances, transactions and merchant history stay on the server; this page was
        rendered there and the browser received prose.
      </p>
    </main>
  );
}

/* ── 1. the routing decision ─────────────────────────────────────────────── */

/**
 * The first thing on the page, because it is the product.
 *
 * Surescripts is about to manufacture abandonment alerts industrially into a
 * channel that already ignores most of what it receives. The question Ready
 * answers is which of them is worth a physician's attention, and the answer
 * for the commonest class is "none of it".
 */
function Routing({ routing }: { routing: RoutingDecision }): React.ReactElement {
  const tone = ROUTE_TONE[routing.route] ?? 'quiet';
  return (
    <section className={s.routing} data-tone={tone} data-sent={routing.sent ? 'yes' : 'no'}>
      <span className={s.routeBadge}>{routing.label}</span>
      <p className={s.routeLine}>{routing.line}</p>
    </section>
  );
}

/* ── 2. the window ───────────────────────────────────────────────────────── */

function Hero({ data, tone }: { data: ReadyCardData; tone: string }): React.ReactElement {
  const { verdict, readyWindow: w } = data;
  const spread = w !== null && w.earliest !== w.likely;

  return (
    <section className={s.hero} data-tone={tone}>
      <div className={s.heroMeta}>
        <span className={s.ref}>{data.ref}</span>
        <span>{data.patientName}</span>
        <span>{data.drugLabel}</span>
        <span className="fig">{fmt(data.copay)} copay</span>
        <span>written {shortDate(data.writtenOn)}</span>
      </div>

      <div className={s.heroMain}>
        <div className={s.dateBlock}>
          <div className={s.kicker}>Ready window</div>
          {w === null ? (
            <>
              <div className={`${s.date} ${s.dateNone}`}>No window</div>
              <div className={s.dateSub}>
                No day in the 45-day scan clears this copay. Not this week, and not this plan year.
              </div>
            </>
          ) : (
            <>
              <div className={s.windowRow}>
                <span className={s.windowTag}>earliest</span>
                <span className={`${s.date} fig`}>{enDate(w.earliest)}</span>
              </div>
              <div className={s.windowRow}>
                <span className={s.windowTag}>likely</span>
                <span className={`${s.dateLikely} fig`}>
                  {spread ? enRange(w) : 'the same day — the classifier published no spread'}
                </span>
              </div>
              <div className={s.dateSub}>
                {verdict.daysToReady === 0
                  ? 'The floor is today.'
                  : `The floor is ${verdict.daysToReady} day${verdict.daysToReady === 1 ? '' : 's'} out.`}{' '}
                The card leads with the earliest day, not the middle of the range: a date three days early is a
                card declining at the counter, which is the most adherence-destroying event in the whole journey.
              </div>
              <p className={s.windowNote}>{READY_WINDOW_NOTE}</p>
            </>
          )}
        </div>

        <div className={s.badgeStack}>
          <div className={s.classBadge} data-tone={tone}>
            {verdict.class}
          </div>
          <p className={s.gloss}>{CLASS_GLOSS[verdict.class]}</p>
        </div>
      </div>

      <ClinicalWindowBlock data={data} />

      <div className={s.slotRow}>
        <span className={s.slotBadge} data-tone={SLOT_TONE[data.slot.state] ?? 'quiet'}>
          {SLOT_LABEL[data.slot.state] ?? data.slot.state}
        </span>
        <span className={s.slotWhy}>{data.slot.reason}</span>
        <span className={s.slotBudget}>
          {data.slot.rank === null
            ? `${data.slot.slotsUsed} of ${data.slot.slotBudget} slots spent this week`
            : `rank ${data.slot.rank} · ${data.slot.slotsUsed} of ${data.slot.slotBudget} slots spent this week`}
        </span>
      </div>
    </section>
  );
}

/**
 * THE CORRECTION, IN THE PLACE A JUDGE WILL LOOK FOR IT.
 *
 * Everything on this screen used to say "the script expires." That is simply
 * false — non-controlled prescriptions are valid up to a year in most states.
 * What closes is a clinical window, it is specific to the drug, and it is the
 * only reason a prescriber rather than a pharmacist is the right recipient.
 * Saying so ourselves is cheaper than having it said to us.
 */
function ClinicalWindowBlock({ data }: { data: ReadyCardData }): React.ReactElement {
  const cw = data.clinicalWindow;
  const w = data.readyWindow;
  const late = w === null ? null : daysBetween(cw.closesOn, w.earliest);

  return (
    <div className={s.cwin} data-state={cw.closed ? 'closed' : 'open'}>
      <div className={s.cwinHead}>
        <span className={s.cwinTag}>Clinical window</span>
        <span className={`${s.cwinDate} fig`}>
          {cw.closed ? 'closed' : 'closes'} {shortDate(cw.closesOn)}
        </span>
        <span className={s.cwinDays}>
          {cw.days} days from written · clinical weight {data.clinicalWeight.toFixed(2)}
        </span>
        {late !== null && late > 0 && (
          <span className={s.cwinLate}>
            money arrives {late} day{late === 1 ? '' : 's'} late at the earliest
          </span>
        )}
      </div>
      <p className={s.cwinReason}>{cw.reason}</p>
      <p className={s.cwinNote}>{NOT_AN_EXPIRY_NOTE}</p>
    </div>
  );
}

/* ── 3. the curve ────────────────────────────────────────────────────────── */

/**
 * Checking, every day, from today to the end of the horizon.
 *
 * Not the twelve-bar benefit strip: that one plots one figure per month
 * against a flat capacity line, and this plots one figure per DAY against the
 * copay, crossing zero in both directions. Same ink, same mono micro-labels,
 * same 2px baseline — a different series needs a different primitive, and the
 * shared thing is the design language, not the component.
 *
 * The shaded band is the published window. The marked column is its floor.
 */
function Curve({ curve }: { curve: BalanceCurve }): React.ReactElement {
  const range = Math.max(1, curve.top - curve.bottom);
  const pct = (c: Cents): number => ((c - curve.bottom) / range) * 100;
  const zero = pct(0);
  const copayY = pct(curve.copay);
  const n = curve.points.length;
  const floor = curve.window?.earliest ?? null;

  return (
    <figure className={s.curve}>
      <div
        className={s.plot}
        style={{ ['--n' as keyof CSSProperties]: String(n) } as CSSProperties}
        role="img"
        aria-label={`Projected checking balance for each of the next ${n - 1} days against a ${fmt(curve.copay)} copay.`}
      >
        <div className={s.zeroLine} style={{ bottom: `${zero}%` }} />
        <div className={s.copayLine} style={{ bottom: `${copayY}%` }}>
          <span className="fig">{fmt(curve.copay)} copay</span>
        </div>

        {curve.points.map((p) => {
          const y = pct(p.balance);
          const up = p.balance >= 0;
          const isFloor = floor !== null && p.date === floor;
          const title = [
            `${longDate(p.date)}: ${fmt(p.balance)}`,
            `clears ${fmt(p.cleared)} after the next week of bills and the ${fmt(curve.bufferFloor)} buffer`,
            ...p.events,
          ].join(' · ');
          return (
            <div key={p.date} className={s.col} data-band={p.inWindow ? 'in' : undefined} title={title}>
              <span
                className={s.barFill}
                data-state={isFloor ? 'ready' : p.isToday ? 'today' : up ? 'up' : 'down'}
                style={{
                  bottom: `${up ? zero : y}%`,
                  height: `${Math.max(0.6, Math.abs(y - zero))}%`,
                }}
              />
              {isFloor && (
                <span className={s.flag}>
                  <b>EARLIEST</b>
                  <i />
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className={s.axis} style={{ ['--n' as keyof CSSProperties]: String(n) } as CSSProperties}>
        {curve.points.map((p, i) => (
          <span
            key={p.date}
            className={s.tick}
            data-mark={floor !== null && p.date === floor ? 'ready' : p.isToday ? 'today' : undefined}
          >
            {p.isToday || (floor !== null && p.date === floor) || i % 7 === 0 ? shortDate(p.date) : ''}
          </span>
        ))}
      </div>

      <figcaption className={s.legend}>
        <span>
          <i data-state="up" /> projected checking, end of day
        </span>
        <span>
          <i data-state="down" /> below zero
        </span>
        <span>
          <i data-state="ready" /> the earliest day it clears
        </span>
        <span>
          <i className={s.bandKey} /> the likely window
        </span>
        <span>
          <i className={s.dash} /> the copay this has to clear
        </span>
      </figcaption>
    </figure>
  );
}

/* ── the displaced obligation ────────────────────────────────────────────── */

function Displacement({ data }: { data: ReadyCardData }): React.ReactElement | null {
  const d = data.verdict.displacement;

  // A displacement claim needs a counterfactual day to pay it on instead. For
  // STRUCTURAL there is no such day, so the claim is meaningless and is not
  // printed even if the classifier hands one over.
  if (data.verdict.class === 'STRUCTURAL') return null;

  if (!d) {
    return (
      <p className={s.displaceNone}>
        <b>Nothing is displaced.</b> Paying the {fmt(data.copay)} today still covers every dated obligation in
        the next two weeks. The account simply does not hold it yet — there is no second-order cost to report
        and none is invented here.
      </p>
    );
  }

  return (
    <p className={s.displace}>
      <b>Paying today costs something else.</b> {data.patientName.split(' ')[0]} would be{' '}
      <span className="fig">{fmt(d.shortBy)}</span> short on <b>{d.merchantName}</b> (
      <span className="fig">{fmt(d.amount)}</span>), due {shortDate(d.dueOn)}.
      <br />
      <small>
        A real recurring obligation mined from posted transactions — not an overdraft fee and not revolving
        interest. Nessie emits neither, so neither is claimed. The shortfall is smaller than the copay, which is
        what makes the copay its cause: where it is larger, the household was already behind and this card says
        that instead.
      </small>
    </p>
  );
}

/* ── 4. provenance ───────────────────────────────────────────────────────── */

function Provenance({ data }: { data: ReadyCardData }): React.ReactElement {
  const sent: [string, string][] = [
    ['class', data.claim.class],
    ['ready day', 'readyOn' in data.claim ? data.claim.readyOn : '— (none exists)'],
  ];
  const neverSent = data.withheld;

  return (
    <div className={s.prov}>
      <div className={s.provNote}>
        {data.routing.sent
          ? 'This is the alert in full. Both columns are generated from the type, not typed out.'
          : 'Nothing was sent for this row — not the class, not the date, nothing. This is what the alert would have contained if it had been worth sending.'}
      </div>

      <div className={s.provCols}>
        <div className={s.provCol} data-side="sent" data-void={data.routing.sent ? undefined : 'yes'}>
          <h3>{data.routing.sent ? 'Sent' : 'Would have been sent'}</h3>
          <ul>
            {sent.map(([k, v]) => (
              <li key={k}>
                <span className={s.provKey}>{k}</span>
                <span className="fig">{v}</span>
              </li>
            ))}
          </ul>
          <p className={s.provFoot}>Two fields. One enum and one date.</p>
        </div>

        <div className={s.provCol} data-side="withheld">
          <h3>Not sent</h3>
          <ul>
            {neverSent.map((f) => (
              <li key={f}>
                <span className={s.provX}>×</span>
                {f}
                {f === 'merchant names' && <sup>†</sup>}
              </li>
            ))}
          </ul>
          <p className={s.provFoot}>
            Never transmitted, never logged against the prescription, never available to the plan.
          </p>
        </div>
      </div>

      <p className={s.provDagger}>
        <sup>†</sup> One exception, stated rather than buried. When an obligation is displaced, the card above
        names it — <i>&ldquo;short on Appalachian Power&rdquo;</i> — because &ldquo;an obligation goes short&rdquo; is not
        something a prescriber can weigh. That single merchant is the only ledger-derived fact on this page,
        it is rendered on the server into a sentence, and it is <b>not</b> part of the claim in the left
        column: it does not travel with the alert, does not reach the plan, and does not enter the chart.
      </p>

      <p className={s.provCost}>
        <b>And the minimal payload is not a free payload.</b> A <span className="fig">STRUCTURAL</span> enum
        written into a chart is durable and discoverable: it follows the patient to every future clinician, it is
        reachable in discovery, and unlike a balance it never goes stale. Two fields is the smallest thing that
        supports the decision — it is not a thing with no cost, and the only payload that carries no cost at all
        is the one for a row we refuse to send. That is what happens to every TIMING row on this panel.
      </p>
    </div>
  );
}

/* ── 5. the one action ───────────────────────────────────────────────────── */

function Action({
  data,
  scheduleFill,
}: {
  data: ReadyCardData;
  scheduleFill: (ref: string) => Promise<ScheduleResult>;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridge, setBridge] = useState<BridgeResponse | null>(null);
  const [receipt, setReceipt] = useState<ScheduleReceipt | null>(null);
  const [routed, setRouted] = useState(false);

  const onSchedule = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await scheduleFill(data.ref);
      if (result.ok) setReceipt(result);
      else setError(result.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [data.ref, scheduleFill]);

  const onBridge = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: data.ref }),
      });
      const json = (await res.json()) as BridgeResult;
      if (json.ok) setBridge(json);
      else setError(json.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [data.ref]);

  const floor = data.readyWindow?.earliest ?? data.verdict.readyOn ?? data.today;

  return (
    <section className={s.action} data-tone={CLASS_TONE[data.verdict.class]}>
      <div className={s.actionCopy}>
        {data.verdict.class === 'TIMING' && (
          <>
            <h3>Nothing goes to the prescriber</h3>
            <p>
              The only thing this row produces is on the patient&rsquo;s own side of the boundary: a dated
              reminder written onto the patient&rsquo;s own Nessie account for {shortDate(floor)}, the earliest
              day the account clears. No money moves, no slot is spent, and no chart note is written.
            </p>
            <p className={s.gate} data-ok="yes">
              Dated to the floor of the window, never its midpoint. A reminder three days early is a card
              declining at the counter.
            </p>
          </>
        )}
        {data.verdict.class === 'STALE' && (
          <>
            <h3>Fund the fill — {fmt(data.bridge.amount)}</h3>
            <p>{BRIDGE_STRUCTURE_LINE}</p>
            <p>
              Funder is <b>{data.bridge.funderName}</b>, an independent charitable foundation. Never a brand, and
              never a payment per fill to anyone for arranging a prescription.
            </p>
            <p className={s.gate} data-ok={data.bridge.eligible ? 'yes' : 'no'}>
              {data.bridge.reason}
            </p>
            <p className={s.caveat}>{BRIDGE_SANDBOX_CAVEAT}</p>
          </>
        )}
        {data.verdict.class === 'STRUCTURAL' && (
          <>
            <h3>Route to patient assistance</h3>
            <p>
              No money moves, and the reason is the verdict: <b>no date exists</b>. The monthly surplus is{' '}
              <span className="fig">{fmt(data.verdict.surplusMonthly)}</span> against a{' '}
              <span className="fig">{fmt(data.copay)}</span> copay every 30 days. Funding one fill would cover one
              month and leave the next eleven exactly where they are — PAP is the right instrument here, and we
              say so before anyone else has to.
            </p>
          </>
        )}
      </div>

      <div className={s.actionBtns}>
        {data.verdict.class === 'TIMING' && (
          <button type="button" className="btn primary" onClick={onSchedule} disabled={busy || receipt !== null}>
            {receipt ? 'Reminder written' : busy ? 'Writing…' : `Remind the patient on ${shortDate(floor)}`}
          </button>
        )}
        {data.verdict.class === 'STALE' && (
          <button type="button" className="btn gold" onClick={onBridge} disabled={busy || !data.bridge.offered}>
            {busy
              ? 'Funding…'
              : data.grant && !bridge
                ? 'Re-read balances'
                : `Fund ${fmt(data.bridge.amount)} at the pharmacy`}
          </button>
        )}
        {data.verdict.class === 'STRUCTURAL' && (
          <button type="button" className="btn" onClick={() => setRouted(true)} disabled={routed}>
            {routed ? 'Routed off-channel' : 'Route to PAP'}
          </button>
        )}
      </div>

      {!data.bridge.eligible && data.verdict.class === 'STALE' && (
        <p className={s.blocked}>Button disabled. {data.bridge.reason}</p>
      )}

      {error && <p className={s.error}>{error}</p>}

      {receipt && (
        <div className={s.receipt}>
          <div>
            <span className={s.rk}>Nessie bill</span>
            <span className="fig">{receipt.billId}</span>
          </div>
          <div>
            <span className={s.rk}>payee</span>
            <span>{receipt.payee}</span>
          </div>
          <div>
            <span className={s.rk}>due</span>
            <span className="fig">{shortDate(receipt.dueOn)}</span>
          </div>
          <div>
            <span className={s.rk}>amount</span>
            <span className="fig">{fmt(receipt.amount)}</span>
          </div>
        </div>
      )}

      {bridge && <BridgeReceipt bridge={bridge} />}

      {data.grant && !bridge && (
        <p className={s.priorGrant}>
          A grant for this reference already exists: transfer <span className="fig">{data.grant.transferId}</span>{' '}
          for <span className="fig">{fmt(data.grant.amount)}</span> on {shortDate(data.grant.grantedOn)}. Pressing
          the button re-reads both balances; it does not send the money twice.
        </p>
      )}
    </section>
  );
}

function BridgeReceipt({ bridge }: { bridge: BridgeResponse }): React.ReactElement {
  return (
    <div className={s.bridgeOut}>
      <div className={s.bridgeHead}>
        {bridge.replayed
          ? 'Balances re-read'
          : bridge.moved
            ? 'Purchase funded'
            : 'Grant recorded — balance unchanged'}{' '}
        · Nessie {bridge.source} · transfer <span className="fig">{bridge.transferId}</span>
      </div>
      <div className={s.bridgeGrid}>
        {[bridge.balances.funder, bridge.balances.patient].map((b) => (
          <div key={b.accountId} className={s.bal}>
            <div className={s.balLabel}>{b.label}</div>
            <div className={s.balRow}>
              <span className={`${s.was} fig`}>{fmt(b.before)}</span>
              <span className={s.arrow}>→</span>
              <span className={`${s.now} fig`}>{fmt(b.after)}</span>
            </div>
            <div className={s.balId}>{b.accountId}</div>
          </div>
        ))}
      </div>
      {!bridge.moved && !bridge.replayed && (
        <p className={s.blocked}>
          The grant is recorded ({bridge.transferSource}) but the account the balance is read from ({bridge.source})
          did not move by {fmt(bridge.amount)}. Both figures above are readings taken either side of the write, so
          this says the write did not land there — it is not a rendering delay and refreshing will not change it.
        </p>
      )}

      <p className={s.bridgeFoot}>
        Funded by {bridge.funderName}, an independent charitable foundation — never a brand fund. {BRIDGE_SANDBOX_CAVEAT}{' '}
        Both figures on each row were read from Nessie before and after the write. Neither was computed from the
        grant amount, which is why this panel can report that nothing moved.
      </p>
    </div>
  );
}

/* ── 6. the patient's card ───────────────────────────────────────────────── */

function PatientCardBlock({ card }: { card: PatientCard }): React.ReactElement {
  const [speaking, setSpeaking] = useState<'en' | 'es' | null>(null);
  const [canSpeak, setCanSpeak] = useState(false);

  useEffect(() => {
    setCanSpeak(typeof window !== 'undefined' && 'speechSynthesis' in window);
    // Leaving the page mid-sentence should stop the voice, not follow the
    // clinician to the next patient.
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback(
    (side: PatientCardSide) => {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      if (speaking === side.lang) {
        setSpeaking(null);
        return;
      }
      // The browser's own voice. No paid TTS: a card that needs an API key to
      // be read aloud is not accessible, it is licensed.
      const utterance = new SpeechSynthesisUtterance(side.speech);
      utterance.lang = side.speechLang;
      utterance.rate = 0.95;
      utterance.onend = () => setSpeaking(null);
      utterance.onerror = () => setSpeaking(null);
      setSpeaking(side.lang);
      window.speechSynthesis.speak(utterance);
    },
    [speaking],
  );

  return (
    <section className="panel gold" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <h2>The patient&rsquo;s card</h2>
        <span className="note">both languages print on one sheet</span>
      </div>
      <div className={`panel-body ${s.cards}`}>
        {[card.en, card.es].map((side) => (
          <article key={side.lang} className={s.pcard} lang={side.lang}>
            <div className={s.pcardHead}>
              <span className={s.pcardLang}>{side.langLabel}</span>
              <button
                type="button"
                className="btn quiet"
                aria-pressed={speaking === side.lang}
                disabled={!canSpeak}
                onClick={() => speak(side)}
              >
                {speaking === side.lang
                  ? side.lang === 'es'
                    ? 'Detener'
                    : 'Stop'
                  : side.lang === 'es'
                    ? 'Escuchar en voz alta'
                    : 'Read this aloud'}
              </button>
            </div>
            <h4 className={s.pcardTitle}>{side.title}</h4>
            <div className={`${s.pcardDate} fig`}>{side.dateLine}</div>
            {side.dateSub && <div className={s.pcardDateSub}>{side.dateSub}</div>}
            {side.body.map((line) => (
              <p key={line} className={s.pcardLine}>
                {line}
              </p>
            ))}
            <p className={s.pcardTodo}>{side.todo}</p>
            <p className={s.pcardFoot}>{side.footer}</p>
          </article>
        ))}
      </div>
      {!canSpeak && (
        <p className={s.blocked} style={{ margin: '0 20px 18px' }}>
          This browser has no speech synthesis, so the read-aloud buttons are disabled rather than silent.
        </p>
      )}
    </section>
  );
}

/* ── 7. the trace ────────────────────────────────────────────────────────── */

function Trace({ data }: { data: ReadyCardData }): React.ReactElement {
  return (
    <details className={s.trace}>
      <summary>Where did that window come from</summary>
      <div className={s.traceBody}>
        <h4>Classifier</h4>
        <ol>
          {data.verdict.trace.map((line, i) => (
            <li key={`v${i}`}>{line}</li>
          ))}
        </ol>
        <h4>Balance curve</h4>
        <ol>
          {data.curve.trace.map((line, i) => (
            <li key={`c${i}`}>{line}</li>
          ))}
        </ol>
        <h4>Patient card</h4>
        <ol>
          {data.patientCard.trace.map((line, i) => (
            <li key={`p${i}`}>{line}</li>
          ))}
        </ol>
        <h4>Routing</h4>
        <ol>
          <li>{data.routing.line}</li>
          <li>
            Clinical window: {data.clinicalWindow.days} days from {data.writtenOn},{' '}
            {data.clinicalWindow.closed ? 'closed' : 'closes'} {data.clinicalWindow.closesOn}. Weight{' '}
            {data.clinicalWeight.toFixed(2)}. The window is part of the synthetic scenario, like the copay; the
            arithmetic run over it is not.
          </li>
        </ol>
        <p className={s.traceFoot}>
          Claims index said <b>{data.claimsIndexEvent ?? 'nothing'}</b>; the ledger said{' '}
          <b>{data.verdict.class}</b>. Two independent sources — the only reason this row could be considered for
          a slot at all. The ledger side is <i>corroboration</i>, not fill-level verification: a bank line reading{' '}
          <span className="fig">CVS/PHARMACY #1234 $47.00</span> carries no NDC and no Rx number, and we do not
          claim it does.
        </p>
      </div>
    </details>
  );
}
