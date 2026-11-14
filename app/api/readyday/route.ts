import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { median } from '@/lib/dates';

/**
 * The Ready Day counter.
 *
 * "You are the 1,247th person to find their Ready Day tonight. The median is
 * 9 days away." A counter is most of why a thing travels — and it is also the
 * one number on the page that is not a model output. Every value here is a
 * real event: somebody answered three questions and got a date.
 *
 * So: no seeding, no floor, no "join 1,000+ others". If the file is missing
 * the endpoint reports zero and the page hides the line entirely, which is the
 * correct behaviour on a fresh clone and on a read-only filesystem alike.
 *
 * Same read-json-with-fallback shape as lib/nessie/client.ts: a cache that
 * cannot be read is never an error the visitor has to see.
 */

const COUNTER_FILE = path.join(process.cwd(), 'data', 'cache', 'readyday-counter.json');

/** Enough samples for an honest median, few enough that the file stays small. */
const SAMPLE_WINDOW = 500;

interface CounterFile {
  count: number;
  structural: number;
  /** Days-to-ready for the last SAMPLE_WINDOW results that had a date. */
  samples: number[];
  updatedAt: string;
}

const EMPTY: CounterFile = { count: 0, structural: 0, samples: [], updatedAt: '' };

export interface CounterPayload {
  count: number;
  medianDaysToReady: number | null;
  structural: number;
}

export const dynamic = 'force-dynamic';

async function readCounter(): Promise<CounterFile> {
  try {
    const parsed = JSON.parse(await readFile(COUNTER_FILE, 'utf8')) as Partial<CounterFile>;
    return {
      count: typeof parsed.count === 'number' ? parsed.count : 0,
      structural: typeof parsed.structural === 'number' ? parsed.structural : 0,
      samples: Array.isArray(parsed.samples) ? parsed.samples.filter((n) => typeof n === 'number') : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

function payload(file: CounterFile): CounterPayload {
  return {
    count: file.count,
    medianDaysToReady: file.samples.length > 0 ? Math.round(median(file.samples)) : null,
    structural: file.structural,
  };
}

/**
 * Next runs route handlers concurrently inside one process, and this is a
 * read-modify-write against a single file. Chaining every mutation off the
 * previous one costs four lines and stops two simultaneous taps from both
 * reading 1,246 and both writing 1,247.
 */
let writeQueue: Promise<CounterPayload> = Promise.resolve({ count: 0, medianDaysToReady: null, structural: 0 });

async function increment(sample: number | null, structural: boolean): Promise<CounterPayload> {
  const file = await readCounter();
  const next: CounterFile = {
    count: file.count + 1,
    structural: file.structural + (structural ? 1 : 0),
    samples: sample === null ? file.samples : [...file.samples, sample].slice(-SAMPLE_WINDOW),
    updatedAt: new Date().toISOString(),
  };
  try {
    await mkdir(path.dirname(COUNTER_FILE), { recursive: true });
    await writeFile(COUNTER_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (err) {
    // Read-only deploy target, full disk, whatever. The visitor still gets a
    // number; it just does not persist. Never surface this.
    console.warn('[api/readyday] counter write failed:', err);
  }
  return payload(next);
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(payload(await readCounter()));
}

export async function POST(request: Request): Promise<NextResponse> {
  // Three distinct outcomes, and conflating them is how a counter starts
  // lying. An explicit null means STRUCTURAL — a real person who got a real
  // "no date exists". A body we cannot read is a visit and nothing more: it
  // must not be booked as somebody with no Ready Day.
  let sample: number | null = null;
  let structural = false;
  try {
    const body = (await request.json()) as { daysToReady?: unknown };
    const raw = body.daysToReady;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 45) sample = raw;
    else if (raw === null) structural = true;
  } catch {
    /* unreadable body: count the visit, claim nothing about the result */
  }

  const queued = writeQueue.then(() => increment(sample, structural));
  writeQueue = queued.catch(() => payload(EMPTY));
  return NextResponse.json(await queued);
}
