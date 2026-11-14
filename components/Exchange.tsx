import { fmt } from '@/lib/money';
import { shortDate } from '@/lib/dates';
import type { DataSource } from '@/lib/types';
import type { ExchangeSheet } from '@/lib/ready/exchange';
import type { VerifiedStart } from '@/lib/ready/types';
import styles from './Exchange.module.css';

/**
 * The commercial-fit screen, rebuilt as a proposed experiment.
 *
 * Impiricus said almost nobody who pitches them answers the commercial
 * question. The previous version of this screen answered it with a
 * two-column table that a hostile judge took apart in about a minute: it
 * billed per engagement in the arithmetic and per fill in the prose, it
 * assumed the touches we refused would have produced nothing, and it rested
 * on two prices that appear in no source we can cite.
 *
 * So the table is gone. What is here instead is a term sheet with an
 * experiment attached:
 *
 *   §1  what the rationing layer measurably did — the only block on the page
 *       that does not depend on a price
 *   §2  the unit being sold, and the explicit statement that a verified fill
 *       is a quality metric and not an invoice line
 *   §3  the break-even, printed as a concession, with its sensitivity to a
 *       price we invented
 *   §4  the six-week experiment that would price the channel honestly
 *   §5  the receipts, with their Nessie ids
 *
 * Honest uncertainty, stated precisely, beats a confident table a judge can
 * dismantle. Presentational only: every figure arrives computed by
 * lib/ready/exchange.ts and the trace at the bottom reproduces all of it.
 */

const SLOT_CAPS = [1, 2, 3, 4, 5, 6] as const;

function threshold(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Only the header fields this sheet prints.
 *
 * The board type is still moving underneath us — the repositioning widened it
 * in lib/ready/attention.ts before lib/ready/types.ts caught up — and this
 * screen reads five fields off it. Asking for exactly those keeps the sheet
 * renderable from either shape, which is also what makes it testable without
 * constructing a whole board.
 */
export interface SheetCounterparty {
  profile: {
    prescriberName: string;
    specialty: string;
    saturationPoint: number;
    sendsAlreadyThisWeek: number;
  };
  slotBudget: number;
  generatedAt: string;
}

export default function Exchange({
  board,
  sheet,
  starts,
  countedRefs,
  mode,
  slotCap,
}: {
  board: SheetCounterparty;
  sheet: ExchangeSheet;
  /** Everything observed, counted or not. The ledger prints both. */
  starts: VerifiedStart[];
  /** Refs whose fill the quality metric actually counted. */
  countedRefs: string[];
  mode: DataSource;
  /** The cap in force — the prescriber's own slider position. */
  slotCap: number;
}) {
  const { ledger, terms, breakEven, sensitivity, experiment } = sheet;
  const { profile } = board;
  const counted = new Set(countedRefs);

  // Withheld from the inbox is not the same as never leaving the building:
  // the assistance queue is off-channel, not silence. The panel board counts
  // those rows as sent, so this screen says so rather than appearing to
  // contradict it.
  const rerouted = ledger.buckets
    .filter((b) => b.rerouted)
    .reduce((a, b) => a + b.count, 0);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="wordmark">
          Ready <em>· clearing</em>
        </div>
        <p>
          What a brand would buy if it bought cleared engagements instead of impressions — the
          unit, what this week&rsquo;s rationing actually refused, and the experiment that would
          price it.
        </p>
        <span className="spacer" />
        <span className="srcbadge">
          <i className={mode === 'live' ? 'dot' : 'dot warn'} />
          ledger <b>{mode}</b>
        </span>
      </header>

      <section className={styles.sheet}>
        {/* ── head of the sheet ─────────────────────────────────────────── */}
        <div className={styles.sheetTop}>
          <h1>Term sheet · attention exchange</h1>
          <span className="spacer" />
          <span className={styles.party}>
            Counterparty <b>{profile.prescriberName}</b>, {profile.specialty} · as of{' '}
            <b>{shortDate(board.generatedAt)}</b>
          </span>
          <span className={styles.draft}>proposed · not priced</span>
        </div>

        <div className={styles.recitals}>
          <div className={styles.recital}>
            <div className="k">Panel this week</div>
            <div className="v">{ledger.panel}</div>
            <div className="s">candidates a claims index flagged</div>
          </div>
          <div className={styles.recital}>
            <div className="k">Sent · billable</div>
            <div className="v">{ledger.sent}</div>
            <div className="s">cleared engagements, two sources, inside the cap</div>
          </div>
          <div className={styles.recital} data-lead="true">
            <div className="k">Withheld</div>
            <div className="v">{ledger.withheld}</div>
            <div className="s">refused, suppressed, held or routed — §1</div>
          </div>
          <div className={styles.recital}>
            <div className="k">Verified fills</div>
            <div className="v">{terms.verifiedFills}</div>
            <div className="s">
              quality metric · <b>never invoiced</b>
            </div>
          </div>
        </div>

        {/* The slider lives on the board; here it is six links, because the
            whole sheet is recomputed server-side and there is nothing to
            hydrate. Moving it moves every figure below. */}
        <div className={styles.caps}>
          <span className="lbl">Prescriber&rsquo;s weekly cap</span>
          {SLOT_CAPS.map((n) => (
            <a key={n} className={styles.cap} data-on={n === slotCap} href={`/exchange?slots=${n}`}>
              {n}
            </a>
          ))}
          <span className={styles.measured}>
            measured saturation point {profile.saturationPoint} · {profile.sendsAlreadyThisWeek}{' '}
            already spent · {board.slotBudget} slot{board.slotBudget === 1 ? '' : 's'} left
          </span>
        </div>

        {/* ── §1 the measured thing ─────────────────────────────────────── */}
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <span className="cl">§1</span>
            <h2>What the rationing layer refused, and why</h2>
            <span className="note">no price enters this block</span>
          </div>
          <div className={styles.blockBody}>
            <p>
              This is the measurement. {ledger.sent} of {ledger.panel} candidates reached the
              inbox; {ledger.withheld} did not, under {ledger.buckets.length} distinct reasons
              that today&rsquo;s channel does not distinguish at all
              {rerouted > 0 ? (
                <>
                  {' '}
                  — and {rerouted} of those {rerouted === 1 ? 'is' : 'are'} not silence but a
                  reroute, which is why the panel board counts{' '}
                  {rerouted === 1 ? 'it' : 'them'} as sent and this sheet does not bill for{' '}
                  {rerouted === 1 ? 'it' : 'them'}
                </>
              ) : null}
              . Every figure here is a count of decisions taken by code, reproduced in this
              page&rsquo;s trace — <b>it does not depend on a price, a conversion rate, or
              anything you have to take on trust</b>. The patients are synthetic. The decisions
              over them are not.
            </p>
            <table className={styles.refusals}>
              <tbody>
                {ledger.buckets.map((b) => (
                  <tr key={b.code} data-rerouted={b.rerouted}>
                    <th>
                      {b.label}
                      <small>{b.why}</small>
                    </th>
                    <td>{b.count}</td>
                  </tr>
                ))}
                <tr className={styles.total}>
                  <th>
                    Withheld from this prescriber&rsquo;s inbox
                    <small>
                      {ledger.buckets.map((b) => b.count).join(' + ')} = {ledger.withheld}, and{' '}
                      {ledger.withheld} + {ledger.sent} sent = {ledger.panel} on the panel
                    </small>
                  </th>
                  <td>{ledger.withheld}</td>
                </tr>
              </tbody>
            </table>

            <div className={styles.classSplit}>
              <table>
                <thead>
                  <tr>
                    <th>Verdict</th>
                    <th>Sent</th>
                    <th>Withheld</th>
                    <th className={styles.wide}>The decision this class asks a physician for</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.byClass.map((c) => (
                    <tr key={c.cls}>
                      <th>{c.cls}</th>
                      <td>{c.sent}</td>
                      <td>{c.withheld}</td>
                      <td className={styles.wide}>
                        {c.cls === 'TIMING'
                          ? 'None. The patient reaches the copay on their own money inside the window — a $47 generic six days from payday needs a date, not a doctor. Suppressed.'
                          : c.cls === 'STALE'
                            ? 'A real one. The clinical window closes before the cash arrives, and only a prescriber can re-issue, substitute or escalate. Sent.'
                            : c.cls === 'STRUCTURAL'
                              ? 'A real one, off-channel. No date exists this plan year, so it is an assistance-programme decision, not an inbox one.'
                              : 'Nothing was corroborated, so there is nothing to ask. Refused.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.selfTest}>
              <b>The uncomfortable one, said first.</b> Our own hero case used to be a TIMING
              alert. Applied honestly, our own attention engine refuses it — so now it does,
              deliberately and visibly. The class we can most easily dramatise is the class we
              send nothing for.
            </p>
          </div>
        </div>

        {/* ── §2 the unit ───────────────────────────────────────────────── */}
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <span className="cl">§2</span>
            <h2>The unit being sold</h2>
            <span className="note">one line item, and one thing it is scored on</span>
          </div>
          <div className={styles.blockBody}>
            <dl className={styles.terms}>
              <div>
                <dt>Billing unit</dt>
                <dd>
                  <b>One cleared engagement.</b> An alert that two independent sources agreed on —
                  a claims-side no-fill and a dated verdict from the patient&rsquo;s own cash
                  position — and that fitted inside the prescriber&rsquo;s measured cap.
                </dd>
              </div>
              <div>
                <dt>Not the billing unit</dt>
                <dd>
                  <b>The verified fill.</b> It is the quality metric the contract is scored on and
                  it is explicitly <b>not an invoice line</b>. Bill per fill and cost-per-start
                  becomes whatever price we set, which makes every comparison circular. It is also
                  the structure the Anti-Kickback Statute polices: per-fill payment for arranging
                  prescriptions is the shape to stay away from.
                </dd>
              </div>
              <div>
                <dt>Units this week</dt>
                <dd className={styles.figure}>
                  {terms.units} <span>cleared engagements at the cap in force</span>
                </dd>
              </div>
              <div>
                <dt>Assumed unit price</dt>
                <dd className={styles.figure}>
                  {fmt(terms.assumedUnitPrice)} <span>per cleared engagement</span>
                </dd>
              </div>
              <div>
                <dt>Invoice, this week</dt>
                <dd className={styles.figure}>
                  {fmt(terms.invoiced)}{' '}
                  <span>
                    = {terms.units} × {fmt(terms.assumedUnitPrice)}. {terms.verifiedFills} verified
                    fill{terms.verifiedFills === 1 ? '' : 's'} moved this number by {fmt(0)}, which
                    is the point of the unit.
                  </span>
                </dd>
              </div>
            </dl>
            <div className={styles.assumption}>
              <b>Both prices on this page are illustrative assumptions.</b> They are placeholders
              we chose so the arithmetic is checkable in your head. They are not a rate card, not a
              quote, and not sourced — and by our own rule, anything we cannot source we do not
              assert. Replace them with yours and every derived figure moves; §3 shows by how much.
            </div>
          </div>
        </div>

        {/* ── §3 the concession ─────────────────────────────────────────── */}
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <span className="cl">§3</span>
            <h2>What would have to be true for metering to be the wrong buy</h2>
          </div>
          <div className={styles.blockBody}>
            <div className={styles.experiment}>
              <div className={styles.breakeven}>
                <div className="big">
                  {breakEven.computable ? threshold(breakEven.conversionRate) : 'no threshold'}
                </div>
                <div className="cap">{breakEven.sentence}</div>
              </div>
              <div>
                <p className={styles.longhand}>
                  <b>The arithmetic, longhand.</b> Unmetered, this week is {ledger.panel} ×{' '}
                  {fmt(sheet.assumedUnmeteredPrice)} = {fmt(sheet.unmeteredSpend)}. Metered it is{' '}
                  {terms.units} × {fmt(terms.assumedUnitPrice)} = {fmt(terms.invoiced)}. Credit{' '}
                  <em>both</em> channels with the same {breakEven.startsCredited}{' '}
                  {sheet.startsAreObserved ? 'observed' : 'illustrative'} start
                  {breakEven.startsCredited === 1 ? '' : 's'} — including the unmetered one, which
                  is credited with starts it would have bought using touches we refused to send.
                  The unmetered channel also buys the {breakEven.withheldTouches} withheld touches
                  at some unknown rate <em>c</em>, and the two meet where{' '}
                  <code>
                    {fmt(sheet.unmeteredSpend)} / ({breakEven.startsCredited} +{' '}
                    {breakEven.withheldTouches}c) = {fmt(terms.invoiced)} /{' '}
                    {breakEven.startsCredited}
                  </code>
                  .
                </p>
                <p className={styles.longhand}>
                  <b>We are not claiming a cost-per-start improvement.</b> That claim used to be
                  the headline of this screen and it was deleted. It required believing that{' '}
                  {breakEven.withheldTouches} refused touches would have produced nothing, and we
                  destroyed the only evidence that could settle that by refusing to send them. What
                  is left is a threshold, a price we made up, and an experiment.
                </p>
                <p className={styles.longhand}>
                  <b>And note which way this number leans.</b> Refusing more lowers our own
                  invoice, which raises the threshold — the figure flatters us precisely as we
                  ration harder. Move the cap above from {slotCap} and watch it move. A metric
                  that improves when the seller sells less is a metric to test, not to quote,
                  which is the whole reason this section is a concession and §4 is the ask.
                </p>
                <table className={styles.sensitivity}>
                  <thead>
                    <tr>
                      <th>If a cleared engagement is worth…</th>
                      <th>Week&rsquo;s invoice</th>
                      <th>Break-even conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.map((s) => (
                      <tr key={s.clearedPrice} data-current={s.current}>
                        <th>
                          {fmt(s.clearedPrice)}
                          {s.current ? ' · as assumed above' : ''}
                        </th>
                        <td>{fmt(s.meteredSpend)}</td>
                        <td>
                          {!s.computable
                            ? 'nothing billable this week'
                            : s.alreadyFlipped
                              ? 'none — impressions win outright'
                              : threshold(s.conversionRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={styles.sensitivityNote}>
                  Move a price we invented by half and the reading of this page changes completely.
                  That is the strongest single reason to treat it as an experiment rather than a
                  result — and it is the reason we are showing you the sensitivity instead of
                  waiting for you to ask for it.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── §4 the ask ────────────────────────────────────────────────── */}
        <div className={styles.closer}>
          <h2>§4 · The ask</h2>
          <p className="line">
            Six weeks, one therapeutic area, <em>and a number neither of us has yet</em>.
          </p>
          <p className="q">{experiment.question}</p>
          <ul className={styles.protocol}>
            {experiment.protocol.map((p) => (
              <li key={p.k}>
                <span className="k">{p.k}</span>
                <span className="t">{p.t}</span>
              </li>
            ))}
          </ul>
          <p className="foot">
            <b>Who can run it.</b> {experiment.whoCanRunIt}
          </p>
        </div>

        {/* ── §5 receipts ───────────────────────────────────────────────── */}
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <span className="cl">§5</span>
            <h2>Verified fill ledger — the quality metric</h2>
            <span className="note">settlement ids are Nessie object ids — curl them yourself</span>
          </div>
          <div className={styles.blockBody}>
            <p>
              A verified fill is a pharmacy-category debit of approximately the expected amount, in
              the expected window, in the patient&rsquo;s own account. <b>It is corroboration, not
              adjudication</b> — no NDC, no Rx number, and a multi-item basket or a spouse&rsquo;s
              card breaks the match. Good enough to score a contract on. Not good enough to invoice
              on, which is why §2 invoices the engagement.
            </p>
            {starts.length === 0 ? (
              <div className={styles.empty}>
                <b>No settlement has posted yet.</b> Clear a STALE row from its Ready Card: the
                purchase posts to the patient&rsquo;s own Nessie account and appears here with its
                object id within the same request. Until then §3 is computed against{' '}
                {breakEven.startsCredited} illustrative start
                {breakEven.startsCredited === 1 ? '' : 's'}, marked as such wherever it is printed,
                and <b>the invoice in §2 is unaffected either way</b>.
              </div>
            ) : (
              <table className={styles.receipts}>
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Observed</th>
                    <th>Amount</th>
                    <th>Merchant</th>
                    <th>Nessie settlement id</th>
                    <th>Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {starts.map((s) => (
                    <tr key={s.ref} data-counted={counted.has(s.ref)}>
                      <td>{s.ref}</td>
                      <td>{s.observedOn ? shortDate(s.observedOn) : '—'}</td>
                      <td className="amt">{s.amount === null ? '—' : fmt(s.amount)}</td>
                      <td>{s.merchantName ?? '—'}</td>
                      <td className="id">{s.settlementId ?? '—'}</td>
                      <td>
                        {counted.has(s.ref)
                          ? 'yes — scored, not billed'
                          : 'no — alert withheld, so not ours to claim'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── trace ─────────────────────────────────────────────────────── */}
        <div className={styles.block}>
          <div className={styles.blockBody}>
            <details className="trace">
              <summary>Recompute every figure on this page — {sheet.trace.length} steps</summary>
              <ol>
                {sheet.trace.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </details>
          </div>
        </div>
      </section>

      <nav className={styles.nav}>
        <a href="/">← panel board</a>
        <span>·</span>
        <a href="/sticker-shock">the Ready Day test</a>
      </nav>
    </main>
  );
}
