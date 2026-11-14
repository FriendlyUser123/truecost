/**
 * The Sticker Shock question bank, and the dealing of it.
 *
 * This file is the single source of truth for two things that must never drift
 * apart: the web page at /sticker-shock, and the HokieAI agent whose
 * instructions `npm run export:hokieai` generates from this same data. It has
 * no React and no imports, and like the page it shares nothing with the
 * clinician panel.
 *
 * Every price is a real, published figure with its source printed next to it.
 * The questions are curated rather than generated on purpose: a language model
 * asked to "make up a healthcare price question" will make up the price too,
 * and a game whose whole claim is "these are the real numbers" cannot survive
 * that. What is random is WHICH three you are dealt, never what they cost.
 */

export type Topic = 'rx-acute' | 'rx-chronic' | 'transport' | 'hospital' | 'birth';
export type ScaleId = 'rx' | 'care';

export interface Item {
  id: string;
  /** No round ever deals two questions from the same topic. */
  topic: Topic;
  scale: ScaleId;
  label: string;
  detail: string;
  /** What it actually costs, in dollars. */
  truth: number;
  source: string;
  /** Slider starts here so the anchor is not the answer. */
  start: number;
}

/** Log sliders, so $5 and $100,000 are both reachable with a thumb. */
export const SCALES: Record<ScaleId, { min: number; max: number }> = {
  rx: { min: 5, max: 4_000 },
  care: { min: 50, max: 100_000 },
};

export const BANK: Item[] = [
  {
    id: 'inhaler',
    topic: 'rx-acute',
    scale: 'rx',
    label: 'One albuterol rescue inhaler',
    detail: 'The blue one. Cash price at a chain pharmacy, no insurance.',
    truth: 89,
    source: 'retail cash price, US chain pharmacy',
    start: 40,
  },
  {
    id: 'epipen',
    topic: 'rx-acute',
    scale: 'rx',
    label: 'An EpiPen two-pack',
    detail: 'The one a parent buys every autumn because the old one expired.',
    truth: 730,
    source: 'manufacturer list price',
    start: 120,
  },
  {
    id: 'narcan',
    topic: 'rx-acute',
    scale: 'rx',
    label: 'A two-pack of Narcan nasal spray',
    detail: 'The overdose-reversal spray, now sold over the counter. Two doses in the box.',
    truth: 45,
    source: 'over-the-counter retail price, two-pack (Emergent BioSolutions, 2023)',
    start: 12,
  },
  {
    id: 'atorvastatin',
    topic: 'rx-chronic',
    scale: 'rx',
    label: 'A month of generic atorvastatin',
    detail: 'The cholesterol pill more Americans take than any other. Thirty tablets, cash, no insurance.',
    truth: 16.5,
    source: 'retail cash price, US chain pharmacy',
    start: 80,
  },
  {
    id: 'humalog',
    topic: 'rx-chronic',
    scale: 'rx',
    label: 'A 10 mL vial of Humalog insulin',
    detail: 'The mealtime insulin. List price, before any insurance.',
    truth: 66.4,
    source: "manufacturer list price after Eli Lilly's 2023 cut",
    start: 250,
  },
  {
    id: 'ozempic',
    topic: 'rx-chronic',
    scale: 'rx',
    label: 'One month of Ozempic',
    detail: 'One pen, one month, no insurance.',
    truth: 1178,
    source: 'retail cash price, US chain pharmacy',
    start: 300,
  },
  {
    id: 'ambulance',
    topic: 'transport',
    scale: 'care',
    label: 'A four-mile ambulance ride',
    detail: 'Ground transport, advanced life support. Four miles.',
    truth: 1277,
    source: 'mean US ground ambulance charge',
    start: 260,
  },
  {
    id: 'air-ambulance',
    topic: 'transport',
    scale: 'care',
    label: 'A helicopter ambulance ride',
    detail: 'Air transport from the scene to a hospital. The charge, before any insurance gets involved.',
    truth: 36_400,
    source: 'median charge for a helicopter transport (US GAO, 2017 data)',
    start: 4_000,
  },
  {
    id: 'er-copay',
    topic: 'hospital',
    scale: 'care',
    label: 'The typical ER copay on employer insurance',
    detail: 'Not the bill. Just the flat fee printed on the insurance card, for plans that charge one.',
    truth: 217,
    source: 'KFF Employer Health Benefits Survey 2023, average copayment',
    start: 60,
  },
  {
    id: 'hospital-day',
    topic: 'hospital',
    scale: 'care',
    label: 'One night in a US hospital',
    detail: 'What the hospital itself spends to staff, feed and run a single inpatient day. Not the bill you get.',
    truth: 3_449,
    source: 'KFF State Health Facts, nonprofit hospitals (AHA survey, 2024)',
    start: 800,
  },
  {
    id: 'birth-total',
    topic: 'birth',
    scale: 'care',
    label: 'Having a baby, all in',
    detail: 'Everything billed for pregnancy, birth and postpartum care, for a woman on a large employer plan.',
    truth: 20_416,
    source: 'Peterson-KFF Health System Tracker, employer plans',
    start: 4_000,
  },
  {
    id: 'birth-oop',
    topic: 'birth',
    scale: 'care',
    label: 'What she pays herself for that',
    detail: 'Of that whole bill, the part that comes out of her own pocket, even with insurance.',
    truth: 2_743,
    source: 'Peterson-KFF Health System Tracker, employer plans',
    start: 600,
  },
];

/* ── slider maths ────────────────────────────────────────────────────────── */

/** $16.50 stays $16.50; $20,415.87 is not a number anyone means. */
function snap(v: number): number {
  if (v >= 10_000) return Math.round(v / 100) * 100;
  if (v >= 1_000) return Math.round(v / 10) * 10;
  return Math.round(v);
}

export function toValue(scale: ScaleId, t: number): number {
  const { min, max } = SCALES[scale];
  return snap(Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))));
}

export function toSlider(scale: ScaleId, v: number): number {
  const { min, max } = SCALES[scale];
  const clamped = Math.min(max, Math.max(min, v));
  return (Math.log(clamped) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

/** Whole dollars, except a price under $100 that has cents keeps them. */
export function formatUsd(n: number): string {
  const cents = n < 100 && !Number.isInteger(n);
  return `$${(cents ? n.toFixed(2) : Math.round(n).toString()).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Four tick labels at the ends and thirds of the log scale, to two significant figures. */
export function scaleLabels(scale: ScaleId): string[] {
  return [0, 1 / 3, 2 / 3, 1].map((t) => {
    const raw = toValue(scale, t);
    const step = 10 ** (Math.max(0, Math.floor(Math.log10(raw)) - 1));
    return formatUsd(Math.round(raw / step) * step);
  });
}

/* ── dealing ─────────────────────────────────────────────────────────────── */

/** Small, fast, seedable. The HokieAI decks are dealt with this so they are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Deals three questions from three different topics, so a round never asks for
 * the price of both an inhaler and an EpiPen back to back or two halves of the
 * same childbirth bill. `seen` is what this person has already been asked;
 * those are skipped until fewer than three topics remain, then history resets.
 */
export function pickQuestions(rand: () => number, seen: readonly string[] = []): Item[] {
  let pool = BANK.filter((i) => !seen.includes(i.id));
  if (new Set(pool.map((i) => i.topic)).size < 3) pool = BANK.slice();

  const picked: Item[] = [];
  const topics = new Set<Topic>();
  for (const it of shuffle(pool, rand)) {
    if (topics.has(it.topic)) continue;
    picked.push(it);
    topics.add(it.topic);
    if (picked.length === 3) break;
  }
  return picked;
}

/**
 * `?q=inhaler,humalog,birth-total` — a friend's link that deals you the same
 * three questions. Anything that is not exactly three known, distinct ids is
 * ignored rather than trusted, and the page falls back to a random deal.
 */
export function parseQuestionIds(raw: string | null | undefined): Item[] | null {
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim());
  if (ids.length !== 3 || new Set(ids).size !== 3) return null;
  const items = ids.map((id) => BANK.find((i) => i.id === id));
  return items.every((i): i is Item => i !== undefined) ? items : null;
}

/* ── the verdict ─────────────────────────────────────────────────────────── */

export interface Tier {
  max: number;
  title: string;
  line: string;
}

/** Ordered by how wrong you were. The copy is the whole product here. */
export const TIERS_LOW: Tier[] = [
  { max: 20, title: 'You have read a medical bill.', line: 'Within twenty percent across all three. Either you work in healthcare or something expensive happened to you.' },
  { max: 60, title: 'Close enough to be furious.', line: 'You knew it was bad. You did not know it was this bad. Nobody does, which is the entire problem.' },
  { max: 150, title: "You'd make a dangerously optimistic doctor.", line: 'You lowballed American healthcare by more than double. So does the person writing your prescriptions.' },
  { max: 400, title: 'You have very good insurance.', line: 'You have never seen the sticker because someone else has always been paying it. Twenty-six million Americans have seen it.' },
  { max: Number.POSITIVE_INFINITY, title: 'You have never once looked at a bill.', line: 'Off by several multiples on every single one. Honestly, protect that. It is a nice way to live.' },
];

export const TIERS_HIGH: Tier[] = [
  { max: 20, title: 'You have read a medical bill.', line: 'Within twenty percent across all three. Either you work in healthcare or something expensive happened to you.' },
  { max: 60, title: 'Scarred, but accurate.', line: 'You guessed high and you were nearly right. Somebody has handed you an invoice you are still thinking about.' },
  { max: 150, title: 'You have been to an American ER.', line: 'You overshot, which almost nobody does. Whatever happened to you, it left a mark on your estimating.' },
  { max: Number.POSITIVE_INFINITY, title: 'You have given up entirely.', line: 'You assumed the worst and then doubled it. Reasonable instinct. Still wrong, somehow.' },
];

/** The score: mean absolute percentage error, and which way the errors lean. */
export function score(items: readonly Item[], guesses: readonly number[]): {
  meanAbs: number;
  guessedLow: boolean;
  tier: Tier;
} {
  const errors = items.map((it, i) => ((guesses[i] ?? it.start) - it.truth) / it.truth);
  const meanAbs = items.length ? (errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length) * 100 : 0;
  const guessedLow = errors.reduce((a, e) => a + e, 0) < 0;
  const table = guessedLow ? TIERS_LOW : TIERS_HIGH;
  const tier = table.find((t) => meanAbs <= t.max) ?? (TIERS_LOW[TIERS_LOW.length - 1] as Tier);
  return { meanAbs, guessedLow, tier };
}
