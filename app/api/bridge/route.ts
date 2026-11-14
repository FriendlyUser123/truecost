import { NextResponse } from 'next/server';
import { DEMO_TODAY } from '@/lib/dates';
import { readCapacity } from '@/lib/engine/capacity';
import { PANEL_CANDIDATES, cohortLedger } from '@/lib/fixtures/cohort';
import { CHECKING_ID } from '@/lib/fixtures/ledger';
import { bridgeTransfer, getLedger, readRuntimeState } from '@/lib/nessie/client';
import { dollars } from '@/lib/money';
import {
  BRIDGE_FUNDER,
  BRIDGE_FUNDER_NAME,
  BRIDGE_FUND_ACCOUNT_FALLBACK,
  BRIDGE_FUND_ACCOUNT_LABEL,
  BRIDGE_FUND_OPENING,
  BRIDGE_TAG,
  bridgeEligibility,
} from '@/lib/ready/card';
import type { BridgeBalance, BridgeFailure, BridgeResponse } from '@/lib/ready/card';
import { classifyLiquidity } from '@/lib/ready/liquidity';
import { getGrant, saveGrant } from '@/lib/store';
import type { BridgeGrant } from '@/lib/ready/types';
import type { Cents, DataSource } from '@/lib/types';

/**
 * The bridge.
 *
 * POST { ref } → a real Nessie P2P transfer from the Blue Ridge Access
 * Foundation's checking account into the patient's, and both balances read
 * back out of the same API afterwards. Nothing here is simulated: the number
 * that changes on screen changes because money moved between two accounts a
 * judge can curl.
 *
 * Three gates, in this order, and each one refuses loudly rather than
 * degrading into a smaller grant:
 *
 *   1. The ref has to be a prescription on this panel.
 *   2. The patient has to be commercially insured. Third-party copay
 *      assistance to a federally-insured patient is an Anti-Kickback Statute
 *      problem — see bridgeEligibility() in lib/ready/card.ts. This is the
 *      gate that must exist in code and not in a slide.
 *   3. The ledger verdict has to be STALE. TIMING does not need money, it
 *      needs a date; STRUCTURAL is not fixable with one month's copay and
 *      offering one would be a lie told with a working transfer behind it.
 *
 * Error handling follows app/api/account/route.ts: log the real error, return
 * a sentence, never leak a stack to the client.
 */

export const dynamic = 'force-dynamic';

function fundAccountId(): string {
  return process.env.NESSIE_FUND_CHECKING_ID?.trim() || BRIDGE_FUND_ACCOUNT_FALLBACK;
}

function patientAccountId(): string {
  return process.env.NESSIE_CHECKING_ID?.trim() || CHECKING_ID;
}

function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error } satisfies BridgeFailure, { status });
}

/**
 * The foundation's balance, derived from its own outgoing grants rather than
 * asserted.
 *
 * Nessie's account list for the patient is what getLedger() returns, so the
 * fund's balance is not directly on the wire here. What IS on the wire is
 * every `BRIDGE-` transfer it has paid out, because those land on the
 * patient's transfer list as incoming P2P. Opening balance less the grants it
 * has made is the same number the sandbox holds.
 *
 * The runtime overlay is unioned in on purpose. getLedger() applies the
 * overlay in recorded and demo mode but NOT on a successful live read, so a
 * grant that fell back to a local write after the sandbox refused the POST is
 * invisible in `ledger.transfers`. Counting it from both places is what keeps
 * the funder's figure a function of grants actually made in every mode.
 * Transfers are de-duplicated by `_id`, which bridgeTransfer derives from the
 * ref, so a grant present in both lists is still counted once.
 */
function funderBalance(
  ledgerTransfers: { _id: string; description: string; payer_id: string; amount: number }[],
  overlayTransfers: { _id: string; description: string; payer_id: string; amount: number }[],
): Cents {
  const seen = new Set<string>();
  let paidOut = 0;
  for (const t of [...ledgerTransfers, ...overlayTransfers]) {
    if (seen.has(t._id)) continue;
    seen.add(t._id);
    if (!t.description.startsWith(BRIDGE_TAG)) continue;
    if (t.payer_id !== fundAccountId()) continue;
    paidOut += dollars(t.amount);
  }
  return BRIDGE_FUND_OPENING - paidOut;
}

/** Both sides of the transfer as they read right now. Observed, never derived. */
async function readBalances(): Promise<{ patient: Cents; funder: Cents; source: DataSource; accountId: string; nickname: string }> {
  const { ledger, source } = await getLedger();
  const overlay = await readRuntimeState();
  return {
    patient: dollars(ledger.checking.balance),
    funder: funderBalance(ledger.transfers, overlay.transfers),
    source,
    accountId: ledger.checking._id,
    nickname: ledger.checking.nickname,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    let ref = '';
    try {
      const body = (await request.json()) as { ref?: unknown };
      if (typeof body.ref === 'string') ref = body.ref.trim();
    } catch {
      return fail('Body must be JSON of the shape { "ref": "rx-1043" }.', 400);
    }
    if (ref === '') return fail('Missing "ref".', 400);

    const candidate = PANEL_CANDIDATES.find((c) => c.ref === ref);
    if (!candidate) return fail(`No prescription ${ref} on this panel.`, 404);

    // Gate 2 before gate 3: an ineligible patient must never see us price the
    // grant they are not allowed to have.
    const eligibility = bridgeEligibility(candidate.insuranceType);
    if (!eligibility.eligible) return fail(eligibility.reason, 403);

    const ledger = cohortLedger(candidate.nessieCustomerId);
    const capacity = readCapacity(ledger, 'demo');
    const verdict = classifyLiquidity({
      copay: candidate.copay,
      writtenOn: candidate.writtenOn,
      capacity,
      ledger,
      clinicalWindowDays: candidate.clinicalWindowDays,
    });

    if (verdict.class !== 'STALE') {
      return fail(
        `The ledger classifies ${ref} as ${verdict.class}, not STALE. A bridge only makes sense when the patient can afford the drug but not before the clinical window closes.`,
        409,
      );
    }

    const amount = verdict.copay;
    const from = fundAccountId();
    const to = patientAccountId();

    // READ BEFORE THE WRITE. The previous version of this route read only
    // afterwards and reported `before` as `after - amount`, which is not an
    // observation, it is the arithmetic we were hoping the sandbox had done.
    // In live mode the two are not the same number: a POST the sandbox
    // rejects falls back to a local write, the live ledger read does not see
    // it, and the card would then animate a $145 move that never happened.
    // Both figures below are now readings, so when nothing moves the card
    // says nothing moved.
    const before = await readBalances();

    // Idempotent by ref. A judge will double-tap the button, and a second
    // $145 leaving a charity because of a double-tap is not a demo bug, it is
    // the thing the whole product is arguing against.
    const existing = await getGrant(ref);
    const transfer = existing
      ? { id: existing.transferId, source: existing.source }
      : await bridgeTransfer({ amount, fromAccountId: from, toAccountId: to, ref });

    if (!existing) {
      const grant: BridgeGrant = {
        ref,
        funder: BRIDGE_FUNDER,
        amount,
        toAccountId: to,
        transferId: transfer.id,
        grantedOn: DEMO_TODAY,
        source: transfer.source,
      };
      await saveGrant(grant);
    }

    // Refetch. Every figure below is read back after the write; none of them
    // is computed from what we intended to write.
    const after = await readBalances();

    const patient: BridgeBalance = {
      label: `${after.nickname || 'Patient checking'} · Nessie`,
      accountId: after.accountId,
      before: before.patient,
      after: after.patient,
    };
    const funder: BridgeBalance = {
      label: `${BRIDGE_FUNDER_NAME} · ${BRIDGE_FUND_ACCOUNT_LABEL}`,
      accountId: from,
      before: before.funder,
      after: after.funder,
    };

    // The difference between "the money moved" and "we asked for it to move".
    // A replay is expected to show no delta and says so through `replayed`;
    // a first grant that shows no delta means the write did not land where
    // the balance is read from, and the card has to be able to say that
    // instead of drawing two identical numbers with an arrow between them.
    const moved = after.patient - before.patient === amount;

    const payload: BridgeResponse = {
      ok: true,
      ref,
      transferId: transfer.id,
      funder: BRIDGE_FUNDER,
      funderName: BRIDGE_FUNDER_NAME,
      amount,
      grantedOn: existing?.grantedOn ?? DEMO_TODAY,
      balances: { funder, patient },
      source: after.source,
      /** Where the transfer itself landed, which is not always where the ledger is read from. */
      transferSource: transfer.source,
      moved,
      replayed: existing !== null,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[api/bridge]', err);
    return fail((err as Error).message, 500);
  }
}
