import { basketSignature, computeBasket, resolveInputs, type BasketOptions } from './basket';
import { createBills, executeTransfer, getCheckingBalance } from './nessie/client';
import { getBasketActivation, saveBasketActivation } from './store';
import type { BasketActivation } from './types';

/** The request is valid but the plan cannot be carried out. The API turns this into a 409. */
export class ActivationRefused extends Error {}

function reference(): string {
  return `RXB-2026-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * The household's payday-plan write, the same round trip as the bridge and the fill: write the
 * payday plan to the bank.
 *
 * Installment one executes as a Transfer, the other eleven are written as Bills
 * pinned to the paydays the detector found in the deposits, and then the
 * balance is REFETCHED from the account, so the number that changes on screen
 * is one the bank returned and not one this code computed.
 *
 * Three refusals, each before any money moves: an unaffordable first installment
 * (held, exactly as Maria's is), a basket that costs nothing, and a household
 * that has no bank read at all.
 */
export async function activateBasket(opts: BasketOptions): Promise<BasketActivation> {
  const { coverage, drugs } = resolveInputs(opts);
  const signature = basketSignature(coverage.id, drugs.map((d) => d.id));

  // Idempotent by scenario. A double click, a reload, or a judge pressing the
  // button again returns the same receipt and moves nothing.
  const existing = await getBasketActivation(signature);
  if (existing) return existing;

  const result = await computeBasket(opts);
  const ledger = result.capacity.ledger;
  if (!ledger) throw new ActivationRefused('there is no bank read to write against');
  const { schedule } = result;

  if (schedule.total <= 0) {
    throw new ActivationRefused('this basket costs the household nothing, so there is nothing to schedule');
  }
  if (schedule.firstInstallmentFits === false) {
    throw new ActivationRefused(
      `installment one exceeds today's safe-to-pay ceiling, so nothing was transferred and no bills were written`,
    );
  }

  const count = schedule.installments.length;
  const balanceBefore = ledger.checkingBalance;

  const bills = await createBills(
    schedule.installments.slice(1).map((i) => ({
      payee: 'Household prescriptions (Ready payday plan)',
      nickname: `Rx basket — installment ${i.n} of ${count}`,
      amount: i.amount,
      dueDate: i.dueDate,
    })),
    'household',
  );

  const first = schedule.installments[0];
  const transfer = await executeTransfer({
    amount: first?.amount ?? 0,
    description: `Rx basket — installment 1 of ${count}`,
    subject: 'household',
  });

  // Annotate a copy: the computed result is not ours to mutate.
  let billCursor = 0;
  const installments = schedule.installments.map((i, k) =>
    k === 0
      ? { ...i, status: 'executed' as const, nessieTransferId: transfer.id }
      : { ...i, status: 'scheduled' as const, nessieBillId: bills.ids[billCursor++] },
  );

  const after = await getCheckingBalance('household');

  const activation: BasketActivation = {
    reference: reference(),
    signature,
    coverageLabel: coverage.label,
    schedule: { ...schedule, installments },
    balanceBefore,
    balanceAfter: after.balance,
    executedTransferId: transfer.id,
    billIds: bills.ids,
    activatedAt: new Date().toISOString(),
    source: after.source,
  };
  await saveBasketActivation(activation);
  return activation;
}
