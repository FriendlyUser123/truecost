'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BasketStrip from './BasketStrip';
import Programs from './Programs';
import { longDate, shortDate } from '@/lib/dates';
import { fmt, fmtShort } from '@/lib/money';
import type { BasketActivation, BasketResult, CoverageId, DataSource, ProgramEvaluation, Route } from '@/lib/types';

const SOURCE_COPY: Record<DataSource, string> = {
  live: 'Nessie live',
  recorded: 'Nessie replay',
  demo: 'Nessie seeded',
};

export interface CatalogDrug {
  id: string;
  label: string;
  rank: number;
  prescriptions: number;
  defaultSelected: boolean;
}

export interface CoverageOption {
  id: CoverageId;
  label: string;
  blurb: string;
}

const ROUTE_COPY: Record<Route, string> = {
  plan: 'Plan',
  discount: 'Discount card',
  retail: 'Counter price',
};

const millions = (n: number): string => `${(n / 1_000_000).toFixed(1)}M`;

/** A program is relevant if it is household-wide, or covers at least one selected drug. */
function isApplicable(e: ProgramEvaluation, selectedIds: string[]): boolean {
  for (const c of e.program.criteria) {
    if (c.predicate.field === 'drugId') return c.predicate.value.some((id) => selectedIds.includes(id));
  }
  return true;
}

export default function EverydayRx({
  initial,
  catalog,
  coverages,
}: {
  initial: BasketResult;
  catalog: CatalogDrug[];
  coverages: CoverageOption[];
}) {
  const [coverage, setCoverage] = useState<CoverageId>(initial.coverage.id);
  const [selected, setSelected] = useState<string[]>(initial.lines.map((l) => l.drugId));
  const [result, setResult] = useState<BasketResult>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activation, setActivation] = useState<BasketActivation | null>(null);
  const [activating, setActivating] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const first = useRef(true);

  // Read the household's bank and price the basket against it.
  const fetchBasket = useCallback(
    async (signal?: AbortSignal): Promise<BasketResult> => {
      const qs = new URLSearchParams({ coverage, drugs: selected.join(',') });
      const res = await fetch(`/api/basket?${qs.toString()}`, { cache: 'no-store', signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `the basket engine returned ${res.status}`);
      }
      return (await res.json()) as BasketResult;
    },
    [coverage, selected],
  );

  // The server rendered the opening scenario, so the first pass has nothing to
  // fetch. Every later change re-runs the engine; a stale request is aborted
  // rather than allowed to overwrite a newer answer. A receipt belongs to the
  // scenario it was written for, so changing the scenario clears it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    setError(null);
    setActivation(null);
    setActError(null);
    fetchBasket(ac.signal)
      .then(setResult)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(`${(e as Error).message}. The figures below are from the previous scenario.`);
      })
      .finally(() => {
        if (!ac.signal.aborted) setBusy(false);
      });
    return () => ac.abort();
  }, [fetchBasket]);

  // Write the payday plan to the bank, then read the bank AGAIN. The balance on
  // screen afterwards is one the account returned, not one this page computed.
  const activate = async () => {
    setActivating(true);
    setActError(null);
    try {
      const res = await fetch('/api/basket/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverage, drugs: selected }),
      });
      const body = (await res.json().catch(() => ({}))) as BasketActivation & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `activation returned ${res.status}`);
      setActivation(body);
      setResult(await fetchBasket());
    } catch (e) {
      setActError(`${(e as Error).message}. Nothing was written to the bank.`);
    } finally {
      setActivating(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.length === 1 ? cur : cur.filter((x) => x !== id);
      return [...cur, id];
    });

  const r = result;
  const nessie: DataSource = r.dataSources.nessie ?? 'demo';
  const led = r.capacity.ledger;
  const insured = r.coverage.plan !== null;
  const shown = r.lines.map((l) => l.drugId);
  const applicable = r.assistance.filter((a) => isApplicable(a, shown));
  const notApplicable = r.assistance.filter((a) => !isApplicable(a, shown));
  const moved = r.lines.filter((l) => l.route !== l.asIssuedRoute).length;
  const incomeBlocked = applicable.filter((a) =>
    a.criteria.some((c) => !c.passed && c.label.includes('poverty level')),
  ).length;
  // What each program is actually worth in the chosen plan. An eligible program
  // can still go unused: a manufacturer card does not stack on a drug another
  // program already claimed, and a copay card cannot attach to a cash purchase.
  const renderSaving = (e: ProgramEvaluation) => {
    const used = r.applied.find((a) => a.program.id === e.program.id);
    return used ? (
      <>
        <span className="fig">saves {fmt(used.saved)}</span>
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>/yr</span>
      </>
    ) : (
      <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>eligible, not needed</span>
    );
  };
  const stampClass =
    r.verdict.label === 'AFFORDABLE' ? 'stamp ok' : r.verdict.label === 'AFFORDABLE IF LEVELLED' ? 'stamp mid' : 'stamp';

  return (
    <main className="shell">
      <header className="masthead">
        <a href="/" className="wordmark" style={{ textDecoration: 'none' }}>
          Ready<em>.</em>
        </a>
        <p>What the most common prescriptions in America cost a typical household, and how it covers them.</p>
        <span className="spacer" />
        <span className="srcbadge">
          <span className={`dot ${nessie === 'live' ? '' : 'warn'}`} />
          <b>{SOURCE_COPY[nessie]}</b>
          <span>·</span>
          <b>seeded catalog</b>
        </span>
      </header>

      <section className="chart">
        <div className="chart-top">
          <h1>{r.household.label}</h1>
          <span className="demo">
            household of {r.profile.householdSize} · {r.profile.city}, {r.profile.state} ·{' '}
            {Math.round(r.profile.incomeFplMultiple * 100)}% of the federal poverty line
          </span>
        </div>
        <div className="chart-meta">
          <span>
            Income <b>{fmt(r.profile.annualHouseholdIncome)}</b> a year
          </span>
          <span>
            Coverage <b>{r.coverage.label}</b>
          </span>
          <span>
            Basket <b>{r.lines.length} medications</b>, filled monthly
          </span>
        </div>
        <div className="order">
          <div className="order-body">
            <div className="order-label">The question</div>
            <div className="order-drug">Can a household afford the medications Americans actually take?</div>
            <div className="order-sig">
              The average U.S. household spends {fmt(r.referenceDrugSpend)} a year on drugs, over-the-counter included
              (BLS, 2024). This basket is ten of the most-prescribed drugs in the country, all at once.
            </div>
          </div>
        </div>
      </section>

      {/* ── scenario controls ───────────────────────────────────────────────── */}
      <section className="panel plan controls">
        <div className="panel-head">
          <h2>Set the scenario</h2>
          <span className="note">income is fixed at the U.S. median; coverage and medications are yours to change</span>
        </div>
        <div className="panel-body">
          <span className="ctl-label">Insurance coverage</span>
          <div className="covers" role="group" aria-label="Insurance coverage level">
            {coverages.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cover"
                aria-pressed={coverage === c.id}
                onClick={() => setCoverage(c.id)}
              >
                <b>{c.label}</b>
                <span>{c.blurb}</span>
              </button>
            ))}
          </div>

          <span className="ctl-label" style={{ marginTop: 20 }}>
            Medications, ranked by U.S. prescriptions filled (ClinCalc DrugStats, 2024)
          </span>
          <ul className="rxpick">
            {catalog.map((d) => (
              <li key={d.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(d.id)}
                    disabled={selected.length === 1 && selected.includes(d.id)}
                    onChange={() => toggle(d.id)}
                  />
                  <span className="rk">#{d.rank}</span>
                  <span>{d.label}</span>
                  <span className="ct">{millions(d.prescriptions)} Rx</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="quick">
            <button
              type="button"
              className="btn quiet"
              onClick={() => setSelected(catalog.filter((d) => d.defaultSelected).map((d) => d.id))}
            >
              Top ten
            </button>
            <button type="button" className="btn quiet" onClick={() => setSelected(catalog.map((d) => d.id))}>
              All fourteen
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={() =>
                setSelected([...new Set([...catalog.filter((d) => d.defaultSelected).map((d) => d.id), 'semaglutide'])])
              }
            >
              Top ten + semaglutide
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="panel alarm reveal" style={{ marginTop: 18 }}>
          <div className="panel-body" style={{ color: 'var(--alarm)' }}>
            {error}
          </div>
        </div>
      )}

      <div className={busy ? 'busy' : undefined} aria-busy={busy}>
        {/* ── 1. the bill, and the household's room to pay it ──────────────── */}
        <div className="grid split">
          <section className="panel plan">
            <div className="panel-head">
              <h2>The twelve-month bill</h2>
              <span className="note">{insured ? (r.coverage.plan as { name: string }).name : 'no insurance'}</span>
            </div>
            <div className="panel-body">
              <div className="hero-fig">
                {r.finalAnnual < r.asIssuedAnnual && (
                  <span className="n fig" style={{ color: 'var(--ink-3)', textDecoration: 'line-through', fontSize: 'clamp(26px, 4vw, 38px)' }}>
                    {fmt(r.asIssuedAnnual)}
                  </span>
                )}
                <span className={`n fig ${r.finalAnnual < r.asIssuedAnnual ? 'good' : ''}`}>{fmt(r.finalAnnual)}</span>
                <span className="cap">
                  a year, after choosing how each drug is paid for
                  {r.assistanceSavings > 0 ? ' and claiming assistance' : ''}
                </span>
              </div>

              <table className="ledger" style={{ marginTop: 18 }}>
                <tbody>
                  <tr>
                    <th scope="row">{insured ? 'Everything through the plan' : 'Everything at the counter price'}</th>
                    <td className="fig">{fmt(r.asIssuedAnnual)}</td>
                  </tr>
                  <tr className="sub">
                    <th scope="row">
                      Cheapest route for each drug
                      <small style={{ display: 'block' }}>
                        {moved} of {r.lines.length} drugs {insured ? 'moved to a discount card' : 'use a discount card'}
                      </small>
                    </th>
                    <td className="fig">{r.routeSavings > 0 ? `−${fmt(r.routeSavings)}` : fmt(r.routeSavings)}</td>
                  </tr>
                  <tr className="sub">
                    <th scope="row">
                      Assistance programs
                      <small style={{ display: 'block' }}>
                        {r.applied.length === 0 ? 'none apply to this household' : r.applied.map((a) => a.program.name).join(' · ')}
                      </small>
                    </th>
                    <td className="fig">{r.assistanceSavings > 0 ? `−${fmt(r.assistanceSavings)}` : fmt(0)}</td>
                  </tr>
                  <tr className="total">
                    <th scope="row">Twelve-month total</th>
                    <td className="fig">{fmt(r.finalAnnual)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 22 }}>
                <BasketStrip months={r.months} slack={r.capacity.slackMonthly} />
              </div>
            </div>
          </section>

          <section className="panel bank">
            <div className="panel-head">
              <h2>Household capacity</h2>
              <span className="note">Capital One · {SOURCE_COPY[nessie]}</span>
            </div>
            <div className="panel-body">
              <table className="ledger">
                <tbody>
                  {led && (
                    <>
                      <tr>
                        <th scope="row">Checking</th>
                        <td className="fig">{fmt(led.checkingBalance)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Savings</th>
                        <td className="fig">{fmt(led.savingsBalance)}</td>
                      </tr>
                    </>
                  )}
                  {led?.income ? (
                    <tr>
                      <th scope="row">Paycheck, take-home</th>
                      <td className="fig">
                        {fmt(led.income.averageAmount)}
                        <small>
                          every {led.income.intervalDays} days · next {shortDate(led.income.nextPaydays[0] ?? '')}
                        </small>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <th scope="row">After taxes</th>
                      <td className="fig">
                        {fmt(r.capacity.disposableMonthly)}
                        <small>a month</small>
                      </td>
                    </tr>
                  )}
                  {led && (
                    <>
                      <tr>
                        <th scope="row">Fixed obligations detected</th>
                        <td className="fig">
                          {fmt(led.recurringMonthly)}
                          <small>{led.recurring.length} merchants, monthly</small>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Everyday spending</th>
                        <td className="fig">{fmt(led.variableMonthly)}</td>
                      </tr>
                    </>
                  )}
                  <tr className="total">
                    <th scope="row">Spare each month</th>
                    <td className="fig">{fmt(r.capacity.slackMonthly)}</td>
                  </tr>
                  {led && (
                    <tr className="sub">
                      <th scope="row">Safe to pay today</th>
                      <td className="fig">{fmt(led.safeToPayToday)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {led && (
                <p className="rule-note">
                  {led.recurring
                    .slice(0, 3)
                    .map((b) => `${b.merchantName} ${fmt(b.averageAmount)}`)
                    .join(' · ')}{' '}
                  — read off the household&rsquo;s transactions by merchant repetition and amount stability, not typed in.
                </p>
              )}

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--rule-2)', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Average month for these drugs</div>
                  <div className="fig" style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em' }}>
                    {fmt(r.verdict.averageMonth)}
                  </div>
                </div>
                <div className={stampClass} role="status">
                  <span className="l1">{r.verdict.label}</span>
                  <span className="l2">{Math.round(r.verdict.shareOfSlack * 100)}% of the household&rsquo;s slack</span>
                </div>
              </div>

              <ul style={{ margin: '16px 0 0', paddingLeft: 18, color: 'var(--ink-2)', fontSize: 13.5 }}>
                {r.verdict.rationale.map((line, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {line}
                  </li>
                ))}
              </ul>

              <details className="trace">
                <summary>Show how the slack was derived</summary>
                <ol>
                  {r.capacity.trace.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              </details>
            </div>
          </section>
        </div>

        {/* ── 2. drug by drug ───────────────────────────────────────────────── */}
        <section className="panel plan reveal" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h2>Medication by medication</h2>
            <span className="note">{insured ? 'plan or discount card, whichever is cheaper for the whole basket' : 'counter price or discount card'}</span>
          </div>
          <div className="panel-body">
            <div className="cmp-scroll">
              <table className="cmp">
                <thead>
                  <tr>
                    <th scope="col">Medication</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Default way</th>
                    <th scope="col">Cheapest</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.drugId}>
                      <td>
                        <span className="drugname">{l.label}</span>
                        <span className="tag">#{l.rank}</span>
                        <span className="tag">tier {l.tier}</span>
                        {l.priorAuthRequired && <span className="tag">prior auth</span>}
                        {l.program && <span className="tag good">{l.program}</span>}
                        <div className="drugsub">
                          Counter {fmt(l.listPrice)} · plan rate {fmt(l.allowedAmount)} · discount card {fmt(l.cashPrice)} a fill
                        </div>
                        <span className="why">{l.why}</span>
                      </td>
                      <td>
                        <span className={`route ${l.route !== l.asIssuedRoute ? 'moved' : ''}`}>{ROUTE_COPY[l.route]}</span>
                      </td>
                      <td className="fig was">{fmt(l.asIssuedAnnual)}</td>
                      <td className={`fig ${l.finalAnnual < l.asIssuedAnnual ? 'saving' : ''}`}>{fmt(l.finalAnnual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rule-note">
              A drug paid for with a discount card never reaches the insurer, so it does not count toward the deductible.
              That cost is priced in: every combination of plan and card was evaluated together, because the choice for
              one drug changes what the others cost.{' '}
              <b>This page prices how each fill is paid for. It does not choose therapy, and it never touches a prescription.</b>
            </p>
            <details className="trace">
              <summary>Show every step of this calculation</summary>
              <ol>
                {r.optimizer.trace.map((t, i) => (
                  <li key={`o${i}`}>{t}</li>
                ))}
                {r.trace.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </details>
          </div>
        </section>

        {/* ── 3. the way to cover it ───────────────────────────────────────── */}
        <section className="panel gold reveal" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h2>How this household covers it</h2>
            <span className="note">
              {r.applied.length} of {r.assistance.length} programs applied
            </span>
          </div>
          <div className="panel-body">
            <div className="inputs" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <ol>
                <li>
                  <b>Pay each drug the cheapest way.</b>{' '}
                  {r.routeSavings > 0
                    ? `${moved} of ${r.lines.length} drugs ${insured ? 'move to a discount card' : 'use one'}, saving ${fmt(r.routeSavings)} a year.`
                    : 'No route beats the default here, so nothing moves.'}
                </li>
                <li>
                  <b>Claim what is already set aside.</b>{' '}
                  {r.applied.length > 0
                    ? r.applied.map((a) => `${a.program.name} saves ${fmt(a.saved)}`).join('; ') + '.'
                    : `No program applies to this household with this coverage and these medications. ${incomeBlocked} of the ${applicable.length} programs that could apply are income-tested below this household's ${Math.round(r.profile.incomeFplMultiple * 100)}% of the poverty line; the rest fail on other criteria, each shown below. Assistance is built for the low end of the income range, so at the median the answer is routing and planning.`}
                </li>
                <li>
                  <b>Set the rest aside each payday.</b> {fmt(r.finalAnnual)} is {fmt(r.schedule.perPaycheck)} a paycheck across{' '}
                  {r.schedule.paychecksPerYear} paychecks, each fill funded by the payday before it.
                </li>
              </ol>
            </div>

            <div style={{ marginTop: 20 }}>
              <Programs evaluations={applicable} renderFigure={renderSaving} />
            </div>
            {notApplicable.length > 0 && (
              <details className="trace">
                <summary>
                  {notApplicable.length} programs cover none of the selected medications, each still checked criterion by criterion
                </summary>
                <div style={{ marginTop: 12 }}>
                  <Programs evaluations={notApplicable} />
                </div>
              </details>
            )}
            <p className="rule-note">
              Manufacturer cards and patient-assistance programs do not stack on the same fill, and a copay card only
              attaches to a drug that runs through the plan. Foundation grants are drawn against the remaining total, each
              to its own cap.
            </p>
          </div>
        </section>

        {/* ── 4. the payday plan ───────────────────────────────────────────── */}
        <section className="panel receipt reveal" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h2>The payday plan</h2>
            <span className="note">
              paydays detected in the deposits &middot; written to the account below when activated
            </span>
          </div>
          <div className="panel-body">
            <div className="hero-fig" style={{ marginBottom: 16 }}>
              <span className="n fig good">{fmt(r.schedule.perPaycheck)}</span>
              <span className="cap">
                set aside from each of {r.schedule.paychecksPerYear} paychecks. Or {fmt(r.schedule.perInstallment)} a fill.
              </span>
            </div>
            <div className="insts">
              {r.schedule.installments.map((i) => (
                <div key={i.n} className="inst">
                  <div className="n">FILL #{i.n}</div>
                  <div className="d">from {shortDate(i.dueDate)}</div>
                  <div className="a">{fmt(i.amount)}</div>
                </div>
              ))}
            </div>
            <details className="trace">
              <summary>Show how the schedule was built</summary>
              <ol>
                {r.schedule.trace.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </details>
          </div>
        </section>

        {/* ── 5. write it to the bank ──────────────────────────────────────── */}
        {!activation && r.schedule.total > 0 && (
          <div className="actionbar reveal">
            <div className="copy">
              <h3>
                Write this plan to the household&rsquo;s bank account:{' '}
                <span className="fig">{fmt(r.schedule.total)}</span> over {r.schedule.installments.length} fills
              </h3>
              <p>
                {r.schedule.firstInstallmentFits === false
                  ? `Installment one of ${fmt(r.schedule.perInstallment)} is more than today's safe-to-pay ceiling of ${fmt(led?.safeToPayToday ?? 0)}, so nothing will be transferred until it fits.`
                  : `Installment one of ${fmt(r.schedule.perInstallment)} executes now as a transfer; the other ${r.schedule.installments.length - 1} are written as bills pinned to the paydays detected in the deposits. Then the balance is refetched from the account. Nothing here writes, transmits or signs a prescription.`}
              </p>
              {actError && <p style={{ color: '#ffb4b4', marginTop: 8 }}>{actError}</p>}
            </div>
            <button
              type="button"
              className="btn gold"
              onClick={() => void activate()}
              disabled={activating || r.schedule.firstInstallmentFits === false}
            >
              {activating ? 'Writing to the bank…' : 'Activate and schedule'}
            </button>
          </div>
        )}

        {activation && (
          <section className="panel receipt reveal" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h2>Activated</h2>
              <span className="note">{longDate(activation.activatedAt.slice(0, 10))}</span>
            </div>
            <div className="panel-body">
              <div className="hero-fig" style={{ marginBottom: 18 }}>
                <span className="n fig" style={{ color: 'var(--ink-3)', textDecoration: 'line-through' }}>
                  {fmt(r.asIssuedAnnual)}
                </span>
                <span className="n fig good">{fmt(activation.schedule.total)}</span>
                <span className="cap">a year, scheduled against the paydays in the account.</span>
              </div>

              <div className="confirm">
                <span>
                  <span className="k">Plan reference</span> <span className="v">{activation.reference}</span>
                </span>
                <span>
                  <span className="k">Coverage</span> <span className="v">{activation.coverageLabel}</span>
                </span>
                <span>
                  <span className="k">Bank</span> <span className="v">{SOURCE_COPY[activation.source]}</span>
                </span>
              </div>

              <div className="balance">
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Checking balance</span>
                <span className="was">{fmt(activation.balanceBefore)}</span>
                <span className="arrow">&rarr;</span>
                <span className="now fig">{fmt(activation.balanceAfter)}</span>
                <span className="tick">
                  Installment one of {fmt(activation.schedule.perInstallment)} executed as transfer{' '}
                  <span className="fig">{activation.executedTransferId}</span>, then the balance was refetched from the
                  account. {activation.billIds.length} bills written for the remaining installments.
                </span>
              </div>

              <div className="insts">
                {activation.schedule.installments.map((i) => (
                  <div key={i.n} className={`inst ${i.status === 'executed' ? 'done' : ''}`}>
                    <div className="n">{i.status === 'executed' ? 'PAID' : `#${i.n}`}</div>
                    <div className="d">{shortDate(i.dueDate)}</div>
                    <div className="a">{fmt(i.amount)}</div>
                  </div>
                ))}
              </div>

              <p className="rule-note">
                Pressing Activate again on this same scenario returns this same receipt and moves nothing. A different
                coverage level or basket is a different plan, and writes its own.
              </p>
            </div>
          </section>
        )}
      </div>

      {/* ── provenance ──────────────────────────────────────────────────────── */}
      <section className="panel reveal" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Where every number came from</h2>
          <span className="note">sourced, or modelled &mdash; never both</span>
        </div>
        <div className="panel-body">
          <span className="ctl-label">Sourced</span>
          <ul className="srcs">
            <li>
              Median household income {fmtShort(r.profile.annualHouseholdIncome)}:{' '}
              <a href="https://www.census.gov/library/publications/2025/demo/p60-286.html" target="_blank" rel="noreferrer">
                U.S. Census Bureau, Income in the United States: 2024
              </a>
              .
            </li>
            <li>
              Poverty line for a household of three, $27,320:{' '}
              <a href="https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines" target="_blank" rel="noreferrer">
                HHS/ASPE 2026 poverty guidelines
              </a>
              .
            </li>
            <li>
              The fourteen medications, their rank and prescription counts:{' '}
              <a href="https://clincalc.com/DrugStats/Top300Drugs.aspx" target="_blank" rel="noreferrer">
                ClinCalc DrugStats 2024
              </a>
              , built from AHRQ&rsquo;s Medical Expenditure Panel Survey. These are estimates.
            </li>
            <li>
              Average plan: $1,886 deductible (single coverage) from the{' '}
              <a href="https://www.kff.org/health-costs/2025-employer-health-benefits-survey/" target="_blank" rel="noreferrer">
                KFF 2025 Employer Health Benefits Survey
              </a>
              . The $11 / $37 / $67 / $116 tier copays are as reported by summaries of that survey&rsquo;s Section 9 and
              should be checked against the report before they are quoted.
            </li>
            <li>
              The {fmt(r.referenceDrugSpend)} average household drug spend:{' '}
              <a href="https://www.bls.gov/news.release/cesan.nr0.htm" target="_blank" rel="noreferrer">
                BLS Consumer Expenditure Survey 2024
              </a>
              .
            </li>
            <li>
              Three percent of disposable income left unspent:{' '}
              <a href="https://www.bea.gov/data/income-saving/personal-income" target="_blank" rel="noreferrer">
                BEA personal saving rate, July 2026
              </a>
              .
            </li>
          </ul>
          <span className="ctl-label" style={{ marginTop: 16 }}>
            Modelled &mdash; realistic, not authoritative
          </span>
          <ul className="srcs">
            <li>
              <b>Discount-card prices.</b> Typical, not quoted; they move week to week and by pharmacy.
            </li>
            <li>
              <b>The low-deductible and high-deductible plans</b>, and every plan&rsquo;s out-of-pocket maximum. KFF publishes
              the distribution of maximums, not an average.
            </li>
            <li>
              <b>The household&rsquo;s bank account is synthetic.</b> Its transactions are seeded, and the badge at the top
              says where they were read from: <em>Nessie seeded</em> (no sandbox attached), <em>Nessie replay</em>, or{' '}
              <em>Nessie live</em>. They are built to two published constraints: take-home is the Census median income at
              about 87% of gross (an aggregate ratio, not a tax return), split over 26 paychecks; and spending is
              calibrated to about 97 cents of each disposable dollar, the complement of the BEA saving rate.
            </li>
            <li>
              <b>The spare cash is not typed in.</b> It is derived from those transactions by the same detector that
              reads Maria&rsquo;s account: payroll cadence from the deposits, fixed bills from merchant repetition and
              amount stability, everyday spending from the rest. Real households vary enormously; a median household is
              the only defensible single one.
            </li>
            <li>
              <b>The two added programs</b> (rescue-inhaler card, free-clinic pharmacy) are realistic in shape and not a
              transcription of any live program&rsquo;s rules.
            </li>
            <li>
              <b>State and household size.</b> No state is average; Virginia is used so the state programs can be
              evaluated. The average household is 2.5 people and FPL needs a whole number, so it is rounded up to three.
            </li>
            <li>
              <b>Twelve months from today with the deductible untouched</b>: the worst timing, and easy to check by hand.
            </li>
            <li>
              <b>Manufacturer-card dollars count toward the deductible.</b> Plans that run a copay accumulator do not
              credit them. On such a plan a card on an expensive drug no longer clears the deductible for the rest of the
              basket, and the bill is higher than shown.
            </li>
          </ul>
          <p className="rule-note">
            The household is a composite. It does not exist, and nothing here is a purchasing decision or medical advice.
          </p>
        </div>
      </section>

      <footer className="footnote">
        <span>Composite household. No real PHI, no real prescription, no real enrollment.</span>
        <span>
          <a href="/">&larr; The panel board</a>
        </span>
        <span>
          <a href="/sticker-shock/prices">Price Shock: guess what care costs &rarr;</a>
        </span>
      </footer>
    </main>
  );
}
