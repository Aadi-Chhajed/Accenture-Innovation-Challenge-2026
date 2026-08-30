import type { Encounter, Recommendation, Resource, RoutingPolicy, UrgencyLevel } from "./types";

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
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

function clampLevel(level: number): UrgencyLevel {
  return Math.min(5, Math.max(1, level)) as UrgencyLevel;
}

function waitForLevel(level: UrgencyLevel, pathway: string, resources: Resource[]) {
  const constrained = resources.filter((resource) => resource.status !== "Available").length;
  const base = { 1: 0, 2: 8, 3: 24, 4: 55, 5: 95 }[level];
  const pathwayPressure = pathway.includes("Cardiac") || pathway.includes("Trauma") ? 4 : 0;
  return base + constrained * 3 + pathwayPressure;
}

export function calculateRecommendation(
  encounter: Encounter,
  resources: Resource[],
  policy: RoutingPolicy,
): Recommendation {
  const reasons: string[] = [];
  const missingInfo: string[] = [];
  const uncertainty: string[] = [];
  let level = 4;
  let pathway = "Emergency General";
  let destination = "ED priority queue";
  let confidence = 0.88;
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
    confidence -= 0.08;
  }
  if (encounter.speakerSource !== "Patient") {
    uncertainty.push(`information provided by ${encounter.speakerSource.toLowerCase()} (third-party)`);
    confidence -= 0.05;
  }
  if (encounter.riskAnswers.contradiction === "Yes") {
    uncertainty.push("conflicting patient/family narrative detected");
    level -= 1;
    confidence -= 0.14;
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
  if (hasAny(encounter, ["chest", "heaviness", "pressure", "breathless", "palpitations", "radiating pain"])) {
    proposePathway(encounter.patientCategories.includes("Geriatric") ? 2 : 3, "Cardiac Review", "ED priority cardiac review");
    reasons.push("reported chest discomfort or acute shortness of breath");

    // Geriatric atypical MI check
    if (encounter.patientCategories.includes("Geriatric")) {
      geriatricAtypicalFlag = true;
      reasons.push("geriatric cardiac presentation protocol (high atypical MI risk)");
    }
  }

  // 6. STROKE & NEUROLOGICAL SYMPTOMS (LEVEL 2)
  if (hasAny(encounter, ["face droop", "speech", "sudden weakness", "confusion", "slurred", "numbness", "arm drift"])) {
    proposePathway(2, "Stroke / Neuro Review", "Stroke / Neuro priority review");
    reasons.push("sudden neurological or stroke-like signals");
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
  // decremented `level` on its own, so a patient tripping several (e.g. missing vitals
  // + worsening + high severity) compounded straight to Level 1. Per the routing spec,
  // undertriage protection must be balanced against overtriage — unbounded stacking
  // exhausts high-priority resources and delays everyone else. Total escalation from
  // this block is therefore capped at one level, while every signal that fired is still
  // surfaced in `reasons` / `uncertainty` so the nurse sees the full picture.
  let escalated = false;

  if (missingInfo.length >= 2 && (hasAny(encounter, ["chest", "breathing", "weakness", "dizziness"]) || encounter.reportedSeverity >= 7)) {
    undertriageSafeguard = true;
    escalated = true;
    reasons.push("undertriage protection active: upgraded acuity due to missing vitals with risk signals");
    confidence -= 0.10;
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
    level = clampLevel(level - 1);
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
    confidence -= 0.08;
  }

  if (reasons.length === 0) reasons.push("general emergency review based on clinical presentation");

  const overtriageRiskScore = Math.min(85, Math.max(12, (5 - finalLevel) * 15 + missingInfo.length * 8));

  return {
    id: `REC-${Date.now()}`,
    encounterId: encounter.id,
    level: finalLevel,
    label: levelLabels[finalLevel],
    pathway,
    destination,
    estimatedWait: waitForLevel(finalLevel, pathway, resources),
    confidence: Math.max(0.40, Math.min(0.96, confidence)),
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
