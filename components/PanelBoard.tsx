'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PanelPayload, PanelRowEvidence } from '@/app/api/panel/route';
import { shortDate } from '@/lib/dates';
import { fmt } from '@/lib/money';
import { WITHHELD_FIELDS } from '@/lib/ready/types';
import type { LiquidityClass, RankedCandidate, SlotState } from '@/lib/ready/types';
import type { DataSource } from '@/lib/types';
import s from './PanelBoard.module.css';

/**
 * The panel board.
 *
 * One ruled table, twelve prescriptions, one prescriber. The screen has to
 * survive a specific question — "so you're selling my attention?" — and it
 * answers it structurally rather than in copy: the slot meter at the top is a
 * control the physician owns, and the refused rows at the bottom are the
 * alerts they would have received today, priced.
 *
 * All arithmetic is server-side (app/api/panel/route.ts). Moving the slider
 * refetches the whole board rather than re-sorting locally, because a board
 * the browser could re-derive would be a board the browser had the ledger
 * for, and it does not.
 */

const STATE_LABEL: Record<SlotState, string> = {
  CLEARED: 'Sent',
  DEFERRED: 'Held',
  PAP_QUEUE: 'Off-channel',
  SUPPRESSED: 'Suppressed',
  REFUSED: 'Refused',
};

/** Typographic marks, not icons — this prints on a clinic laser printer. */
const STATE_MARK: Record<SlotState, string> = {
  CLEARED: '✓',
  DEFERRED: '··',
  PAP_QUEUE: '→',
  SUPPRESSED: '⊘',
  REFUSED: '✕',
};

/** The two states that mean the inbox never sees the row at all. */
const NEVER_SENT: Record<SlotState, boolean> = {
  CLEARED: false,
  DEFERRED: false,
  PAP_QUEUE: false,
  SUPPRESSED: true,
  REFUSED: true,
};

const SOURCE_LABEL: Record<DataSource, string> = {
  live: 'live',
  recorded: 'recorded cache',
  demo: 'simulated ledger',
};

/**
 * The reason the three-way classification exists: the classes do not differ
 * in severity, they differ in what the prescriber is supposed to DO. Today
 * all three arrive as one abandonment alert and get the chart note "patient
 * declined", which is how a TIMING patient ends up switched off a drug that
 * was working.
 */
const ROUTE: Record<LiquidityClass, string> = {
  TIMING: 'Nothing to do. The fill happens on payday either way.',
  STALE: 'Re-issue, substitute or escalate — the clinical window closes first.',
  STRUCTURAL: 'Route to patient assistance.',
};

function pctOf(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * "none (95% CI -1.97 to +3.47 pts, n=367)" -> "95% CI -1.97 to +3.47 pts, n=367".
 *
 * The band is rendered as the figure and the interval as its footnote. The
 * bare point estimate never appears anywhere on this screen.
 */
function intervalOf(display: string): string {
  const m = /\(([^)]*)\)/.exec(display);
  return m?.[1] ?? display;
}

export default function PanelBoard({ initial }: { initial: PanelPayload }): React.ReactElement {
  const [cap, setCap] = useState(initial.cap);
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // A drag fires an event per pixel. The latest request wins and the earlier
  // ones are aborted, so the board can never settle on a stale cap — the
  // counter is what makes that true even if two responses race.
  const seq = useRef(0);

  useEffect(() => {
    if (cap === data.cap) return;

    const id = (seq.current += 1);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/panel?slots=${cap}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`panel ${res.status}`);
        const next = (await res.json()) as PanelPayload;
        if (seq.current !== id) return;
        setData(next);
        setFailed(false);
      } catch (err) {
        if ((err as Error).name === 'AbortError' || seq.current !== id) return;
        console.error('[panel] recompute failed', err);
        setFailed(true);
      } finally {
        if (seq.current === id) setBusy(false);
      }
    }, 90);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [cap, data.cap]);

  const { board, evidence } = data;
  const { profile } = board;

  // The meter reads "3 of 4": three slots left of a cap of four, one already
  // spent on Tuesday. Rendering the spent pips is the whole point — a budget
  // with no visible consumption is a decoration.
  const pips = Array.from({ length: data.cap }, (_, i) =>
    i < profile.sendsAlreadyThisWeek ? 'spent' : i < profile.sendsAlreadyThisWeek + board.cleared ? 'filled' : 'open',
  );

  return (
    <main className="shell">
      <header className="masthead">
        <div className="wordmark">
          Ready<em>.</em>
        </div>
        <p>
          Surescripts can tell you the prescription was never picked up. Ready decides which of
          those alerts is worth your attention — and the second source is the patient&rsquo;s own
          cash position.
        </p>
        <Link href="/plan-year" className={s.planYearLink}>
          Plan year &rarr;
        </Link>
        <span className="spacer" />
        {/* The badge states the connection AND how many rows actually came
            down it. A green "live" over twelve replayed ledgers is the exact
            overclaim this product is built to refuse. */}
        <span
          className="srcbadge"
          title={`${data.linkedRows} of ${board.rows.length} rows read from the connected Nessie customer`}
        >
          <i className={`dot${board.source === 'live' ? '' : ' warn'}`} />
          Nessie <b>{SOURCE_LABEL[board.source]}</b>
          <span className={s.badgeSplit}>
            {data.linkedRows === 0
              ? `all ${board.rows.length} rows replayed`
              : `${data.linkedRows} of ${board.rows.length} rows linked`}
          </span>
        </span>
      </header>

      <section className={s.who}>
        <h1>{profile.prescriberName}</h1>
        <span>{profile.specialty}</span>
        <span>{data.prescriberCity}</span>
        <span className="fig">NPI {profile.prescriberId.replace(/^npi-/, '')}</span>
        <span className={s.whoDate}>panel as of {shortDate(board.generatedAt)}</span>
      </section>

      {/* ── the meter ─────────────────────────────────────────────────────── */}
      <section className={s.meter} aria-busy={busy}>
        <div className={s.meterFig}>
          <div className={s.kicker}>Slots this week</div>
          <div className={s.meterCount}>
            <span className={`fig ${s.meterN}`}>{board.slotBudget}</span>
            <span className={s.meterOf}>of {data.cap}</span>
          </div>
          <div className={s.pips} aria-hidden="true">
            {pips.map((kind, i) => (
              <i key={i} data-kind={kind} />
            ))}
          </div>
          <p className={s.meterNote}>
            {profile.sendsAlreadyThisWeek} already spent this week · {board.cleared} of the{' '}
            {board.rows.length} rows below earn one
          </p>
        </div>

        <div className={s.control}>
          <div className={s.controlHead}>
            <label htmlFor="cap">Your weekly cap</label>
            <span className={`fig ${s.controlVal}`}>{cap}</span>
          </div>
          <input
            id="cap"
            className={s.slider}
            type="range"
            min={data.minCap}
            max={data.maxCap}
            step={1}
            value={cap}
            onChange={(e) => setCap(Number(e.currentTarget.value))}
            aria-describedby="cap-note"
          />
          <div className={s.ticks} aria-hidden="true">
            {Array.from({ length: data.maxCap - data.minCap + 1 }, (_, i) => data.minCap + i).map(
              (n) => (
                <span key={n} data-measured={n === profile.saturationPoint ? 'yes' : undefined}>
                  {n}
                </span>
              ),
            )}
          </div>
          <p id="cap-note" className={s.controlNote}>
            Your measured saturation point is <b className="fig">{profile.saturationPoint}</b>.
            Above {profile.saturationPoint} sends in a week your own open rate falls below half its{' '}
            {pctOf(profile.openRate)} four-year average. Nobody typed that number — it is measured
            over {profile.totalSends} sends. Set the cap lower and the board re-ranks; the alerts
            that fall out do not get sent.
          </p>
          {failed ? (
            <p className={s.controlWarn}>
              Recompute failed — the board below is still the last good result for a cap of{' '}
              {data.cap}.
            </p>
          ) : null}
        </div>

        <dl className={s.stats}>
          <div>
            <dt>Open rate</dt>
            <dd className="fig">{pctOf(profile.openRate)}</dd>
          </div>
          <div>
            <dt>Reply rate</dt>
            <dd className="fig">{pctOf(profile.replyRate)}</dd>
          </div>
          <div>
            <dt>Median latency</dt>
            <dd className="fig">{profile.medianLatencyMin} min</dd>
          </div>
          <div>
            <dt>Best hour</dt>
            <dd className="fig">{data.bestHour}</dd>
          </div>
          <div>
            {/* Never a bare decimal. The point estimate is two orders of
                magnitude inside the noise of its own inputs, so what reaches
                the screen is the band with its interval and sample size —
                see summariseDebt() in lib/ready/attention.ts. */}
            <dt>Cost of one uncorroborated send</dt>
            <dd className={s.debtDd}>
              <b>{profile.debt.band}</b>
              <small className="fig">{intervalOf(profile.debt.display)}</small>
            </dd>
          </div>
        </dl>
      </section>

      {/* ── the board ─────────────────────────────────────────────────────── */}
      {/* ── what the rationing layer actually did ─────────────────────────
          The headline on this board is how FEW alerts are sent. The two
          never-sent states get the same type size as the sends and more
          prose, because they are the product rather than a shortfall. */}
      <section className={s.ledger}>
        <div className={s.ledgerSide} data-side="sent">
          <div className={s.kicker}>Sent · {board.sent} of {board.rows.length}</div>
          <div className={s.ledgerRow}>
            <span className={`fig ${s.ledgerN}`}>{board.cleared}</span>
            <span className={s.ledgerLab}>
              <b>in-channel</b>
              <small>
                STALE — a clinical window closes before the cash arrives. Re-issue, substitute or
                escalate: all three are prescriber acts.
              </small>
            </span>
          </div>
          <div className={s.ledgerRow}>
            <span className={`fig ${s.ledgerN}`}>{board.papQueue}</span>
            <span className={s.ledgerLab}>
              <b>off-channel</b>
              <small>
                STRUCTURAL — no date exists this plan year. A prescriber decision, taken in the
                assistance queue, spending no slot.
              </small>
            </span>
          </div>
        </div>

        <div className={s.ledgerSide} data-side="withheld">
          <div className={s.kicker}>
            Not sent · {board.suppressed + board.refused + board.deferred} of {board.rows.length}
          </div>
          <div className={s.ledgerRow} data-state="SUPPRESSED">
            <span className={`fig ${s.ledgerN}`}>{board.suppressed}</span>
            <span className={s.ledgerLab}>
              <b>suppressed</b>
              <small>
                TIMING — believed completely, and still not sent. The patient reaches the copay on
                their own money inside the clinical window, so there is no physician act. Our own
                attention engine, applied to our own best-scoring rows, refuses them.
              </small>
            </span>
          </div>
          <div className={s.ledgerRow} data-state="REFUSED">
            <span className={`fig ${s.ledgerN}`}>{board.refused}</span>
            <span className={s.ledgerLab}>
              <b>refused</b>
              <small>
                One source. Claims says the script was never picked up and the ledger produced no
                dated verdict, or the reverse. Not an affordability finding.
              </small>
            </span>
          </div>
          <div className={s.ledgerRow} data-state="DEFERRED">
            <span className={`fig ${s.ledgerN}`}>{board.deferred}</span>
            <span className={s.ledgerLab}>
              <b>held</b>
              <small>Corroborated and actionable, outranked this week. It waits, it does not die.</small>
            </span>
          </div>
        </div>
      </section>

      <section className={s.boardHead}>
        <h2>Panel</h2>
        <span className={s.counts}>
          <b data-state="CLEARED">{board.cleared} sent</b>
          <b data-state="PAP_QUEUE">{board.papQueue} off-channel</b>
          <b data-state="SUPPRESSED">{board.suppressed} suppressed</b>
          <b data-state="DEFERRED">{board.deferred} held</b>
          <b data-state="REFUSED">{board.refused} refused</b>
        </span>
      </section>

      <div className={s.scroll}>
        <table className={s.board} data-busy={busy ? 'yes' : undefined}>
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Ref</th>
              <th scope="col">Drug + copay</th>
              <th scope="col">
                Index <small>claims</small>
              </th>
              <th scope="col">
                Ledger <small>bank</small>
              </th>
              <th scope="col">Ready</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <Row key={row.candidate.ref} row={row} evidence={evidence[row.candidate.ref]} />
            ))}
          </tbody>
        </table>
      </div>

      <section className={s.after}>
        <div className={s.suppressedNote}>
          <div className={s.kicker}>The {board.suppressed} suppressed rows</div>
          <p>
            These score highest on the board. A TIMING row is corroborated on both sides, the date
            is real, and the classifier is certain — and it is still not sent, because the patient
            fills on payday with or without you. There is no prescriber act, so there is no
            message. <b>The strongest thing this product does is decline to interrupt you.</b>
          </p>
        </div>
        <div className={s.refusedNote}>
          <div className={s.kicker}>The {board.refused} refused rows</div>
          <p>
            These are the alerts that would have landed in your inbox today, unmetered, on one
            source. They are not affordability findings: the ledger says the money is there. Each
            would have cost a slot, and the channel cost of an uncorroborated send measures{' '}
            <b>{profile.debt.display}</b> — reported as a band, because the interval is wider than
            the estimate.
          </p>
        </div>
        <div className={s.privacy}>
          <div className={s.kicker}>What left the building</div>
          <p>
            <b>Sent</b> on each of the {board.cleared} in-channel rows: one class and one date.
            Nothing at all on the {board.suppressed + board.refused} rows above.
          </p>
          <p>
            <b>Withheld:</b> {WITHHELD_FIELDS.join(', ')}.
          </p>
          <p className={s.linkage}>
            Drawn at 100% bank linkage for legibility. Ready is a module for an entity that
            already holds the connection — a hub, a health system&rsquo;s financial navigation
            team, a payer&rsquo;s app. Penetration is their number, not a claim we make.
          </p>
        </div>
      </section>

      <footer className="footnote">
        <span>Ready · panel board · {board.generatedAt}</span>
        <span>
          Capital One Nessie: {SOURCE_LABEL[board.source]}. {data.linkedRows} of{' '}
          {board.rows.length} rows read off the connected customer; the rest replay the cohort
          ledgers through the identical readCapacity → classifyLiquidity path.
        </span>
        <span>Every figure on this screen is recomputable from the trace on each card.</span>
        <span>
          Also: <Link href="/sticker-shock">the Ready Day Test</Link> ·{' '}
          <Link href="/sticker-shock/prices">Price Shock</Link> ·{' '}
          <Link href="/average-american">the median household</Link>
        </span>
      </footer>
    </main>
  );
}

/* ── one row ─────────────────────────────────────────────────────────────── */

function Row({
  row,
  evidence,
}: {
  row: RankedCandidate;
  evidence: PanelRowEvidence | undefined;
}): React.ReactElement {
  const c = row.candidate;
  const v = row.liquidity;
  const refused = row.state === 'REFUSED';

  return (
    <tr className={s.row} data-state={row.state} data-sent={NEVER_SENT[row.state] ? 'no' : 'yes'}>
      <td className={s.cState}>
        <span className={s.chip}>
          <i aria-hidden="true">{STATE_MARK[row.state]}</i>
          {STATE_LABEL[row.state]}
        </span>
      </td>

      <td className={s.cRef}>
        <Link className={s.rowLink} href={`/card/${c.ref}`}>
          <b>{evidence?.initials ?? '—'}</b>
          <span className="fig">{c.ref}</span>
        </Link>
      </td>

      <td className={s.cDrug}>
        <span className={s.drug}>{c.drugLabel}</span>
        <span className={`fig ${s.copay}`}>{fmt(c.copay)}</span>
      </td>

      <td className={s.cIndex} data-event={c.claimsIndexEvent ?? 'none'}>
        {c.claimsIndexEvent ?? '—'}
      </td>

      <td className={s.cLedger} data-class={v?.class ?? 'none'}>
        {v?.class ?? '—'}
      </td>

      <td className={s.cReady}>
        {v?.readyOn ? (
          <>
            <span className="fig">{shortDate(v.readyOn)}</span>
            <small className="fig">
              {v.daysToReady === 0 ? 'today' : `${v.daysToReady ?? 0}d`}
            </small>
          </>
        ) : (
          <span className={s.dash}>{'—'}</span>
        )}
      </td>

      <td className={s.cWhy}>
        {refused && evidence && evidence.refusal !== '' ? (
          <span className={s.whyLead}>{evidence.refusal}</span>
        ) : null}
        {(row.state === 'CLEARED' || row.state === 'SUPPRESSED') && v ? (
          <span className={s.whyRoute}>{ROUTE[v.class]}</span>
        ) : null}
        <span className={s.whyBody}>{row.reason}</span>
      </td>
    </tr>
  );
}
