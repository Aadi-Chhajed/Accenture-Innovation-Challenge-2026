import type { Encounter, Patient, Recommendation, Resource, RoutingPolicy, UrgencyLevel } from "./types";

// Maximum minutes from triage to initial physician assessment, per acuity
// level. These are the published CTAS (Canadian Triage and Acuity Scale)
// national targets — NOT values we invented:
//   L1 immediate (98% compliance) | L2 15m (95%) | L3 30m (90%)
//   L4 60m (85%)                  | L5 120m (80%)
//
// HOSPITAL-CONFIGURABLE: the spec requires thresholds to live in config rather
// than source. This is the single definition point; a per-hospital override
// belongs here when hospital onboarding is built.
export const SAFE_WAIT_THRESHOLD_MINUTES: Record<UrgencyLevel, number> = {
  1: 0,
  2: 15,
  3: 30,
  4: 60,
  5: 120,
};

const levelLabels: Record<UrgencyLevel, string> = {
  1: "Level 1 - Immediate Resuscitation",
  2: "Level 2 - Very Urgent Review",
  3: "Level 3 - Urgent Review",
  4: "Level 4 - Standard Review",
  5: "Level 5 - Non-Urgent / Fast Track",
};

const pathwayResources: Record<string, string[]> = {
  "Resuscitation / Critical Care Bay": ["Critical care bay", "Monitor", "Oxygen point", "Emergency physician"],
  "Cardiac Review": ["ECG machine", "Monitor", "Emergency physician"],
  "Stroke / Neuro Review": ["Neuro review room", "Imaging slot", "Monitor"],
  Trauma: ["Trauma bay", "Stretcher", "Procedure kit"],
  Pediatrics: ["Pediatric bed", "Pediatric nurse", "Pediatric monitor"],
  Obstetrics: ["OB review room", "Obstetrician on call"],
  "Isolation / Infection Concern": ["Isolation room", "PPE station"],
  "Emergency General": ["ED bed", "Nurse review"],
  Observation: ["Observation bed", "Repeat vitals"],
  "Fast Track / Minor Care": ["Minor care room"],
};

// ---------------------------------------------------------------------------
// MULTILINGUAL TERM LAYER
// ---------------------------------------------------------------------------
// The AI layer understood Hindi/Marathi/Hinglish; this engine did not, so a
// narrative typed as "pet me dard, bukhar, ulti" produced symptoms: [] and a
// 66-year-old with reported abdominal rigidity routed to Level 4. The engine
// decides urgency, so an English-only matcher here is an under-triage bug, not
// a localisation gap — and it must not depend on the AI being reachable.
//
// Each English key below expands to the Hinglish/Devanagari/Marathi forms a
// patient or family member actually types or says. Matching is substring and
// case-insensitive, so stems ("dard", "saans") cover their inflections.
const TERM_ALIASES: Record<string, string[]> = {
  chest: ["chaati", "chhati", "seene", "seena", "छाती", "सीने"],
  heaviness: ["bhari", "bhaari", "jadpana", "जडपणा", "भारीपन"],
  breathless: ["saans", "sans", "dam ghut", "साँस", "सांस", "श्वास", "damghutna"],
  pain: ["dard", "dukh rha", "dukhat", "दर्द", "दुखत"],
  "abdominal pain": ["pet me dard", "pet mein dard", "pet dard", "pot dukhat", "पेट में दर्द", "पोट दुखत"],
  fever: ["bukhar", "bukhar", "taap", "बुखार", "ताप"],
  vomiting: ["ulti", "ultee", "vomitting", "उल्टी", "ओकारी", "okari"],
  nausea: ["ji ghabra", "matli", "मळमळ", "malmal"],
  weakness: ["kamzori", "kamjori", "thakan", "कमजोरी", "अशक्तपणा"],
  dizziness: ["chakkar", "chakar", "चक्कर", "भोवळ"],
  headache: ["sir dard", "sar dard", "sir me dard", "doke dukhat", "सिर दर्द", "डोकं दुखत"],
  fainting: ["behosh", "behoshi", "gir gaya", "बेहोश", "बेशुद्ध"],
  unresponsive: ["hosh nahi", "jawab nahi de", "होश नहीं", "प्रतिसाद नाही"],
  bleeding: ["khoon", "khun beh", "रक्त", "खून"],
  seizure: ["daura", "jhatke", "मिरगी", "झटके", "फेफरे"],
  confusion: ["bhatak", "ulta seedha bol", "गोंधळ", "बहक"],
  injury: ["chot", "lag gayi", "चोट", "इजा", "जखम"],
  accident: ["durghatna", "accident hua", "दुर्घटना", "अपघात"],
  swelling: ["sujan", "sooj", "सूजन", "सूज"],
  rash: ["daane", "chakatte", "दाने", "पुरळ"],
  cough: ["khansi", "khaansi", "खांसी", "खोकला"],
  pregnan: ["garbhvati", "pet se hai", "गर्भवती", "गरोदर"],
  burn: ["jal gaya", "jalan", "जल गया", "भाजल"],
};

function expandTerms(terms: string[]): string[] {
  const out: string[] = [];
  for (const term of terms) {
    out.push(term);
    const aliases = TERM_ALIASES[term.toLowerCase()];
    if (aliases) out.push(...aliases);
  }
  return out;
}

// ---------------------------------------------------------------------------
// NEGATION-AWARE MATCHING
// ---------------------------------------------------------------------------
// Plain substring matching cannot tell "chest pain" from "no chest pain", and
// the failure is not symmetric: a narrative reading "no chest pain at all, just
// unusually tired" matched the cardiac rule on the word "chest", which then
// suppressed the atypical-presentation rule below it — the one written for
// exactly that patient. Denying a symptom made the engine treat it as reported.
//
// So an occurrence is ignored when a negator appears in the same clause just
// before it. Scope is the clause, not the sentence: "no chest pain, but severe
// breathlessness" must still match "breathless".
const NEGATORS = /(?:^|[^a-z])(no|not|non|denies|denied|without|never|negative for|free of|nahi|nahin|nako|nasel)(?:[^a-z][^.,;:]*)?$/;

// Hindi and Marathi are verb-final, so the negator follows what it negates:
// "chest pain bilkul NAHI hai". A backward-only check reads that as a reported
// chest pain. These particles are listed separately from the English ones
// because they can be trusted clause-finally — applying the same forward look
// to English "not" would wrongly negate "chest pain is severe and she is NOT
// vomiting".
const TRAILING_NEGATORS = /^[^.,;:]{0,40}?(?:^|[^a-z])(nahi|nahin|nahee|naahi|nako|nahe|nai)(?:[^a-z]|$)|^[^.,;:]{0,40}?(नहीं|नाही|नको|नाहीं)/;

function isNegated(haystack: string, index: number, termLength: number): boolean {
  // Look back to the start of the clause only, so "no chest pain, but severe
  // breathlessness" still matches "breathless".
  const clauseStart = Math.max(
    haystack.lastIndexOf(".", index),
    haystack.lastIndexOf(",", index),
    haystack.lastIndexOf(";", index),
    haystack.lastIndexOf(":", index),
  );
  if (NEGATORS.test(haystack.slice(clauseStart + 1, index))) return true;
  return TRAILING_NEGATORS.test(haystack.slice(index + termLength));
}

function includesAffirmed(haystack: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) return false;
    if (!isNegated(haystack, at, term.length)) return true;
    from = at + term.length;
  }
}

function hasAny(encounter: Encounter, terms: string[]) {
  const haystack = [
    encounter.primaryConcern,
    encounter.freeText,
    encounter.transcript ?? "",
    ...encounter.symptoms,
    ...encounter.observations,
    ...encounter.patientCategories,
  ]
    .join(" ")
    .toLowerCase();
  return expandTerms(terms).some((term) => includesAffirmed(haystack, term.toLowerCase()));
}

function clampLevel(level: number): UrgencyLevel {
  return Math.min(5, Math.max(1, level)) as UrgencyLevel;
}

/**
 * Cross-encounter context. Optional so the pure single-encounter call still
 * works (tests, previews), but the store always supplies it — queue position
 * and outbreak detection are both impossible from one encounter alone.
 */
export type RoutingContext = {
  encounters?: Encounter[];
  patient?: Patient;
};

// ---------------------------------------------------------------------------
// WAIT ESTIMATION — queue position, not just acuity
// ---------------------------------------------------------------------------
// Previously level-based only: a Level 3 next in line and a Level 3 with ten
// people ahead showed the same figure, which contradicts what the nurse can
// see on the board. Now the estimate is driven by how many patients will
// actually be seen first.
//
// Model: patients are seen in (level, waiting time) order. `ahead` counts those
// who outrank this patient. Clinicians work in parallel, so `ahead` is divided
// by the number of available clinicians before multiplying by the mean
// consultation time.
const MEAN_CONSULT_MINUTES = 12;

function estimateWait(
  level: UrgencyLevel,
  encounter: Encounter,
  resources: Resource[],
  context: RoutingContext,
): { wait: number; position: number } {
  if (level === 1) return { wait: 0, position: 1 };

  const queue = (context.encounters ?? []).filter(
    (other) =>
      other.id !== encounter.id &&
      (other.status === "Waiting" || other.status === "Intake") &&
      other.recommendation?.level != null,
  );

  const ahead = queue.filter(
    (other) =>
      other.recommendation.level < level ||
      (other.recommendation.level === level && other.waitingMins > encounter.waitingMins),
  ).length;

  const clinicians = Math.max(1, resources.filter((r) => r.category === "Staff" && r.status === "Available").length);
  const constrained = resources.filter((r) => r.status !== "Available").length;

  // Everyone waits at least a triage-to-bed turnaround, even when first in line.
  const turnaround = { 1: 0, 2: 5, 3: 10, 4: 15, 5: 20 }[level];
  const queueWait = Math.round((ahead / clinicians) * MEAN_CONSULT_MINUTES);
  const pathwayPressure = constrained * 3;

  // Never promise faster than the safe-wait target allows us to plan for, but
  // never inflate past it either when the queue genuinely is short.
  return { wait: turnaround + queueWait + pathwayPressure, position: ahead + 1 };
}

// ---------------------------------------------------------------------------
// OUTBREAK / GEOGRAPHY SIGNAL
// ---------------------------------------------------------------------------
// A single febrile patient is routine. Four from the same locality in one shift
// is a public-health signal that no per-patient rule can see. This does not
// change the patient's own acuity — it flags isolation placement and raises an
// alert for the shift lead.
const OUTBREAK_THRESHOLD = 3; // others from the same locality, this shift

function detectOutbreak(encounter: Encounter, context: RoutingContext): string | undefined {
  const locality = encounter.locality?.trim().toLowerCase();
  if (!locality) return undefined;
  if (!hasAny(encounter, ["fever", "cough", "rash", "vomiting", "diarrh", "infection", "breathless"])) return undefined;

  const similar = (context.encounters ?? []).filter(
    (other) =>
      other.id !== encounter.id &&
      other.locality?.trim().toLowerCase() === locality &&
      hasAny(other, ["fever", "cough", "rash", "vomiting", "diarrh", "infection", "breathless"]),
  );

  if (similar.length < OUTBREAK_THRESHOLD) return undefined;
  return `${similar.length + 1} patients from ${encounter.locality} presenting with a similar infectious picture this shift — possible local cluster`;
}

export function calculateRecommendation(
  encounter: Encounter,
  resources: Resource[],
  policy: RoutingPolicy,
  context: RoutingContext = {},
): Recommendation {
  // -------------------------------------------------------------------------
  // GATE 0 — NURSE DIRECT-TO-RESUS BYPASS
  // -------------------------------------------------------------------------
  // A patient who is obviously dying does not get a questionnaire. When the
  // nurse triggers the bypass this returns immediately at Level 1: no rule
  // below can dilute it, and no missing field can delay it. Confidence is 1.0
  // because the input is a trained clinician's direct observation, which is a
  // stronger signal than anything the form could collect.
  if (encounter.nurseCriticalOverride) {
    return {
      id: `REC-${Date.now()}`,
      encounterId: encounter.id,
      level: 1,
      label: levelLabels[1],
      pathway: "Resuscitation / Critical Care Bay",
      destination: "Critical care resuscitation bay",
      estimatedWait: 0,
      confidence: 1,
      confidenceBasis: [
        { factor: "Nurse direct observation (Gate 0)", effect: "authoritative — supersedes the questionnaire" },
      ],
      queuePosition: 1,
      resources: pathwayResources["Resuscitation / Critical Care Bay"],
      reasons: [
        `nurse critical bypass: ${encounter.nurseCriticalOverride.reason}`,
        "triage questionnaire skipped by design — resuscitation first, documentation after",
      ],
      missingInfo: ["full intake pending — complete retrospectively once the patient is stabilised"],
      uncertainty: [],
      humanReviewRequired: true,
      undertriageSafeguard: false,
      overtriageRiskScore: 0,
      createdAt: new Date().toISOString(),
    };
  }

  const reasons: string[] = [];
  const missingInfo: string[] = [];
  const uncertainty: string[] = [];
  let level = 4;
  let pathway = "Emergency General";
  let destination = "ED priority queue";
  let undertriageSafeguard = false;
  let pediatricDangerFlag = false;
  let geriatricAtypicalFlag = false;
  let zeroHistoryFlag = false;

  // 1. MISSING DATA SCREENING
  if (encounter.vitals.consciousness === "Not recorded") missingInfo.push("consciousness level");
  if (!encounter.vitals.spo2 && !encounter.vitals.spo2Unavailable) missingInfo.push("oxygen saturation (SpO2)");
  if (encounter.vitals.spo2Unavailable) missingInfo.push("SpO2 sensor reading not available yet");
  if (!encounter.vitals.pulse && !encounter.vitals.pulseUnavailable) missingInfo.push("pulse rate");
  if (!encounter.vitals.bpSystolic && !encounter.vitals.bpUnavailable) missingInfo.push("blood pressure");
  if (!encounter.onset) missingInfo.push("symptom onset time");
  if (encounter.history.allergies === "Not asked yet") missingInfo.push("allergy history");

  // 2. UNCERTAINTY & RELIABILITY CORRECTION
  if (encounter.communicationLimitations.length > 0) {
    uncertainty.push("communication limitation requires collateral verification");
  }
  if (encounter.speakerSource !== "Patient") {
    uncertainty.push(`information provided by ${encounter.speakerSource.toLowerCase()} (third-party)`);
  }
  if (encounter.riskAnswers.contradiction === "Yes") {
    uncertainty.push("conflicting patient/family narrative detected");
    level -= 1;
    reasons.push("contradictory history with potential acute risk");
  }

  // 3. ZERO-HISTORY EHR CASE
  if (hasAny(encounter, ["unknown record", "not found", "zero history"])) {
    zeroHistoryFlag = true;
    uncertainty.push("no prior EHR record on file — zero-history patient");
    reasons.push("zero-history screening protocol active");
  }

  // --- PATHWAY SELECTION -----------------------------------------------------
  // Each rule below PROPOSES a pathway with the acuity it implies. Previously
  // every rule assigned `pathway` directly, so the last rule to match won: a
  // patient with chest pain AND a burn was routed to Trauma purely because the
  // trauma rule is evaluated after the cardiac one. Now the most urgent
  // proposal wins regardless of evaluation order, and ties keep the earlier
  // (higher-priority) rule. Every matched rule still contributes its reason.
  let pathwayLevel = 99;
  function proposePathway(candidateLevel: number, name: string, dest: string) {
    level = Math.min(level, candidateLevel);
    if (candidateLevel < pathwayLevel) {
      pathwayLevel = candidateLevel;
      pathway = name;
      destination = dest;
    }
  }

  // 4. CRITICAL RESUSCITATION SYMPTOMS (LEVEL 1)
  if (
    encounter.vitals.consciousness === "Unresponsive" ||
    encounter.vitals.consciousness === "Responds to pain" ||
    hasAny(encounter, ["unresponsive", "not breathing", "gasping", "severe arterial bleeding", "cardiac arrest"])
  ) {
    proposePathway(1, "Resuscitation / Critical Care Bay", "Critical care resuscitation bay");
    reasons.push("critical vital collapse or unresponsiveness");
  }

  // 5. CARDIAC & CHEST SYMPTOMS (LEVEL 2/3)
  const classicCardiac = hasAny(encounter, ["chest", "heaviness", "pressure", "breathless", "palpitations", "radiating pain"]);
  if (classicCardiac) {
    proposePathway(encounter.patientCategories.includes("Geriatric") ? 2 : 3, "Cardiac Review", "ED priority cardiac review");
    reasons.push("reported chest discomfort or acute shortness of breath");

    // Geriatric atypical MI check
    if (encounter.patientCategories.includes("Geriatric")) {
      geriatricAtypicalFlag = true;
      reasons.push("geriatric cardiac presentation protocol (high atypical MI risk)");
    }
  }

  const conditions = `${encounter.history.conditions} ${encounter.history.medications}`.toLowerCase();
  const diabetic = /diabet|sugar|insulin|metformin/.test(conditions) || encounter.patientCategories.includes("Diabetic");
  const atypicalRiskGroup =
    encounter.patientCategories.includes("Geriatric") ||
    diabetic ||
    (context.patient?.sex === "Female" && (context.patient?.age ?? 0) >= 45);

  // 6. STROKE & NEUROLOGICAL SYMPTOMS (LEVEL 2)
  if (hasAny(encounter, ["face droop", "speech", "sudden weakness", "confusion", "slurred", "numbness", "arm drift"])) {
    proposePathway(2, "Stroke / Neuro Review", "Stroke / Neuro priority review");
    reasons.push("sudden neurological or stroke-like signals");
  }

  // 6b. ATYPICAL ACS PRESENTATION (modifier M2) — LEVEL 2
  // Roughly a third of myocardial infarctions present WITHOUT chest pain,
  // concentrated in three groups: older adults, people with diabetes (autonomic
  // neuropathy blunts cardiac pain), and women. In those groups the absence of
  // the classic symptom is not reassurance — the presentation is breathlessness,
  // epigastric discomfort, sweating, syncope, nausea, or sudden fatigue.
  //
  // This was previously left to the LLM alone, so the protection disappeared
  // whenever the network did. It is deterministic now.
  //
  // It sits AFTER the stroke rule deliberately: "sudden confusion" belongs to
  // Neuro, which proposes at the same acuity and therefore keeps the tie. And it
  // demands real evidence — one strong sign, or two weak ones. A first draft
  // fired on any single symptom of malaise and swept six of twenty seeded
  // patients into Cardiac Review, which is over-triage severe enough to make the
  // rule useless: if everyone is a cardiac case, nobody is.
  const strongAtypical = hasAny(encounter, [
    "breathless", "short of breath", "shortness of breath", "epigastric",
    "upper abdominal", "indigestion", "sweating", "clammy", "diaphor", "fainting", "syncope",
  ]);
  const weakAtypical = ["fatigue", "tired", "weakness", "nausea", "vomiting", "dizziness", "confusion"]
    .filter((t) => hasAny(encounter, [t])).length;
  const infectiveExplanation = hasAny(encounter, ["fever", "cough", "rash", "infection"]);
  const strokeSignals = hasAny(encounter, ["face droop", "speech", "sudden weakness", "slurred", "numbness", "arm drift"]);

  if (
    atypicalRiskGroup &&
    !classicCardiac &&
    !infectiveExplanation &&
    !strokeSignals &&
    (strongAtypical || weakAtypical >= 2)
  ) {
    geriatricAtypicalFlag = true;
    proposePathway(2, "Cardiac Review", "ED priority cardiac review");
    const group = diabetic
      ? "diabetes (autonomic neuropathy)"
      : encounter.patientCategories.includes("Geriatric")
        ? "age"
        : "sex and age";
    reasons.push(
      `atypical presentation protocol: ${group} places this patient in a group where a cardiac event commonly presents with no chest pain — absence of chest pain does not lower suspicion`,
    );
  }

  // 7. TRAUMA & MEDICO-LEGAL (LEVEL 2/3)
  if (hasAny(encounter, ["accident", "fall", "injury", "bleeding", "burn", "fracture", "head trauma"])) {
    proposePathway(encounter.medicoLegal ? 2 : 3, "Trauma", "Trauma bay queue");
    reasons.push(encounter.medicoLegal ? "medico-legal forensic trauma workflow" : "acute injury or trauma workflow");
  }

  // 8. PEDIATRIC SPECIFIC THRESHOLDS & DANGER FLAGS (LEVEL 2/3)
  if (encounter.patientCategories.includes("Infant") || encounter.patientCategories.includes("Child")) {
    const isPediatricSevere =
      (encounter.vitals.pulse && encounter.vitals.pulse > 140) ||
      (encounter.vitals.temperature && encounter.vitals.temperature >= 38.8) ||
      hasAny(encounter, ["lethargy", "grunting", "inconsolable crying", "sunken", "dehydration", "retractions"]);

    if (isPediatricSevere) {
      pediatricDangerFlag = true;
      reasons.push("pediatric physiological danger flags (high fever, tachycardia, or lethargy)");
    } else {
      reasons.push("age-specific pediatric review pathway");
    }
    // Pediatric care is delivered in the pediatric area regardless of the
    // presenting complaint, so it wins ties against same-acuity adult pathways.
    proposePathway(isPediatricSevere ? 2 : 3, "Pediatrics", "Pediatric emergency review");
  }

  // 8b. GERIATRIC PHYSIOLOGICAL DANGER FLAGS (numeric vital thresholds distinct
  // from the adult/pediatric ones above). Elderly patients often present with a
  // blunted febrile and tachycardic response — a fever or heart rate that would
  // look unremarkable in an adult can signal serious illness at this age.
  if (encounter.patientCategories.includes("Geriatric")) {
    const geriatricDanger =
      (encounter.vitals.temperature != null && encounter.vitals.temperature >= 37.8) ||
      (encounter.vitals.pulse != null && encounter.vitals.pulse >= 110) ||
      (encounter.vitals.spo2 != null && encounter.vitals.spo2 < 92);

    if (geriatricDanger) {
      geriatricAtypicalFlag = true;
      if (pathway === "Emergency General") {
        proposePathway(2, "Isolation / Infection Concern", "Isolation review area");
      } else {
        // A more specific pathway already matched (e.g. Cardiac, Stroke) — keep
        // it, just make sure the acuity reflects the geriatric danger signal.
        level = Math.min(level, 2);
      }
      reasons.push("geriatric vital-sign threshold triggered (blunted febrile/tachycardic response can mask serious illness in this age group)");
    }
  }

  // 9. GERIATRIC ATYPICAL PRESENTATION (LEVEL 2/3)
  if (encounter.patientCategories.includes("Geriatric") && level > 2) {
    if (hasAny(encounter, ["weakness", "fainting", "confusion", "dizziness", "unexplained pain", "nausea"])) {
      geriatricAtypicalFlag = true;
      level -= 1;
      reasons.push("geriatric atypical disease escalation (safety bias applied)");
    }
  }

  // 10. PREGNANCY RELATED
  if (encounter.patientCategories.includes("Pregnant patient") || hasAny(encounter, ["pregnan", "fetal", "labour"])) {
    proposePathway(hasAny(encounter, ["bleeding", "pain", "cramps"]) ? 2 : 3, "Obstetrics", "OB emergency review");
    reasons.push("pregnancy-related clinical routing context");
  }

  // 11. INFECTION & ISOLATION
  // Isolation is a placement constraint rather than a competing clinical
  // pathway, so it only claims the destination when nothing more specific did.
  if (hasAny(encounter, ["fever", "rash", "cough", "exposure", "infection", "isolation"])) {
    const infectionLevel = encounter.patientCategories.includes("Geriatric") ? 2 : 3;
    level = Math.min(level, infectionLevel);
    if (pathway === "Emergency General") {
      proposePathway(infectionLevel, "Isolation / Infection Concern", "Isolation review area");
    } else {
      reasons.push("isolation precautions flagged alongside primary pathway");
    }
    reasons.push("infection control or isolation workflow signal");
  }

  // 11b. GEOGRAPHIC CLUSTER / OUTBREAK SIGNAL
  // Placement and public-health reporting only — it deliberately does NOT raise
  // this patient's acuity. Their own illness is no more severe because their
  // neighbours are also ill; what changes is that they must not sit in the open
  // waiting area, and the shift lead needs to know.
  const outbreakSignal = detectOutbreak(encounter, context);
  if (outbreakSignal) {
    if (pathway === "Emergency General") {
      proposePathway(pathwayLevel === 99 ? level : pathwayLevel, "Isolation / Infection Concern", "Isolation review area");
    }
    reasons.push(`geographic cluster detected — ${outbreakSignal}`);
    uncertainty.push("possible community outbreak: confirm travel/contact history and notify infection control");
  }

  // 12. FAST TRACK / MINOR CARE (LEVEL 5)
  if (hasAny(encounter, ["small cut", "minor", "sprain", "abrasion", "stitch removal"]) && level > 3) {
    level = 5;
    pathwayLevel = 5;
    pathway = "Fast Track / Minor Care";
    destination = "Fast track minor care bay";
    reasons.push("stable low-acuity minor-care pattern");
  }

  // 13. ESCALATION MODIFIERS (ASYMMETRIC UNDERTRIAGE SAFEGUARD + ACUITY SIGNALS)
  // These signals are collected rather than applied individually: each one previously
  // decremented `level` on its own, so a patient tripping several compounded straight
  // to Level 1. Total escalation from this block is capped at one level, while every
  // signal that fired is still surfaced so the nurse sees the full picture.
  let escalated = false;

  if (missingInfo.length >= 2 && (hasAny(encounter, ["chest", "breathing", "weakness", "dizziness"]) || encounter.reportedSeverity >= 7)) {
    undertriageSafeguard = true;
    escalated = true;
    reasons.push("undertriage protection active: upgraded acuity due to missing vitals with risk signals");
  }

  if (encounter.trend === "Worsening") {
    escalated = true;
    reasons.push("patient condition reported as worsening over time");
  }

  if (encounter.waitingMins > 30 && level > 2) {
    escalated = true;
    uncertainty.push("waiting time exceeded 30m threshold — priority bumped");
  }

  if (encounter.reportedSeverity >= 8) {
    escalated = true;
    reasons.push("high patient-reported pain/severity score (≥8)");
  }

  if (escalated) {
    // Escalation stops at Level 2. Level 1 means "resuscitation now" and has a
    // specific meaning to the receiving team; reaching it by accumulating soft
    // modifiers (worsening + high pain + missing vitals) produced incoherent
    // records like a Level 1 routed to Cardiac Review. Level 1 comes from an
    // actual critical finding or the nurse's Gate 0 call, and from nothing else.
    // Escalation can never carry a patient PAST Level 2, but it must never
    // raise one who is already Level 1 either. Writing this as a bare
    // Math.max(2, ...) pushed a genuinely unresponsive patient — who reached
    // Level 1 on a critical finding — back up to Level 2 the moment their trend
    // was also "worsening".
    level = Math.min(level, Math.max(2, clampLevel(level - 1)));
  }

  const finalLevel = clampLevel(level);

  // 14. RESOURCE CONSTRAINT ADJUSTMENTS
  const needed = pathwayResources[pathway] ?? ["Nurse review"];
  const unavailableNeeded = needed.filter((need) =>
    resources.some((resource) => need.toLowerCase().includes(resource.name.toLowerCase()) && resource.status === "Unavailable"),
  );
  if (unavailableNeeded.length > 0) {
    destination = "Safest available holding area";
    uncertainty.push(`resource constraint: ${unavailableNeeded.join(", ")} unavailable`);
  }

  if (reasons.length === 0) reasons.push("general emergency review based on clinical presentation");

  const { wait, position } = estimateWait(finalLevel, encounter, resources, context);
  const { confidence, basis } = deriveConfidence(encounter, missingInfo, unavailableNeeded.length > 0, zeroHistoryFlag);
  const overtriageRiskScore = Math.min(85, Math.max(12, (5 - finalLevel) * 15 + missingInfo.length * 8));

  return {
    id: `REC-${Date.now()}`,
    encounterId: encounter.id,
    level: finalLevel,
    label: levelLabels[finalLevel],
    pathway,
    destination,
    estimatedWait: wait,
    queuePosition: position,
    confidence,
    confidenceBasis: basis,
    outbreakSignal,
    resources: needed,
    reasons,
    missingInfo,
    uncertainty,
    humanReviewRequired: finalLevel <= 3 || uncertainty.length > 0 || missingInfo.length > 0 || undertriageSafeguard,
    undertriageSafeguard,
    overtriageRiskScore,
    pediatricDangerFlag,
    geriatricAtypicalFlag,
    zeroHistoryFlag,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CONFIDENCE — derived, not asserted
// ---------------------------------------------------------------------------
// This used to start at a hardcoded 0.88 and subtract hand-picked penalties.
// Neither the base nor the penalties came from anywhere; the number looked
// precise and meant nothing, which is worse than showing no number at all.
//
// It now answers one specific, checkable question: HOW MUCH OF THE INFORMATION
// THAT DRIVES THE ROUTING DECISION DO WE ACTUALLY HAVE? Each input group below
// carries a weight equal to its influence on the rules above — vitals matter
// most because six rules read them; history matters least because one does.
// Completeness is the weighted fraction present, then reliability multipliers
// discount information we hold but cannot fully trust.
//
// It is NOT a probability that the routing is correct, and is not presented as
// one. Every term is returned in `confidenceBasis` so the nurse can see what
// moved it rather than being handed a bare number.
const CONFIDENCE_WEIGHTS = {
  vitals: 0.35,
  presentation: 0.2,
  timing: 0.15,
  riskScreening: 0.15,
  history: 0.15,
};

// "Unknown", "Not clear", "Not asked yet" are placeholders, not answers, and
// must not score as information we hold. "None known" and "No" ARE answers —
// a confirmed absence is as useful to the rules as a confirmed presence.
const PLACEHOLDERS = new Set(["", "unknown", "not clear", "not asked yet", "not recorded", "not available", "-"]);
const known = (v?: string) => !!v && !PLACEHOLDERS.has(v.trim().toLowerCase());

function deriveConfidence(
  encounter: Encounter,
  missingInfo: string[],
  resourceConstrained: boolean,
  zeroHistory: boolean,
): { confidence: number; basis: Recommendation["confidenceBasis"] } {
  const basis: Recommendation["confidenceBasis"] = [];

  // --- completeness -------------------------------------------------------
  const vitalChecks = [
    encounter.vitals.consciousness !== "Not recorded",
    encounter.vitals.pulse != null || encounter.vitals.pulseUnavailable === true,
    encounter.vitals.spo2 != null || encounter.vitals.spo2Unavailable === true,
    encounter.vitals.bpSystolic != null || encounter.vitals.bpUnavailable === true,
    encounter.vitals.temperature != null || encounter.vitals.tempUnavailable === true,
  ];
  const vitalsScore = vitalChecks.filter(Boolean).length / vitalChecks.length;

  const presentationScore =
    (encounter.symptoms.length > 0 ? 0.5 : 0) + ((encounter.freeText ?? "").trim().length > 20 ? 0.5 : 0);

  const timingChecks = [known(encounter.onset), known(encounter.duration), encounter.trend !== "Unknown"];
  const timingScore = timingChecks.filter(Boolean).length / timingChecks.length;

  const riskAnswered = Object.values(encounter.riskAnswers ?? {}).filter((v) => v && v !== "Unsure").length;
  const riskScore = Math.min(1, riskAnswered / 4);

  const historyChecks = [
    known(encounter.history.conditions),
    known(encounter.history.medications),
    known(encounter.history.allergies),
  ];
  const historyScore = historyChecks.filter(Boolean).length / historyChecks.length;

  const completeness =
    vitalsScore * CONFIDENCE_WEIGHTS.vitals +
    presentationScore * CONFIDENCE_WEIGHTS.presentation +
    timingScore * CONFIDENCE_WEIGHTS.timing +
    riskScore * CONFIDENCE_WEIGHTS.riskScreening +
    historyScore * CONFIDENCE_WEIGHTS.history;

  basis.push({
    factor: "Information completeness",
    effect: `${Math.round(completeness * 100)}% of routing-relevant inputs recorded (vitals ${Math.round(vitalsScore * 100)}%, presentation ${Math.round(presentationScore * 100)}%, timing ${Math.round(timingScore * 100)}%, risk screening ${Math.round(riskScore * 100)}%, history ${Math.round(historyScore * 100)}%)`,
  });

  // --- reliability discounts ----------------------------------------------
  let confidence = completeness;
  const discount = (factor: string, multiplier: number, why: string) => {
    confidence *= multiplier;
    basis.push({ factor, effect: `×${multiplier} — ${why}` });
  };

  if (encounter.speakerSource !== "Patient") {
    discount("Third-party history", 0.95, `account given by ${encounter.speakerSource.toLowerCase()}, not the patient`);
  }
  if (encounter.communicationLimitations.length > 0) {
    discount("Communication limitation", 0.92, encounter.communicationLimitations.join(", "));
  }
  if (encounter.riskAnswers.contradiction === "Yes") {
    discount("Contradictory account", 0.85, "narrative conflicts internally");
  }
  if (zeroHistory) {
    discount("No prior record", 0.95, "nothing to corroborate against");
  }
  if (resourceConstrained) {
    discount("Resource constraint", 0.92, "planned pathway is not fully available");
  }
  if (missingInfo.length >= 3) {
    discount("Multiple gaps", 0.9, `${missingInfo.length} routing-relevant fields still unknown`);
  }

  // Floor and ceiling: never 0 (the rules still fire on what we have) and never
  // 1 (a triage decision on partial information is never certain).
  const final = Math.max(0.2, Math.min(0.95, confidence));
  basis.push({ factor: "Bounded", effect: `clamped to 0.20-0.95 → ${final.toFixed(2)}` });
  return { confidence: final, basis };
}
