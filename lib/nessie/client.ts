import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../fsjson';
import { DEMO_TODAY, dayOfMonth } from '../dates';
import { dollars } from '../money';
import type { VerifiedStart } from '../ready/types';
import type { Cents, DataSource } from '../types';
import { SUBJECTS, type Subject } from './subjects';
import type { LedgerSnapshot, NessieAtm, NessieBill, NessiePurchase, NessieTransfer } from './types';

const BASE = process.env.NESSIE_BASE_URL ?? 'https://api.nessieisreal.com';

/**
 * Where the replay cache and the runtime overlay live. Read lazily so a test can
 * point it at a temp directory and exercise real writes without touching the
 * files the demo ships with.
 */
export function cacheDir(): string {
  return process.env.TRUECOST_CACHE_DIR?.trim() || path.join(process.cwd(), 'data', 'cache');
}

/**
 * Three modes, one interface.
 *
 *   live     — real HTTP against api.nessieisreal.com. Every response is
 *              written through to data/cache/nessie-recorded*.json.
 *   recorded — replays that cache. RECORDED=1 forces it even with a key set.
 *              This is the demo's life insurance: a dead sandbox at 9am
 *              produces an identical screen instead of an empty table.
 *   demo     — no key, no cache: builds the ledger from lib/fixtures. This is
 *              what a judge gets when they clone the repo on a plane.
 *
 * Writes in recorded and demo mode are applied to a runtime overlay on disk,
 * so a transfer really does change what the next GET returns. The balance drop
 * on screen is a refetch, never an animation.
 *
 * Every function that reads or writes a customer's account takes an optional
 * `subject`: whose account this is. It defaults to Maria — the patient the Ready
 * board, the bridge and the fill verification all operate on — so nothing written
 * before the household segment existed changed behaviour. The median household
 * on /average-american is a second, independent customer. See ./subjects.ts.
 */

export interface RuntimeState {
  balanceDelta: Cents;
  bills: NessieBill[];
  transfers: NessieTransfer[];
  /** Fills posted by recordFill. verifyStart reads them back as settlements. */
  purchases: NessiePurchase[];
  updatedAt: string;
}

const EMPTY_STATE: RuntimeState = {
  balanceDelta: 0,
  bills: [],
  transfers: [],
  purchases: [],
  updatedAt: '',
};

export function nessieMode(): DataSource {
  const key = process.env.NESSIE_API_KEY?.trim();
  if (process.env.RECORDED === '1') return 'recorded';
  if (key) return 'live';
  return 'demo';
}

const envValue = (name: string): string => process.env[name]?.trim() ?? '';

/**
 * The mode for one subject. Maria keeps her original strictness: a key with no
 * customer id is a configuration error and fails loudly. The household is
 * optional — someone who seeded only Maria into their sandbox should still get
 * a working household page — so a key without the household's ids means it runs
 * on its seeded ledger, and says so on screen rather than claiming to be live.
 */
export function modeFor(subject: Subject = 'maria'): DataSource {
  const mode = nessieMode();
  if (mode !== 'live' || subject === 'maria') return mode;
  return envValue(SUBJECTS[subject].env.customer) ? 'live' : 'demo';
}

/**
 * Both of these used to be written out here against node:fs directly. They now
 * route through lib/fsjson.ts, which absorbs a read-only filesystem — see the
 * comment there; the deployed site runs from one.
 */
const readJson = readJsonFile;
const writeJson = writeJsonFile;

const recordedFile = (s: Subject) => path.join(cacheDir(), SUBJECTS[s].files.recorded);
const runtimeFile = (s: Subject) => path.join(cacheDir(), SUBJECTS[s].files.runtime);

export async function readRuntimeState(subject: Subject = 'maria'): Promise<RuntimeState> {
  // Spread over EMPTY_STATE rather than casting: a runtime-state.json written
  // before `purchases` existed is still on disk in every checkout that ran the
  // demo once, and `state.purchases.length` on that file throws.
  const stored = await readJson<Partial<RuntimeState>>(runtimeFile(subject), {});
  return { ...EMPTY_STATE, ...stored };
}

export async function resetRuntimeState(subject: Subject = 'maria'): Promise<void> {
  await writeJson(runtimeFile(subject), { ...EMPTY_STATE, updatedAt: new Date().toISOString() });
}

/* ── live HTTP ───────────────────────────────────────────────────────────── */

async function api<T>(route: string, init?: RequestInit): Promise<T> {
  const key = process.env.NESSIE_API_KEY?.trim();
  if (!key) throw new Error('NESSIE_API_KEY is not set');
  const sep = route.includes('?') ? '&' : '?';
  // Venue wifi and the Nessie sandbox are both unreliable. Without a hard
  // ceiling a slow socket hangs the whole panel; 20s then fall back to the
  // recorded ledger is always better than a dead screen in front of a judge.
  const res = await fetch(`${BASE}${route}${sep}key=${encodeURIComponent(key)}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Nessie ${init?.method ?? 'GET'} ${route} -> ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface NessieCreateResponse {
  code: number;
  message: string;
  objectCreated: { _id: string };
}

async function fetchLiveLedger(customerId: string): Promise<LedgerSnapshot> {
  const accounts = await api<LedgerSnapshot['checking'][]>(`/customers/${customerId}/accounts`);
  const checking = accounts.find((a) => a.type === 'Checking');
  const savings = accounts.find((a) => a.type === 'Savings');
  if (!checking || !savings) throw new Error('customer is missing a Checking or Savings account');

  const [deposits, withdrawals, purchases, transfers, bills, merchants] = await Promise.all([
    api<LedgerSnapshot['deposits']>(`/accounts/${checking._id}/deposits`),
    api<LedgerSnapshot['withdrawals']>(`/accounts/${checking._id}/withdrawals`),
    api<LedgerSnapshot['purchases']>(`/accounts/${checking._id}/purchases`),
    api<LedgerSnapshot['transfers']>(`/accounts/${checking._id}/transfers`),
    api<LedgerSnapshot['bills']>(`/accounts/${checking._id}/bills`),
    api<LedgerSnapshot['merchants']>('/merchants'),
  ]);

  const used = new Set(purchases.map((p) => p.merchant_id));
  return {
    customerId,
    checking,
    savings,
    merchants: merchants.filter((m) => used.has(m._id)),
    deposits,
    withdrawals,
    purchases,
    transfers,
    bills,
  };
}

/* ── the one function the app calls ──────────────────────────────────────── */

export async function getLedger(
  subject: Subject = 'maria',
): Promise<{ ledger: LedgerSnapshot; source: DataSource }> {
  const cfg = SUBJECTS[subject];
  const mode = modeFor(subject);

  if (mode === 'live') {
    const customerId = envValue(cfg.env.customer);
    if (!customerId) throw new Error(`${cfg.env.customer} is not set`);
    try {
      const ledger = await fetchLiveLedger(customerId);
      await writeJson(recordedFile(subject), ledger); // write-through
      return { ledger, source: 'live' };
    } catch (err) {
      // The sandbox is down. Do not show a judge an empty table.
      console.warn(`[nessie] live read failed for ${subject}, falling back to recorded cache:`, err);
      const cached = await readJson<LedgerSnapshot | null>(recordedFile(subject), null);
      if (cached) return { ledger: await withOverlay(cached, subject), source: 'recorded' };
      return { ledger: await withOverlay(cfg.build(), subject), source: 'demo' };
    }
  }

  if (mode === 'recorded') {
    const cached = await readJson<LedgerSnapshot | null>(recordedFile(subject), null);
    if (cached) return { ledger: await withOverlay(cached, subject), source: 'recorded' };
  }

  return { ledger: await withOverlay(cfg.build(), subject), source: 'demo' };
}

async function withOverlay(ledger: LedgerSnapshot, subject: Subject): Promise<LedgerSnapshot> {
  const state = await readRuntimeState(subject);
  if (state.balanceDelta === 0 && state.bills.length === 0 && state.purchases.length === 0) {
    return ledger;
  }
  return {
    ...ledger,
    checking: { ...ledger.checking, balance: ledger.checking.balance + state.balanceDelta / 100 },
    transfers: [...ledger.transfers, ...state.transfers],
    bills: [...ledger.bills, ...state.bills],
    purchases: [...ledger.purchases, ...state.purchases],
  };
}

export async function getCheckingBalance(
  subject: Subject = 'maria',
): Promise<{ balance: Cents; source: DataSource }> {
  const { ledger, source } = await getLedger(subject);
  return { balance: dollars(ledger.checking.balance), source };
}

/* ── writes ──────────────────────────────────────────────────────────────── */

export interface BillDraft {
  payee: string;
  nickname: string;
  amount: Cents;
  dueDate: string;
}

export async function createBills(
  drafts: BillDraft[],
  subject: Subject = 'maria',
): Promise<{ ids: string[]; source: DataSource }> {
  const cfg = SUBJECTS[subject];
  const mode = modeFor(subject);
  const accountId = envValue(cfg.env.checking);

  if (mode === 'live' && accountId) {
    try {
      const ids: string[] = [];
      for (const d of drafts) {
        const created = await api<NessieCreateResponse>(`/accounts/${accountId}/bills`, {
          method: 'POST',
          body: JSON.stringify({
            status: 'pending',
            payee: d.payee,
            nickname: d.nickname,
            payment_date: d.dueDate,
            recurring_date: dayOfMonth(d.dueDate),
            upcoming_payment_date: d.dueDate,
            payment_amount: d.amount / 100,
          }),
        });
        ids.push(created.objectCreated._id);
      }
      return { ids, source: 'live' };
    } catch (err) {
      console.warn('[nessie] live bill write failed, recording locally:', err);
    }
  }

  const state = await readRuntimeState(subject);
  const bills: NessieBill[] = drafts.map((d, i) => ({
    _id: `bill-${Date.now().toString(36)}-${i}`,
    status: 'pending',
    payee: d.payee,
    nickname: d.nickname,
    creation_date: DEMO_TODAY,
    recurring_date: dayOfMonth(d.dueDate),
    upcoming_payment_date: d.dueDate,
    payment_amount: d.amount / 100,
    account_id: cfg.demoCheckingId,
  }));
  await writeJson(runtimeFile(subject), {
    ...state,
    bills: [...state.bills, ...bills],
    updatedAt: new Date().toISOString(),
  } satisfies RuntimeState);
  return { ids: bills.map((b) => b._id), source: mode === 'live' ? 'recorded' : mode };
}

export async function executeTransfer(args: {
  amount: Cents;
  description: string;
  payeeId?: string;
  subject?: Subject;
}): Promise<{ id: string; source: DataSource }> {
  const subject = args.subject ?? 'maria';
  const cfg = SUBJECTS[subject];
  const mode = modeFor(subject);
  const accountId = envValue(cfg.env.checking);
  const payeeId = args.payeeId ?? envValue(cfg.env.payee);

  if (mode === 'live' && accountId) {
    try {
      const created = await api<NessieCreateResponse>(`/accounts/${accountId}/transfers`, {
        method: 'POST',
        body: JSON.stringify({
          amount: args.amount / 100,
          transaction_date: DEMO_TODAY,
          status: 'completed',
          description: args.description,
        }),
      });
      return { id: created.objectCreated._id, source: 'live' };
    } catch (err) {
      console.warn('[nessie] live transfer failed, recording locally:', err);
    }
  }

  const state = await readRuntimeState(subject);
  const transfer: NessieTransfer = {
    _id: `trf-${Date.now().toString(36)}`,
    type: 'transfer',
    transaction_date: DEMO_TODAY,
    status: 'completed',
    medium: 'balance',
    payer_id: cfg.demoCheckingId,
    payee_id: payeeId || cfg.demoPayeeId,
    amount: args.amount / 100,
    description: args.description,
  };
  await writeJson(runtimeFile(subject), {
    ...state,
    balanceDelta: state.balanceDelta - args.amount,
    transfers: [...state.transfers, transfer],
    updatedAt: new Date().toISOString(),
  } satisfies RuntimeState);
  return { id: transfer._id, source: mode === 'live' ? 'recorded' : mode };
}

/* ── ATMs ────────────────────────────────────────────────────────────────── */

/**
 * The demo-mode ATM set: four real cash points inside the Roanoke Valley,
 * positioned around the two pharmacy geocodes the seed script creates.
 *
 * It lives here rather than in lib/fixtures because it exists only to keep
 * `getAtmsNear` answerable with no key and no cache — the same reason
 * buildLedger() exists. Two of the four are deliberately unusable: one has no
 * wheelchair access, one is nearly out of cash. A filter that never excludes
 * anything is not a filter, and a judge should be able to see it bite.
 */
const DEMO_ATMS: NessieAtm[] = [
  {
    _id: 'atm-electric-rd',
    name: 'Member One FCU — Electric Road',
    language_list: ['English', 'Spanish'],
    address: {
      street_number: '3221',
      street_name: 'Electric Rd',
      city: 'Roanoke',
      state: 'VA',
      zip: '24018',
    },
    geocode: { lat: 37.2385, lng: -80.0031 },
    amount_left: 9800,
    accessibility: true,
    hours: ['00:00-23:59'],
  },
  {
    _id: 'atm-towers',
    name: 'Freedom First — Towers Shopping Center',
    language_list: ['English', 'Spanish'],
    address: {
      street_number: '2203',
      street_name: 'Colonial Ave SW',
      city: 'Roanoke',
      state: 'VA',
      zip: '24015',
    },
    geocode: { lat: 37.2517, lng: -79.9666 },
    amount_left: 4200,
    accessibility: true,
    hours: ['06:00-22:00'],
  },
  {
    // Closest machine to the Williamson Rd pharmacy, and the one a patient who
    // uses a wheelchair cannot use. Excluded, not ranked lower.
    _id: 'atm-williamson',
    name: 'Blue Eagle CU — Williamson Road',
    language_list: ['English'],
    address: {
      street_number: '3348',
      street_name: 'Williamson Rd NW',
      city: 'Roanoke',
      state: 'VA',
      zip: '24012',
    },
    geocode: { lat: 37.3072, lng: -79.952 },
    amount_left: 1500,
    accessibility: false,
    hours: ['00:00-23:59'],
  },
  {
    // Accessible and open, but nearly drained. Excluded once minCash is set.
    _id: 'atm-city-market',
    name: 'Roanoke City Market',
    language_list: ['English'],
    address: {
      street_number: '32',
      street_name: 'Market Sq SE',
      city: 'Roanoke',
      state: 'VA',
      zip: '24011',
    },
    geocode: { lat: 37.2707, lng: -79.9392 },
    amount_left: 40,
    accessibility: true,
    hours: ['08:00-20:00'],
  },
];

const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle miles. Rounded to one decimal — the card prints "1.2 mi". */
function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  const miles = 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(miles * 10) / 10;
}

/**
 * Cash points within `radMiles` of a point, usable by this patient.
 *
 * `minCash` is the copay: a machine holding less than the number the patient
 * came for is not a place they can fill the prescription, so it is dropped
 * rather than shown greyed out. Same for `accessibility`.
 *
 * Nearest first. Distance is attached because the caller cannot recompute it
 * without the query centre.
 */
export async function getAtmsNear(
  lat: number,
  lng: number,
  radMiles: number,
  minCash: Cents = 0,
): Promise<NessieAtm[]> {
  const mode = nessieMode();

  if (mode === 'live') {
    try {
      // VERIFIED GOTCHA: /atms answers with a wrapped page {code,message,data}
      // while /merchants answers with a bare array. Same API, same day.
      const raw = await api<NessieAtm[] | { data?: NessieAtm[] }>(
        `/atms?lat=${lat}&lng=${lng}&rad=${radMiles}`,
      );
      const rows = Array.isArray(raw) ? raw : (raw.data ?? []);
      return usableAtms(rows, lat, lng, radMiles, minCash);
    } catch (err) {
      // An empty ATM row is survivable; a thrown request in front of a judge
      // is not. Same posture as getLedger().
      console.warn('[nessie] live ATM read failed, falling back to the demo set:', err);
    }
  }

  return usableAtms(DEMO_ATMS, lat, lng, radMiles, minCash);
}

function usableAtms(
  rows: NessieAtm[],
  lat: number,
  lng: number,
  radMiles: number,
  minCash: Cents,
): NessieAtm[] {
  return rows
    .filter((a) => a.accessibility === true)
    // amount_left is dollars on the wire; minCash is cents. Compare in cents.
    .filter((a) => dollars(a.amount_left) >= minCash)
    .map((a) => ({ ...a, distanceMiles: milesBetween(lat, lng, a.geocode.lat, a.geocode.lng) }))
    // Nessie's own `rad` filter is generous and the demo set is unfiltered, so
    // enforce the radius here in both modes rather than trusting the server.
    .filter((a) => (a.distanceMiles ?? Infinity) <= radMiles)
    .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
}

/* ── the bridge and the settlement ───────────────────────────────────────── */

/**
 * The account the overlay's balance actually belongs to. In demo and recorded
 * mode there is exactly one ledger on screen — the patient's — so money only
 * moves the displayed balance when it is that account being credited or
 * debited. A transfer between two other accounts is recorded and shows no
 * balance change, which is the truth.
 *
 * The patient is Maria. The Ready board, the bridge and the fill verification
 * all operate on her; the median household is a separate customer with its own
 * account and never appears here.
 */
function patientCheckingId(): string {
  return envValue(SUBJECTS.maria.env.checking) || SUBJECTS.maria.demoCheckingId;
}

/**
 * A real P2P transfer from the bridge funder's account into the patient's.
 *
 * Not a simulation and not an escrow abstraction: two Nessie customers exist,
 * one of them is an independent charitable foundation with $4,000, and after
 * this call both balances have moved. `ref` is carried in the description so
 * the grant and the fill it paid for can be matched later.
 */
export async function bridgeTransfer(a: {
  amount: Cents;
  fromAccountId: string;
  toAccountId: string;
  ref: string;
}): Promise<{ id: string; source: DataSource }> {
  const mode = nessieMode();
  const description = `BRIDGE-${a.ref}`;

  if (mode === 'live' && a.fromAccountId) {
    try {
      const created = await api<NessieCreateResponse>(`/accounts/${a.fromAccountId}/transfers`, {
        method: 'POST',
        body: JSON.stringify({
          medium: 'balance',
          payee_id: a.toAccountId,
          amount: a.amount / 100,
          transaction_date: DEMO_TODAY,
          status: 'completed',
          description,
        }),
      });
      return { id: created.objectCreated._id, source: 'live' };
    } catch (err) {
      console.warn('[nessie] live bridge transfer failed, recording locally:', err);
    }
  }

  const state = await readRuntimeState('maria');
  const transfer: NessieTransfer = {
    // Derived from the ref, not Date.now(): the grant id a judge reads off the
    // Ready Card is the same id on every reload of the same reference.
    _id: `bridge-${a.ref}`,
    type: 'transfer',
    transaction_date: DEMO_TODAY,
    status: 'completed',
    medium: 'balance',
    payer_id: a.fromAccountId,
    payee_id: a.toAccountId,
    amount: a.amount / 100,
    description,
  };
  const credited = a.toAccountId === patientCheckingId() ? a.amount : 0;
  await writeJson(runtimeFile('maria'), {
    ...state,
    balanceDelta: state.balanceDelta + credited,
    transfers: [...state.transfers, transfer],
    updatedAt: new Date().toISOString(),
  } satisfies RuntimeState);
  return { id: transfer._id, source: mode === 'live' ? 'recorded' : mode };
}

/**
 * Post the pharmacy side of the fill as a purchase on the patient's account.
 *
 * No sandbox emits a real pharmacy settlement, so this stands in for one. It
 * is the only honest way to make a verified start verifiable: the money has to
 * leave the account and be readable back out of the same API a judge can curl.
 * The `RX-<ref>` description is the join key verifyStart matches on.
 */
export async function recordFill(a: {
  accountId: string;
  merchantId: string;
  amount: Cents;
  ref: string;
  date: string;
}): Promise<{ id: string; source: DataSource }> {
  const mode = nessieMode();
  const description = `RX-${a.ref}`;

  if (mode === 'live' && a.accountId) {
    try {
      const created = await api<NessieCreateResponse>(`/accounts/${a.accountId}/purchases`, {
        method: 'POST',
        body: JSON.stringify({
          merchant_id: a.merchantId,
          medium: 'balance',
          purchase_date: a.date,
          amount: a.amount / 100,
          status: 'completed',
          description,
        }),
      });
      return { id: created.objectCreated._id, source: 'live' };
    } catch (err) {
      console.warn('[nessie] live fill write failed, recording locally:', err);
    }
  }

  const state = await readRuntimeState('maria');
  const purchase: NessiePurchase = {
    _id: `rxfill-${a.ref}`,
    merchant_id: a.merchantId,
    payer_id: a.accountId,
    purchase_date: a.date,
    amount: a.amount / 100,
    status: 'completed',
    medium: 'balance',
    description,
  };
  const debited = a.accountId === patientCheckingId() ? a.amount : 0;
  await writeJson(runtimeFile('maria'), {
    ...state,
    balanceDelta: state.balanceDelta - debited,
    purchases: [...state.purchases, purchase],
    updatedAt: new Date().toISOString(),
  } satisfies RuntimeState);
  return { id: purchase._id, source: mode === 'live' ? 'recorded' : mode };
}

/**
 * Did the prescription actually get filled?
 *
 * This is the whole outcome metric. An impression model counts sends; the
 * exchange counts this. It reads the patient's own posted purchases and looks
 * for one tagged `RX-<ref>` on or after the day the claim was made — a fill
 * that predates the alert was not caused by it and does not count.
 *
 * Deliberately routed through getLedger() rather than a bare GET: that is
 * where the live -> recorded -> demo chain and the runtime overlay already
 * live, so a verified start survives a dead sandbox exactly as the ledger does.
 */
export async function verifyStart(ref: string, sinceISO: string): Promise<VerifiedStart> {
  const { ledger, source } = await getLedger('maria');
  const tag = `RX-${ref}`;

  // ISO dates sort lexicographically, so a string compare is the date compare.
  // Latest match wins: a refill posted later is the more current evidence.
  const hits = ledger.purchases
    .filter((p) => p.description.includes(tag) && p.purchase_date >= sinceISO)
    .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
  const hit = hits[hits.length - 1];

  if (!hit) {
    return {
      ref,
      verified: false,
      observedOn: null,
      amount: null,
      merchantName: null,
      settlementId: null,
      source,
    };
  }

  const merchant = ledger.merchants.find((m) => m._id === hit.merchant_id);
  return {
    ref,
    verified: true,
    observedOn: hit.purchase_date,
    amount: dollars(hit.amount),
    merchantName: merchant?.name ?? null,
    settlementId: hit._id,
    source,
  };
}
