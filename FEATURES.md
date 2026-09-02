# PatientTriage.ai — Feature Inventory

**What is actually in the app right now.** Not a roadmap, not a pitch.

> **Last verified:** commit `d7ec851` · Expo SDK 54 · verified by running the checks in [§10](#10-how-to-re-verify-this-document), not from memory.
>
> **Rule for maintaining this file:** every ✅ must be something observed working — in the running app, in a live API call, or in a passing check. Anything built but unproven is ⚠️. Anything absent is ❌. If you cannot verify it, it is not ✅.

---

## 1. At a glance

| | Count |
|---|---|
| Screens | 11 |
| Shared components | 11 |
| Store actions | 15 |
| Routing rules | 15 |
| Care pathways | 10 |
| AI capabilities | 8 (7 wired) |
| Seeded patients | 20 profiles / 20 encounters / 2 drafts |
| Intake wizard steps | 8 |

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

**15 ordered rules.** Pathway selection uses *most-urgent-proposal-wins*, not last-match-wins.

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

- **Asymmetric undertriage safeguard** — escalates when ≥2 vitals are missing alongside risk signals
- **Escalation cap** — stacked modifiers raise acuity by at most one level total, never compounding
- **Automatic queue monitoring** — background tick advances waiting clocks and raises a Critical alert + audit entry on threshold breach, with no nurse action. *Verified firing unprompted.*

Regression suite: `src/lib/routing.check.ts` — 7 assertions, run with
`node --experimental-strip-types src/lib/routing.check.ts`

---

## 4. Intake wizard — 8 steps

| # | Step | Contents |
|---|---|---|
| 1 | Arrival | Walk-in · Ambulance · Referral · Pre-arrival call |
| 2 | Patient basics | Photo, name, age, sex, prior record, categories, medico-legal |
| 3 | Information source | Speaker, language, communication limitations |
| 4 | **Chief concern** | **Voice capture + AI conversation** (see §5), symptoms, extraction |
| 5 | Onset & trend | Onset, duration, severity 1–10, trend |
| 6 | **Risk screening** | **AI-generated per presentation**, static fallback offline |
| 7 | Medical history | Conditions, meds, allergies, prior episode, recent visit |
| 8 | **Vitals & observations** | **AI-prioritised shortlist**, 8 vitals, observations, injury photo |

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

**Seeded dataset:** 20 patients across all five acuity levels — pediatric, geriatric, pregnancy, trauma, ambiguous, zero-history, and genuine Fast Track cases, in English / Hindi / Hinglish / Marathi.

---

## 8. Known limitations — read before demoing

| # | Limitation | Impact |
|---|---|---|
| 1 | **Routing engine is English-only.** `hasAny()` does English substring matching, so a Hinglish narrative alone yields `symptoms: []`. Verified: a Hinglish abdominal-pain case with a **yes** to abdominal rigidity routed to **Level 4**. | 🔴 **Potential under-triage.** Mitigated only if the nurse taps *Extract details with AI*, which is manual and skippable. |
| 2 | **Confidence score is arithmetically invented** — `0.88` minus hand-picked penalties, no derivation. | 🟠 A fabricated number in a judged submission |
| 3 | **Estimated wait ignores queue position** — "next in line" and "tenth in line" at the same level show the same figure. | 🟠 Contradicts what a nurse sees |
| 4 | **No Gate 0 bypass** — a nurse cannot fast-track a visibly catastrophic case without the full wizard. | 🔴 Designed in `docs/TRIAGE_CLASSIFICATION.md`, zero code |
| 5 | **M2 atypical presentation not in the rules** — only the AI catches it; the deterministic engine cannot. | 🟠 Lost entirely if AI is unavailable |
| 6 | **No geography / outbreak signal** | 🟠 Identified as important, not built |
| 7 | **Intake exceeds the 5-minute triage budget** — research median is ~2.6 min, 98% under 5; this is 8 steps. | 🟠 Deployability |
| 8 | Voice is device-only | 🟡 Web shows a sample fallback |
| 9 | PDF export unverified on device | 🟡 Different native path than web |
| 10 | API key ships in the bundle (`EXPO_PUBLIC_*`) | 🔴 **Prototype only.** Real deployment needs a backend proxy |
| 11 | Similar-case matching is lexical, not semantic | 🟡 Misses paraphrases |

**Not built by deliberate decision:** facial recognition — excluded by `AGENTS.md` §35, and DPDP biometric consent is not obtainable from unconscious patients. Patient recognition is served by the photo already captured.

---

## 9. Stack

`expo@~54.0.37` · `react-native@0.81.5` · `react@19.1.0` · `nativewind@^4.2.6` · `expo-audio` · `expo-image-picker` · `expo-print` · `expo-sharing` · `@react-native-async-storage/async-storage`

State: React Context + `useReducer`, persisted to AsyncStorage. **No backend** — the app is fully local apart from LLM calls.

---

## 10. How to re-verify this document

Run these from `expo-app/`. If output disagrees with the tables above, **the tables are wrong** — fix them.

```bash
# Type safety across the whole app
npx tsc --noEmit

# Routing regression suite (7 assertions)
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

# Seeded data counts
node -e "const s=require('fs').readFileSync('src/lib/demoData.ts','utf8');
console.log('encounters:',(s.match(/^    encounter\(\{/gm)||[]).length)"
```

**Update this file in the same commit as any feature change.** A stale inventory is worse than none — it is what let three AI functions sit unwired while being described as delivered.
