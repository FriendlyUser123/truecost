import path from 'node:path';
import { readJsonFile, writeJsonFile } from './fsjson';
import { cacheDir } from './nessie/client';
import { SUBJECTS } from './nessie/subjects';
import type { BridgeGrant, VerifiedStart } from './ready/types';
import type { BasketActivation } from './types';

/**
 * Where a bridge grant and its outcome are remembered between requests.
 *
 * A local JSON file, and deliberately nothing else. The previous version of
 * this file also wrote to Mongo Atlas when a URI happened to be set; that
 * connection was never actually made, so it was a failure mode we carried
 * without ever getting anything for it. One file, no network, no 9 AM surprise.
 *
 * The point of persisting at all: the fill is verified in a *later* request
 * than the one that granted the bridge, so the grant has to outlive its
 * response. Everything here is keyed by the candidate `ref`.
 */

const DIR = path.join(process.cwd(), 'data', 'cache');
const GRANTS = path.join(DIR, 'runtime-grants.json');
const STARTS = path.join(DIR, 'runtime-starts.json');

/** See lib/fsjson.ts: the deployed filesystem is read-only and refuses these. */
const readJson = readJsonFile;
const writeJson = writeJsonFile;

export async function saveGrant(grant: BridgeGrant): Promise<void> {
  const all = await readJson<BridgeGrant[]>(GRANTS, []);
  await writeJson(GRANTS, [...all.filter((g) => g.ref !== grant.ref), grant]);
}

export async function getGrant(ref: string): Promise<BridgeGrant | null> {
  const all = await readJson<BridgeGrant[]>(GRANTS, []);
  return all.find((g) => g.ref === ref) ?? null;
}

export async function listGrants(): Promise<BridgeGrant[]> {
  return readJson<BridgeGrant[]>(GRANTS, []);
}

export async function saveVerifiedStart(start: VerifiedStart): Promise<void> {
  const all = await readJson<VerifiedStart[]>(STARTS, []);
  await writeJson(STARTS, [...all.filter((s) => s.ref !== start.ref), start]);
}

export async function listVerifiedStarts(): Promise<VerifiedStart[]> {
  return readJson<VerifiedStart[]>(STARTS, []);
}

/** `npm run reset` — back to the opening frame between judges. */
export async function clearStore(): Promise<void> {
  await writeJson(GRANTS, []);
  await writeJson(STARTS, []);
}

/* ── the household's payday plans ────────────────────────────────────────── */

/**
 * The Ready board's grants are keyed by candidate, one per patient. A household
 * can run many scenarios (coverage level x medications), so its receipts are
 * keyed by scenario: pressing Activate on the same scenario twice returns the
 * SAME receipt and moves no money, while a genuinely different scenario is a
 * genuinely different plan.
 *
 * Unlike the grants above, this reads its directory lazily through cacheDir():
 * the household's tests run the whole write path against a temp directory, and
 * must never touch the files a demo ships with.
 */
const basketFile = () => path.join(cacheDir(), SUBJECTS.household.files.activation);

async function readBasketActivations(): Promise<Record<string, BasketActivation>> {
  const parsed = await readJson<Record<string, BasketActivation> | null>(basketFile(), null);
  return parsed ?? {};
}

export async function getBasketActivation(signature: string): Promise<BasketActivation | null> {
  return (await readBasketActivations())[signature] ?? null;
}

export async function saveBasketActivation(activation: BasketActivation): Promise<void> {
  const all = await readBasketActivations();
  all[activation.signature] = activation;
  await writeJson(basketFile(), all);
}

export async function clearBasketActivations(): Promise<void> {
  try {
    await writeJson(basketFile(), {});
  } catch {
    /* nothing to clear */
  }
}
