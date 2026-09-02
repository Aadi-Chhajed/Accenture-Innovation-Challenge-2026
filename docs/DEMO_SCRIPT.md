# PatientTriage.ai — demo script

**Team Themistocles · IIT Kanpur · Accenture Innovation Challenge 2026**

Two versions below: an **8-minute live walkthrough** (§2) and a **90-second
elevator cut** (§5) for when you get less time than promised.

`[SAY]` = spoken. `[DO]` = what you click. Timings are cumulative.

**Before you start:** app running, logged in (`NUR-1042` + any password),
dashboard loaded, demo data freshly reset (More → Reset demo data).

---

## 1. The opening — 45 seconds

> `[SAY]` In an Indian district emergency department, one nurse decides where
> every arriving patient goes. She has about **two and a half minutes** per
> patient, no lab, no imaging, and often no prior record. Get it wrong in one
> direction and someone with a silent heart attack sits in the waiting room.
> Get it wrong in the other and you flood the resus bay with sprains.
>
> That decision is the bottleneck of the entire department, and it is made from
> a story, a set of vitals, and experience.
>
> **PatientTriage.ai is decision support for that one decision.** Not a
> diagnosis engine. Not a chatbot. It gives the nurse a level, a pathway, a
> destination, and — this is the part that matters — **the reasoning behind
> all three**, in under a second, working offline.

**The one line to land early:**

> `[SAY]` A deterministic rule engine decides urgency and pathway. The AI layer
> adds extraction, questioning and a second opinion on top — and by design it
> **can never override the engine**. If every API key is wrong and the network
> is down, the app still triages correctly. The AI makes it better; it is not
> load-bearing.

---

## 2. The live walkthrough — 8 minutes

### Beat 1 · The queue (0:45 → 1:30)

`[DO]` Dashboard. Point at the level filters and the stat row.

> `[SAY]` Twenty-one live patients across all five acuity levels. Every card
> shows level, pathway, waiting time and how close it is to the safe-wait
> threshold. Those thresholds aren't invented — they're the **CTAS national
> targets**: immediate, 15, 30, 60, 120 minutes.
>
> The queue monitors itself. If a Level 2 crosses 15 minutes with nobody
> touching the app, it raises a critical alert on its own.

`[DO]` Tap the Alerts tab briefly — show a real alert already sitting there.

---

### Beat 2 · Gate 0, the question before the questions (1:30 → 2:30)

`[DO]` New Patient. Stop on step 1 without scrolling. Point at the red panel.

> `[SAY]` The first control in the intake is **not a question**. It's this.
>
> Some patients are visibly dying when they arrive. A triage tool that demands
> a questionnaire before it will route them has inverted its own purpose. The
> nurse looking at a collapsed, apnoeic patient has a **stronger signal than
> anything the form could collect**, and she has it immediately.

`[DO]` Tap "Unresponsive / cannot be woken", then confirm.

> `[SAY]` One tap. **Level 1, zero wait, straight to resuscitation.** No
> analysis animation, no questions. The rule engine short-circuits before any
> other rule runs, so no missing field can delay it and no later rule can
> dilute it.
>
> The record is incomplete **by construction** — and it says so: intake pending,
> critical alert raised for the receiving team, and the nurse's stated reason
> written to the audit trail. Documentation follows resuscitation. It does not
> precede it.

`[DO]` Scroll to the AI review card.

> `[SAY]` And note what the AI says here: it **concurs**, and contributes a
> forward-looking differential — what the receiving team should check first.
> That took work. The first version argued *against* the bypass — "routing to
> resuscitation is not supported, no evidence the patient is unresponsive" —
> reasoning from the empty form instead of recognising it's empty on purpose.

---

### Beat 3 · A real intake (2:30 → 4:30)

`[DO]` Back to dashboard → New Patient. Walk the six steps at pace.

> `[SAY]` For everyone else, six steps against a **five-minute budget** — that
> timer in the header is live. Published ED work puts the median triage
> encounter at two and a half to three minutes. This was eight screens; it's
> six, with nothing dropped. An intake that takes eight minutes doesn't get
> filled in carefully, it gets skipped — and a safety net nobody uses protects
> nobody.

**Step 1 — Arrival & source.** `[DO]` Ambulance, Family, Hinglish.

> `[SAY]` Who's speaking is asked **first**, before anything clinical, because a
> third-party account discounts confidence on every answer that follows. The
> system has to know that before those answers arrive, not after.

**Step 2 — Patient basics.** `[DO]` Age 68, sex Female, locality "Kalyan East",
tick Diabetic.

> `[SAY]` Age and sex aren't administrative fields here, they're **routing
> inputs**. The same 37.9 °C fever is a Level 4 in an adult and a **Level 2 in a
> 72-year-old** — so the engine has to meet the age before it meets the fever.
> Age group is derived, never re-asked. Six sex options, because "Unknown" is a
> real answer for an unconscious patient and forcing a guess corrupts the data.

**Step 3 — Chief concern.** `[DO]` Type or dictate: *"pet me dard hai, ulti,
thoda bukhar. Chest pain bilkul nahi hai."*

> `[SAY]` The patient speaks; Whisper transcribes; the model extracts symptoms,
> onset, duration and severity, and then asks **only what's still missing**.

**Step 4 — Risk screening.** `[DO]` Let the questions generate.

> `[SAY]` These are generated **from what this patient just said**. A fixed
> checklist can be short or specific, not both. Every question states which
> condition it rules in or out. If the network is down, a static per-symptom
> fallback runs instead.

**Step 5 — History.** `[DO]` Tap two chips.

> `[SAY]` This was five free-text boxes nobody filled. That mattered more than
> it looked: **"Diabetes" here is what arms the atypical-presentation rule.** An
> empty history box was silently disabling one of the most important safety
> rules in the product.

**Step 6 — Vitals.** `[DO]` Mark one vital "not available" deliberately.

> `[SAY]` Photo first, because it's the fastest input on the page and it was the
> one most often skipped when it sat under eight numeric boxes. The model
> shortlists the four vitals that matter for *this* presentation — the rest stay
> visible, just de-emphasised.
>
> And every vital can be marked **not available** rather than guessed. Missing
> data is a first-class state the engine reasons about. **A fabricated normal
> value is not.**

---

### Beat 4 · The recommendation — where the real work shows (4:30 → 6:30)

`[DO]` Land on the recommendation screen. Point at the level and reasons.

**(a) Negation, in two word orders**

> `[SAY]` She said *"chest pain bilkul nahi hai"* — no chest pain at all. Notice
> the engine does not report chest pain. That's a bug we fixed twice. First for
> English "no chest pain". Then again for **Hindi, which is verb-final** — the
> negator comes *after* the symptom, so a backward-only check can't see it.
>
> And it wasn't cosmetic: matching the denied symptom fired the cardiac rule,
> which **suppressed the atypical-presentation rule written for exactly this
> patient**. The false positive was hiding the true one.

**(b) Atypical ACS — the rule that earns its place**

> `[SAY]` Instead, here: *atypical presentation protocol*. **Around a third of
> heart attacks present without chest pain**, concentrated in older adults,
> people with diabetes, and women. This is a 68-year-old diabetic woman with
> breathlessness. The engine says out loud: **absence of chest pain does not
> lower suspicion.**
>
> It's deterministic, not AI — because a safety net that vanishes when the
> network drops is not a safety net. And it's guarded in both directions: my
> first version swept 6 of 20 patients into cardiac review, including a fever
> case and a stroke case. If everyone's a cardiac case, nobody is.

**(c) Confidence you can audit**

`[DO]` Tap "How was this confidence calculated?"

> `[SAY]` Confidence used to be a hardcoded 0.88 minus penalties I made up.
> A number that looks precise and means nothing is **worse than no number**.
>
> Now it answers one checkable question: how much of the information that drives
> this decision do we actually have? Weighted completeness — vitals 35%,
> presentation 20%, timing, risk screening, history — then discounted for what
> we hold but can't fully trust: third-party account, communication barrier,
> contradictory story, no prior record.
>
> Every term is on screen. It is **not** a probability that the routing is
> correct, and we don't present it as one.

**(d) Queue-aware wait**

> `[SAY]` And the wait is a real number, not a level lookup. Patients ahead
> divided by available clinicians, times mean consultation time. Next in line
> shows **10 minutes**; the same patient with twelve ahead shows **154**.

---

### Beat 5 · What one encounter can never see (6:30 → 7:15)

`[DO]` Open the seeded encounter carrying the cluster signal.

> `[SAY]` Two things are invisible from inside a single patient record, no
> matter how good your rules are. Queue position is one. **Geography is the
> other.**
>
> One febrile patient is routine. **Four from the same locality in one shift is
> a signal no per-patient rule can see.** So the engine looks across the live
> queue — and here it is: five patients from Kalyan East with a similar
> infectious picture this shift.
>
> Critically: **this does not change her acuity.** She is not sicker because her
> neighbours are ill. What changes is that she shouldn't sit in the open waiting
> area, and infection control needs to know today rather than next week. That
> separation is asserted in the test suite, because it's exactly the kind of
> thing that quietly drifts.

---

### Beat 6 · Governance and the stress test (7:15 → 8:00)

`[DO]` Override on the recommendation screen → then More → 3× Surge.

> `[SAY]` The nurse is the decision-maker. Override with a reason, escalate,
> reassess — all logged against her ID with a timestamp. Full audit trail, per
> patient journey timeline, jurisdiction stated: India, DPDP Act.
>
> And under a mass-casualty surge — 20 patients to 60, beds and staff
> constrained — the routing holds and the wait estimates move with the
> constraint.
>
> One deliberate absence: **no facial recognition.** You cannot obtain biometric
> consent from an unconscious patient. The photo we already capture solves the
> actual problem.

---

## 3. Closing — 30 seconds

> `[SAY]` Three things I'd want you to take away.
>
> **One — the rules are the authority, the AI is additive.** Pull the network
> and it still triages. That's an architectural commitment, not a fallback.
>
> **Two — every number is inspectable.** The level, the confidence, the wait,
> the reasoning. A triage tool a nurse can't interrogate is a tool she will
> correctly refuse to trust.
>
> **Three — it's tested where it matters.** Twenty-four assertions across
> fourteen scenarios, and most of them exist because they caught something.
> The escalation cap clobbering genuine Level 1s, the atypical rule
> over-triaging, the Hindi negation — every one found by a check or by driving
> the app, not by reading the code and feeling confident.

---

## 4. Questions you will get — and the honest answers

**"How do you know the triage is correct?"**
> We don't claim clinical validation. Levels and safe-wait targets follow CTAS
> and ESI, thresholds are age-differentiated, and behaviour is pinned by 24
> regression assertions. That makes it *consistent and auditable*. Clinical
> accuracy needs a prospective study against nurse triage — that's the next
> step, not a claim we're making today.

**"What if the AI hallucinates?"**
> It can't change the level or the pathway. Structurally — the rule engine
> returns before the AI is called, and the AI's output renders as advisory
> commentary in a separate card. Worst case it prints something unhelpful next
> to a correct routing decision.

**"Isn't this replacing the nurse?"**
> The opposite. It never routes anyone by itself — the nurse accepts, overrides
> or escalates, and every one of those is logged. What it removes is the memory
> load: remembering that this patient is geriatric so the fever threshold moved,
> that four others came from the same area today, that eleven people are ahead
> in the queue.

**"Why not fine-tune a model on triage data?"**
> No model is trained or fine-tuned on patient data anywhere in this project.
> Similar-case retrieval is lexical search over a **synthetic** local corpus,
> labelled as illustrative precedent, never as evidence.

**"What's not production-ready?"** *(volunteer this — it buys more credibility
than it costs)*
> The API key ships in the bundle: prototype only, real deployment needs a
> backend proxy. Locality matching is exact-string, so spelling variants miss.
> The multilingual vocabulary is ~23 hand-built term families, not the long
> tail. And the five-minute budget is measured, not timed with a real nurse on
> real hardware. All eleven known limitations are written down in `FEATURES.md`.

**"Why does the demo data show lower confidence than you described?"**
> The seeded records carry no risk-screening answers and little history, so they
> cap around 0.75. A live intake through the wizard scores up to 0.95 — which
> you saw a moment ago.

---

## 5. The 90-second cut

For when the slot shrinks. Gate 0 → recommendation → cluster. Nothing else.

> In a district ED, one nurse routes every arrival in about two and a half
> minutes, with no labs and often no prior record.
>
> `[DO]` *Gate 0, one tap.* If the patient is visibly dying, the questionnaire
> is the wrong thing to do first — one tap sends them to resus at Level 1 and
> logs the reason. Everyone else gets a six-step intake against a five-minute
> budget.
>
> `[DO]` *Recommendation screen.* Level, pathway, destination, wait — and the
> reasoning. This patient denied chest pain in Hindi; the engine correctly does
> not record chest pain, and then flags **atypical presentation**: she's 68 and
> diabetic, and a third of heart attacks in that group present without chest
> pain. That rule is deterministic, so it survives the network dropping.
>
> `[DO]` *Tap confidence.* Every number is inspectable — confidence is derived
> from what we actually know, and shows its working.
>
> `[DO]` *Cluster card.* And it sees across patients: five from one locality
> with a similar infectious picture this shift. That doesn't change her acuity —
> it changes where she waits, and who gets told.
>
> Rules decide. AI assists and can never override. Nurse has the final call, and
> every call is audited.

---

## 6. Delivery notes

- **Don't narrate the UI.** "Now I click next" is dead air. Say why the screen
  is ordered that way instead.
- **Lead with a defect on at least one feature.** "This was broken and here's
  how we found it" is more convincing than any feature list, and it's the part
  judges remember.
- **Never say "accurate" or "AI-powered diagnosis."** Say *consistent*,
  *auditable*, *decision support*.
- **If a live AI call hangs**, keep talking — the rule result is already on
  screen. That's the point: *"and notice the routing was there before the AI
  was."* The failure mode is part of the pitch.
- **Reset demo data before every run.** Surge is not idempotent.
