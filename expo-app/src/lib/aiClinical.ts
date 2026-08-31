import { callModel, isAiConfigured, aiProvider } from "./ai";
import type { Encounter, Patient, Recommendation, Vitals } from "./types";
import { priorRecordPrompt, nextQuestionsPrompt, vitalsPlanPrompt, holisticPrompt, reassessmentPrompt, riskScreeningPrompt } from "./prompts";

// ---------------------------------------------------------------------------
// Clinical AI capabilities layered on top of the provider transport in ai.ts.
//
// SAME CONTRACT AS ai.ts — read it before changing anything here:
//   1. ADDITIVE ONLY. routing.ts remains the sole authority on urgency level
//      and pathway. Nothing in this file may mutate a recommendation.
//   2. FAILS SOFT. No key, no network, bad JSON, timeout -> null, and the
//      caller carries on with rules alone.
//   3. NEVER BLOCKING. Callers render the rule-based result first, then enrich.
// ---------------------------------------------------------------------------

const GROQ_KEY = (process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "").trim();
const STT_MODEL = process.env.EXPO_PUBLIC_GROQ_STT_MODEL ?? "whisper-large-v3-turbo";

// =========================================================================
// 1. SPEECH TO TEXT (real, via Groq-hosted Whisper)
// =========================================================================

export function isSttConfigured(): boolean {
  // Whisper is served by Groq's audio endpoint; Gemini/Anthropic keys don't
  // enable it, so this is deliberately narrower than isAiConfigured().
  return GROQ_KEY.length > 0;
}

/**
 * Transcribe a recorded audio file. Returns null on any failure so the nurse
 * can always fall back to typing.
 */
export async function transcribeAudio(uri: string, languageHint?: string): Promise<string | null> {
  if (!isSttConfigured()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const form = new FormData();
    // React Native's FormData accepts this file-descriptor shape directly.
    form.append("file", { uri, name: "intake.m4a", type: "audio/m4a" } as unknown as Blob);
    form.append("model", STT_MODEL);
    // Whisper language codes are ISO-639-1. Omit for auto-detect, which matters
    // for code-switched speech (Hinglish) where forcing a language hurts.
    const iso = languageHint === "Hindi" ? "hi" : languageHint === "Marathi" ? "mr" : languageHint === "English" ? "en" : "";
    if (iso) form.append("language", iso);
    form.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${GROQ_KEY}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[ai/stt] failed " + res.status + ": " + (await res.text().catch(() => "")));
      return null;
    }
    const json = (await res.json()) as { text?: string };
    return json.text?.trim() || null;
  } catch (err) {
    console.warn("[ai/stt] error, falling back to typing:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// =========================================================================
// 2. PRIOR RECORD SUMMARY + COMPARISON
// =========================================================================

export type PriorRecordAnalysis = {
  summary: string;
  changedSinceLastVisit: string[];
  relevantRisks: string[];
  isRepresentation: boolean;
  representationConcern?: string;
};

/**
 * Summarise a patient's prior record and compare it against what they're
 * presenting with today. Returns null when there is no prior record.
 */
export async function analyzePriorRecord(
  patient: Patient,
  encounter: Encounter
): Promise<PriorRecordAnalysis | null> {
  if (!isAiConfigured()) return null;
  if (patient.previousRecord !== "Available" || !patient.previousSummary) return null;

  const system = priorRecordPrompt();

  const tool = {
    name: "record_prior_analysis",
    description: "Record the comparison between prior record and current presentation.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Under 50 words summarising the prior record's relevance today." },
        changedSinceLastVisit: { type: "array", items: { type: "string" }, description: "What is different now versus the prior record." },
        relevantRisks: { type: "array", items: { type: "string" }, description: "Prior conditions that raise risk for today's complaint." },
        isRepresentation: { type: "boolean", description: "True if this looks like a return for the same/related problem." },
        representationConcern: { type: ["string", "null"], description: "If a re-presentation, why it matters." },
      },
      required: ["summary", "changedSinceLastVisit", "relevantRisks", "isRepresentation"],
    },
  };

  const userText = [
    "PRIOR RECORD",
    patient.previousSummary,
    "",
    "CURRENT PRESENTATION",
    "Age " + patient.age + ", " + patient.sex,
    "Primary concern: " + (encounter.primaryConcern || "-"),
    "Symptoms: " + (encounter.symptoms.join(", ") || "-"),
    "Narrative: " + (encounter.freeText || "-"),
    "Reported history today: " + encounter.history.conditions,
    "Medications today: " + encounter.history.medications,
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;
  return {
    summary: typeof out.summary === "string" ? out.summary : "",
    changedSinceLastVisit: Array.isArray(out.changedSinceLastVisit) ? (out.changedSinceLastVisit as string[]) : [],
    relevantRisks: Array.isArray(out.relevantRisks) ? (out.relevantRisks as string[]) : [],
    isRepresentation: out.isRepresentation === true,
    representationConcern: typeof out.representationConcern === "string" ? out.representationConcern : undefined,
  };
}

// =========================================================================
// 3. DYNAMIC LEADING QUESTIONS (conversational intake)
// =========================================================================

export type NextQuestions = {
  questions: { question: string; why: string; options?: string[] }[];
  readyToRoute: boolean;
  stillMissing: string[];
};

/**
 * Given what's captured so far, decide what to ask NEXT. This is what makes the
 * form dynamic rather than a fixed 8-step march — questions adapt to what the
 * patient actually said.
 */
export async function generateNextQuestions(
  partial: Partial<Encounter> & { age?: number; sex?: string },
  askedAlready: string[]
): Promise<NextQuestions | null> {
  if (!isAiConfigured()) return null;

  const system = nextQuestionsPrompt();

  const tool = {
    name: "record_next_questions",
    description: "Record the next questions to ask and whether enough is known to route.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "Under 15 words, plain language." },
              why: { type: "string", description: "What routing decision this affects. For the nurse, not the patient." },
              options: { type: "array", items: { type: "string" }, description: "Short answer options, if applicable." },
            },
            required: ["question", "why"],
          },
        },
        readyToRoute: { type: "boolean", description: "True if enough is known to route safely." },
        stillMissing: { type: "array", items: { type: "string" }, description: "Routing-relevant facts still unknown." },
      },
      required: ["questions", "readyToRoute", "stillMissing"],
    },
  };

  const v = partial.vitals;
  const userText = [
    "CAPTURED SO FAR",
    "Age: " + (partial.age ?? "unknown") + " | Sex: " + (partial.sex ?? "unknown"),
    "Categories: " + (partial.patientCategories?.join(", ") || "none recorded"),
    "Primary concern: " + (partial.primaryConcern || "-"),
    "Symptoms: " + (partial.symptoms?.join(", ") || "-"),
    "Narrative: " + (partial.freeText || "-"),
    "Onset: " + (partial.onset || "unknown") + " | Trend: " + (partial.trend || "unknown"),
    "Severity: " + (partial.reportedSeverity ?? "unknown"),
    "Vitals: " + (v ? `HR ${v.pulse ?? "-"}, BP ${v.bpSystolic ?? "-"}/${v.bpDiastolic ?? "-"}, SpO2 ${v.spo2 ?? "-"}, Temp ${v.temperature ?? "-"}, consciousness ${v.consciousness}` : "none recorded"),
    "History: " + (partial.history?.conditions ?? "unknown"),
    "",
    "ALREADY ASKED (do not repeat):",
    askedAlready.length ? askedAlready.map((q) => "- " + q).join("\n") : "(nothing yet)",
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;
  return {
    questions: Array.isArray(out.questions) ? (out.questions as NextQuestions["questions"]) : [],
    readyToRoute: out.readyToRoute === true,
    stillMissing: Array.isArray(out.stillMissing) ? (out.stillMissing as string[]) : [],
  };
}

// =========================================================================
// 4. SITUATION-AWARE VITALS SELECTION
// =========================================================================

export type VitalsPlan = {
  priority: { vital: string; why: string }[];
  optional: string[];
  observations: string[];
};

const ALL_VITALS = [
  "temperature", "pulse", "spo2", "respiratoryRate",
  "bpSystolic", "bpDiastolic", "painScore", "bloodSugar", "consciousness",
];

/**
 * Decide which vitals actually matter for this presentation, so the nurse sees
 * a short prioritised list instead of a wall of eight identical fields.
 */
export async function planVitals(partial: Partial<Encounter> & { age?: number }): Promise<VitalsPlan | null> {
  if (!isAiConfigured()) return null;

  const system = vitalsPlanPrompt(ALL_VITALS);

  const tool = {
    name: "record_vitals_plan",
    description: "Record which vitals and observations to prioritise.",
    input_schema: {
      type: "object",
      properties: {
        priority: {
          type: "array",
          items: {
            type: "object",
            properties: {
              vital: { type: "string", enum: ALL_VITALS },
              why: { type: "string", description: "Under 12 words." },
            },
            required: ["vital", "why"],
          },
        },
        optional: { type: "array", items: { type: "string", enum: ALL_VITALS } },
        observations: { type: "array", items: { type: "string" }, description: "Physical observations worth recording for this case." },
      },
      required: ["priority", "optional", "observations"],
    },
  };

  const userText = [
    "PRESENTATION",
    "Age: " + (partial.age ?? "unknown"),
    "Categories: " + (partial.patientCategories?.join(", ") || "none"),
    "Primary concern: " + (partial.primaryConcern || "-"),
    "Symptoms: " + (partial.symptoms?.join(", ") || "-"),
    "Narrative: " + (partial.freeText || "-"),
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;
  return {
    priority: Array.isArray(out.priority) ? (out.priority as VitalsPlan["priority"]) : [],
    optional: Array.isArray(out.optional) ? (out.optional as string[]) : [],
    observations: Array.isArray(out.observations) ? (out.observations as string[]) : [],
  };
}

// =========================================================================
// 5. SIMILAR-CASE RETRIEVAL  (see the honesty note below)
// =========================================================================

export type SimilarCase = {
  encounter: Encounter;
  patientName: string;
  score: number;
  sharedSignals: string[];
};

/**
 * Find prior encounters resembling the current one.
 *
 * IMPORTANT — this is RETRIEVAL, not training. No model is fine-tuned on
 * patient data anywhere in this project. This ranks the LOCAL encounter corpus
 * by structured/lexical overlap and hands the top matches to the model as
 * context (retrieval-augmented generation). Two honest limitations:
 *   - Similarity is lexical + categorical, NOT semantic. There is no embedding
 *     model configured, so "chest tightness" and "pressure in chest" only match
 *     on the shared token "chest".
 *   - The corpus is synthetic demo data. Outcomes in it are not real, so
 *     nothing retrieved constitutes clinical evidence — it is illustrative
 *     precedent for the nurse to judge, and is labelled as such in the UI.
 */
export function findSimilarEncounters(
  current: Partial<Encounter> & { age?: number },
  corpus: Encounter[],
  patients: Patient[],
  limit = 3
): SimilarCase[] {
  const currentSymptoms = new Set((current.symptoms ?? []).map((s) => s.toLowerCase()));
  const currentText = ((current.primaryConcern ?? "") + " " + (current.freeText ?? "")).toLowerCase();
  const currentCats = new Set((current.patientCategories ?? []).map((c) => c.toLowerCase()));

  const scored = corpus
    .filter((e) => e.id !== current.id)
    .map((e) => {
      const shared: string[] = [];
      let score = 0;

      for (const s of e.symptoms) {
        if (currentSymptoms.has(s.toLowerCase())) {
          score += 3;
          shared.push(s);
        }
      }
      for (const c of e.patientCategories) {
        if (currentCats.has(c.toLowerCase())) {
          score += 2;
          shared.push(c);
        }
      }
      // Token overlap on the narrative, ignoring short filler words.
      const words = new Set(
        ((e.primaryConcern ?? "") + " " + (e.freeText ?? "")).toLowerCase().split(/\W+/).filter((w) => w.length > 4)
      );
      for (const w of words) if (currentText.includes(w)) score += 1;

      const patient = patients.find((p) => p.id === e.patientId);
      if (patient && current.age != null && Math.abs(patient.age - current.age) <= 10) score += 2;

      return { encounter: e, patientName: patient?.name ?? "Unknown", score, sharedSignals: [...new Set(shared)] };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

// =========================================================================
// 6. HOLISTIC FINAL ANALYSIS
// =========================================================================

export type HolisticAnalysis = {
  overallAssessment: string;
  agreesWithRouting: boolean;
  riskssMissedByRules: string[];
  atypicalPresentationWarning?: string;
  precedentInsight?: string;
  recommendedNextActions: string[];
  confidenceInAssessment: "high" | "moderate" | "low";
  confidenceRationale: string;
};

/**
 * The final "think about the whole situation" pass. Runs after the rule engine
 * has already produced its recommendation, sees everything (patient, vitals,
 * prior record, hospital state, similar past cases), and gives the nurse a
 * holistic read. Advisory only — cannot change level or pathway.
 */
export async function analyzeHolistic(args: {
  encounter: Encounter;
  patient: Patient;
  recommendation: Recommendation;
  priorAnalysis?: PriorRecordAnalysis | null;
  similarCases?: SimilarCase[];
  hospitalContext: string;
}): Promise<HolisticAnalysis | null> {
  if (!isAiConfigured()) return null;
  const { encounter, patient, recommendation, priorAnalysis, similarCases, hospitalContext } = args;

  const system = holisticPrompt();

  const tool = {
    name: "record_holistic",
    description: "Record the holistic situational assessment.",
    input_schema: {
      type: "object",
      properties: {
        overallAssessment: { type: "string", description: "Under 70 words on the whole situation." },
        agreesWithRouting: { type: "boolean" },
        riskssMissedByRules: { type: "array", items: { type: "string" }, description: "Risks the keyword rules may not have captured." },
        atypicalPresentationWarning: { type: ["string", "null"], description: "Set if this patient could be presenting atypically for a serious condition." },
        precedentInsight: { type: ["string", "null"], description: "Anything useful from the similar past cases." },
        recommendedNextActions: { type: "array", items: { type: "string" }, description: "Concrete next steps for the nurse." },
        confidenceInAssessment: { type: "string", enum: ["high", "moderate", "low"] },
        confidenceRationale: { type: "string", description: "Under 25 words on why that confidence." },
      },
      required: ["overallAssessment", "agreesWithRouting", "riskssMissedByRules", "recommendedNextActions", "confidenceInAssessment", "confidenceRationale"],
    },
  };

  const v = encounter.vitals;
  const userText = [
    "PATIENT",
    patient.age + "y " + patient.sex + " | categories: " + (encounter.patientCategories.join(", ") || "none"),
    "Primary concern: " + (encounter.primaryConcern || "-"),
    "Symptoms: " + (encounter.symptoms.join(", ") || "-"),
    "Narrative: " + (encounter.freeText || "-"),
    "Onset: " + (encounter.onset || "-") + " | Duration: " + (encounter.duration || "-") + " | Trend: " + encounter.trend,
    "Severity: " + encounter.reportedSeverity + "/10 | Source: " + encounter.speakerSource,
    "Vitals: HR " + (v.pulse ?? "-") + ", BP " + (v.bpSystolic ?? "-") + "/" + (v.bpDiastolic ?? "-") + ", SpO2 " + (v.spo2 ?? "-") + ", Temp " + (v.temperature ?? "-") + ", RR " + (v.respiratoryRate ?? "-") + ", consciousness " + v.consciousness,
    "History: " + encounter.history.conditions + " | Meds: " + encounter.history.medications + " | Allergies: " + encounter.history.allergies,
    "Observations: " + (encounter.observations.join(", ") || "-"),
    "",
    "PRIOR RECORD",
    priorAnalysis ? priorAnalysis.summary + (priorAnalysis.isRepresentation ? " [RE-PRESENTATION]" : "") : "None on file.",
    "",
    "RULE ENGINE DECIDED (cannot be changed)",
    recommendation.label + " -> " + recommendation.pathway,
    "Reasons: " + recommendation.reasons.join("; "),
    "Missing: " + (recommendation.missingInfo.join("; ") || "none"),
    "",
    "SIMILAR PAST CASES (synthetic, illustrative only)",
    similarCases?.length
      ? similarCases.map((c) => `- ${c.patientName}: ${c.encounter.primaryConcern} -> ${c.encounter.recommendation.label} (${c.encounter.currentPathway}); shared: ${c.sharedSignals.join(", ") || "narrative overlap"}`).join("\n")
      : "None comparable.",
    "",
    "HOSPITAL STATE",
    hospitalContext,
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;
  const conf = out.confidenceInAssessment;
  return {
    overallAssessment: typeof out.overallAssessment === "string" ? out.overallAssessment : "",
    agreesWithRouting: out.agreesWithRouting !== false,
    riskssMissedByRules: Array.isArray(out.riskssMissedByRules) ? (out.riskssMissedByRules as string[]) : [],
    atypicalPresentationWarning: typeof out.atypicalPresentationWarning === "string" ? out.atypicalPresentationWarning : undefined,
    precedentInsight: typeof out.precedentInsight === "string" ? out.precedentInsight : undefined,
    recommendedNextActions: Array.isArray(out.recommendedNextActions) ? (out.recommendedNextActions as string[]) : [],
    confidenceInAssessment: conf === "high" || conf === "low" ? conf : "moderate",
    confidenceRationale: typeof out.confidenceRationale === "string" ? out.confidenceRationale : "",
  };
}

// =========================================================================
// 7. REASSESSMENT ANALYSIS
// =========================================================================

export type ReassessmentAnalysis = {
  meaningfulChange: boolean;
  changeSummary: string;
  deteriorationSignals: string[];
  recommendEscalation: boolean;
  suggestedAction: string;
};

/**
 * Compare a patient's state before and after new information arrives, and say
 * whether the change is clinically meaningful. This is what stops the queue
 * monitor from generating noise: not every new observation matters.
 */
export async function analyzeReassessment(
  encounter: Encounter,
  previousVitals: Vitals,
  previousLevel: number,
  newObservation: string
): Promise<ReassessmentAnalysis | null> {
  if (!isAiConfigured()) return null;

  const system = reassessmentPrompt();

  const tool = {
    name: "record_reassessment",
    description: "Record whether the patient's change is clinically meaningful.",
    input_schema: {
      type: "object",
      properties: {
        meaningfulChange: { type: "boolean" },
        changeSummary: { type: "string", description: "Under 40 words." },
        deteriorationSignals: { type: "array", items: { type: "string" } },
        recommendEscalation: { type: "boolean" },
        suggestedAction: { type: "string", description: "Concrete next step for the nurse." },
      },
      required: ["meaningfulChange", "changeSummary", "deteriorationSignals", "recommendEscalation", "suggestedAction"],
    },
  };

  const v = encounter.vitals;
  const fmt = (x: Vitals) => `HR ${x.pulse ?? "-"}, BP ${x.bpSystolic ?? "-"}/${x.bpDiastolic ?? "-"}, SpO2 ${x.spo2 ?? "-"}, Temp ${x.temperature ?? "-"}, RR ${x.respiratoryRate ?? "-"}, consciousness ${x.consciousness}`;

  const userText = [
    "PATIENT: " + (encounter.patientCategories.join(", ") || "adult") + ", waiting " + encounter.waitingMins + " minutes",
    "Presenting: " + (encounter.primaryConcern || "-") + " | " + (encounter.symptoms.join(", ") || "-"),
    "",
    "AT TRIAGE (Level " + previousLevel + "): " + fmt(previousVitals),
    "NOW (Level " + encounter.recommendation.level + "): " + fmt(v),
    "Trend reported: " + encounter.trend,
    "",
    "NEW OBSERVATION",
    newObservation || "(none provided)",
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;
  return {
    meaningfulChange: out.meaningfulChange === true,
    changeSummary: typeof out.changeSummary === "string" ? out.changeSummary : "",
    deteriorationSignals: Array.isArray(out.deteriorationSignals) ? (out.deteriorationSignals as string[]) : [],
    recommendEscalation: out.recommendEscalation === true,
    suggestedAction: typeof out.suggestedAction === "string" ? out.suggestedAction : "",
  };
}

/** Which provider/model is doing the clinical reasoning, for UI display. */
export function clinicalAiStatus(): { provider: string; stt: boolean } {
  return { provider: aiProvider(), stt: isSttConfigured() };
}

// =========================================================================
// 8. DYNAMIC RISK SCREENING (replaces the hardcoded per-symptom checklist)
// =========================================================================

export type RiskScreening = {
  questions: { key: string; question: string; probes: string; critical: boolean }[];
  rationale: string;
};

/**
 * Generate risk-screening questions specific to what THIS patient described.
 *
 * Replaces a static map of symptom -> fixed question list, which could only
 * respond to the ~10 symptoms it had entries for and asked identical questions
 * regardless of age, sex, history, or how the complaint was actually described.
 * A 70-year-old diabetic with chest pain and a 25-year-old with the same chip
 * selected received exactly the same four questions.
 */
export async function generateRiskScreening(
  partial: Partial<Encounter> & { age?: number; sex?: string }
): Promise<RiskScreening | null> {
  if (!isAiConfigured()) return null;

  const system = riskScreeningPrompt();

  const tool = {
    name: "record_risk_screening",
    description: "Record risk-screening questions tailored to this presentation.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Short snake_case identifier, unique within this set." },
              question: { type: "string", description: "Plain language, answerable Yes/No/Unsure." },
              probes: { type: "string", description: "The condition this helps rule in or out, as readable prose for a nurse — for example 'Acute coronary syndrome' or 'Pulmonary embolism'. Never snake_case or an identifier." },
              critical: { type: "boolean", description: "True if a Yes would materially change routing." },
            },
            required: ["key", "question", "probes", "critical"],
          },
        },
        rationale: { type: "string", description: "Under 30 words on why this question set for this patient." },
      },
      required: ["questions", "rationale"],
    },
  };

  const userText = [
    "PATIENT",
    "Age: " + (partial.age ?? "unknown") + " | Sex: " + (partial.sex ?? "unknown"),
    "Categories: " + (partial.patientCategories?.join(", ") || "none recorded"),
    "Primary concern: " + (partial.primaryConcern || "-"),
    "Symptoms: " + (partial.symptoms?.join(", ") || "-"),
    "Narrative: " + (partial.freeText || "-"),
    "Onset: " + (partial.onset || "unknown") + " | Duration: " + (partial.duration || "unknown"),
    "Known history: " + (partial.history?.conditions ?? "unknown"),
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;
  return {
    questions: Array.isArray(out.questions) ? (out.questions as RiskScreening["questions"]) : [],
    rationale: typeof out.rationale === "string" ? out.rationale : "",
  };
}
