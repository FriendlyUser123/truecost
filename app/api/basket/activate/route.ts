import { NextResponse } from 'next/server';
import { BasketInputError } from '@/lib/basket';
import { ActivationRefused, activateBasket } from '@/lib/basketActivate';

export const dynamic = 'force-dynamic';

/**
 * POST /api/basket/activate  { coverage, drugs }
 *
 * Writes the household's payday plan to the bank: installment one as a
 * transfer, the rest as bills, then refetches the balance. Idempotent per
 * scenario. See lib/basketActivate.ts.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { coverage?: string; drugs?: string[] };
  try {
    return NextResponse.json(await activateBasket({ coverage: body.coverage ?? null, drugs: body.drugs ?? null }));
  } catch (err) {
    if (err instanceof BasketInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ActivationRefused) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[api/basket/activate]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
