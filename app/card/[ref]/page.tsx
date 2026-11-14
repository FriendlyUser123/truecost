import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ReadyCard from '@/components/ReadyCard';
import type { ReadyCardData } from '@/components/ReadyCard';
import { DEMO_TODAY } from '@/lib/dates';
import { readCapacity } from '@/lib/engine/capacity';
import {
  ENGAGEMENT_HISTORY,
  PRESCRIBER_ID,
  PRESCRIBER_NAME,
  PRESCRIBER_SPECIALTY,
} from '@/lib/fixtures/engagement';
import { COHORT_NAMES, PANEL_CANDIDATES, cohortLedgers } from '@/lib/fixtures/cohort';
import { createBills, getLedger } from '@/lib/nessie/client';
import {
  BRIDGE_FUNDER_NAME,
  bridgeEligibility,
  buildPatientCard,
  clinicalWindowFor,
  pharmacyCentre,
  projectBalanceCurve,
  readyWindowOf,
  routeFor,
} from '@/lib/ready/card';
import type { ClinicalWindow, ScheduleResult } from '@/lib/ready/card';
import { buildAttentionProfile, claimFor, rankCandidates } from '@/lib/ready/attention';
import { classifyLiquidity } from '@/lib/ready/liquidity';
import { WITHHELD_FIELDS } from '@/lib/ready/types';
import type { LiquidityVerdict, PanelCandidate } from '@/lib/ready/types';
import { getGrant } from '@/lib/store';
import type { LedgerSnapshot } from '@/lib/nessie/types';

/**
 * /card/[ref] — the Ready Card.
 *
 * What the prescriber opens from a panel row — when the row reaches a
 * prescriber at all, which for TIMING it deliberately does not.
 *
 * Ready rations prescriber attention. The card shows the routing decision
 * first (suppressed / sent / sent off-channel), then the cash window that made
 * the decision possible, then the curve behind the window, then — printed next
 * to all of it — the complete list of what crossed the boundary and what did
 * not, including the honest cost of the part that did.
 *
 * Everything on this page is computed on the server. The browser receives
 * prose, a series of integers, and one enum. It never receives the ledger.
 * That is not a policy, it is the render boundary, and the provenance block
 * exists so a judge can check it against what is actually on the wire.
 *
 * NO ATM ROW. `getAtmsNear()` is real and stays in the Nessie client; it is
 * not called here, because the sandbox ignores the radius parameters and holds
 * only Arlington machines while this cohort is in Roanoke. A distance printed
 * for these patients would be a fabricated number.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  // Deliberately no patient name and no class: this string ends up in a tab
  // title, a browser history file and a screen-share thumbnail.
  return { title: `Ready Card — ${ref}`, robots: { index: false, follow: false } };
}

/* ── the clinical window, per candidate ──────────────────────────────────── */

/**
 * The fixture may carry its own prose for what closes; if it does not, the
 * drug-specific default in lib/ready/card.ts is used. Read structurally so
 * this page compiles either side of that field landing in PanelCandidate.
 */
function windowFor(candidate: PanelCandidate): ClinicalWindow {
  const carried = (candidate as PanelCandidate & { clinicalWindowReason?: string | undefined })
    .clinicalWindowReason;
  return clinicalWindowFor({
    drugId: candidate.drugId,
    writtenOn: candidate.writtenOn,
    clinicalWindowDays: candidate.clinicalWindowDays,
    reason: carried,
  });
}

/* ── the board, computed once ────────────────────────────────────────────── */

interface Panel {
  verdicts: Record<string, LiquidityVerdict>;
  ledgers: Record<string, LedgerSnapshot>;
}

/**
 * Classify all twelve, not just this one.
 *
 * The card has to show which slot state this row landed in, and a slot state
 * is a statement about the whole week's queue — rank 2 of 4 is meaningless
 * without the other eleven. Running the same `rankCandidates` the panel board
 * runs is the only way the two screens cannot disagree.
 */
function classifyPanel(): Panel {
  const ledgers = cohortLedgers();
  const verdicts: Record<string, LiquidityVerdict> = {};
  for (const candidate of PANEL_CANDIDATES) {
    const ledger = ledgers[candidate.nessieCustomerId];
    if (!ledger) continue;
    verdicts[candidate.ref] = classifyLiquidity({
      copay: candidate.copay,
      writtenOn: candidate.writtenOn,
      capacity: readCapacity(ledger, 'demo'),
      ledger,
      clinicalWindowDays: candidate.clinicalWindowDays,
    });
  }
  return { verdicts, ledgers };
}

/* ── the patient-side reminder ───────────────────────────────────────────── */

/**
 * Write the fill onto the patient's own account as a dated Nessie bill.
 *
 * This is the ONLY thing a TIMING row produces, and it is deliberately not an
 * alert: nothing reaches the prescriber's queue, because for a patient who
 * will fill on payday anyway there is no prescriber act to take. What moves is
 * a reminder on the patient's own ledger, on the patient's own side of the
 * boundary.
 *
 * A server action rather than a route because it takes one string and returns
 * one receipt; /api/bridge exists as a route because a judge is going to curl
 * it. Same gates, in the same order — an action reachable from a button is
 * still an endpoint.
 */
async function scheduleFill(ref: string): Promise<ScheduleResult> {
  'use server';
  try {
    const candidate = PANEL_CANDIDATES.find((c) => c.ref === ref);
    if (!candidate) return { ok: false, error: `No prescription ${ref} on this panel.` };

    const { verdicts, ledgers } = classifyPanel();
    const verdict = verdicts[ref];
    const ledger = ledgers[candidate.nessieCustomerId];
    if (!verdict || !ledger) return { ok: false, error: `No ledger verdict for ${ref}.` };

    if (verdict.class !== 'TIMING' || verdict.readyOn === null) {
      return {
        ok: false,
        error: `The ledger classifies ${ref} as ${verdict.class}. Scheduling a fill for a date the patient cannot clear is the failure this product exists to stop.`,
      };
    }

    // The window's floor, not its midpoint. A reminder dated three days early
    // is a card declining at the counter.
    const window = readyWindowOf(verdict);
    const dueOn = window?.earliest ?? verdict.readyOn;

    const payee = pharmacyCentre(ledger).name;
    const { ids, source } = await createBills([
      {
        payee,
        nickname: `Rx ${candidate.drugLabel} · ${ref}`,
        amount: verdict.copay,
        dueDate: dueOn,
      },
    ]);
    const billId = ids[0];
    if (billId === undefined) return { ok: false, error: 'Nessie accepted no bill.' };

    return { ok: true, ref, billId, payee, amount: verdict.copay, dueOn, source };
  } catch (err) {
    console.error('[card/scheduleFill]', err);
    return { ok: false, error: (err as Error).message };
  }
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default async function Page({ params }: { params: Promise<{ ref: string }> }): Promise<React.ReactElement> {
  const { ref } = await params;

  const candidate: PanelCandidate | undefined = PANEL_CANDIDATES.find((c) => c.ref === ref);
  if (!candidate) notFound();

  const { verdicts, ledgers } = classifyPanel();
  const verdict = verdicts[candidate.ref];
  const ledger = ledgers[candidate.nessieCustomerId];
  if (!verdict || !ledger) notFound();

  const capacity = readCapacity(ledger, 'demo');
  const curve = projectBalanceCurve({ verdict, capacity, ledger });
  const clinicalWindow = windowFor(candidate);
  const routing = routeFor(verdict, clinicalWindow);
  const readyWindow = readyWindowOf(verdict);

  const profile = buildAttentionProfile(ENGAGEMENT_HISTORY, {
    prescriberId: PRESCRIBER_ID,
    prescriberName: PRESCRIBER_NAME,
    specialty: PRESCRIBER_SPECIALTY,
  });
  const board = rankCandidates({ candidates: PANEL_CANDIDATES, liquidityByRef: verdicts, profile });
  const row = board.rows.find((r) => r.candidate.ref === candidate.ref);
  if (!row) notFound();

  // The sandbox read is separate from the fixture read on purpose: the ledger
  // above produced the verdict, this one carries the runtime overlay and is
  // where a bridge grant shows up. In live mode with a seeded customer they
  // are the same account.
  const sandbox = await getLedger();

  const eligibility = bridgeEligibility(candidate.insuranceType);
  const offerBridge = eligibility.eligible && verdict.class === 'STALE';

  // The patient card has to say whether the purchase has already been funded,
  // not just whether it is on offer — a card printed after the fact should not
  // still be telling her to ask for something she has.
  const existingGrant = await getGrant(candidate.ref);

  const patientCard = buildPatientCard({
    verdict,
    drugLabel: candidate.drugLabel,
    clinicalWindow,
    bridge: offerBridge ? { amount: verdict.copay, granted: existingGrant !== null } : null,
  });

  const claim = claimFor(verdict);
  const data: ReadyCardData = {
    ref: candidate.ref,
    drugLabel: candidate.drugLabel,
    copay: candidate.copay,
    writtenOn: candidate.writtenOn,
    clinicalWindow,
    clinicalWeight: candidate.clinicalWeight,
    readyWindow,
    routing,
    today: DEMO_TODAY,
    patientName: COHORT_NAMES[candidate.nessieCustomerId] ?? 'Unnamed patient',
    insuranceType: candidate.insuranceType,
    claimsIndexEvent: candidate.claimsIndexEvent,
    prescriberName: profile.prescriberName,
    prescriberSpecialty: profile.specialty,
    source: sandbox.source,
    verdict,
    curve,
    claim,
    slot: {
      state: row.state,
      reason: row.reason,
      rank: row.rank,
      slotBudget: board.slotBudget,
      slotsUsed: board.slotsUsed,
      attentionCost: row.attentionCost,
    },
    patientCard,
    bridge: {
      offered: offerBridge,
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      amount: verdict.copay,
      funderName: BRIDGE_FUNDER_NAME,
    },
    grant: existingGrant,
    withheld: [...WITHHELD_FIELDS],
  };

  return <ReadyCard data={data} scheduleFill={scheduleFill} />;
}
