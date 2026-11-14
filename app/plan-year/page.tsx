import Link from 'next/link';
import { readCapacity } from '@/lib/engine/capacity';
import { drugById } from '@/lib/fixtures/formulary';
import { ANTHEM_HSA_3400 } from '@/lib/fixtures/plan';
import { MARIA } from '@/lib/fixtures/patient';
import { fmt, fmtShort } from '@/lib/money';
import { getLedger } from '@/lib/nessie/client';
import { buildPlanYear } from '@/lib/ready/planyear';
import s from '@/components/PlanYear.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Plan year — when the same drug becomes affordable',
  description:
    'The benefit engine says what the plan charges each month. The ledger says what she can absorb. Where they cross is when therapy can actually start.',
};

/**
 * The join between the two halves of the project.
 *
 * The panel board answers "which alerts are worth sending". This page answers
 * the question underneath it that a single copay figure hides: the copay is
 * not one number. On a high-deductible plan it is two numbers with a cliff
 * between them, and which side of the cliff the patient is standing on
 * decides whether the prescription is a timing problem or an impossible one.
 */
export default async function PlanYearPage() {
  const { ledger, source } = await getLedger();
  const capacity = readCapacity(ledger, source);
  const drug = drugById('semaglutide');
  if (!drug) throw new Error('semaglutide missing from the formulary');

  const py = buildPlanYear({ drug, plan: ANTHEM_HSA_3400, capacity });

  const peak = Math.max(...py.months.map((m) => m.patientPays), py.capacityMonthly);
  const pxFor = (c: number) => Math.max(3, Math.round((c / peak) * 186));
  const capTop = 186 - pxFor(py.capacityMonthly);

  return (
    <main className={s.shell}>
      <header className={s.masthead}>
        <span className={s.wordmark}>Ready.</span>
        <Link href="/" className={s.back}>← Panel board</Link>
        <span className={s.spacer} />
        <span className={s.badge}>Nessie {source}</span>
      </header>

      <p className={s.eyebrow}>Plan year · {MARIA.firstName} {MARIA.lastName} · {py.planName}</p>
      <h1 className={s.headline}>{py.headline}</h1>
      <p className={s.sub}>
        The panel board shows one copay because a prescription has one price <em>today</em>. It does
        not. On a high-deductible plan the same fill is {fmt(py.months[0]?.patientPays ?? 0)} while the
        deductible is open and {fmt(py.firstClearingMonth?.patientPays ?? 0)} once it clears. Plan design
        and pay cycle are owned by different systems that never speak, so this crossing has never been
        on one screen.
      </p>

      <section className={s.chartCard}>
        <div className={s.chartHead}>
          <span className={s.chartTitle}>{py.drugLabel} · what the plan charges, month by month</span>
          <span className={s.legend}>
            <span className={s.key}><i className={`${s.swatch} ${s.swBlocked}`} /> above her capacity</span>
            <span className={s.key}><i className={`${s.swatch} ${s.swClear}`} /> clears</span>
            <span className={s.key}><i className={`${s.swatch} ${s.swCap}`} /> monthly capacity {fmt(py.capacityMonthly)}</span>
          </span>
        </div>

        <div className={s.bars}>
          <span className={s.capLine} style={{ top: `${capTop + 6}px` }}>
            <span className={s.capLabel}>{fmt(py.capacityMonthly)} capacity</span>
          </span>
          {py.months.map((m) => (
            <div key={m.monthIndex} className={s.col}>
              <span className={s.barAmt}>{fmtShort(m.patientPays)}</span>
              <span
                className={`${s.bar} ${m.clears ? s.barClear : s.barBlocked} ${
                  m.label === py.firstClearingMonth?.label ? s.crossing : ''
                }`}
                style={{ height: `${pxFor(m.patientPays)}px` }}
              />
            </div>
          ))}
        </div>
        <div className={s.axis}>
          {py.months.map((m) => (
            <span
              key={m.monthIndex}
              className={`${s.axisLabel} ${m.label === py.firstClearingMonth?.label ? s.axisCross : ''}`}
            >
              {m.label}
            </span>
          ))}
        </div>
      </section>

      <section className={s.stats}>
        <div className={s.stat}>
          <span className={`${s.statN} ${s.statBad}`}>{py.monthsBlocked}</span>
          <span className={s.statC}>months she cannot start, at any point in them</span>
        </div>
        <div className={s.stat}>
          <span className={`${s.statN} ${s.statOk}`}>{py.firstClearingMonth?.label ?? '—'}</span>
          <span className={s.statC}>
            {py.firstClearingMonth
              ? 'the first month the fill fits inside her capacity'
              : 'no month clears this plan year'}
          </span>
        </div>
        <div className={s.stat}>
          <span className={s.statN}>{fmt(py.blockedOutlay)}</span>
          <span className={s.statC}>what she would have to absorb to reach that month</span>
        </div>
        <div className={s.stat}>
          <span className={s.statN}>{fmt(py.annualOop)}</span>
          <span className={s.statC}>projected out of pocket across the plan year</span>
        </div>
      </section>

      <div className={s.cols}>
        <div className={`${s.note} ${s.noteAlarm}`}>
          <p className={s.noteTitle}>Why one copay is a lie</p>
          <p>
            Ask &ldquo;can she afford this drug?&rdquo; and there are <strong>twelve answers</strong>.
            Three months of {fmt(py.months[0]?.patientPays ?? 0)} and nine of{' '}
            {fmt(py.firstClearingMonth?.patientPays ?? 0)} are not the same product, and a real-time
            benefit check that quotes today&rsquo;s number tells her doctor the wrong one for a quarter
            of the year.
          </p>
          <p>
            A therapy she can only begin in <strong>{py.firstClearingMonth?.label ?? 'no month'}</strong>{' '}
            is a therapy she does not begin. The barrier is the deductible, not the price.
          </p>
        </div>
        <div className={s.note}>
          <p className={s.noteTitle}>What this changes on the board</p>
          <p>
            A <strong>STRUCTURAL</strong> verdict in September is not permanent — it is the deductible
            phase. The same patient is <strong>TIMING</strong> from{' '}
            {py.firstClearingMonth?.label ?? '—'}, and the right intervention is completely different
            on either side of that line.
          </p>
          <p>
            Nothing in a claims feed, a PBM or a benefit tool holds both halves of this chart. One side
            needs the plan&rsquo;s accumulators; the other needs her bank.
          </p>
        </div>
      </div>

      <ol className={s.pipeline}>
        <li className={s.stage}>
          <b>Plan design → what she owes.</b> Deductible remaining, tier, coinsurance, twelve months of
          accumulator roll-forward. <span className={s.stageWho}>lib/engine/benefit.ts</span>
        </li>
        <li className={s.stage}>
          <b>Bank ledger → what she can absorb.</b> Payroll cadence, recurring obligations and the
          essential floor, inferred from posted transactions.{' '}
          <span className={s.stageWho}>lib/engine/capacity.ts</span>
        </li>
        <li className={s.stage}>
          <b>Both → the crossing.</b> The first month the fill fits, and what it costs to get there.{' '}
          <span className={s.stageWho}>lib/ready/planyear.ts</span>
        </li>
        <li className={s.stage}>
          <b>Crossing + clinical window → whether anyone is told.</b> Most of the time, nobody is.{' '}
          <span className={s.stageWho}>lib/ready/liquidity.ts · attention.ts</span>
        </li>
      </ol>

      <details className={s.drawer}>
        <summary>Where every number came from</summary>
        <ol className={s.traceList}>
          {py.trace.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </details>

      <p className={s.foot}>
        {MARIA.firstName} {MARIA.lastName} is a synthetic patient — no real health data. The plan is a
        real-shaped HDHP fixture; the arithmetic over it is the same engine the test suite checks
        against hand calculations. Capacity is read from the {source === 'live' ? 'live' : source}{' '}
        Capital One Nessie ledger.
      </p>
    </main>
  );
}
