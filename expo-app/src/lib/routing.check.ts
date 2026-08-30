// Runnable check for routing precedence + escalation capping.
//   node --experimental-strip-types src/lib/routing.check.ts
// Kept deliberately tiny: no framework, just asserts that fail loudly.
import assert from "node:assert";
import { calculateRecommendation } from "./routing.ts";
import type { Encounter, Resource, RoutingPolicy } from "./types.ts";

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

console.log("routing checks passed:");
console.log("  chest+burn      ->", chestAndBurn.pathway, "L" + chestAndBurn.level);
console.log("  trauma only     ->", traumaOnly.pathway, "L" + traumaOnly.level);
console.log("  unresponsive    ->", critical.pathway, "L" + critical.level);
console.log("  stacked signals -> L" + stacked.level, "(capped)");
console.log("  minor case      ->", minor.pathway, "L" + minor.level);
console.log("  adult 37.9°C    -> L" + adultMildFever.level, "(non-urgent)");
console.log("  geriatric 37.9°C-> L" + geriatricMildFever.level, geriatricMildFever.pathway, "(escalated)");
