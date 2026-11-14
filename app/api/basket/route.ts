import { NextResponse } from 'next/server';
import { BasketInputError, computeBasket } from '@/lib/basket';

export const dynamic = 'force-dynamic';

/** GET /api/basket?coverage=average&drugs=atorvastatin,lisinopril — drugs omitted = the top ten. */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const drugs = params.get('drugs');
  try {
    return NextResponse.json(
      await computeBasket({
        coverage: params.get('coverage'),
        drugs: drugs === null ? null : drugs.split(',').filter(Boolean),
      }),
    );
  } catch (err) {
    if (err instanceof BasketInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[api/basket]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
