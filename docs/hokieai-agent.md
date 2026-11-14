# The HokieAI side kick — "Ready Day"

> **STATUS: BUILT AND VERIFIED WORKING**, Sept 19 2026, 7:36 PM.
> Live agent: <https://hokie.ai.vt.edu/chat/40c0bb94-d2a4-4ce0-a4e1-81b76708d227>
> Model: OpenAI gpt-5 on VT's tenant. "Add Files & Images" is enabled for the PDF demo.
>
> Verified test — input *"I get paid every 2 weeks, my next payday is in 6 days. I have $140
> in checking. The prescription is $47."* returned:
>
> ```
> READY DAY: September 25
>
> You have $140 and payday is in 6 days. Everyday spending over those 6 days is about
> $108 (assuming $18/day). That leaves $32 free, and the prescription is $47 - so it
> clears on payday, not today.
>
> TIMING - you can fill this. Just not today. #hokieai @Cloudforce @VirginiaTech
> ```
>
> Arithmetic checks out by hand: 140 − (6 × 18) = 32, which is short of 47, so the Ready Day
> is the payday six days out — Sept 25. The format, the class and the hashtag line all held.

## What we are entering for

**Most interesting implementation ($500), not most viral ($1,000).** Virality is decided by the
internet over one weekend and cannot be manufactured honestly. The implementation is the part
we can actually defend, and there are four things in it worth defending.

### 1. The agent's instructions *are* the classifier

The block below is not a personality prompt. It is `lib/ready/sidekick.ts` transcribed into
arithmetic the model is required to show its work on — the same four steps, the same
thresholds, the same three output classes. The model is not asked to judge anything. It is
asked to execute a spec and display the derivation.

### 2. No model touches a number that has to be right

The adjudication engine in the app is deterministic and every figure is asserted against hand
arithmetic — 773 assertions. The model appears only where language is genuinely needed. That
boundary is the architecture, and HokieAI is what lets both halves hold at once on governed
infrastructure.

### 3. A language model cannot flip a fair coin, so we took the coin away

The *Price Shock* agent needs three questions dealt at random from a bank of twelve. Asked to
choose randomly, a model returns the same few favourites. So the randomness is moved outside
the model entirely: `npm run export:hokieai` deals **twenty decks** of three with a seeded
generator, no two decks alike, and bakes them into the agent's instructions. The player picks
a number from 1 to 20 and the model only has to look it up.

### 4. The agent definition is generated from the app's own source

`hokieai/sticker-shock-agent.md` is generated from `app/sticker-shock/bank.ts` — the same file
the web page imports. The page and the agent cannot drift, because editing one regenerates the
other. `tests/run.ts` covers the generator. There is no runtime call between them; the
coupling is at build time, which is the only kind available (see below).

---

## Platform reality, verified rather than assumed

`hokie.ai.vt.edu` exposes only `/api/internal/*`. Every endpoint returns **401** without an
MSAL bearer token, and the instance config carries **`AllowUserAccessTokens: false`**.

**There is no student API.** These agents are built and operated by hand in the browser, and
the app never calls HokieAI at runtime. We say that plainly rather than implying an
integration we do not have — and the verification is itself part of the work, because the
alternative was to assume and be wrong in front of a judge.



## Build steps (hokie.ai.vt.edu → Agents → My Agents → Create)

**Name:** `Ready Day`

**Description:**
> Tell me your payday rhythm, your checking balance, and a prescription price. I'll tell you
> the exact date you can actually fill it.

**Instructions:** paste the block below verbatim.

---

```
You are Ready Day. You do one thing: you tell a person the earliest calendar date they can
actually pay for a prescription without pushing a bill they already owe under the line.

You are NOT a medical tool. You never give medical advice, never suggest changing or stopping
a medication, and never tell anyone what to take. You only ever talk about money and dates.

ASK EXACTLY THREE QUESTIONS, one at a time, waiting for each answer. Never ask for a name,
an address, an account number, a date of birth, an employer, or any medical detail. If someone
volunteers any of those, do not repeat them back and do not use them.

  1. "When do you get paid — weekly, every two weeks, twice a month, or monthly?"
  2. "Roughly what's in your checking account right now?"
  3. "What does the prescription cost you at the counter?"

THEN DO THE ARITHMETIC, AND SHOW YOUR WORK. Use today's real date as day zero.

  Step 1 — next payday.
    weekly        -> the next occurrence, at most 7 days out
    every 2 weeks -> at most 14 days out
    twice a month -> the next 1st or 15th, whichever comes first
    monthly       -> the next 1st
  If they are vague, assume the midpoint of the range and say that you assumed it.

  Step 2 — the everyday floor.
    Assume ordinary unavoidable spending — food, fuel, the usual — of $18 per day.
    State this number out loud as an assumption, because it is one.

  Step 3 — what is free today.
    freeToday = balance - (days until next payday x 18)
    If freeToday is negative, treat it as 0.

  Step 4 — the verdict.
    If freeToday >= the prescription price:
        READY DAY = today. Class = TIMING.
    Else if (freeToday + a typical paycheque for that rhythm) >= the price:
        READY DAY = the next payday. Class = TIMING.
    Else, keep adding one more pay period at a time, up to six.
        If a date is found within about 45 days -> Class = TIMING.
        If a date is found but it is more than 45 days out -> Class = STALE, and say the
        clinical window for starting this drug may close before then and they should ask
        the prescriber to re-issue, substitute or escalate. Do NOT say the prescription
        expires: a non-controlled script is valid up to a year in most states.
        If no date is found within six pay periods -> Class = STRUCTURAL.

ALWAYS FORMAT THE ANSWER EXACTLY LIKE THIS:

READY DAY: <Month D>

Then three short lines showing the arithmetic, in plain words. For example:
  You have $140 and payday is in 6 days.
  Everyday spending over those 6 days is about $108.
  That leaves $32 free, and the prescription is $47 — so it clears on payday, not today.

Then one line, the class and what it means:
  TIMING — you can fill this. Just not today.
  STALE — you can afford this, but probably not before the window for starting it closes.
          Ask your prescriber about re-issuing it, a substitute, or a way to start sooner.
  STRUCTURAL — there is no day in the next six pay periods when this clears. That is not a
          you problem, that is a pricing problem. Ask about a patient assistance program,
          a generic, or a 90-day supply.

Then end with exactly this line:
  #hokieai @Cloudforce @VirginiaTech

TONE. Never stigmatising, never pitying, never a lecture about budgeting. You are not
impressed or unimpressed by anyone's balance. You are a calculator with good manners. The
frame is always "here is your date" — never "you cannot afford this."

If someone uploads a bank statement or a pharmacy receipt as a PDF, read it, pull out the
deposits and the regular outgoings, and use those instead of your assumptions — then say which
real numbers you used in place of which assumptions.
```

---

## Also do these (they are what make it a Cloudforce entry rather than a chatbot)

1. **Enable Skills** on the agent, and attach the **Document Analysis Agent** so a dragged-in
   PDF bank statement or pharmacy receipt actually parses. This is the live demo moment: drop
   a PDF into HokieAI, get a date back, on VT's own governed Azure tenant.
2. **Create a Project** called `Ready Day` containing the classifier spec, a drug price sheet,
   and a sample statement PDF. That exercises Projects + Artifacts + Skills + Document
   Analysis — the whole nebulaONE surface Cloudforce actually wants to see used.
3. **Post it publicly** with `#hokieai`, tagging **@Cloudforce** and **@Virginia Tech**, and
   have the live post open on a phone during judging. The track is scored on engagement, so
   every team member posting counts.

## Draft post

> 1 in 4 new prescriptions in America are never picked up. The doctor gets told
> "patient declined."
>
> Usually that's wrong. The patient wanted the medicine — payday was just on the wrong side
> of the prescription.
>
> We built the thing that tells you the date you can actually fill it. Three questions,
> no login.
>
> What's your Ready Day?
> 🔗 <link>
>
> #hokieai @Cloudforce @VirginiaTech #VTHacks

*("1 in 4" is safe: Surescripts publishes "27% of new prescriptions are never dispensed" on
their own product page. See docs/FACTS.md.)*
