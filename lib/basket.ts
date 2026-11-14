import { DEMO_TODAY } from './dates';
import { readCapacity } from './engine/capacity';
import { buildBasket } from './engine/basket';
import {
  BASKET_CATALOG,
  BASKET_DRUGS,
  BLS_AVERAGE_DRUG_SPEND,
  COVERAGE_LEVELS,
  HOUSEHOLD,
} from './fixtures/household';
import { getLedger } from './nessie/client';
import type { LedgerSnapshot } from './nessie/types';
import type { BasketDrug, BasketResult, CoverageId, CoverageLevel, DataSource } from './types';

export const DEFAULT_COVERAGE: CoverageId = 'average';

export class BasketInputError extends Error {}

export interface BasketOptions {
  coverage?: string | null;
  drugs?: string[] | null;
}

export function defaultDrugIds(): string[] {
  return BASKET_DRUGS.filter((d) => d.defaultSelected).map((d) => d.id);
}

/**
 * Unknown coverage levels and unknown drug ids are rejected rather than
 * ignored — a silently dropped medication would understate the bill. This runs
 * BEFORE any bank call, so a bad request is a 400 and never a wasted (or, live,
 * a slow) trip to the Nessie sandbox.
 */
export function resolveInputs(opts: BasketOptions): { coverage: CoverageLevel; drugs: BasketDrug[] } {
  const coverageId = opts.coverage ?? DEFAULT_COVERAGE;
  const coverage = COVERAGE_LEVELS.find((c) => c.id === coverageId);
  if (!coverage) {
    throw new BasketInputError(
      `unknown coverage level "${coverageId}"; expected one of ${COVERAGE_LEVELS.map((c) => c.id).join(', ')}`,
    );
  }

  const ids = new Set(opts.drugs ?? defaultDrugIds());
  const unknown = [...ids].filter((id) => !BASKET_DRUGS.some((d) => d.id === id));
  if (unknown.length > 0) throw new BasketInputError(`unknown medication id: ${unknown.join(', ')}`);
  if (ids.size === 0) throw new BasketInputError('select at least one medication');

  // Always in rank order, so which drug absorbs the deductible does not depend
  // on the order the caller happened to list them in.
  return { coverage, drugs: BASKET_DRUGS.filter((d) => ids.has(d.id)) };
}

/** The identity of a scenario. Activating the same one twice must not move money twice. */
export function basketSignature(coverage: CoverageId, drugIds: readonly string[]): string {
  return `${coverage}:${[...drugIds].sort().join(',')}`;
}

/**
 * The whole computation, given a bank. Pure and synchronous: no network, no
 * disk, no environment. The clinician panel's chain (read the ledger, infer
 * capacity, adjudicate, match assistance, schedule) with a basket in the middle.
 */
export function computeBasketFromLedger(
  opts: BasketOptions,
  bank: { ledger: LedgerSnapshot; source: DataSource },
): BasketResult {
  const { coverage, drugs } = resolveInputs(opts);
  return buildBasket({
    household: HOUSEHOLD,
    coverage,
    drugs,
    programs: BASKET_CATALOG,
    today: DEMO_TODAY,
    referenceDrugSpend: BLS_AVERAGE_DRUG_SPEND,
    ledger: { capacity: readCapacity(bank.ledger, bank.source) },
  });
}

/**
 * Reads the household's account from Nessie — live, a recorded replay, or the
 * seeded ledger, exactly as the clinician panel does for Maria — and computes
 * the basket against what it finds there.
 */
export async function computeBasket(opts: BasketOptions = {}): Promise<BasketResult> {
  resolveInputs(opts);
  const bank = await getLedger('household');
  return computeBasketFromLedger(opts, bank);
}
