# Hardening — what the red team broke, and what we're doing about it

A hostile-judge pass (playing an Impiricus employee) attacked the Ready pitch. Most of it
landed. This file records every finding, whether it is genuinely fatal, and the decision.

**Headline: the product survives. The pitch does not, and had to be rebuilt around a
different centre of gravity.**

---

## 0. The fact that forced the repositioning

**Impiricus integrated Medvantx on September 8, 2026 — eleven days before judging.**
Verified at the GlobeNewswire release. It puts "sample management services and therapy
support directly into physician conversations," enabling "therapy access and fulfillment
resources," delivered by "SMS, chatbots, intelligent media, and other digital channels."
Medvantx's own product line includes **patient assistance, bridge/quick start, and cash-pay**
programs — the release does not explicitly confirm all of those are embedded, but the
direction is unmistakable.

**"Bridge" is Medvantx's product category, now inside the judge's platform.**

Our STALE class — the only class that moved money, and therefore the only class that earned
revenue — was a worse, legally shakier version of something the judge's employer announced
last week. Building the pitch on it would have been the same mistake as TrueCost versus
Concierge, made twice in one weekend.

---

## 1. The repositioning

**Ready is the rationing layer. The Ready Day is the evidence, not the product.**

> Surescripts is about to industrially manufacture abandonment alerts into a channel that
> already ignores most of what it receives. Ready decides which of those alerts is worth a
> physician's attention — and the second source that makes the decision possible is the
> patient's own cash position.

| Class | Old behaviour | New behaviour |
|---|---|---|
| **TIMING** | Alert the prescriber, big date on a card | **SUPPRESSED. Not sent.** The patient fills on payday with or without us; there is no physician action. This is now the *point*, not a gap. |
| **STALE** | Bridge money into checking | Sent — a clinical window closes before the cash arrives, and only a prescriber can re-issue, substitute or escalate. |
| **STRUCTURAL** | PAP queue, no slot | Unchanged. Sent off-channel; a prescriber decision. |

This single change answers the red team's objection 3 (*"for TIMING the doctor does nothing —
why is it on her screen?"*) and, better, it makes our own rationing logic self-consistent:
previously our attention engine, applied honestly to our own hero alert, would have refused
it. Now it does refuse it, deliberately, on screen.

**The hero demo moves from TIMING to STALE.** The TIMING row becomes the best example of an
alert we *don't* send.

---

## 2. FATAL findings, and the disposition of each

### 2a. The hero case contradicted its own arithmetic — FIXED IN FIXTURES
The scripted story had payday on Oct 3 and the displaced power bill on Oct 4. But
`projectedBalance(Oct 4)` includes the Oct 3 deposit, so the bill clears with ~$317 to spare
and `displacement` is `null`. The "$41 short" number was impossible under our own pseudocode —
and we were explicitly inviting judges to recompute it.
**Fix: the displaced obligation must fall BEFORE the next payday.** Fixtures corrected and
hand-checked against real code output, not against the prose.

### 2b. Anti-Kickback Statute — STRUCTURE CHANGED
Per-fill payment to a vendor for arranging prescriptions, plus cash into a beneficiary's
checking account, is the exact shape the AKS and the Beneficiary Inducements CMP police. Our
own cited literature (Social Security, welfare recipients) describes a largely *federally
insured* population — i.e. the population categorically excluded from manufacturer support.
**Fixes, all enforced in code, not in a slide:**
- Billing unit is a **cleared engagement**, never a fill. A verified fill is a *quality
  metric*, explicitly not an invoice line.
- Bridge eligibility is **commercial insurance only**, gated in `RankedCandidate` and disabled
  in the UI with a visible reason for government-insured patients.
- Funder is an **independent charitable foundation**, never a brand.
- The bridge is framed as a **funded purchase at the pharmacy**, the structure hubs already
  use — not cash to a patient.

### 2c. A bank ledger cannot verify a specific fill — CLAIM RETIRED
`CVS/PHARMACY #1234 $47.00` carries no NDC, no Rx number. Multi-item baskets, HSA cards, cash
and a spouse's card all break matching. This is true in production, not just in the sandbox.
**We no longer claim fill-level verification.** What the ledger honestly supports is
*corroboration* — a pharmacy-category debit of approximately the expected amount in the
expected window. That is enough to be a second source. It is not enough to bill on, and we say
so.

### 2d. Consent penetration kills the corroboration gate — REPOSITIONED
At a realistic 2–5% bank-link penetration, 95%+ of alerts are single-source and therefore
refused; the board would be all refusals and nothing cleared. Also, income attestation exists
for PAP (which selects for STRUCTURAL — our unmonetisable class), not for copay cards.
**We stop claiming a consumer acquisition path.** Ready is a **module for entities that
already hold the connection** — hub providers, health-system financial navigation, a payer's
app. Penetration is their number. We demonstrate the classifier and the rationing layer that
run on top of whatever penetration exists. The panel board carries an explicit note that it is
drawn at 100% linkage for legibility.

### 2e. The exchange slide contradicted itself — TABLE DELETED
It billed per cleared alert in the arithmetic and per verified fill in the prose; and if
billing really were per fill, cost-per-start equals whatever price we set, making the
comparison circular. Break-even analysis shows impressions win if the nine refused touches
convert at just 5.8% — an unremarkable rate — so the whole economic claim rested on an
unmeasured assumption, and one we destroyed by refusing to send them.
**Replaced with a proposed experiment**: deliverability decay under metered vs unmetered
volume, randomised holdout, six weeks inside Ascend. That is something a commercial lead can
actually act on, and it does not require anyone to believe our numbers.

### 2f. The saturation point is not identified from observational logs — CLAIM NARROWED
A high-volume week is a launch week or a congress; open rate falls because of *what is in the
week*, not because of a physician capacity constant. Identification needs randomised send
volume within physician, which nobody runs.
**New claim: we built the estimator and the control surface; the identification requires a
holdout that only a platform holding both the archive and the send can run.** That is true,
and it is a better answer than the one it replaces.

---

## 3. SERIOUS findings

- **`attentionDebt` printed noise.** "0.4 points" off n≈5 sends has a standard error around
  ±32 percentage points. **Do not print a decimal.** Show a coarse band or remove it.
- **Prescriptions do not expire in 30 days.** Non-controlled scripts are valid up to a year in
  most US states; what happens at 10–14 days is will-call restocking. **"Script expires" is
  factually wrong and must not appear on screen.** STALE is renamed to a *clinical window* —
  post-MI statin initiation, an antibiotic course, a titration schedule — which is drug-
  specific and makes `clinicalWeight` mean something.
- **The Ready Day should not be a single date.** No backtest exists and none can, so there is
  no MAE to quote. Sixty-five transactions is ~5 weeks — barely one billing cycle — and
  `detectIncome`'s CV<15% threshold fails hardest on exactly the hourly/gig population the
  liquidity literature is about. A date that is three days *early* means the card declines at
  the counter, which is the most adherence-destroying event in the journey.
  **Ship a window with a floor** ("earliest Oct 3, likely Oct 3–7") plus the honest framing
  that in production this is an *event trigger* on the live connection, not a forecast.
- **The STRUCTURAL enum is a durable poverty flag** written into a medical record, visible to
  every future clinician and discoverable in legal proceedings. Our "one enum and one date"
  privacy line minimises the payload while maximising its permanence. Acknowledge it rather
  than lead with it.
- **We bill for TIMING fills that would have happened anyway** — last-click attribution on a
  conversion we did not cause. Suppressing TIMING (§1) removes this.
- **The bridge funds the solvent-but-late and declines the insolvent.** PAP is genuinely the
  right instrument for STRUCTURAL, but say it out loud before someone else does.

---

## 4. Cheapest high-value fix: reconcile the numbers

The build spec's rehearsed lines used figures that `docs/FACTS.md` lists as DO-NOT-CLAIM:
the "October 2025" launch date, "93.5% override", "+52%/+99% payday effect", "55%/81%
physician survey", and the "$12/touch / $38/cleared" pricing. A judge needs to catch **one**
unsourced number to reclassify every other number in the pitch as decorative.
**FACTS.md wins every conflict. Anything not in it does not get said.**

Also narrow one overreach: *"not in their data at any price"* is falsifiable — banks and
neobanks ship forward-balance features, Capital One included. The true and sufficient claim is
**"no entity in the prescription supply chain can produce this date."**

---

## 5. What genuinely survives, unqualified

1. **The Ready Day as a primitive.** No one in the prescription chain — PBM, EHR, RTBC,
   pharmacy, pharma — can see a patient's cash position. That remains true.
2. **The three-way classifier.** TIMING / STALE / STRUCTURAL is a real distinction that today
   produces one undifferentiated alert and one chart note. Nobody separates them.
3. **The refusal layer.** Refusing uncorroborated alerts, showing the refusals, and letting the
   physician set the cap. This is the strongest thing in the build and it is now the centre of
   the pitch.
4. **The deterministic engine.** Hand-checkable arithmetic, no model in the decision path.
5. **The Nessie integration.** Real reads, real writes, real ids.

---

## 6. Two items resolved on inspection

**2a (hero arithmetic) was not reproduced in the build.** The spec's broken example had payday
on Oct 3 and the displaced bill on Oct 4. The fixture author independently got the ordering
right: Grant P. is paid on **2026-09-25** and his $96 water bill falls on the **24th** — the
obligation lands *before* the deposit, which is the only ordering under which a displacement
can exist. To be confirmed against real `npm test` output rather than the comment.

**The ATM feature is cut from the UI.** Measured behaviour: `GET /atms` ignores `lat`, `lng`
and `rad`, and every ATM Nessie holds is in Arlington. Our cohort is Roanoke — Cardinal Ridge,
Appalachian Power, LewisGale, WV Water. Relocating twelve hand-built ledgers to Northern
Virginia to make one row honest is not worth the churn this late, and printing a distance for
a Roanoke patient would be a fabricated number on a screen whose entire pitch is
hand-checkable arithmetic.

`getAtmsNear()` stays in the Nessie client — it is real, it parses the real response shape,
and it demonstrates endpoint breadth for the Capital One track. It simply does not render a
proximity claim. If asked: *"we implemented it, then measured that the sandbox's ATM set is
Arlington-only and ignores the radius parameter, so showing a distance to a Roanoke patient
would have been a number we invented."* That answer is worth more than the row was.

---

## 7. Two real bugs found by running the engine over the whole cohort

Output of `classifyLiquidity` across all twelve panel candidates, 2026-09-19.
Class mix came out **8 TIMING / 2 STALE / 2 STRUCTURAL** — a good spread for the board.
Two defects showed up that no unit test caught, because both are about *which* obligation
gets picked, not about the arithmetic.

### 7a. `shortBy` can exceed the copay — the displacement claim is then false

```
rx-1045  Sitagliptin   copay $85.00   displaces Verizon Wireless by $92.06
rx-1052  Insulin glargine copay $118.00  displaces Appalachian Power by $125.28
```

If the shortfall is larger than the copay, the obligation was **already** going to fail
without the prescription. Saying "paying this pushes your phone bill under the line" is then
simply untrue — the phone bill was under the line anyway.

**Displacement must be attributable to the copay.** The correct guard is
`shortBy <= copay`; anything else means the household was already short and the prescription
is not the cause. Where that happens the honest output is a *different* signal — "this
household is already behind" — not a displacement claim.

This matters more than it looks: displacement is the number we invite judges to recompute,
and it is the one we chose specifically because it is not a fabricated overdraft fee.

### 7b. The displacement picker chooses discretionary merchants

```
rx-1043  Insulin glargine  copay $145.00  displaces Planet Fitness Roanoke by $56.53
rx-1049  Dulaglutide       copay  $95.00  displaces Verizon Wireless by $75.58
```

"Fill your insulin and you lose your gym membership" is not an argument — it invites the
obvious reply, *cancel the gym*. The whole force of the displacement idea is that the
household is choosing between the drug and something it genuinely cannot defer.

**The picker must rank by essentiality, not just by date order**: housing, utilities, water,
insurance, childcare first; telecom, fitness, subscriptions and retail never. The essential
category set already exists in `liquidity.ts` for the spending floor — the same taxonomy
should gate which obligations are eligible to be reported as displaced.

### 7c. STRUCTURAL rows still emit a displacement

`rx-1049` is STRUCTURAL (no date exists) yet reports a displaced obligation. For STRUCTURAL
the displacement is meaningless — there is no "pay it today instead" counterfactual, because
there is no day at all. Suppress it for that class.

### 7d. The web side kick and the HokieAI agent can disagree

Same inputs, different answers, because they make different assumptions about *when* the next
payday falls:

| Surface | Input | Answer |
|---|---|---|
| HokieAI `Ready Day` agent | biweekly, $140, $47, **"payday in 6 days"** | Sept 25 |
| `/sticker-shock` web side kick | biweekly, $140, $47 (payday inferred) | Oct 2 |

Neither is wrong — the agent was told the payday and the app assumed a default biweekly
calendar. But both will be on screen during judging, and a judge who types the same numbers
into each gets two dates.

**Fix: the web side kick should ask for the next payday** (a fourth tap, or a "when's your
next payday?" inline control) rather than assuming one, so the two surfaces agree. If that is
too much surgery, have the app state its assumption on screen the way the HokieAI agent does
("assuming your next payday is the 2nd").
