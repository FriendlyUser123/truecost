'use client';

import { fmt } from '@/lib/money';
import type { BenefitResult, Cents } from '@/lib/types';

const PHASE_LABEL: Record<string, string> = {
  deductible: 'Paying the deductible',
  coinsurance: '20% coinsurance',
  copay: 'Flat copay',
  'oop-max-met': 'Out-of-pocket max met',
};

/**
 * Twelve bars, one per fill, plus a dashed line at what she actually has
 * spare each month. The argument the panel is making is visible before you
 * read a single figure: the first three bars are five times the line.
 */
export default function MonthStrip({
  benefit,
  capacityLine,
}: {
  benefit: BenefitResult;
  capacityLine: Cents;
}) {
  const peak = Math.max(...benefit.months.map((m) => m.patientPays), capacityLine, 1);
  // Only the bars with room for a figure get one. Nine identical $199.52
  // labels shingled on top of each other is noise, and the trace has them.
  const labelFloor = peak * 0.3;
  const phases = [...new Set(benefit.months.map((m) => m.phase))];

  return (
    <div className="strip">
      <div className="strip-plot">
        {benefit.months.map((m) => (
          <div
            key={m.monthIndex}
            className="bar"
            data-phase={m.phase}
            style={{ ['--h' as string]: ((m.patientPays / peak) * 100).toFixed(2) }}
            title={`${m.label}: ${fmt(m.patientPays)} — ${m.explanation}`}
          >
            {m.patientPays >= labelFloor && <span className="amt">{fmt(m.patientPays)}</span>}
            <div className="fill" />
          </div>
        ))}
        {capacityLine > 0 && (
          <div className="capline" style={{ ['--h' as string]: ((capacityLine / peak) * 100).toFixed(2) }}>
            <span>{fmt(capacityLine)} spare each month</span>
          </div>
        )}
      </div>
      <div className="strip-axis">
        {benefit.months.map((m) => (
          <span key={m.monthIndex}>{m.label}</span>
        ))}
      </div>
      <div className="legend">
        {phases.map((p) => (
          <span key={p}>
            <i style={{ background: barColor(p) }} />
            {PHASE_LABEL[p] ?? p}
          </span>
        ))}
        <span>
          <i style={{ background: 'transparent', borderTop: '2px dashed var(--alarm)', height: 0, width: 14 }} />
          What she has spare
        </span>
      </div>
    </div>
  );
}

function barColor(phase: string): string {
  switch (phase) {
    case 'deductible':
      return '#0e1726';
    case 'coinsurance':
      return '#3f7ab5';
    case 'copay':
      return '#7fa9d2';
    default:
      return 'var(--plan-lo)';
  }
}
