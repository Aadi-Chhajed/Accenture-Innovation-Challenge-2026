# PatientTriage.ai — Feature Inventory

**What is actually in the app right now.** Not a roadmap, not a pitch.

> **Last verified:** Expo SDK 54 · verified by running the checks in [§10](#10-how-to-re-verify-this-document), not from memory.
>
> **Rule for maintaining this file:** every ✅ must be something observed working — in the running app, in a live API call, or in a passing check. Anything built but unproven is ⚠️. Anything absent is ❌. If you cannot verify it, it is not ✅.

---

## 1. At a glance

| | Count |
|---|---|
| Screens | 11 |
| Shared components | 11 |
| Store actions | 15 |
| Routing rules | 17 |
| Care pathways | 10 |
| AI capabilities | 8 (all wired) |
| Seeded patients | 21 profiles / 21 encounters / 2 drafts |
| Intake wizard steps | 6 |
| Routing regression assertions | 24 |

**Architecture in one line:** a deterministic rule engine decides urgency and pathway; an LLM layer adds extraction, questioning and advisory review on top, and can never override the engine.

---

## 2. Screens

| Screen | Purpose | Status |
|---|---|---|
| `SplashScreen` | Branding, auto-advances | ✅ |
| `NurseLoginScreen` | Roll number + password; identity feeds the audit trail | ✅ |
| `DashboardScreen` | Live queue, stats, hospital status, drafts, search, level filters | ✅ |
| `OnboardingWizard` | 8-step intake (see §4) | ✅ |
| `AIAnalyzingScreen` | Processing checklist between intake and recommendation | ✅ |
| `AIRecommendationScreen` | Level, pathway, wait, confidence, reasons, AI review, accept/override/escalate/reassess | ✅ |
| `PatientTokenScreen` | Token, priority, route, PDF entry point | ✅ |
| `PatientDetailsScreen` | Overview / Timeline / Observations tabs, override, reassess | ✅ |
| `AlertsScreen` | Alert queue with level filters, acknowledge | ✅ |
| `SimulationScreen` | Surge / staff shortage / EHR outage / reset (behind "More") | ✅ |
| `PdfPreviewScreen` | Routing summary; real PDF via `expo-print` | ⚠️ Renders; **export never verified on device** |

Navigation is a state machine in `App.tsx` — no router. Five bottom tabs: Dashboard, New Patient, Drafts, Alerts, More.

---

## 3. Routing engine — `src/lib/routing.ts`

The authority on urgency and pathway. Pure, deterministic, no network, works with AI fully offline.

**17 ordered rules**, preceded by a **Gate 0 short-circuit**. Pathway selection uses *most-urgent-proposal-wins*, not last-match-wins.

**10 pathways:** Resuscitation / Critical Care Bay · Cardiac Review · Stroke / Neuro Review · Trauma · Pediatrics · Obstetrics · Isolation / Infection Concern · Emergency General · Observation · Fast Track / Minor Care

### Safe-wait thresholds — CTAS national standards (not invented)

| Level | Target | Compliance |
|---|---|---|
| 1 | Immediate | 98% |
| 2 | 15 min | 95% |
| 3 | 30 min | 90% |
| 4 | 60 min | 85% |
| 5 | 120 min | 80% |

### Age-differentiated vital thresholds

| Group | Thresholds |
|---|---|
| Pediatric | pulse > 140, temp ≥ 38.8 °C |
| Geriatric | temp ≥ 37.8 °C, pulse ≥ 110, SpO₂ < 92 |
| Adult | Default rules |

Verified: an identical 37.9 °C fever yields **L4 for an adult, L2 for a geriatric patient**.

### Safety behaviours

- **Gate 0 — nurse direct-to-resus bypass.** One tap on the first screen routes a visibly critical patient at Level 1 / zero wait, short-circuiting every rule below. Raises a Critical alert, writes the nurse's stated reason to the audit trail, and records the intake as pending. *Verified: stable vitals and a "minor sprain" complaint cannot dilute it.*
- **Multilingual matching.** The engine — not only the AI — reads Hindi, Marathi and Hinglish. ~23 term families with transliterated and Devanagari forms. *Verified: a Hinglish fever/abdominal case in a 66-year-old now reaches L2 instead of L4.*
- **Negation-aware matching, in both word orders.** "No chest pain" no longer matches the cardiac rule — and neither does Hindi's verb-final `"chest pain bilkul nahi hai"`, which needs a *forward* look because the negator follows the term. Both were causing the same failure: a denied symptom fired the cardiac rule, which then suppressed the atypical-presentation rule written for exactly that patient. *Verified live: the same narrative now reaches the atypical rule instead.*
- **Atypical ACS detection (M2), deterministic.** Older adults, people with diabetes, and women ≥45 with breathlessness / epigastric pain / sweating / syncope, **or two weaker signs**, reach Cardiac Review with no chest pain reported. Suppressed when a febrile or stroke-like picture has its own pathway. *Verified in both directions: it catches the 68-year-old diabetic, and it does not funnel vague geriatric malaise into cardiac.*
- **Asymmetric undertriage safeguard** — escalates when ≥2 vitals are missing alongside risk signals
- **Escalation cap** — stacked modifiers raise acuity by at most one level total, never compounding, and **never past Level 2**. Level 1 comes from a critical finding or Gate 0 only. *This removed 6 spurious Level 1s from the 20-patient seed.*
- **Automatic queue monitoring** — background tick advances waiting clocks and raises a Critical alert + audit entry on threshold breach, with no nurse action. *Verified firing unprompted.*

### Queue-aware wait estimates

Driven by **actual queue position**, not acuity alone: patients ahead ÷ available clinicians × mean consultation time, plus a per-level turnaround floor. *Verified: a Level 2 next in line shows 10 min; the same patient with 12 ahead shows 154 min.* Position is shown next to the estimate ("Next to be seen" / "3 ahead in queue").

### Geographic cluster detection

Four patients from one locality with a similar infectious picture in a shift raises an outbreak signal, a Warning alert to the shift lead, and isolation placement — **without changing the individual's acuity**, which is asserted in the regression suite. *Verified firing on the seeded dataset.*

Regression suite: `src/lib/routing.check.ts` — 24 assertions across 14 scenarios, run with
`node --experimental-strip-types src/lib/routing.check.ts`

---

## 4. Intake wizard — 6 steps

Reduced from 8. Rationale, ordering justification and the time budget are in
[`docs/INTAKE_DESIGN.md`](docs/INTAKE_DESIGN.md).

| # | Step | Contents |
|---|---|---|
| — | **Gate 0** | Red panel at the top of step 1: six observed-reason taps → Level 1, zero wait, wizard exits |
| 1 | Arrival & source | Walk-in · Ambulance · Referral · Pre-arrival call · **Other (specify)**; speaker, language, communication limitations |
| 2 | Patient basics | Photo, name, age, **6 sex options**, **locality**, prior record, **11 clinical modifiers** (age group derived automatically), medico-legal |
| 3 | **Chief concern** | **Voice capture + AI conversation** (see §5), symptoms, extraction, onset, duration, severity, trend |
| 4 | **Risk screening** | **AI-generated per presentation**, static fallback offline |
| 5 | Medical history | **6 tappable category groups → 24 subcategories**, meds, allergies, yes/no prior episode & recent visit |
| 6 | **Vitals & observations** | **Photo first**, **AI-prioritised shortlist**, 8 vitals, observations |

**Live elapsed timer** against the 5-minute research-backed budget sits in the progress header — shown, never enforced.

**Every vital can be marked "not available"** rather than guessed — missing data is a first-class state.

**Drafts:** exiting mid-intake auto-saves; Resume returns to the exact step with data intact. *Verified.*

**Symptom taxonomy:** 20 labels, defined once in `prompts.ts` and re-exported by `pathways.ts` so the nurse's chips and the model's vocabulary cannot drift apart.

---

## 5. AI layer

**Providers:** Groq (default, `openai/gpt-oss-120b`) · Google Gemini · Anthropic — auto-selected by whichever key is present. **All prompts live in `src/lib/prompts.ts`** and nowhere else.

### Contract (enforced in code)

1. **Additive only** — cannot change level or pathway
2. **Fails soft** — no key / no network / bad JSON / timeout → `null`, app continues on rules
3. **Never blocking** — rule result renders first, AI enriches after

| Capability | Function | Where | Status |
|---|---|---|---|
| Speech-to-text | `transcribeAudio()` | Step 4 | ⚠️ Real Whisper; **device-only, unverified on hardware** |
| Narrative extraction | `extractFromNarrative()` | Step 4 | ✅ |
| Dynamic questions | `generateNextQuestions()` | Step 4 | ✅ |
| Risk screening | `generateRiskScreening()` | Step 6 | ✅ |
| Vitals prioritisation | `planVitals()` | Step 8 | ✅ |
| Second opinion | `reviewRecommendation()` | Recommendation | ✅ |
| Prior-record comparison | `analyzePriorRecord()` | Recommendation | ✅ |
| Holistic review | `analyzeHolistic()` | Recommendation | ✅ |
| Reassessment analysis | `analyzeReassessment()` | Reassess modal | ✅ |
| Similar-case retrieval | `findSimilarEncounters()` | Recommendation | ✅ |

### Verified AI behaviours

- **Hinglish understood** — *"pet me dard / ulti / bukhar"* correctly parsed; questions returned on peritonitis, upper GI bleed and shock
- **Multi-symptom extraction** — a narrative with chest pain + headache + nausea yields **3 symptoms, not 1**
- **Atypical presentation caught** — 68y diabetic woman, fatigue + breathlessness, *no chest pain* → flagged possible silent MI and broadened the differential to PE, aortic dissection, sepsis, hypoglycaemia
- **AI layers may disagree** with each other and with the rules — disagreement is surfaced to the nurse, not silently resolved

### On "training"

**No model is trained or fine-tuned on patient data anywhere in this project.** `findSimilarEncounters()` is *retrieval* over the local corpus (RAG). Similarity is lexical and categorical, **not semantic** — there is no embedding model. The corpus is synthetic, so retrieved cases are illustrative precedent, never clinical evidence, and are labelled as such in the UI.

---

## 6. Clinical safety & governance

| Feature | Status |
|---|---|
| Override with reason, level and pathway change | ✅ Logged with nurse ID + timestamp |
| Escalate to resus | ✅ |
| Reassess with recalculation | ✅ |
| Full audit trail | ✅ Every action attributed |
| Per-encounter journey timeline | ✅ |
| Confidence + uncertainty + missing-info surfaced | ✅ Always shown |
| **Confidence derivation inspectable** | ✅ Weighted completeness × reliability multipliers, every term shown on tap |
| **Gate 0 bypass logged** | ✅ Critical alert + audit entry + journey entry with the nurse's stated reason |
| Jurisdiction stated | ✅ India — DPDP Act + hospital policy |
| Synthetic-data notice | ✅ Visible in-app |

---

## 7. Simulation & demo controls

| Control | Behaviour |
|---|---|
| 3× Surge | Injects a real mixed-severity arrival burst **and** constrains beds/staff. *Verified 20 → 60 patients.* |
| Staff shortage | Marks nurses unavailable, reduces staff pool |
| EHR / device outage | Demonstrates graceful degradation |
| Reset demo data | Two-tap confirm, restores the 20-patient seed |

**Seeded dataset:** 21 patients across all five acuity levels — pediatric, geriatric, pregnancy, trauma, ambiguous, zero-history, and genuine Fast Track cases, in English / Hindi / Hinglish / Marathi.

---

## 8. Known limitations — read before demoing

| # | Limitation | Impact |
|---|---|---|
| 1 | **API key ships in the bundle** (`EXPO_PUBLIC_*`) | 🔴 **Prototype only.** Real deployment needs a backend proxy |
| 2 | **Locality matching is exact-string.** "Kalyan East" and "kalyan (east)" are different places to the cluster detector. | 🟠 Missed clusters from spelling variation |
| 3 | **Mean consultation time in the wait estimate is one constant (12 min)** for every pathway. A trauma review and a dressing check are not the same length. | 🟠 Estimates skew where the mix is unusual |
| 4 | **The multilingual term list is hand-built** (~23 families). It covers the common presentations, not the long tail. | 🟠 An unlisted phrase still falls through to the AI layer alone |
| 5 | **Negation detection is clause-scoped and lexical.** "I wouldn't say there's chest pain" is not handled. Forward-looking negation is restricted to Hindi/Marathi particles, because applying it to English "not" would wrongly negate "chest pain is severe and she is not vomiting". | 🟠 Conservative direction (over-match, not under-match) |
| 6 | **The 5-minute budget is measured, not validated.** Six steps is defensible; nobody has timed it with a real nurse on real hardware. | 🟠 Deployability claim is untested |
| 7 | **Seeded confidence tops out around 0.75** because the synthetic records carry no risk-screening answers and little history. A live intake through the wizard scores up to 0.95. | 🟡 Demo shows lower numbers than the product achieves |
| 8 | Voice is device-only | 🟡 Web shows a sample fallback |
| 9 | PDF export unverified on device | 🟡 Different native path than web |
| 10 | Similar-case matching is lexical, not semantic | 🟡 Misses paraphrases |
| 11 | Acuity distribution is **L2-heavy** (11 of 21) by design — geriatric safety bias — but has not been validated against real ED case-mix | 🟡 Over-triage direction, deliberate but unproven |

### Fixed since the previous revision

Recorded here rather than deleted, because each was a real defect and the fix is worth being able to point at:

- **English-only routing engine** — a Hinglish narrative yielded `symptoms: []` and routed a 66-year-old with reported rigidity to Level 4. Now multilingual, asserted.
- **"No chest pain" matched the cardiac rule**, which then suppressed the atypical-presentation rule on exactly the patients it existed for. Found twice — once for English, then again for Hindi's verb-final word order, which a backward-only check could not see.
- **Gate 0 silently did nothing on web.** `Alert.alert` with multiple buttons is a no-op in React Native Web, so the most safety-critical control in the app was platform-dependent. Replaced with an in-app two-tap confirm.
- **The AI second opinion argued against Gate 0** — "routing to immediate resuscitation is not supported; no evidence patient is unresponsive" — reasoning from the empty form rather than recognising it is empty by design. It now concurs and contributes a forward-looking differential instead.
- **The `-1` unknown-age sentinel rendered as "-1"** on the recommendation screen.
- **Confidence was a hardcoded `0.88`** minus invented penalties. Now derived and inspectable.
- **Wait ignored queue position** — "next in line" and "tenth in line" showed the same figure.
- **No Gate 0 bypass** — a nurse could not fast-track a visibly catastrophic case.
- **M2 atypical presentation lived only in the AI** — the protection vanished with the network.
- **6 of 20 seeded patients were Level 1** purely from stacked soft modifiers, none with a critical finding.
- **The escalation floor then clobbered genuine Level 1s** — an unresponsive patient was pushed back to Level 2 because their trend was also "worsening". Caught by adding the assertion, not by reading the code.
- **The first atypical-ACS rule was an over-triage funnel**, sweeping 6 of 20 seeded patients into Cardiac Review including a febrile case and a stroke case.
- **`locality` was silently dropped** by the demo-data builder, so cluster detection reported zero on seeded data despite being correct.

**Not built by deliberate decision:** facial recognition — excluded by `AGENTS.md` §35, and DPDP biometric consent is not obtainable from unconscious patients. Patient recognition is served by the photo already captured.

## 9. Stack

`expo@~54.0.37` · `react-native@0.81.5` · `react@19.1.0` · `nativewind@^4.2.6` · `expo-audio` · `expo-image-picker` · `expo-print` · `expo-sharing` · `@react-native-async-storage/async-storage`

State: React Context + `useReducer`, persisted to AsyncStorage. **No backend** — the app is fully local apart from LLM calls.

---

## 10. How to re-verify this document

Run these from `expo-app/`. If output disagrees with the tables above, **the tables are wrong** — fix them.

```bash
# Type safety across the whole app
npx tsc --noEmit

# Routing regression suite (24 assertions)
node --experimental-strip-types src/lib/routing.check.ts

# Which AI functions are actually wired into UI (0 = orphaned)
for f in generateNextQuestions planVitals analyzeReassessment generateRiskScreening \
         analyzeHolistic analyzePriorRecord findSimilarEncounters transcribeAudio; do
  echo "$f -> $(grep -rl "$f" src/screens src/components 2>/dev/null | wc -l) file(s)"
done

# Inventory counts
ls src/screens | wc -l          # screens
ls src/components | wc -l       # components
grep -cE "^  // [0-9]+[a-z]?\." src/lib/routing.ts   # routing rules
grep -c "assert\." src/lib/routing.check.ts          # regression assertions

# Seeded data counts
node -e "const s=require('fs').readFileSync('src/lib/demoData.ts','utf8');
console.log('encounters:',(s.match(/^    encounter\(\{/gm)||[]).length)"
```

**Update this file in the same commit as any feature change.** A stale inventory is worse than none — it is what let three AI functions sit unwired while being described as delivered.
