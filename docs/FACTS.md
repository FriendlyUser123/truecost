# Verified facts — every claim we make on stage

**Rule: if a number is not in this file with a source, it does not get said to a judge.**

Three tiers below. Tier 1 is quotable verbatim. Tier 2 is directionally safe but must be
attributed loosely ("published research suggests"). Tier 3 is *unverified* — we do not say it.

---

## Tier 1 — verified from a primary source, quotable

### Surescripts First-Fill Abandonment
Source: <https://surescripts.com/products/first-fill-abandonment> (fetched Sept 19 2026)

The product is real and currently ships. Verbatim from their page:

- It "proactively monitors new prescriptions sent across the Surescripts network and flags
  when patients don't pick them up."
- Delivered to care teams / EHR vendors / health systems "at their chosen frequency,"
  selectable "daily or weekly."
- Uses "direct pharmacy data refreshed every 24 hours" rather than claims.
- Prescribers gain visibility into "which patients need outreach" so "intervention can be
  initiated in days, not weeks."

Their own published statistics, on that page:

| Figure | Exact wording |
|---|---|
| **27%** | "27% of new prescriptions are never dispensed" |
| **27%** | "27% of U.S. adults have not filled a prescription due to cost" |
| **14.2%** | "14.2% of prescriptions take 7 days or longer to fill" |

**Why the third one matters more than the other two.** That is the category incumbent
publishing, in its own marketing, that *delay is a distinct phenomenon from abandonment* — and
then shipping a product that only measures abandonment. 14.2% of prescriptions are late, not
lost. Nothing in their stack says which day they will land. That is the Ready Day, in their
own numbers.

**⚠ Do NOT claim a launch date.** An earlier draft asserted "shipped October 2025." That date
is **not** on the Surescripts page and we have not sourced it. Say "currently ships."

### Our own arithmetic
Every number rendered by the app is recomputable by hand from the `trace[]` drawer on screen.
`npm test` asserts each one against a hand calculation written in a comment above it: on the
final build that is **773 assertions**, all passing, with `tsc --noEmit` and `next build`
clean and all nine routes returning 200. This is a claim we can make without qualification,
and we should invite the judge to test it.

**Say 773, not a rounder number, and re-run `npm test` if you have touched anything.** Earlier
drafts of this file said 247, then 744, then 765; the count is the one the test runner prints.
The last jump was eight assertions covering the read-only-filesystem fallback in `lib/fsjson.ts`,
added after the deployed bridge button returned a 500.

### The demo clock is pinned, and we say so unprompted
`DEMO_TODAY` in `lib/dates.ts` pins "today" to **2026-09-19**. Every screen therefore reads
*panel as of Sep 19*, including on judging morning. This is deliberate: all 773 expected values
were hand-derived against that date. Measured, not assumed — running `DEMO_TODAY=2026-09-20
npm test` fails **seven** assertions (plan-year month 3, four capacity figures, the uninsured
counter-price shortfall, and the payday-alignment write test), because those seven quantities
are genuinely different on a different day.

**Quotable:** "The clock is pinned on purpose so the screen matches the arithmetic we can show
you. It's one environment variable." **Never say** the site is live-dated, or that it tracks
the current date.

### The site is deployed, and this is what may be said about it
`truecost.health` is live, serving the `draft-3` build over HTTPS, and every route returns 200.
**Quotable:** the URL itself, and that a judge can open it on their phone.

This entry replaces a Tier 3 line reading *"Any deployed URL / GoDaddy domain — nothing deployed
unless and until it actually is."* That was written before the domain existed and was still in
this file after the site went up, which is the wrong direction for a document whose job is to
stop us saying untrue things — it was forbidding a true one. The limits that remain real moved
to Tier 3 below: the deployed build runs on simulated data, and its bridge state does not
survive between requests.

### The domain, and the MLH claim resting on it
`truecost.health` was registered **2026-09-20 06:31 UTC through Porkbun**, not GoDaddy. We still
claim MLH's *Best Domain Name from GoDaddy Registry*, and the reason is the difference between a
registrar and a registry: IANA's root database lists the `.health` registry operator as
**Registry Services, LLC**, Tempe AZ, administrative contact **GoDaddy Registry**,
`iana@registry.godaddy`.

**Quotable:** "`.health` is a GoDaddy Registry TLD — IANA lists the operator as GoDaddy Registry.
We bought it through Porkbun, but the registry is theirs." **Never say** we registered it with
GoDaddy, or that we used the MLH promo code.

### HokieAI platform constraints
Verified directly against `hokie.ai.vt.edu` on Sept 19 2026:
- Instance config: `AllowUserCreatedGptSystems: true`, `AllowSkills: true`,
  `AllowApiAccessManagement: true`, **`AllowUserAccessTokens: false`**.
- Every `/api/internal/*` endpoint returns **401** with session cookies; it requires an MSAL
  bearer token.
- **Conclusion: there is no programmatic access.** Anything on HokieAI is browser-operated.
  We say this plainly rather than implying an integration we do not have.
- **The Ready Day agent is built and verified working.** The Price Shock agent
  (`hokieai/sticker-shock-agent.md`) is a paste-ready definition that **has not been created in
  HokieAI**. Two agents exist on paper; one exists in the world. Say which is which.

### The household segment's published constants
Every constant in `lib/fixtures/household.ts` carries a label in the source and the same label
in the UI: **SOURCED** (publisher and year) or **MODELLED** (chosen because no published figure
exists). The SOURCED ones are Tier 1 and quotable as they stand:

| Figure | Source |
|---|---|
| **$83,730** median household income, 2024 | U.S. Census Bureau, *Income in the United States: 2024* (**P60-286**) |
| **$27,320** poverty guideline, household of three, 2026; the household at **306%** of it | HHS/ASPE 2026 poverty guidelines, 48 contiguous states |
| **$1,886** average single-coverage deductible | **KFF** Employer Health Benefits Survey **2025** |
| **$658** average household drug spend a year, OTC included | **BLS** Consumer Expenditure Survey 2024 |
| **3.0%** personal saving rate, July 2026 | BEA, Personal Income and Outlays |
| The rank and prescription counts of the fourteen drugs | ClinCalc DrugStats 2024, built from AHRQ's MEPS. **Estimates.** |
| Retail and discount-card reference prices | **GoodRx**, as published, at the date recorded beside each one |

The figures the engine *computes* from those — `$1,381.20` as issued, `$946.80` after routing
and assistance, `$183.01` a month of slack, `$36.42` across 26 paychecks — are ours, and each
is asserted against hand arithmetic in `tests/run.ts`. They are quotable because they are
recomputable, not because anyone published them.

The full breakdown of what in that segment is sourced, loosely attributable, and forbidden is
in **[The household segment and Price Shock](#the-household-segment-and-price-shock)** below.
It is kept separate on purpose: none of it supports the Ready Day.

---

## Tier 2 — real, but attribute loosely

- **Primary non-adherence** is commonly cited in the 20–30% range. Prefer quoting Surescripts'
  own "27% of new prescriptions are never dispensed" (Tier 1) over a range we'd have to defend.
- **Payday effects on prescription fills.** There is a genuine health-economics literature
  showing fills cluster on income arrival — Danish administrative data on welfare recipients,
  and Gross & Tobacman's *Dangerous Liquidity* on Social Security payment timing. The effect
  is real and directionally large. **We have not re-verified the exact effect sizes**
  (a "+52% / +99%" figure appears in our research notes but was not confirmed against the
  papers). Say "published research shows fills cluster sharply on payday" — do not quote a
  percentage we have not read in the source.
- **Alert fatigue / override rates.** Override rates for medication-related clinical decision
  support alerts are well documented to be very high — frequently reported above 90% in
  academic medical centre studies. A specific "93.5% across 196,225 alerts" figure appears in
  our notes but **was not independently verified** before the session's search budget ran out.
  Say "override rates above 90% are widely reported" unless someone re-checks the citation.

---

## Tier 3 — DO NOT CLAIM

| Claim | Why not |
|---|---|
| "Surescripts shipped this in October 2025" | Date not sourced. See above. |
| "+52% / +99% payday fill effect" | Effect sizes not verified against the papers. |
| "93.5% of alerts are overridden" | Specific study not verified. |
| Gemini / Google AI Studio | VT Workspace blocks it; key returns 400. Never worked. |
| ElevenLabs | No key ever present. Read-aloud is the browser's `speechSynthesis`. |
| MongoDB Atlas | Never connected. The code path has been deleted. |
| "The deployed site reads live Nessie" | It does not. Production has no Nessie env vars, so its badge reads **Nessie simulated ledger** and so should you. Live Nessie runs on `localhost:3100`, which is where the Capital One demo happens. |
| "Press the bridge button on truecost.health and watch the balance drop" | It returns 200 and moves the money, but the deployed filesystem is read-only so the grant lives in one server instance's memory. A second press may say *already granted* instead. Demo it locally; if it happens in front of a judge, call it a serverless-state limit, not a broken transfer. |
| "We integrate with HokieAI" | There is no API. The agent is browser-operated. Say so. |
| Real patient data | Everything is synthetic. Say "synthetic patient" before being asked. |
| "The prescription expires" | It does not. A non-controlled US script is valid up to a year in most states. What closes is the **clinical window** for starting that drug. A clinician judge will check this one. |
| "We bill per verified fill" | A bank line carries no NDC and no Rx number. A ledger **corroborates** a fill; it cannot verify one. We bill per **cleared engagement**, and the verified fill is a quality metric the contract is scored on, never an invoice line. |
| Any bare decimal for attention debt | Render the **band + interval + n** the engine produces — currently `none (95% CI −2.0 to +3.5 pts, n=367)`. A single decimal there is two orders of magnitude inside the noise of its own inputs. |
| "The Price Shock agent is live" | `hokieai/sticker-shock-agent.md` is a definition. The agent has not been created in HokieAI. |

---

## What is synthetic, and we volunteer it

- **The patients.** All twelve panel rows. No real PHI — using real PHI in a demo would be
  unlawful. The *arithmetic* over them is real and hand-checkable.
- **The engagement history.** We do not have Impiricus's 1M providers. `lib/fixtures/
  engagement.ts` is a deterministic synthetic archive, deliberately built at realistic
  sparsity (~6–12 touches/month, not dozens/day) because a dense fixture would make the
  saturation point meaningless. **This is the single biggest "but" in the project and we say
  it first, unprompted.** What we demonstrate is that the saturation point is *computable* and
  what it *does* to the channel — not that we measured a real physician.
- **The pharmacy side of the settlement.** Nessie has no pharmacy, so `recordFill()` posts the
  purchase that `verifyStart()` then observes. In production the signal is the patient's own
  card transaction, which the bank sees natively. We state this rather than letting a judge
  discover it: *"we simulate the pharmacy's side because the sandbox has no pharmacy."*
- **The formulary and copay amounts.** Seeded, not a live payer feed.
- **The median household itself.** It is a *composite*: a real published income, a real
  published poverty guideline and a real published deductible, wrapped around a bank ledger we
  built. The ledger is constrained to two published figures — take-home at about 87% of the
  Census median gross, and spending calibrated to 97 cents of every disposable dollar, the
  complement of the BEA saving rate — and its spare cash is then *derived* from those
  transactions rather than typed in. That derivation is real; the household is not a
  household. Its state (Virginia), its 2.5-person average rounded up to three, its
  discount-card prices, two of its three plans, every plan's out-of-pocket maximum and two of
  its ten assistance programs are modelled. Say "composite" the first time you describe it.

## What is genuinely real

- **The Capital One Nessie integration.** Live HTTP against `api.nessieisreal.com` — real
  reads, real writes, real transfer and purchase ids a judge can hit themselves.
- **The deterministic engines.** No model anywhere in the decision path.
- **The Spanish patient card.** Genuine, idiomatic, 6th-grade reading level.
- **The privacy boundary.** `ReadyClaim` is one enum and one date, enforced by the type system,
  and the UI prints what was withheld next to what was sent.

---

## Nessie sandbox — measured behaviour, Sept 19 2026 ~7:40 PM

Tested directly against `api.nessieisreal.com` with our live key.

| Behaviour | What we measured |
|---|---|
| Reachability | **Live.** Checking returns `balance: 204`. |
| Balance precision | **Whole dollars only** — `204`, never `204.37`. Confirmed again. |
| `GET /atms` response shape | **A bare array.** *Not* the wrapped `{code,message,data}` page an earlier note claimed. Our parser accepts both, so this is safe either way. |
| **`GET /atms?lat=&lng=&rad=`** | **The geo parameters are ignored.** Blacksburg (37.23, −80.41) with `rad=5`, Arlington with `rad=1`, and no parameters at all each return **the identical 13 ATMs**, all clustered in **Arlington, Virginia**. There is no radius filtering in the sandbox. |

### What this forces

A patient in Roanoke cannot honestly be shown "nearest fee-free ATM, 1.2 mi." The only ATMs
Nessie has are ~200 miles away, and any distance we printed for a Roanoke patient would be a
number we invented.

Two ways out were on the table: relocate the cohort to Arlington so the coordinates are
genuinely local, or cut the feature.

**What we actually did on the final build: we cut it.** The cohort stayed in Roanoke, and
there is no ATM row anywhere in the UI. `getAtmsNear()` is still real and still lives in
`lib/nessie/client.ts`, unused, with the measurement written above it — see the comments in
`lib/ready/card.ts` and `app/card/[ref]/page.tsx` that say so. **Do not re-enable it and do not
say "nearest fee-free ATM" to a judge.** Showing a fabricated distance is exactly the kind of
detail a judge checks, and it would cost more than the endpoint earns.

What we *do* say about it, unprompted, is the measurement itself — it is the best short proof
that we tested the sandbox rather than trusting its documentation.


---

## The household segment and Price Shock

Added when the two builds were combined. **None of this supports the Ready Day, the classifier
or the exchange**, and none of it should be said in their defence. It is the claims behind
`/average-american`, `/sticker-shock/prices` and `hokieai/sticker-shock-agent.md`, sorted the same
way as everything above.

### Tier 1 — verified from a primary source, quotable

| Figure | Source |
|---|---|
| **$83,730** median household income, 2024 | U.S. Census Bureau, *Income in the United States: 2024* (P60-286) |
| **$27,320** poverty guideline, household of three, 2026 | HHS/ASPE 2026 poverty guidelines, 48 contiguous states |
| **$658** average household spend on drugs a year, OTC included | BLS Consumer Expenditure Survey 2024 |
| **3.0%** personal saving rate, July 2026 | BEA, Personal Income and Outlays |
| **$1,886** average single-coverage deductible | KFF Employer Health Benefits Survey 2025 |
| The rank and prescription counts of the fourteen drugs | ClinCalc DrugStats 2024, built from AHRQ's MEPS. **Estimates.** |

Price Shock's twelve prices each carry their source on the page (`app/sticker-shock/bank.ts`).

### Tier 2 — real, but attribute loosely

- The average plan's **$11 / $37 / $67 / $116** tier copays come from *secondary summaries* of
  KFF's Section 9, not the report. Check them before quoting them.
- Price Shock's Narcan ($45, Emergent BioSolutions 2023) and Humalog ($66.40, after Eli Lilly's 2023
  cut) are retail and list prices, which move. The inhaler, EpiPen, ambulance, atorvastatin and
  Ozempic figures were carried over from the earlier build and **were not re-verified**.

### Tier 3 — DO NOT CLAIM

- **That the household's bank account is real, or live.** It is seeded. The page's badge says
  `Nessie seeded` until `npm run seed:nessie:household` has been run with a key.
- **That the household's live Nessie path works.** It is tested against a stubbed sandbox, which
  proves the requests are built correctly and proves nothing about the real API.
- **That "affordable" is a finding about real households.** The household is a composite, and its
  spare cash is derived from a ledger built to *constrain* it to the BEA saving rate.
- **That a HokieAI agent for Price Shock exists.** `hokieai/sticker-shock-agent.md` is a
  definition. Creating the agent needs a Virginia Tech login and has not been done.
- **That discount-card prices are quotes.** They are modelled.
- **The semaglutide household scenarios as costs a real patient would face.** They assume
  manufacturer-card dollars count toward the deductible; a plan with a copay accumulator does not
  credit them, and the bill there is higher.

### Synthetic or modelled, and we volunteer it

The household's bank transactions; its discount-card prices; the low-deductible and high-deductible
plans and every plan's out-of-pocket maximum; the two added assistance programs (a rescue-inhaler
card, a free-clinic pharmacy program); the choice of Virginia as its state; and rounding a
2.5-person average household up to three.