import type { Metadata } from 'next';

import Exchange from '@/components/Exchange';
import { DEMO_TODAY } from '@/lib/dates';
import { readCapacity } from '@/lib/engine/capacity';
import { PANEL_CANDIDATES, cohortLedger } from '@/lib/fixtures/cohort';
import {
  ENGAGEMENT_HISTORY,
  PRESCRIBER_ID,
  PRESCRIBER_NAME,
  PRESCRIBER_SPECIALTY,
} from '@/lib/fixtures/engagement';
import { nessieMode, verifyStart } from '@/lib/nessie/client';
import { buildAttentionProfile, rankCandidates } from '@/lib/ready/attention';
import { buildExchangeSheet, countedStarts } from '@/lib/ready/exchange';
import { classifyLiquidity } from '@/lib/ready/liquidity';
import type { LiquidityVerdict, VerifiedStart } from '@/lib/ready/types';
import { listVerifiedStarts } from '@/lib/store';

export const metadata: Metadata = {
  title: 'Clearing terms — the unit, what we refused, and the experiment that would price it',
  description:
    "A term sheet with an experiment attached. The billing unit is a cleared engagement; a verified fill is a quality metric and never an invoice line. The measured claim is what this week's rationing refused and why; the break-even conversion and its sensitivity to an illustrative price are printed rather than assumed away.",
};

// The board reads the runtime ledger overlay, so a fill posted from a Ready
// Card in the previous request has to be visible in this one.
export const dynamic = 'force-dynamic';

/** 1–6, matching the clamp inside attention.ts. Anything else is ignored. */
function parseSlots(raw: string | string[] | undefined): number | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === undefined) return null;
  const n = Number.parseInt(first, 10);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

/**
 * /exchange — the commercial-fit screen.
 *
 * The board is rebuilt here rather than imported from the panel route: this
 * page has to stand on its own when it is opened cold from a link, and the
 * whole construction is four deterministic calls over fixtures anchored to
 * DEMO_TODAY. Rebuilding it costs nothing and removes a cross-screen
 * dependency from the demo path.
 *
 * `?slots=N` is the prescriber's own cap. It is the same override the slider
 * on the board writes, and every figure on this page moves with it — which is
 * the point: what the channel is worth is a function of how much attention
 * the physician has agreed to sell, and the break-even threshold in §3 moves
 * with it too.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const override = parseSlots(params.slots);

  const profile = buildAttentionProfile(ENGAGEMENT_HISTORY, {
    prescriberId: PRESCRIBER_ID,
    prescriberName: PRESCRIBER_NAME,
    specialty: PRESCRIBER_SPECIALTY,
    override,
  });

  // Every candidate's ledger runs through the same capacity detectors and the
  // same classifier the Ready Card uses. Nothing on this screen is a second
  // implementation of the verdict.
  const liquidityByRef: Record<string, LiquidityVerdict> = {};
  for (const candidate of PANEL_CANDIDATES) {
    const ledger = cohortLedger(candidate.nessieCustomerId);
    const capacity = readCapacity(ledger, 'demo', DEMO_TODAY);
    liquidityByRef[candidate.ref] = classifyLiquidity({
      copay: candidate.copay,
      writtenOn: candidate.writtenOn,
      capacity,
      ledger,
      clinicalWindowDays: candidate.clinicalWindowDays,
    });
  }

  const board = rankCandidates({
    candidates: PANEL_CANDIDATES,
    liquidityByRef,
    profile,
    today: DEMO_TODAY,
    source: nessieMode(),
  });

  /* ── the receipts ──────────────────────────────────────────────────────
     Two sources, deliberately. The store holds fills written by an earlier
     request; verifyStart re-reads the ledger for the rows that actually spent
     a slot, so a fill posted seconds ago from a Ready Card shows up here even
     though nothing persisted it. Fresh wins on a ref collision — it is the
     later read of the same account.

     None of this touches the invoice. A fill is the quality metric; the
     billable unit is the cleared engagement, and buildExchangeSheet keeps
     those two apart.                                                       */

  const stored = await listVerifiedStarts();
  const sentRefs = board.rows
    .filter((r) => r.state === 'CLEARED')
    .map((r) => r.candidate.ref);
  const fresh = await Promise.all(
    sentRefs.map(async (ref) => verifyStart(ref, board.generatedAt)),
  );

  const byRef = new Map<string, VerifiedStart>();
  for (const s of stored) byRef.set(s.ref, s);
  for (const s of fresh) if (s.verified || !byRef.has(s.ref)) byRef.set(s.ref, s);
  const starts = [...byRef.values()].filter((s) => s.verified);

  const sheet = buildExchangeSheet(board, { starts });
  const { counted } = countedStarts(board, starts);

  return (
    <Exchange
      board={board}
      sheet={sheet}
      starts={starts}
      countedRefs={counted.map((s) => s.ref)}
      mode={board.source}
      slotCap={override ?? profile.saturationPoint}
    />
  );
}
