import { NextResponse } from 'next/server';
import { DEMO_TODAY, addDays } from '@/lib/dates';
import { readCapacity } from '@/lib/engine/capacity';
import { COHORT_NAMES, PANEL_CANDIDATES, cohortLedger } from '@/lib/fixtures/cohort';
import {
  ENGAGEMENT_HISTORY,
  PRESCRIBER_CITY,
  PRESCRIBER_ID,
  PRESCRIBER_NAME,
  PRESCRIBER_SPECIALTY,
} from '@/lib/fixtures/engagement';
import { fmt } from '@/lib/money';
import { getLedger } from '@/lib/nessie/client';
import { buildAttentionProfile, describeHourOfWeek, rankCandidates } from '@/lib/ready/attention';
import { classifyLiquidity } from '@/lib/ready/liquidity';
import type { LiquidityVerdict, PanelBoard } from '@/lib/ready/types';
import type { Cents } from '@/lib/types';

/**
 * The panel board, computed server-side.
 *
 * Nothing about the ranking runs in the browser. The slider posts an integer
 * and gets a whole recomputed board back, because the board is the output of
 * a deterministic engine over a bank ledger and a four-year engagement
 * archive — neither of which the prescriber's browser is ever given.
 *
 * `?slots=` is the prescriber's own cap. Absent means "use my measured
 * saturation point", which is the number lib/ready/attention.ts derives from
 * the archive. The slider can only move the cap DOWN from there in practice;
 * the clamp to 1..6 lives in slotBudgetFor() and is mirrored here so the UI
 * and the engine cannot disagree about what the control does.
 */

export const dynamic = 'force-dynamic';

const MIN_CAP = 1;
const MAX_CAP = 6;

/** Trailing window for "has this patient been to a pharmacy lately". */
const PHARMACY_LOOKBACK_DAYS = 30;

/**
 * The per-row facts the board prints that are NOT part of the ReadyClaim.
 *
 * This is the internal view — the one the alert vendor sees while deciding
 * whether to spend a slot — not the boundary object. A CLEARED row ships a
 * ReadyClaim (one enum, one date) and nothing here. A REFUSED row ships
 * nothing at all, which is exactly why it is safe to show the arithmetic that
 * refused it.
 */
export interface PanelRowEvidence {
  ref: string;
  /** De-identified on the way out; the prescriber already knows their panel. */
  initials: string;
  /** Cents clear of this patient's own buffer floor today. */
  headroomToday: Cents;
  liquidTotal: Cents;
  /** Pharmacy purchases posted in the trailing 30 days. Real rows, counted. */
  pharmacyFills30d: number;
  /** 'linked' = the Nessie account this deploy is actually connected to. */
  ledgerOrigin: 'linked' | 'replay';
  /**
   * The quantified first line of the WHY column, for REFUSED rows only.
   * Empty string everywhere else — a row that was sent does not need a
   * defence, and a row that was deferred already carries its rank.
   */
  refusal: string;
}

export interface PanelPayload {
  board: PanelBoard;
  evidence: Record<string, PanelRowEvidence>;
  /** clamp(override ?? saturationPoint, 1, 6) — the value the slider shows. */
  cap: number;
  minCap: number;
  maxCap: number;
  /** "Tue 07:00" — the measured best hour, for the header. */
  bestHour: string;
  /** How many of the twelve rows came off the connected Nessie account. */
  linkedRows: number;
  prescriberCity: string;
  today: string;
  fetchedAt: string;
}

/** "Nora B." -> "N.B." The panel is the prescriber's; the ledger is not. */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.map((p) => p.charAt(0).toUpperCase());
  return letters.length > 0 ? `${letters.join('.')}.` : '—';
}

/**
 * The sentence that makes a refusal legible.
 *
 * Every figure in it is a measurement off this patient's own posted
 * transactions: headroom is income less mined obligations less the buffer
 * floor, and the fill count is literally `purchases` at merchants Nessie
 * categorises as pharmacy. No overdraft fee, no interest, no inferred
 * "financial stress score" — none of those exist in the data.
 */
function refusalSentence(headroom: Cents, copay: Cents, fills: number): string {
  const covers = copay > 0 && headroom >= copay;
  const multiple = copay > 0 ? Math.floor(headroom / copay) : 0;
  const clauses: string[] = [];

  // "1x this copay" is a worse sentence than saying it clears, so the
  // multiple is only printed once it is actually a multiple.
  if (covers && multiple >= 2) {
    clauses.push(`${fmt(headroom)} free today — ${multiple}x this ${fmt(copay)} copay`);
  } else if (covers) {
    clauses.push(`${fmt(headroom)} free today, clear of the ${fmt(copay)} copay`);
  } else {
    clauses.push(`${fmt(headroom)} free today against a ${fmt(copay)} copay`);
  }
  if (fills > 0) {
    clauses.push(`filled ${fills} other Rx in the last ${PHARMACY_LOOKBACK_DAYS} days`);
  }

  const lead = `${clauses.join(', ')}.`;
  return covers ? `${lead} Not an affordability problem.` : lead;
}

/** Purchases at merchants Nessie itself tags 'pharmacy', inside the window. */
function pharmacyFills(
  ledger: { merchants: { _id: string; category: string[] }[]; purchases: { merchant_id: string; purchase_date: string }[] },
  today: string,
): number {
  const since = addDays(today, -PHARMACY_LOOKBACK_DAYS);
  const pharmacies = new Set(
    ledger.merchants.filter((m) => m.category.includes('pharmacy')).map((m) => m._id),
  );
  return ledger.purchases.filter(
    (p) => pharmacies.has(p.merchant_id) && p.purchase_date > since && p.purchase_date <= today,
  ).length;
}

function clampCap(n: number): number {
  return Math.min(MAX_CAP, Math.max(MIN_CAP, n));
}

/**
 * Build the whole board.
 *
 * `getLedger()` is the one connected Nessie account — live HTTP when a key is
 * present, the recorded cache when the sandbox is down, the simulated ledger
 * when neither. Whichever it is, the row whose `nessieCustomerId` matches it
 * is computed off those bytes; the other eleven replay lib/fixtures/cohort.ts
 * through the identical readCapacity -> classifyLiquidity path. The payload
 * reports `linkedRows` so the screen can say which is which instead of
 * implying twelve live bank accounts.
 */
async function buildPanel(capOverride: number | null): Promise<PanelPayload> {
  const today = DEMO_TODAY;
  const { ledger: linked, source } = await getLedger();

  const liquidityByRef: Record<string, LiquidityVerdict> = {};
  const evidence: Record<string, PanelRowEvidence> = {};
  let linkedRows = 0;

  for (const candidate of PANEL_CANDIDATES) {
    const onLink = linked.customerId === candidate.nessieCustomerId;
    if (onLink) linkedRows += 1;

    const ledger = onLink ? linked : cohortLedger(candidate.nessieCustomerId);
    const capacity = readCapacity(ledger, onLink ? source : 'demo', today);

    liquidityByRef[candidate.ref] = classifyLiquidity({
      copay: candidate.copay,
      writtenOn: candidate.writtenOn,
      capacity,
      ledger,
      clinicalWindowDays: candidate.clinicalWindowDays,
      today,
    });

    evidence[candidate.ref] = {
      ref: candidate.ref,
      initials: initialsOf(COHORT_NAMES[candidate.nessieCustomerId] ?? ''),
      headroomToday: capacity.safeToPayToday,
      liquidTotal: capacity.liquidTotal,
      pharmacyFills30d: pharmacyFills(ledger, today),
      ledgerOrigin: onLink ? 'linked' : 'replay',
      refusal: '',
    };
  }

  const profile = buildAttentionProfile(ENGAGEMENT_HISTORY, {
    prescriberId: PRESCRIBER_ID,
    prescriberName: PRESCRIBER_NAME,
    specialty: PRESCRIBER_SPECIALTY,
    today,
    override: capOverride,
  });

  const board = rankCandidates({
    candidates: PANEL_CANDIDATES,
    liquidityByRef,
    profile,
    today,
    source,
  });

  // Second pass, after the gate has run: only a row that was actually refused
  // gets the quantified defence. Writing it for every row would put an
  // affordability figure next to rows where affordability was never the
  // question, which is the exact conflation the product exists to undo.
  for (const row of board.rows) {
    if (row.state !== 'REFUSED') continue;
    const e = evidence[row.candidate.ref];
    if (!e) continue;
    e.refusal = refusalSentence(e.headroomToday, row.candidate.copay, e.pharmacyFills30d);
  }

  return {
    board,
    evidence,
    cap: clampCap(profile.override ?? profile.saturationPoint),
    minCap: MIN_CAP,
    maxCap: MAX_CAP,
    bestHour: describeHourOfWeek(profile.bestHourOfWeek),
    linkedRows,
    prescriberCity: PRESCRIBER_CITY,
    today,
    fetchedAt: new Date().toISOString(),
  };
}

/** An unparseable ?slots= is not an error — it means "use my measured point". */
function parseCap(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return clampCap(n);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const slots = parseCap(new URL(request.url).searchParams.get('slots'));
    return NextResponse.json(await buildPanel(slots));
  } catch (err) {
    console.error('[api/panel]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
