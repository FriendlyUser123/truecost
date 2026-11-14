'use client';

import { fmt } from '@/lib/money';
import type { BasketMonth, Cents } from '@/lib/types';

/**
 * Twelve bars, one per month of fills, plus a dashed line at the household's
 * monthly slack. Same drawing as the clinician panel's strip, but a household
 * basket has no single "phase" per month, so the only distinction that carries
 * information is whether the deductible was still being paid down.
 */
export default function BasketStrip({ months, slack }: { months: BasketMonth[]; slack: Cents }) {
  const peak = Math.max(...months.map((m) => m.total), slack, 1);
  const anyDeductible = months.some((m) => m.deductibleActive);

  return (
    <div className="strip">
      <div className="strip-plot">
        {months.map((m, i) => {
          // A run of twelve identical figures is noise. Label the first bar and
          // every bar that differs from the one before it.
          const showAmt = i === 0 || m.total !== (months[i - 1] as BasketMonth).total;
          return (
            <div
              key={m.label + i}
              className="bar"
              data-phase={m.deductibleActive ? 'deductible' : 'copay'}
              style={{ ['--h' as string]: ((m.total / peak) * 100).toFixed(2) }}
              title={`${m.label}: ${fmt(m.total)}${m.deductibleActive ? ' — deductible still being paid down' : ''}`}
            >
              {showAmt && m.total > 0 && <span className="amt">{fmt(m.total)}</span>}
              <div className="fill" />
            </div>
          );
        })}
        {slack > 0 && (
          <div className="capline" style={{ ['--h' as string]: ((slack / peak) * 100).toFixed(2) }}>
            <span>{fmt(slack)} slack each month</span>
          </div>
        )}
      </div>
      <div className="strip-axis">
        {months.map((m, i) => (
          <span key={m.label + i}>{m.label}</span>
        ))}
      </div>
      <div className="legend">
        {anyDeductible && (
          <span>
            <i style={{ background: '#0e1726' }} />
            Deductible still being paid down
          </span>
        )}
        <span>
          <i style={{ background: '#7fa9d2' }} />
          Steady monthly cost
        </span>
        <span>
          <i style={{ background: 'transparent', borderTop: '2px dashed var(--alarm)', height: 0, width: 14 }} />
          What the household has spare
        </span>
      </div>
    </div>
  );
}
