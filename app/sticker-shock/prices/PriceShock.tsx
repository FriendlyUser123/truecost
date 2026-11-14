'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import '../sticker-shock.css';
import { formatUsd, parseQuestionIds, pickQuestions, scaleLabels, score, toSlider, toValue, type Item } from '../bank';

/**
 * PRICE SHOCK — the second Sticker Shock game.
 *
 * `/sticker-shock` is the Ready Day Test: what date does YOUR cash flow clear a
 * copay. This is its companion: what does American healthcare actually cost, and
 * how wrong are you. Both are three questions, one personal result, no login.
 *
 * The three questions are dealt at random from a bank of real, sourced prices
 * (see ../bank.ts, which the HokieAI agent in hokieai/ is generated from too). A
 * shared link carries `?q=` so a friend is dealt the same three and can be
 * compared.
 */

export default function PriceShock() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [guesses, setGuesses] = useState<number[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'saved'>('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const deal = useCallback((next: Item[]) => {
    setItems(next);
    setGuesses(next.map((i) => i.start));
    setSeen((prev) => [...new Set([...prev, ...next.map((i) => i.id)])]);
  }, []);

  // The deal happens after mount, not during render: Math.random on the server
  // and again on the client would hand the browser a different three questions
  // than the HTML it was sent, and React would rightly refuse to reconcile them.
  useEffect(() => {
    const pinned = parseQuestionIds(new URLSearchParams(window.location.search).get('q'));
    deal(pinned ?? pickQuestions(Math.random));
  }, [deal]);

  const list = items ?? [];
  const { meanAbs, guessedLow, tier } = score(list, guesses);

  const setGuess = (i: number, v: number) =>
    setGuesses((g) => g.map((old, idx) => (idx === i ? v : old)));

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      await document.fonts.ready;
    } catch {
      /* fonts are a nicety, the card still renders */
    }

    const W = 1200;
    const H = 630;
    canvas.width = W;
    canvas.height = H;

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16233c');
    g.addColorStop(1, '#060b14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffb400';
    ctx.font = '500 22px "Plex Mono", monospace';
    ctx.fillText('P R I C E   S H O C K', 64, 82);

    ctx.fillStyle = meanAbs <= 20 ? '#4ade9b' : '#ff5c47';
    ctx.font = '600 150px "Plex Mono", monospace';
    ctx.fillText(`${Math.round(meanAbs)}%`, 60, 226);

    ctx.fillStyle = '#8a99b0';
    ctx.font = '400 24px "Plex Sans", sans-serif';
    ctx.fillText(guessedLow ? 'under the real price, on average' : 'over the real price, on average', 64, 266);

    ctx.fillStyle = '#f3f5f8';
    ctx.font = '600 52px "Plex Sans", sans-serif';
    wrap(ctx, tier.title, 64, 348, W - 128, 60);

    ctx.fillStyle = '#8a99b0';
    ctx.font = '400 25px "Plex Sans", sans-serif';
    wrap(ctx, tier.line, 64, 430, W - 220, 36);

    ctx.strokeStyle = '#1d2941';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(64, 548);
    ctx.lineTo(W - 64, 548);
    ctx.stroke();

    ctx.fillStyle = '#8a99b0';
    ctx.font = '400 21px "Plex Sans", sans-serif';
    ctx.fillText('How much do you think healthcare costs?', 64, 586);
    ctx.fillStyle = '#ffb400';
    ctx.font = '500 21px "Plex Mono", monospace';
    const tag = 'ready /sticker-shock/prices';
    ctx.fillText(tag, W - 64 - ctx.measureText(tag).width, 586);
  }, [meanAbs, guessedLow, tier]);

  useEffect(() => {
    if (done) void draw();
  }, [done, draw]);

  const share = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setShareState('sharing');
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) {
      setShareState('idle');
      return;
    }
    const file = new File([blob], 'price-shock.png', { type: 'image/png' });
    // The link deals the recipient the same three questions, so scores compare.
    const link = `${window.location.origin}/sticker-shock/prices?q=${list.map((i) => i.id).join(',')}`;
    const text = `I was off by ${Math.round(meanAbs)}% on what American healthcare costs. ${tier.title}\nSame three questions, beat me: ${link}`;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        setShareState('idle');
        return;
      }
      throw new Error('no file share');
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'price-shock.png';
      a.click();
      URL.revokeObjectURL(url);
      setShareState('saved');
    }
  }, [meanAbs, tier.title, list]);

  const reshuffle = () => {
    deal(pickQuestions(Math.random, seen));
    setDone(false);
    setShareState('idle');
  };

  return (
    <div className="ss">
      <div className="ss-wrap">
        <header className="ss-top">
          <div className="ss-kicker">Price Shock</div>
          <h1>Guess what it costs.</h1>
          <p>
            Three things American healthcare charges for. Drag to your guess. No account, no email, eleven seconds. A
            different three every time.
          </p>
        </header>

        {items === null ? (
          <p className="ss-note">Dealing three questions…</p>
        ) : !done ? (
          <>
            {list.map((it, i) => {
              const guess = guesses[i] ?? it.start;
              const labels = scaleLabels(it.scale);
              return (
                <section className="ss-q" key={it.id}>
                  <h2>{it.label}</h2>
                  <div className="sub">{it.detail}</div>
                  <div className="ss-guess" aria-hidden="true">
                    {formatUsd(guess)}
                  </div>
                  <input
                    className="ss-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={toSlider(it.scale, guess)}
                    aria-label={`Your guess for ${it.label}`}
                    aria-valuetext={formatUsd(guess)}
                    onChange={(e) => setGuess(i, toValue(it.scale, Number(e.target.value)))}
                  />
                  <div className="ss-scale">
                    {labels.map((l, k) => (
                      <span key={k}>{l}</span>
                    ))}
                  </div>
                </section>
              );
            })}
            <div className="ss-cta">
              <button type="button" className="ss-btn" onClick={() => setDone(true)}>
                Lock in my guesses
              </button>
              <button type="button" className="ss-btn ghost" onClick={reshuffle}>
                Different questions
              </button>
            </div>
            <p className="ss-note">Nothing is stored. Nothing is sent anywhere.</p>
          </>
        ) : (
          <>
            <section className="ss-verdict">
              <div className={`ss-off ${meanAbs <= 20 ? 'close' : ''}`}>{Math.round(meanAbs)}%</div>
              <div className="ss-offlabel">
                {guessedLow ? 'under the real price, on average' : 'over the real price, on average'}
              </div>
              <h2 className="ss-title">{tier.title}</h2>
              <p className="ss-line">{tier.line}</p>
            </section>

            <div className="ss-rows">
              {list.map((it, i) => (
                <div className="ss-row" key={it.id}>
                  <div className="nm">
                    {it.label}
                    <small>{it.source}</small>
                  </div>
                  <div className="v you">{formatUsd(guesses[i] ?? it.start)}</div>
                  <div className="v real">{formatUsd(it.truth)}</div>
                </div>
              ))}
            </div>

            <canvas ref={canvasRef} className="ss-card" aria-label="Your shareable result card" />

            <div className="ss-cta">
              <button type="button" className="ss-btn" onClick={() => void share()}>
                {shareState === 'sharing' ? 'Preparing…' : shareState === 'saved' ? 'Saved to downloads' : 'Share my result'}
              </button>
              <button type="button" className="ss-btn ghost" onClick={reshuffle}>
                Try again, new questions
              </button>
            </div>
          </>
        )}

        <footer className="ss-foot">
          Prices are real US figures, each with its source, and they are the reason people skip treatment. A fifth to a
          third of new prescriptions are never picked up, and cost is the reason patients give most often.
          <br />
          <a href="/sticker-shock">Now find out your Ready Day &rarr;</a> &nbsp;·&nbsp; <a href="/">The panel board &rarr;</a>
        </footer>
      </div>
    </div>
  );
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let cursor = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cursor);
}
