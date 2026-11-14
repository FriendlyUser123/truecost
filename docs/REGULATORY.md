# Regulatory posture

A dedicated research agent ran the design against the Anti-Kickback Statute, the Beneficiary
Inducements CMP, FCRA, HIPAA, the FTC Health Breach Notification Rule, and state health-data
law. This is the distilled version: **the five design changes it forced, and the six answers
that survive a question from someone who works in this industry.**

This is a hackathon project, not a compliance filing. The point of the exercise was to make
sure nothing on screen is something a healthcare professional would recognise as unlawful.

---

## The five changes, all made

1. **No brand money into a patient's bank account.** Cash to a beneficiary, conditioned on
   filling a drug, is the Beneficiary Inducements CMP. This single edit also clears the
   AKS patient-inducement problem, the coupon guidance, seeding, Best Price, the SSI income
   question, and money transmission. The bridge is a **funded purchase at the pharmacy**, the
   structure hubs already use.

2. **Billing is per signal delivered, payable identically whether or not the patient fills.**
   A payment indexed to script volume is the exact shape the AKS polices, and "fair market
   value" does not save a volume-linked payment. A verified fill is a **quality metric**, never
   an invoice line.

3. **Consents are unbundled.** A separate, specific, revocable authorization — naming the
   recipient, the exact two fields, and the purpose — rather than a clause inside a bundled
   bank-linking screen. Washington voids consent obtained through a broad terms-of-use
   agreement mixed with unrelated information, and requires collection and sharing consent to
   be separate and distinct.

4. **The payload is the minimum operationally necessary.** A scheduling product needs a date.
   Granularity beyond operational necessity is evidence of a furnishing purpose, so every
   value in the enum has to earn its place.

5. **Ranking is by patient clinical urgency, not prescriber value.** The slot *budget* comes
   from the prescriber's measured saturation; the *order within it* is driven by how much the
   delay costs the patient. Ordering a clinical channel by how valuable a prescriber is to a
   brand is both the wrong ethics and a characteristic named in OIG fraud alerts.

---

## The six answers

**"You're sending PHI to a doctor without authorization."**
> The transmission is authorized, specifically and separately — and that is the actual test.
> The Health Breach Notification Rule now counts an *unauthorized disclosure* as a breach, and
> the regime is consent-gated, not volume-gated. Minimising the payload is not an exemption
> anywhere; authorization is. One properly-scoped authorization is what satisfies it.

**"Two fields is basically de-identified."**
> No, and we do not claim it. HIPAA already has a "we minimised it" category: a limited data
> set strips sixteen direct identifiers — name, address, account numbers — and is **still
> regulated PHI**, disclosable only under a data use agreement. Our payload keeps the patient's
> identity and adds a date, so it is strictly *less* de-identified than a category HIPAA
> already regulates. It is minimisation under authorization, which is a different argument.

**"Is this a consumer report? Are you a credit bureau?"**
> A clinician's prescribing decision is not one of the permissible purposes FCRA enumerates,
> and a use adjacent to but outside those purposes takes the communication outside the
> definition. We also contractually prohibit using the output in any credit, collections,
> payment-plan or employment decision, which is the measure that decided *Kidd v. Thomson
> Reuters*. Note the honest caveat: a non-report can *become* one if the recipient uses it for
> a permissible purpose, so the contractual ban is load-bearing, not decorative.

**"Has a regulator blessed any of this?"**
> No — and none has condemned it either. The CFPB asked this exact question in its 2017
> request for information on alternative data, which specifically lists "checking account
> transaction and cashflow data," and has never answered it. Here is how we resolved it for
> ourselves.

**"Using financial data to decide who gets help is discriminatory."**
> A federal regulator already contemplates it: the IRS rule governing nonprofit hospital
> financial assistance expressly allows using information obtained from sources other than the
> applicant to presumptively determine eligibility — and requires only that you disclose that
> you do. We adopt that norm voluntarily. Separately, any customer deploying us inherits an
> identify-and-mitigate duty for patient care decision support tools under ACA §1557, so bias
> documentation is a deliverable, not an afterthought.

**"What's your biggest unsolved problem?"**
> Accuracy and dispute. The enforcement action that actually fits a product like this was
> brought on accuracy and source-disclosure grounds, not permissible purpose — and those are
> the two duties we are least able to discharge. Inferring a recurring obligation from a bank
> memo is noisy, and a patient who wants to dispute a Ready Day has no furnisher to
> re-verify against. We would rather name that than have it found.

---

## The landmine we are standing on, geographically

**Virginia makes it a consumer-protection violation to obtain or disclose personally
identifiable reproductive or sexual health information without consent — and the definition
expressly reaches information *derived, inferred or algorithmically extrapolated* from
non-health data. Damages are actual or $500 per consumer, whichever is greater, trebled if
wilful, plus fees.**

A single contraceptive copay sitting in a transaction feed, run through a classifier, is a
$500-per-person statutory floor. There is no injury element to litigate, which makes it a
cleaner class vehicle than anything in Washington.

**Consequence for the build:** the classifier must never derive or display anything about
reproductive or sexual health, and the essential-spend categoriser must not surface pharmacy
line items by drug. It classifies on *amount and cadence*, never on what was bought. Worth
saying out loud — it is the kind of specific, local, correct detail that signals the team
actually thought about deployment.

---

## What we do not say

- *"We're HIPAA compliant."* We are not a covered entity. Saying it is itself a deception risk.
- *"The patient consented, so we're fine."* Consent cures permissible purpose. It does not
  cure consumer-report status, and it does not cure the AKS.
- *"We only send an enum and a date."* True, and not a defence on its own. See above.
- *"We're commercial-only, so the AKS doesn't apply."* A commercial-only carve-out has been
  treated as *evidence* of intent, not as a safe harbour.
