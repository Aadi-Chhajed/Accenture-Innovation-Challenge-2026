// Runnable check for routing precedence + escalation capping.
//   node --experimental-strip-types src/lib/routing.check.ts
// Kept deliberately tiny: no framework, just asserts that fail loudly.
import assert from "node:assert";
import { calculateRecommendation } from "./routing.ts";
import type { Encounter, Patient, Resource, RoutingPolicy } from "./types.ts";

const resources: Resource[] = [
  { id: "R1", name: "ED bed", category: "Beds", total: 30, available: 8, status: "Available", location: "ED" },
  { id: "R2", name: "Trauma bay", category: "Rooms", total: 4, available: 2, status: "Available", location: "Trauma" },
];
const policy: RoutingPolicy = { safetyBias: 78, waitingTimeWeight: 42, congestionWeight: 55, uncertaintyEscalation: 72 };

function make(partial: Partial<Encounter>): Encounter {
  return {
    id: "E-T", patientId: "P-T", arrivalMode: "Walk-in", arrivalStatus: "Waiting",
    speakerSource: "Patient", language: "English", communicationLimitations: [],
    patientCategories: [], primaryConcern: "", symptoms: [], freeText: "",
    onset: "now", duration: "1h", reportedSeverity: 5, trend: "Stable", riskAnswers: {},
    vitals: { consciousness: "Alert", spo2: 98, pulse: 80, bpSystolic: 120, bpDiastolic: 80, temperature: 37 },
    history: { conditions: "None known", medications: "None known", allergies: "None known", previousEpisode: "No", recentVisit: "No" },
    observations: [], medicoLegal: false, status: "Waiting", currentPathway: "", assignedQueue: "",
    waitingMins: 0, recommendation: {} as Encounter["recommendation"],
    journey: [], updatedAt: new Date().toISOString(),
    ...partial,
  } as Encounter;
}

// 1. The reported bug: chest pain + a burn must NOT be routed to Trauma just
//    because the trauma rule is evaluated later. Cardiac (L2 geriatric) wins.
const chestAndBurn = calculateRecommendation(
  make({ patientCategories: ["Geriatric"], symptoms: ["Chest discomfort", "Burn"], primaryConcern: "Chest pain from 2 days" }),
  resources, policy
);
assert.strictEqual(chestAndBurn.pathway, "Cardiac Review",
  `chest+burn should route to Cardiac Review, got ${chestAndBurn.pathway}`);

// 2. A pure trauma case still routes to Trauma.
const traumaOnly = calculateRecommendation(
  make({ symptoms: ["Injury / trauma"], primaryConcern: "Fell off bike" }), resources, policy
);
assert.strictEqual(traumaOnly.pathway, "Trauma", `trauma-only should be Trauma, got ${traumaOnly.pathway}`);

// 3. Unresponsive always wins outright, even alongside a trauma signal.
const critical = calculateRecommendation(
  make({ symptoms: ["Injury / trauma"], vitals: { consciousness: "Unresponsive" } }), resources, policy
);
assert.strictEqual(critical.pathway, "Resuscitation / Critical Care Bay",
  `unresponsive should be Resuscitation, got ${critical.pathway}`);
assert.strictEqual(critical.level, 1, `unresponsive should be level 1, got ${critical.level}`);

// 4. Escalation modifiers cap at one level in total, not one each.
//    Worsening + severity>=8 + missing vitals would previously stack to L1.
const stacked = calculateRecommendation(
  make({
    symptoms: ["Abdominal pain"], trend: "Worsening", reportedSeverity: 9, waitingMins: 40,
    vitals: { consciousness: "Not recorded" },
    history: { conditions: "Unknown", medications: "Unknown", allergies: "Not asked yet", previousEpisode: "Unknown", recentVisit: "Unknown" },
  }),
  resources, policy
);
assert.ok(stacked.level >= 3, `stacked modifiers should cap at -1 level (expected >=3), got ${stacked.level}`);

// 5. A genuinely minor case reaches Fast Track (the low-acuity tail).
const minor = calculateRecommendation(
  make({ symptoms: [], primaryConcern: "minor sprain", freeText: "twisted ankle, wants a stitch removal check" }),
  resources, policy
);
assert.strictEqual(minor.pathway, "Fast Track / Minor Care", `minor case should be Fast Track, got ${minor.pathway}`);

// 6. Geriatric-specific vital thresholds: a 37.9°C fever with no other symptoms
//    should NOT read as urgent for an adult, but must for a geriatric patient
//    (blunted febrile response can mask serious illness). Same vitals, two ages.
const adultMildFever = calculateRecommendation(
  make({ patientCategories: [], primaryConcern: "feels a bit warm", vitals: { consciousness: "Alert", temperature: 37.9 } }),
  resources, policy
);
const geriatricMildFever = calculateRecommendation(
  make({ patientCategories: ["Geriatric"], primaryConcern: "feels a bit warm", vitals: { consciousness: "Alert", temperature: 37.9 } }),
  resources, policy
);
assert.ok(adultMildFever.level >= 3, `adult 37.9°C should stay non-urgent (>=3), got ${adultMildFever.level}`);
assert.ok(geriatricMildFever.level <= 2, `geriatric 37.9°C must escalate (<=2), got ${geriatricMildFever.level}`);

// 7. HINGLISH ROUTING. The engine — not just the AI layer — must understand the
//    languages patients actually use. This exact case previously produced
//    symptoms: [] and routed a 66-year-old with reported abdominal rigidity to
//    Level 4, because hasAny() only matched English substrings.
const hinglish = calculateRecommendation(
  make({
    patientCategories: ["Geriatric"],
    primaryConcern: "pet me dard aur bukhar",
    freeText: "kal raat se pet me dard ho raha hai, ulti bhi hui, bukhar bhi hai aur bahut kamzori lag rahi hai",
    symptoms: [],
    vitals: { consciousness: "Alert", temperature: 38.2, pulse: 104 },
  }),
  resources, policy
);
assert.strictEqual(hinglish.level, 2,
  `Hinglish fever/abdominal case in a 66y must reach L2 (not L4, not L1), got ${hinglish.level}`);

// 7b. Soft modifiers must never reach Level 1 on their own. Level 1 means
//     resuscitation; it comes from a critical finding or Gate 0, not from
//     accumulating "worsening" + "severity 9" + missing vitals.
assert.ok(
  calculateRecommendation(
    make({
      patientCategories: ["Geriatric"], symptoms: ["Chest discomfort"], trend: "Worsening",
      reportedSeverity: 10, waitingMins: 90, vitals: { consciousness: "Not recorded" },
    }),
    resources, policy,
  ).level >= 2,
  "soft escalation modifiers must not reach Level 1",
);

// 7c. Hindi/Marathi negation follows the term it negates ("chest pain bilkul
//     NAHI hai"), so a backward-only check read a denied symptom as a reported
//     one — and firing the cardiac rule then suppressed the atypical rule
//     written for exactly this patient.
const hinglishDenial = calculateRecommendation(
  make({
    patientCategories: ["Geriatric"],
    primaryConcern: "kamzori aur ulti",
    freeText: "subah se bahut kamzori lag rahi hai aur ulti jaisa lag raha hai, chest pain bilkul nahi hai",
    history: { conditions: "Diabetes, Hypertension", medications: "Metformin", allergies: "None known", previousEpisode: "No", recentVisit: "No" },
  }),
  resources, policy
);
assert.ok(
  !hinglishDenial.reasons.some((r) => r.includes("reported chest discomfort")),
  `"chest pain bilkul nahi hai" must not read as reported chest pain: ${JSON.stringify(hinglishDenial.reasons)}`,
);
assert.ok(
  hinglishDenial.reasons.some((r) => r.includes("atypical presentation protocol")),
  "denying chest pain in a diabetic geriatric must REACH the atypical rule, not suppress it",
);

// 8. GATE 0. The nurse bypass short-circuits every rule below it. Nothing —
//    not a stable set of vitals, not a minor-sounding complaint — may dilute it.
const gate0 = calculateRecommendation(
  make({
    primaryConcern: "minor sprain",
    vitals: { consciousness: "Alert", spo2: 99, pulse: 72, bpSystolic: 120 },
    nurseCriticalOverride: { reason: "Not breathing, gasping, or choking", nurseId: "NUR-1042", at: new Date().toISOString() },
  }),
  resources, policy
);
assert.strictEqual(gate0.level, 1, `Gate 0 must be Level 1, got ${gate0.level}`);
assert.strictEqual(gate0.estimatedWait, 0, `Gate 0 must have zero wait, got ${gate0.estimatedWait}`);
assert.strictEqual(gate0.pathway, "Resuscitation / Critical Care Bay",
  `Gate 0 must route to resus, got ${gate0.pathway}`);

// 9. ATYPICAL ACS (modifier M2) — deterministic, no AI involved. A 68-year-old
//    diabetic woman with fatigue and breathlessness and NO chest pain must
//    reach Cardiac Review. This is the case the rules used to miss entirely.
const femalePatient: Patient = {
  id: "P-T", name: "T", age: 68, ageGroup: "Geriatric", sex: "Female", previousRecord: "Available",
};
const atypical = calculateRecommendation(
  make({
    patientCategories: [],
    primaryConcern: "feeling very tired and a bit short of breath since morning",
    freeText: "no chest pain at all, just unusually tired and slightly nauseous",
    history: { conditions: "Type 2 diabetes", medications: "Metformin", allergies: "None known", previousEpisode: "No", recentVisit: "No" },
  }),
  resources, policy, { patient: femalePatient }
);
assert.strictEqual(atypical.pathway, "Cardiac Review",
  `atypical diabetic presentation should reach Cardiac Review, got ${atypical.pathway}`);
assert.ok(atypical.level <= 2, `atypical ACS must be <=L2, got ${atypical.level}`);

// 9b. The atypical rule must not become an over-triage funnel. A single vague
//     symptom in an older patient is not a cardiac presentation, and a febrile
//     or stroke-like picture has its own pathway. This caught a first draft that
//     swept six of twenty seeded patients into Cardiac Review.
for (const [label, e] of [
  ["single vague symptom", make({ patientCategories: ["Geriatric"], primaryConcern: "brief dizziness, now resolved" })],
  ["febrile picture", make({ patientCategories: ["Geriatric"], primaryConcern: "feeling unwell with mild fever" })],
  ["stroke-like", make({ patientCategories: ["Geriatric"], primaryConcern: "sudden slurred speech and weakness" })],
] as const) {
  const r = calculateRecommendation(e, resources, policy);
  assert.notStrictEqual(r.pathway, "Cardiac Review",
    `${label} must not be funnelled into Cardiac Review, got ${r.pathway}`);
}

// 9c. The Level-2 escalation floor must not push an existing Level 1 back up.
//     A critical finding PLUS soft modifiers is still Level 1.
const criticalPlusModifiers = calculateRecommendation(
  make({
    vitals: { consciousness: "Unresponsive", spo2: 84, pulse: 132, bpSystolic: 82 },
    trend: "Worsening", reportedSeverity: 10, waitingMins: 0,
  }),
  resources, policy
);
assert.strictEqual(criticalPlusModifiers.level, 1,
  `unresponsive + worsening + severity 10 must stay Level 1, got ${criticalPlusModifiers.level}`);

// 10. QUEUE-AWARE WAIT. Same acuity, different queue depth, different estimate.
const queued = (ahead: number) => {
  const others: Encounter[] = Array.from({ length: ahead }, (_, i) =>
    make({ id: `E-Q${i}`, status: "Waiting", waitingMins: 60, recommendation: { level: 2 } as Encounter["recommendation"] }));
  return calculateRecommendation(
    make({ id: "E-ME", symptoms: ["Chest discomfort"], status: "Waiting" }),
    resources, policy, { encounters: others }
  );
};
const nextInLine = queued(0);
const tenthInLine = queued(12);
assert.ok(nextInLine.estimatedWait < tenthInLine.estimatedWait,
  `next in line must wait less than tenth in line (${nextInLine.estimatedWait} vs ${tenthInLine.estimatedWait})`);
assert.ok(nextInLine.estimatedWait <= 15,
  `an urgent patient who is next should be seen within the CTAS L2 target, got ${nextInLine.estimatedWait}`);

// 11. OUTBREAK CLUSTER. Four febrile patients from one locality is a signal;
//     one is not. It must flag WITHOUT changing the patient's own acuity.
const neighbours = Array.from({ length: 3 }, (_, i) =>
  make({ id: `E-N${i}`, locality: "Kalyan East", primaryConcern: "fever and cough" }));
const clustered = calculateRecommendation(
  make({ id: "E-ME2", locality: "Kalyan East", primaryConcern: "fever and cough" }),
  resources, policy, { encounters: neighbours }
);
const isolated = calculateRecommendation(
  make({ id: "E-ME3", locality: "Kalyan East", primaryConcern: "fever and cough" }),
  resources, policy, { encounters: [neighbours[0]] }
);
assert.ok(clustered.outbreakSignal, "4 same-locality febrile patients should raise an outbreak signal");
assert.ok(!isolated.outbreakSignal, "2 patients should NOT raise an outbreak signal");
assert.strictEqual(clustered.level, isolated.level,
  "outbreak detection must not change the individual patient's acuity");

// 12. CONFIDENCE IS DERIVED. A fully documented encounter must score higher
//     than a sparse one, and the derivation must be inspectable.
const wellDocumented = calculateRecommendation(
  make({
    symptoms: ["Chest discomfort"], freeText: "central chest heaviness for two hours, radiating to left arm",
    onset: "2 hours ago", duration: "2h", trend: "Worsening",
    riskAnswers: { a: "Yes", b: "No", c: "Yes", d: "No" },
  }),
  resources, policy
);
const sparse = calculateRecommendation(
  make({
    symptoms: [], freeText: "", onset: "", duration: "", trend: "Unknown", riskAnswers: {},
    speakerSource: "Family", communicationLimitations: ["Language barrier"],
    vitals: { consciousness: "Not recorded" },
    history: { conditions: "Unknown", medications: "Unknown", allergies: "Not asked yet", previousEpisode: "Unknown", recentVisit: "Unknown" },
  }),
  resources, policy
);
assert.ok(wellDocumented.confidence > sparse.confidence + 0.2,
  `documented case should be far more confident than a sparse one (${wellDocumented.confidence} vs ${sparse.confidence})`);
assert.ok(wellDocumented.confidenceBasis.length >= 2,
  "confidence must come with an inspectable derivation, not a bare number");

console.log("routing checks passed:");
console.log("  chest+burn      ->", chestAndBurn.pathway, "L" + chestAndBurn.level);
console.log("  trauma only     ->", traumaOnly.pathway, "L" + traumaOnly.level);
console.log("  unresponsive    ->", critical.pathway, "L" + critical.level);
console.log("  stacked signals -> L" + stacked.level, "(capped)");
console.log("  minor case      ->", minor.pathway, "L" + minor.level);
console.log("  adult 37.9°C    -> L" + adultMildFever.level, "(non-urgent)");
console.log("  geriatric 37.9°C-> L" + geriatricMildFever.level, geriatricMildFever.pathway, "(escalated)");
console.log("  hinglish 66y    -> L" + hinglish.level, hinglish.pathway);
console.log("  gate 0 bypass   -> L" + gate0.level, gate0.pathway, gate0.estimatedWait + "m");
console.log("  atypical ACS    -> L" + atypical.level, atypical.pathway, "(no chest pain)");
console.log("  wait next/12th  ->", nextInLine.estimatedWait + "m /", tenthInLine.estimatedWait + "m");
console.log("  outbreak 4 vs 2 ->", !!clustered.outbreakSignal, "/", !!isolated.outbreakSignal);
console.log("  confidence full/sparse ->", wellDocumented.confidence.toFixed(2), "/", sparse.confidence.toFixed(2));
