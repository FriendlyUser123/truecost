'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DEMO_TODAY } from '@/lib/dates';
import { dollars, fmtShort } from '@/lib/money';
import {
  BALANCE_MAX,
  BALANCE_MIN,
  CADENCE_CHOICES,
  CADENCE_PHRASE,
  DRUG_CHOICES,
  MONTHLY_CLEARING,
  bigDate,
  computeSideKick,
  explainSideKick,
  ordinalSuffix,
} from '@/lib/ready/sidekick';
import type { DrugChoice } from '@/lib/ready/sidekick';
import type { Cents } from '@/lib/types';
import type { LiquidityClass, PayCadence, SideKickResult } from '@/lib/ready/types';
import s from './sidekick.module.css';

/**
 * THE READY DAY TEST.
 *
 * Three taps, one enormous date, a PNG you can send to somebody. It shares a
 * classifier with the clinician product and nothing else — no account, no
 * ledger, no network call except an honest visitor counter that the page
 * hides if it cannot reach it.
 *
 * The rule that governs every string on this screen: the frame is always
 * "here is your date", never "you cannot afford this". TIMING is relief and
 * STRUCTURAL is anger, and both are somebody else's fault — the first is a
 * scheduling failure, the second is a price. Neither is a verdict on the
 * person holding the phone.
 */

const ACCENT: Record<LiquidityClass, string> = {
  TIMING: '#4ade9b',
  STALE: '#f2a33c',
  STRUCTURAL: '#ff5468',
};

/** Burned into the image pixels, so a repost without the caption still carries it. */
const TAGS = '#hokieai   @Cloudforce   @VirginiaTech';

interface Counter {
  count: number;
  medianDaysToReady: number | null;
  structural: number;
}

/** A frozen snapshot of the answered questions, so re-dragging a slider after
 *  the result never desynchronises the card from the date above it. */
interface Shown {
  result: SideKickResult;
  trace: string[];
  drug: DrugChoice;
  cadence: PayCadence;
  balance: Cents;
}

type ShareState = 'idle' | 'working' | 'copied' | 'saved';

export default function ReadyDayTest() {
  const [cadence, setCadence] = useState<PayCadence | null>(null);
  const [balance, setBalance] = useState<Cents>(dollars(240));
  const [drugId, setDrugId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [counter, setCounter] = useState<Counter | null>(null);
  const [shareState, setShareState] = useState<ShareState>('idle');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);

  const drug = DRUG_CHOICES.find((d) => d.id === drugId) ?? null;
  const ready = cadence !== null && drug !== null;

  // globals.css paints the clinician app's light paper on <body>, and a CSS
  // Module may not style a bare element. Without this, iOS rubber-band
  // overscroll flashes white around a page that is otherwise entirely dark.
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = '#05070d';
    return () => {
      document.body.style.background = previous;
    };
  }, []);

  // Warm the counter so the line under the result has a number the instant it
  // appears. A failure here is silent by design: the test still works offline.
  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/readyday', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Counter;
        if (live) setCounter(data);
      } catch {
        /* no counter, no line. Nothing else on the page depends on it. */
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    if (cadence === null || drug === null) return;
    const input = { cadence, balance, copay: drug.copay, drugLabel: drug.label };
    const result = computeSideKick(input);
    setShown({ result, trace: explainSideKick(input), drug, cadence, balance });
    setShareState('idle');

    try {
      const res = await fetch('/api/readyday', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ daysToReady: result.daysToReady }),
      });
      if (res.ok) setCounter((await res.json()) as Counter);
    } catch {
      /* the counter is a nicety; the date is the product */
    }
  }, [cadence, balance, drug]);

  useEffect(() => {
    if (shown === null) return;
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const canvas = canvasRef.current;
    if (canvas !== null) void paintCard(canvas, shown);
  }, [shown]);

  const share = useCallback(async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (canvas === null || shown === null) return;
    setShareState('working');
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob === null) {
      setShareState('idle');
      return;
    }
    const file = new File([blob], 'ready-day.png', { type: 'image/png' });

    // 1. The real thing: hand the OS sheet a PNG plus pre-filled text.
    if (navigator.canShare?.({ files: [file] }) === true) {
      try {
        await navigator.share({ files: [file], text: shareText(shown), url: window.location.href });
      } catch {
        /* the sheet was dismissed. Not an error, and not worth a message. */
      }
      setShareState('idle');
      return;
    }

    // 2. Desktop: the image on the clipboard, ready to paste into anything.
    try {
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setShareState('copied');
        return;
      }
    } catch {
      /* clipboard permission refused, or an insecure origin. Fall through. */
    }

    // 3. Always works.
    downloadBlob(blob);
    setShareState('saved');
  }, [shown]);

  const savePng = useCallback(async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob === null) return;
    downloadBlob(blob);
    setShareState('saved');
  }, []);

  const accent = shown === null ? ACCENT.TIMING : ACCENT[shown.result.class];

  return (
    <div className={s.page}>
      <div className={s.backdrop} aria-hidden="true" />
      <main className={s.wrap}>
        <header className={s.top}>
          <div className={s.kicker}>The Ready Day Test</div>
          <h1>When can you actually fill it?</h1>
          <p className={s.lede}>
            One in four new prescriptions in America is never picked up. The prescriber is told{' '}
            <strong>&ldquo;patient declined.&rdquo;</strong> Almost nobody declined. They were waiting
            on a paycheck, and nobody ever told the doctor which day it lands.
          </p>
          <p className={s.lede}>Three questions. No login, no email, nothing about you leaves this page.</p>
        </header>

        <ol className={s.questions}>
          <li className={s.q}>
            <div className={s.qhead}>
              <span className={s.qnum}>01</span>
              <span className={s.qtext}>When do you get paid?</span>
            </div>
            <div className={s.chips}>
              {CADENCE_CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`${s.chip} ${cadence === c.id ? s.chipOn : ''}`}
                  aria-pressed={cadence === c.id}
                  onClick={() => setCadence(c.id)}
                >
                  {c.label}
                  <small>{c.hint}</small>
                </button>
              ))}
            </div>
          </li>

          <li className={s.q}>
            <div className={s.qhead}>
              <span className={s.qnum}>02</span>
              <span className={s.qtext}>What is in checking right now?</span>
            </div>
            <div className={s.balance}>{fmtShort(balance)}</div>
            <input
              className={s.range}
              type="range"
              min={BALANCE_MIN}
              max={BALANCE_MAX}
              step={dollars(10)}
              value={balance}
              aria-label="What is in checking right now"
              aria-valuetext={fmtShort(balance)}
              onChange={(e) => setBalance(Number(e.target.value))}
            />
            <div className={s.scale}>
              <span>$0</span>
              <span>$1,000</span>
              <span>$2,000</span>
            </div>
          </li>

          <li className={s.q}>
            <div className={s.qhead}>
              <span className={s.qnum}>03</span>
              <span className={s.qtext}>Pick a prescription.</span>
            </div>
            <div className={s.drugs}>
              {DRUG_CHOICES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`${s.drug} ${drugId === d.id ? s.drugOn : ''}`}
                  aria-pressed={drugId === d.id}
                  onClick={() => setDrugId(d.id)}
                >
                  <span className={s.drugName}>{d.label}</span>
                  <span className={s.drugNote}>{d.note}</span>
                  <span className={s.drugPrice}>{fmtShort(d.copay)}</span>
                </button>
              ))}
            </div>
          </li>
        </ol>

        <button type="button" className={s.go} disabled={!ready} onClick={() => void submit()}>
          {ready ? 'Find my Ready Day' : 'Answer all three'}
        </button>
        <p className={s.reassure}>Nothing is stored. Nothing is sent anywhere.</p>

        {shown !== null && (
          <section
            ref={resultRef}
            className={s.result}
            style={{ '--accent': accent } as CSSProperties}
            aria-live="polite"
          >
            <span className={s.badge}>{shown.result.class}</span>
            <h2
              className={`${s.headline} ${shown.result.class === 'STRUCTURAL' ? s.headlineHot : ''}`}
            >
              {shown.result.headline}
            </h2>
            {/* The badge already says the class; repeating it under the badge
                reads as a stutter. Same trim the card does. */}
            <p className={s.subhead}>
              {sentence(shown.result.subhead.replace(`${shown.result.class} — `, ''))}
            </p>
            <p className={s.footnote}>{shown.result.footnote}</p>

            <div className={s.echo}>
              <span>{shown.drug.label}</span>
              <span>{fmtShort(shown.drug.copay)}</span>
              <span>{CADENCE_PHRASE[shown.cadence]}</span>
              <span>{fmtShort(shown.balance)} in checking</span>
              <span>as of {DEMO_TODAY}</span>
            </div>

            <details className={s.trace}>
              <summary>Show the arithmetic</summary>
              <ol className={s.traceList}>
                {shown.trace.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </details>

            <p className={s.assumption}>
              This test knows three things about you, so it has to assume one: that{' '}
              {fmtShort(MONTHLY_CLEARING)} a month clears after your committed bills. The clinician-side
              version does not assume it — it reads the deposits and the recurring obligations out of a
              real ledger and computes the same date from them.
            </p>

            <canvas ref={canvasRef} className={s.card} aria-label="Your Ready Day card, ready to share" />

            <div className={s.actions}>
              <button
                type="button"
                className={`${s.action} ${s.actionPrimary}`}
                onClick={() => void share()}
              >
                {shareState === 'working'
                  ? 'Preparing…'
                  : shareState === 'copied'
                    ? 'Copied — paste it anywhere'
                    : shareState === 'saved'
                      ? 'Saved to your downloads'
                      : 'Share my Ready Day'}
              </button>
              <button type="button" className={s.action} onClick={() => void savePng()}>
                Save PNG
              </button>
              <button
                type="button"
                className={s.action}
                onClick={() => {
                  setShown(null);
                  setShareState('idle');
                }}
              >
                Start over
              </button>
            </div>

            {counter !== null && counter.count > 0 && (
              <p className={s.counter}>
                You are the{' '}
                <b>
                  {counter.count.toLocaleString('en-US')}
                  {ordinalSuffix(counter.count)}
                </b>{' '}
                person to find their Ready Day.
                {counter.medianDaysToReady !== null && (
                  <>
                    {' '}
                    The median is <b>{counter.medianDaysToReady}</b> days away.
                  </>
                )}
                {counter.count >= 5 && counter.structural > 0 && (
                  <>
                    {' '}
                    For <b>{counter.structural.toLocaleString('en-US')}</b> of them, no date existed at
                    all.
                  </>
                )}
              </p>
            )}
          </section>
        )}

        <footer className={s.foot}>
          Prices are real US counter prices. The date is arithmetic, not an opinion — open{' '}
          <em>Show the arithmetic</em> and recompute it yourself. Built at VTHacks 14 as the public half
          of a clinical tool that sends a prescriber one enum and one date, and never a balance.
          <br />
          <a href="/">See the clinician side &rarr;</a> &nbsp;·&nbsp; <a href="/sticker-shock/prices">Price Shock: guess what care costs &rarr;</a>
          <span className={s.tags}>{TAGS}</span>
        </footer>
      </main>
    </div>
  );
}

/* ── share plumbing ──────────────────────────────────────────────────────── */

function shareText(shown: Shown): string {
  const r = shown.result;
  const head =
    r.class === 'STRUCTURAL'
      ? `There is no Ready Day for ${shown.drug.label} at ${fmtShort(shown.drug.copay)} a month. Not one day this year. That is not a me problem, that is a pricing problem.`
      : r.daysToReady === 0
        ? `My Ready Day is today — ${r.class}.`
        : `My Ready Day is ${bigDate(r.readyOn ?? DEMO_TODAY)} — ${r.class}. ${r.daysToReady ?? 0} days.`;
  return `${head}\n\n1 in 4 new prescriptions in America are never picked up, and the prescriber is told "patient declined." Three questions, no login. What is your Ready Day?\n\n${TAGS}`;
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ready-day.png';
  a.click();
  URL.revokeObjectURL(url);
}

/* ── the card ────────────────────────────────────────────────────────────── */

/**
 * 1200×675 — the aspect ratio every timeline crops to, drawn with the plain
 * Canvas 2D API so the page ships no rendering library. The tag line is
 * painted into the pixels rather than suggested in a caption, because a
 * screenshot of a screenshot loses the caption and keeps the image.
 */
async function paintCard(canvas: HTMLCanvasElement, shown: Shown): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  try {
    await document.fonts.ready;
  } catch {
    /* the fallback stack still renders a legible card */
  }

  const W = 1200;
  const H = 675;
  const PAD = 80;
  const MAXW = W - PAD * 2;
  canvas.width = W;
  canvas.height = H;

  const { result } = shown;
  const accent = ACCENT[result.class];
  const structural = result.class === 'STRUCTURAL';

  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#0e1421');
  bg.addColorStop(0.62, '#080c15');
  bg.addColorStop(1, '#05070d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.86, -60, 0, W * 0.86, -60, 640);
  glow.addColorStop(0, withAlpha(accent, 0.26));
  glow.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Chicago maroon, bottom left. It says where this was made without a logo.
  const vt = ctx.createRadialGradient(0, H, 0, 0, H, 580);
  vt.addColorStop(0, 'rgba(134, 31, 65, 0.36)');
  vt.addColorStop(1, 'rgba(134, 31, 65, 0)');
  ctx.fillStyle = vt;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 12, H);

  // Kicker.
  ctx.fillStyle = accent;
  ctx.font = '500 21px "Plex Mono", monospace';
  tracked(ctx, 'THE READY DAY TEST', PAD, 104, 5.5);

  // Label above the date.
  ctx.fillStyle = '#8e9db6';
  ctx.font = '400 27px "Plex Sans", sans-serif';
  tracked(ctx, structural ? 'THERE IS NO' : 'YOUR READY DAY IS', PAD, 192, 3);

  // The date. The only thing on this card anyone will read at thumbnail size.
  const big = structural
    ? 'READY DAY.'
    : result.daysToReady === 0
      ? 'Today.'
      : `${bigDate(result.readyOn ?? DEMO_TODAY)}.`;
  ctx.fillStyle = structural ? accent : '#ffffff';
  fitFont(ctx, big, MAXW, '600', '"Plex Sans", sans-serif', 124, 68);
  ctx.fillText(big, PAD, 314);

  // Class badge.
  ctx.font = '600 21px "Plex Mono", monospace';
  const badgeW = trackedWidth(ctx, result.class, 3.5) + 44;
  roundedRect(ctx, PAD, 350, badgeW, 48, 24);
  ctx.fillStyle = withAlpha(accent, 0.14);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = accent;
  tracked(ctx, result.class, PAD + 22, 381, 3.5);

  // Subhead: the class sentence without the badge word it would repeat.
  ctx.fillStyle = '#d3dcea';
  const sub = sentence(result.subhead.replace(`${result.class} — `, ''));
  fitFont(ctx, sub, MAXW, '400', '"Plex Sans", sans-serif', 33, 22);
  ctx.fillText(sub, PAD, 474);

  ctx.fillStyle = '#93a2b8';
  fitFont(ctx, result.footnote, MAXW, '400', '"Plex Sans", sans-serif', 23, 16);
  ctx.fillText(result.footnote, PAD, 536);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, 566.5);
  ctx.lineTo(W - PAD, 566.5);
  ctx.stroke();

  // The three answers, so the image carries its own inputs and nobody has to
  // take the date on faith.
  const echo = `${shown.drug.label} ${fmtShort(shown.drug.copay)} · ${CADENCE_PHRASE[shown.cadence]} · ${fmtShort(shown.balance)} in checking`;
  ctx.fillStyle = '#76859d';
  fitFont(ctx, echo, MAXW, '400', '"Plex Mono", monospace', 19, 14);
  ctx.fillText(echo, PAD, 604);

  // Burned in, bottom right, where a watermark goes. This line is the entire
  // reason the card is a PNG and not a link.
  ctx.font = '600 20px "Plex Mono", monospace';
  ctx.fillStyle = accent;
  tracked(ctx, TAGS, W - PAD - trackedWidth(ctx, TAGS, 1.2), 642, 1.2);
}

/** Stripping the badge word off the front leaves a lowercase sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Letter-spacing, by hand: `ctx.letterSpacing` is not everywhere yet. */
function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let width = 0;
  for (const ch of text) width += ctx.measureText(ch).width + spacing;
  return width - spacing;
}

/** Shrink until it fits on one line. A wrapped headline is a worse screenshot. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: string,
  family: string,
  start: number,
  min: number,
): void {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** '#4ade9b' + 0.26 -> 'rgba(74, 222, 155, 0.26)'. Gradient stops need it. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
