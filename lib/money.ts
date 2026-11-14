import type { Cents } from './types';

/** Parse "997.58" -> 99758. Used only by fixtures and API edges. */
export function dollars(amount: number): Cents {
  return Math.round(amount * 100);
}

export function fmt(c: Cents): string {
  const neg = c < 0;
  const v = Math.abs(c);
  const s = (v / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? '-' : ''}$${s}`;
}

/** No cents — for axis labels and big display numbers where precision is noise. */
export function fmtShort(c: Cents): string {
  const neg = c < 0;
  const v = Math.abs(c);
  return `${neg ? '-' : ''}$${Math.round(v / 100).toLocaleString('en-US')}`;
}

export function pct(rate: number): string {
  return `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 1)}%`;
}

/** Banker-free, deterministic: coinsurance always rounds half-up to the cent. */
export function applyRate(base: Cents, rate: number): Cents {
  return Math.round(base * rate);
}
