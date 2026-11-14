'use client';

import type { ReactNode } from 'react';
import { fmt } from '@/lib/money';
import type { ProgramEvaluation } from '@/lib/types';

const KIND: Record<string, string> = {
  'copay-card': 'Manufacturer copay card',
  'manufacturer-pap': 'Manufacturer patient assistance',
  'foundation-grant': 'Foundation grant',
  government: 'Government subsidy',
};

/**
 * Eight programs, every criterion evaluated, every failure explained in her
 * own numbers. A rules engine that only ever shows you winners is
 * indistinguishable from a hardcoded string.
 */
export default function Programs({
  evaluations,
  renderFigure,
}: {
  evaluations: ProgramEvaluation[];
  /**
   * What to print on the right of an eligible program. Defaults to the patient's
   * projected annual cost, which is right for one drug. A household basket
   * passes its own, because "what she would pay" is not one number there.
   */
  renderFigure?: (e: ProgramEvaluation) => ReactNode;
}) {
  const winner = evaluations.find((e) => e.eligible);

  return (
    <div className="progs">
      {evaluations.map((e) => {
        const cls = e.eligible ? (e === winner ? 'prog win' : 'prog pass') : 'prog fail';
        return (
          <article key={e.program.id} className={cls}>
            <div className="prog-head">
              <span className="nm">{e.program.name}</span>
              <span className="sp">
                {e.program.sponsor} · {KIND[e.program.kind] ?? e.program.kind}
              </span>
              <span className="rs">
                {e.eligible && renderFigure ? (
                  renderFigure(e)
                ) : e.eligible && e.projectedAnnualOop !== null ? (
                  <>
                    <span className="fig">{fmt(e.projectedAnnualOop)}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>/yr</span>
                  </>
                ) : null}
              </span>
              <span className="verdict">
                {e.eligible ? (e === winner ? 'BEST MATCH' : 'ELIGIBLE') : 'NOT ELIGIBLE'}
              </span>
            </div>
            <ul className="crits">
              {e.criteria.map((c, i) => (
                <li key={i} className={`crit ${c.passed ? 'y' : 'n'}`}>
                  <span className="mk" aria-hidden="true">
                    {c.passed ? '✓' : '✗'}
                  </span>
                  <span className="tx">
                    <b>{c.label}.</b> {c.detail}
                    <span className="sr-only">{c.passed ? ' Met.' : ' Not met.'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
