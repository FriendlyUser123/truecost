import { NextResponse } from 'next/server';
import { getCheckingBalance } from '@/lib/nessie/client';
import { parseSubject } from '@/lib/nessie/subjects';

export const dynamic = 'force-dynamic';

/**
 * Refetch the balance. The drop on screen after a transfer comes from here.
 * `?subject=household` reads the household's account; the default is Maria's.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const subject = parseSubject(new URL(request.url).searchParams.get('subject'));
    const { balance, source } = await getCheckingBalance(subject);
    return NextResponse.json({ balance, source, subject, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[api/account]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
