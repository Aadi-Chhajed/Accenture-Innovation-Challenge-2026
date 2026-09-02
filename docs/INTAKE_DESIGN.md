# Intake design — why these questions, in this order

Companion to [`TRIAGE_CLASSIFICATION.md`](TRIAGE_CLASSIFICATION.md), which covers *how a
patient is classified once the information exists*. This document covers *how the
information is obtained*, and answers two questions that were previously unanswered:
why the steps are ordered the way they are, and how the whole thing fits inside a
realistic triage encounter.

---

## 1. The time budget

Published ED observational work puts the median nurse triage encounter at roughly
**2.5–3 minutes**, with the large majority completed inside five. That is not a target
we set; it is the window a triage nurse actually has when there are nine other people
in the waiting room.

**This is the single hardest constraint in the product.** Everything below is
downstream of it. An intake form that takes eight minutes does not get filled in
carefully — it gets skipped, back-filled from memory, or quietly abandoned, and a
safety net nobody uses protects nobody.

### What changed

The wizard was **eight screens**. It is now **six**, with nothing dropped:

| Was | Now | Why |
|---|---|---|
| 1. Arrival | **1. Arrival & source** | Both are one-tap context, asked before the patient has said anything clinical. Two screens for six taps was two screens too many. |
| 3. Information source | ↑ merged | |
| 2. Patient basics | **2. Patient basics** | Unchanged position. |
| 4. Chief concern | **3. Chief concern** | Onset and trend are *part of* the story the patient is already telling. Splitting them meant asking "when did it start?" on a separate screen from "what is happening?", which is not how anyone describes an illness. |
| 5. Onset & trend | ↑ merged | |
| 6. Risk screening | **4. Risk screening** | |
| 7. Medical history | **5. Medical history** | Rebuilt from five text boxes to tappable categories — see §4. |
| 8. Vitals & observations | **6. Vitals & observations** | |

A live elapsed timer against the 5:00 budget sits in the progress header. It is
**shown, not enforced**: a form that locks a nurse out mid-sentence would be worse
than the problem it measures.

### The real escape hatch

The honest answer to "what if five minutes is still too long" is that for the patients
where it matters most, **the intake should not happen first at all**. That is what
Gate 0 is for (§2). The budget applies to the patients who can wait to be asked.

---

## 2. Gate 0 — the question that comes before the questions

The first control on the first screen is not a question. It is a red panel: **"Patient
is critical right now — skip triage."**

**Rationale.** Some patients are visibly dying on arrival. A triage tool that requires
a questionnaire before it will route them has inverted its own purpose. The nurse's
direct observation of a collapsed, apnoeic, or exsanguinating patient is a *stronger*
signal than anything the form could collect, and it is available immediately.

**Behaviour.** One tap on the observed reason (unresponsive · not breathing · severe
bleeding · active seizure · obvious major trauma · visibly critical) routes the patient
at **Level 1, zero wait, straight to resuscitation**, and exits the wizard. The rule
engine short-circuits before any other rule runs — no missing field can delay it and
no later rule can dilute it.

**What it costs.** The record is incomplete by construction. That is stated explicitly
in `missingInfo` ("full intake pending — complete retrospectively once the patient is
stabilised"), a Critical alert is raised for the receiving team, and the bypass is
written to the audit trail with the nurse's stated reason. Documentation follows
resuscitation; it does not precede it.

---

## 3. Why the steps are in this order

The ordering principle: **each step must be answerable using only what is known by the
time it is reached**, and steps that change routing must come before steps that merely
enrich the record.

### Step 1 — Arrival & source *(before anything clinical)*

Arrival mode and who is speaking are known **before the patient says a word**. Both
also change how everything after them is interpreted:

- An ambulance arrival carries a handover; a walk-in does not.
- A **third-party account discounts confidence** on every subsequent answer (§5), so
  the system has to know it is a third-party account *before* those answers are given,
  not after.
- Language selection routes the voice capture to the right transcription hint, and
  the chief-concern step is the one that uses it.

Asking this after the clinical narrative would mean re-interpreting answers already
recorded.

### Step 2 — Patient basics *(before the complaint, not after)*

This is the step whose order was most often questioned, so it is worth being explicit.
**Age and sex are not administrative fields here — they are routing inputs**, and
several rules cannot be evaluated without them:

| Field | What depends on it |
|---|---|
| Age | Pediatric thresholds (pulse > 140, temp ≥ 38.8), geriatric thresholds (temp ≥ 37.8, pulse ≥ 110, SpO₂ < 92). Same fever, different level. |
| Sex | Atypical-ACS risk grouping for women ≥ 45. |
| Locality | Geographic cluster detection (§6). |
| Clinical modifiers | Pregnancy, immunocompromise, diabetes — each changes how the complaint is read. |

Because the *interpretation* of the chief complaint depends on these, they must be
recorded before it. A 37.9 °C fever is a Level 4 in an adult and a Level 2 in a
72-year-old; the engine cannot tell those apart if it meets the fever first.

**Age groups are derived, not asked.** Infant / Child / Adult / Geriatric come from the
age field automatically. Asking a nurse to re-state what they just typed invited the
two to disagree, and the engine reads the category.

### Step 3 — Chief concern, onset, trend

The clinical core, and the only step designed around **speech rather than tapping**.
A microphone sits at the top: the patient or family talks in any language, Whisper
transcribes, and the model extracts symptoms, onset, duration and severity, then asks
**only what is still missing**. Onset and trend live here because they are part of the
same sentence a patient is already saying.

### Step 4 — Risk screening *(after the complaint, necessarily)*

These questions are **generated from what the patient just described**. A fixed
checklist cannot be both specific and short; a generated set can be. The set is
required to be MECE — each question probes a distinct risk dimension, together they
cover the plausible time-critical causes — and every question states which condition
it rules in or out. A static per-symptom fallback runs when the AI is unreachable.

This step is *structurally* unable to come earlier.

### Step 5 — Medical history

Placed late deliberately: it is the step most likely to be cut short under pressure,
and it is the one whose loss does least damage — with one exception, which is why it
was rebuilt (§4).

### Step 6 — Vitals & observations *(last, because measuring takes longest)*

Vitals require equipment and physical contact; everything before this is conversation.
Putting them last means the nurse can talk while walking the patient to the monitor.

The model **prioritises at most four vitals** for this specific presentation rather
than presenting eight identical boxes. The full set stays on screen — nothing is
hidden, only de-emphasised.

**Every vital can be marked "not available"** instead of guessed. Missing data is a
first-class state that the engine reasons about; a fabricated normal value is not.

**The photo is now the first control on this screen, not the last.** It is the fastest
input on the page and was the one most often skipped when it sat below eight numeric
fields.

---

## 4. Medical history: why it was rebuilt

It was five free-text boxes. Nobody filled them, and free text under time pressure
produces "htn, dm2, ?asthma" — unparseable by the rules that need it.

That mattered more than it appeared to, because **"Diabetes" in this step is what arms
the atypical-presentation rule** in the routing engine. An unfilled history box was
silently disabling one of the most important safety rules in the product.

It is now six tappable groups (heart & circulation · diabetes & hormones · lungs ·
brain & nerves · kidney & liver · other) with concrete subcategories. Selections are
written into the same `history.conditions` field the engine and every AI prompt
already read, so nothing downstream needed changing. The free-text box remains for
anything the list does not cover, and "previous episode" / "recent visit" — which were
always yes/no questions — are now yes/no chips.

---

## 5. Confidence: what the number means

Confidence used to start at a hardcoded `0.88` and subtract hand-picked penalties.
Neither the base nor the penalties came from anywhere. A number that looks precise and
means nothing is worse than showing no number at all.

It now answers one specific, checkable question: **how much of the information that
drives the routing decision do we actually have?**

| Input group | Weight | Why that weight |
|---|---|---|
| Vitals | 0.35 | Six rules read them |
| Presentation (symptoms + narrative) | 0.20 | Every pathway rule reads it |
| Timing (onset, duration, trend) | 0.15 | Drives the escalation modifiers |
| Risk screening | 0.15 | Directly targets time-critical causes |
| History | 0.15 | One rule reads it — but it is the atypical-ACS rule |

Completeness is the weighted fraction present. Reliability multipliers then discount
information we hold but cannot fully trust: third-party account ×0.95, communication
limitation ×0.92, contradictory account ×0.85, no prior record ×0.95, resource
constraint ×0.92, three or more gaps ×0.90. Result is clamped to 0.20–0.95 — never
zero, because the rules still fired on what we have; never one, because a triage
decision on partial information is never certain.

Placeholders are not answers: "Unknown", "Not clear", "Not asked yet" score as absent.
"None known" and "No" score as present, because a confirmed absence is as useful to the
rules as a confirmed presence.

**It is not a probability that the routing is correct, and is not presented as one.**
Every term is shown to the nurse under "How was this confidence calculated?".

---

## 6. Geography

One febrile patient is routine. Four from the same locality in one shift is a signal
no per-patient rule can see.

A free-text locality field on step 2 feeds cluster detection across the live queue.
When four patients from one area present with a similar infectious picture, the
recommendation carries an outbreak signal, the shift lead gets a Warning alert, and
placement defaults to isolation.

**It deliberately does not change the patient's own acuity.** Their illness is no more
severe because their neighbours are also ill. What changes is that they should not sit
in the open waiting area, and that infection control needs to know. This separation is
asserted in the regression suite.

Free text, not a dropdown, because no fixed list covers every village a district
hospital serves.

---

## 7. What is still open

- **Locality matching is exact-string.** "Kalyan East" and "kalyan (east)" are two
  different places to the detector. Real deployment needs normalisation or a gazetteer.
- **The 5-minute budget is measured, not enforced**, and has not been timed with a
  real nurse on real hardware. The step count is defensible; the claim that it fits is
  not yet evidence.
- **Mean consultation time in the wait estimate is a single constant (12 min)** rather
  than per-pathway. A trauma review and a fast-track dressing check are not the same
  length.
