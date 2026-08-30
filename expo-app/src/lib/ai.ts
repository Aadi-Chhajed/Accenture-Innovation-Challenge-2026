import type { Encounter, Recommendation } from "./types";
import { symptomOptions } from "./pathways";

// ---------------------------------------------------------------------------
// Real LLM layer. Supports Groq (OpenAI-compatible), Google Gemini
// (generateContent + responseSchema), and Anthropic (Messages API + tool use),
// selected by whichever key is present.
//
// DESIGN CONTRACT — read before changing:
//   1. This layer is ADDITIVE. The deterministic rule engine in routing.ts stays
//      the source of truth for urgency level and pathway. Per the product spec
//      ("Rule engine + AI model"), an LLM must not directly control routing.
//   2. Every function here fails SOFT: no key, no network, bad JSON, timeout →
//      returns null and the app continues on rules alone (spec: graceful
//      degradation — the system must never become unusable because one data
//      source failed).
//   3. Nothing here blocks the first recommendation. Callers show the rule-based
//      result immediately, then enrich (spec: progressive enrichment).
//
// SECURITY: EXPO_PUBLIC_* values are embedded in the JS bundle, so any key set
// here is readable by anyone who has the app. Acceptable for a local
// prototype/demo ONLY. For any real deployment, proxy these calls through a
// backend that holds the key server-side and never ship it to the device.
// ---------------------------------------------------------------------------

const ANTHROPIC_KEY = (process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? "").trim();
const GEMINI_KEY = (process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "").trim();
const GROQ_KEY = (process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "").trim();
const ANTHROPIC_MODEL = process.env.EXPO_PUBLIC_ANTHROPIC_MODEL ?? "claude-sonnet-5";
const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? "gemini-2.0-flash";
const GROQ_MODEL = process.env.EXPO_PUBLIC_GROQ_MODEL ?? "openai/gpt-oss-120b";
const TIMEOUT_MS = 20000;

export type AiProvider = "groq" | "anthropic" | "gemini" | "none";

/**
 * Provider resolution: an explicit EXPO_PUBLIC_AI_PROVIDER wins, otherwise
 * whichever key is present. Groq is preferred when multiple keys are set
 * because it has the lowest latency for real-time triage demos.
 */
export function aiProvider(): AiProvider {
  const forced = (process.env.EXPO_PUBLIC_AI_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "groq" && GROQ_KEY) return "groq";
  if (forced === "anthropic" && ANTHROPIC_KEY) return "anthropic";
  if (forced === "gemini" && GEMINI_KEY) return "gemini";
  if (GROQ_KEY) return "groq";
  if (GEMINI_KEY) return "gemini";
  if (ANTHROPIC_KEY) return "anthropic";
  return "none";
}

export function isAiConfigured(): boolean {
  return aiProvider() !== "none";
}

/** Human-readable model label for the UI. */
export function aiModelLabel(): string {
  const p = aiProvider();
  if (p === "groq") return `Groq ${GROQ_MODEL}`;
  if (p === "gemini") return GEMINI_MODEL;
  if (p === "anthropic") return ANTHROPIC_MODEL;
  return "not configured";
}

/**
 * Gemini's responseSchema accepts an OpenAPI subset: types are upper-case and
 * validation keywords like minimum/maximum are rejected, so translate rather
 * than passing the Anthropic tool schema through untouched.
 */
type JsonSchema = Record<string, unknown>;
function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  if (typeof schema.type === "string") out.type = schema.type.toUpperCase();
  if (typeof schema.description === "string") out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items as JsonSchema);
  if (schema.properties) {
    const props: JsonSchema = {};
    for (const [k, v] of Object.entries(schema.properties as Record<string, JsonSchema>)) {
      props[k] = toGeminiSchema(v);
    }
    out.properties = props;
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  return out;
}

export type AiExtraction = {
  symptoms: string[];
  primaryConcern?: string;
  onset?: string;
  duration?: string;
  reportedSeverity?: number;
  trend?: Encounter["trend"];
  age?: number;
  sex?: "Female" | "Male" | "Other";
  speakerSource?: Encounter["speakerSource"];
  medicalHistory?: string;
  medications?: string;
  allergies?: string;
  missingCriticalInfo: string[];
  followUpQuestions: string[];
  contradictions: string[];
  notes?: string;
};

async function callModel(
  system: string,
  userText: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> }
): Promise<Record<string, unknown> | null> {
  const provider = aiProvider();
  if (provider === "none") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // ---- Groq (OpenAI-compatible chat completions with tool calling) --------
    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.2,
          max_tokens: 1200,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userText },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: tool.name } },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn("[ai/groq] request failed " + res.status + ": " + (await res.text().catch(() => "")));
        return null;
      }
      const json = (await res.json()) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              function?: { arguments?: string };
            }>;
          };
        }>;
      };
      const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) return null;
      try {
        return JSON.parse(args) as Record<string, unknown>;
      } catch {
        console.warn("[ai/groq] tool call arguments were not valid JSON");
        return null;
      }
    }

    // ---- Gemini (generateContent + responseSchema) -------------------------
    if (provider === "gemini") {
      // Key goes in a header, never a query string.
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: userText }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(tool.input_schema),
              temperature: 0.2,
            },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        console.warn("[ai/gemini] request failed " + res.status + ": " + (await res.text().catch(() => "")));
        return null;
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        console.warn("[ai/gemini] response was not valid JSON");
        return null;
      }
    }

    // ---- Anthropic (Messages API + tool use) --------------------------------
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: userText }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[ai/anthropic] request failed " + res.status + ": " + (await res.text().catch(() => "")));
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; input?: Record<string, unknown> }> };
    return json.content?.find((b) => b.type === "tool_use")?.input ?? null;
  } catch (err) {
    console.warn("[ai] call failed, falling back to rules:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a free-text / voice-transcript narrative into structured intake fields.
 * Returns null on any failure so the caller keeps whatever the nurse typed.
 */
export async function extractFromNarrative(
  narrative: string,
  language: string,
  speakerHint?: string
): Promise<AiExtraction | null> {
  if (!narrative.trim()) return null;

  const system = [
    "You extract structured triage-intake fields from what a patient, family member, or nurse said in an emergency department.",
    "You are a data-extraction step in a ROUTING support tool. You do NOT diagnose and you do NOT assign urgency.",
    "Extract only what is actually stated or clearly implied. Never invent vitals, history, or timings.",
    "If something important for routing was not said, list it in missingCriticalInfo and propose a short targeted question in followUpQuestions.",
    "If the narrative contradicts itself, record it in contradictions rather than silently picking one side.",
    "The narrative may be in " + language + ", including Hinglish or mixed script. Return field VALUES in English.",
    "When mapping symptoms, prefer these exact labels where they fit: " + symptomOptions.join("; ") + ".",
  ].join(" ");

  const tool = {
    name: "record_intake",
    description: "Record the structured intake fields extracted from the narrative.",
    input_schema: {
      type: "object",
      properties: {
        symptoms: { type: "array", items: { type: "string" }, description: "Observed/reported symptoms, using the preferred labels when they fit." },
        primaryConcern: { type: ["string", "null"], description: "One short line summarising why they came in." },
        onset: { type: ["string", "null"], description: "When it started, as stated (e.g. this afternoon)." },
        duration: { type: ["string", "null"], description: "How long it has lasted, as stated." },
        reportedSeverity: { type: ["integer", "null"], minimum: 1, maximum: 10, description: "Only if the speaker indicated severity." },
        trend: { type: ["string", "null"], enum: ["Worsening", "Stable", "Improving", "Unknown", null] },
        age: { type: ["integer", "null"], description: "Patient age if stated." },
        sex: { type: ["string", "null"], enum: ["Female", "Male", "Other", null] },
        speakerSource: { type: ["string", "null"], enum: ["Patient", "Family", "Caregiver", "Ambulance staff", "Registration staff", null] },
        medicalHistory: { type: ["string", "null"], description: "Known conditions mentioned." },
        medications: { type: ["string", "null"], description: "Medications mentioned." },
        allergies: { type: ["string", "null"], description: "Allergies mentioned." },
        missingCriticalInfo: { type: "array", items: { type: "string" }, description: "Routing-relevant facts that were NOT stated." },
        followUpQuestions: { type: "array", items: { type: "string" }, description: "Up to 4 short questions the nurse should ask next." },
        contradictions: { type: "array", items: { type: "string" }, description: "Conflicting statements within the narrative." },
        notes: { type: ["string", "null"], description: "Brief context worth surfacing, e.g. communication difficulty." },
      },
      required: ["symptoms", "missingCriticalInfo", "followUpQuestions", "contradictions"],
    },
  };

  const userText = [
    speakerHint ? "Information provided by: " + speakerHint : null,
    "Language: " + language,
    "",
    "Narrative:",
    narrative,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;

  const trendValues = ["Worsening", "Stable", "Improving", "Unknown"];
  const sexValues = ["Female", "Male", "Other"];
  const speakerValues = ["Patient", "Family", "Caregiver", "Ambulance staff", "Registration staff"];

  return {
    symptoms: Array.isArray(out.symptoms) ? (out.symptoms as string[]) : [],
    primaryConcern: typeof out.primaryConcern === "string" ? out.primaryConcern : undefined,
    onset: typeof out.onset === "string" ? out.onset : undefined,
    duration: typeof out.duration === "string" ? out.duration : undefined,
    reportedSeverity: typeof out.reportedSeverity === "number" ? out.reportedSeverity : undefined,
    trend: trendValues.includes(out.trend as string) ? (out.trend as Encounter["trend"]) : undefined,
    age: typeof out.age === "number" ? out.age : undefined,
    sex: sexValues.includes(out.sex as string) ? (out.sex as "Female" | "Male" | "Other") : undefined,
    speakerSource: speakerValues.includes(out.speakerSource as string) ? (out.speakerSource as Encounter["speakerSource"]) : undefined,
    medicalHistory: typeof out.medicalHistory === "string" ? out.medicalHistory : undefined,
    medications: typeof out.medications === "string" ? out.medications : undefined,
    allergies: typeof out.allergies === "string" ? out.allergies : undefined,
    missingCriticalInfo: Array.isArray(out.missingCriticalInfo) ? (out.missingCriticalInfo as string[]) : [],
    followUpQuestions: Array.isArray(out.followUpQuestions) ? (out.followUpQuestions as string[]) : [],
    contradictions: Array.isArray(out.contradictions) ? (out.contradictions as string[]) : [],
    notes: typeof out.notes === "string" ? out.notes : undefined,
  };
}

export type AiReview = {
  concurs: boolean;
  narrative: string;
  additionalConsiderations: string[];
  suggestedQuestions: string[];
};

/**
 * Second-opinion review of the rule engine's output. Advisory only: it may
 * disagree, and that disagreement is surfaced to the nurse — it never mutates
 * the level or pathway itself.
 */
export async function reviewRecommendation(
  encounter: Encounter,
  rec: Recommendation,
  hospitalContext: string
): Promise<AiReview | null> {
  const system = [
    "You review an emergency-department ROUTING recommendation produced by a deterministic rule engine.",
    "You are decision support for a triage nurse. You do not diagnose and you cannot change the routing.",
    "Judge only whether the routing and urgency look reasonable given the recorded information and the hospital's current state.",
    "Be explicit about what is missing or uncertain. Prefer flagging under-triage risk over false reassurance.",
    "Keep the narrative under 60 words, plain and clinical, no hedging filler.",
  ].join(" ");

  const tool = {
    name: "record_review",
    description: "Record the advisory review of the routing recommendation.",
    input_schema: {
      type: "object",
      properties: {
        concurs: { type: "boolean", description: "True if the recommendation looks reasonable as-is." },
        narrative: { type: "string", description: "Under 60 words explaining the view." },
        additionalConsiderations: { type: "array", items: { type: "string" }, description: "Risks or factors the rules may not have captured." },
        suggestedQuestions: { type: "array", items: { type: "string" }, description: "Up to 3 questions that would most reduce uncertainty." },
      },
      required: ["concurs", "narrative", "additionalConsiderations", "suggestedQuestions"],
    },
  };

  const v = encounter.vitals;
  const userText = [
    "PATIENT",
    "Categories: " + (encounter.patientCategories.join(", ") || "unspecified"),
    "Primary concern: " + (encounter.primaryConcern || "-"),
    "Symptoms: " + (encounter.symptoms.join(", ") || "-"),
    "Narrative: " + (encounter.freeText || "-"),
    "Onset: " + (encounter.onset || "-") + " | Duration: " + (encounter.duration || "-") + " | Trend: " + encounter.trend,
    "Reported severity: " + encounter.reportedSeverity + "/10",
    "Information source: " + encounter.speakerSource,
    "Vitals: HR " + (v.pulse ?? "-") + ", BP " + (v.bpSystolic ?? "-") + "/" + (v.bpDiastolic ?? "-") + ", SpO2 " + (v.spo2 ?? "-") + ", Temp " + (v.temperature ?? "-") + ", RR " + (v.respiratoryRate ?? "-") + ", consciousness " + v.consciousness,
    "History: " + encounter.history.conditions + " | Meds: " + encounter.history.medications + " | Allergies: " + encounter.history.allergies,
    "Nurse observations: " + (encounter.observations.join(", ") || "-"),
    "",
    "RULE ENGINE OUTPUT",
    rec.label + " -> " + rec.pathway + " (" + rec.destination + "), est. wait " + rec.estimatedWait + " min",
    "Reasons: " + rec.reasons.join("; "),
    "Missing: " + (rec.missingInfo.join("; ") || "none"),
    "Uncertainty: " + (rec.uncertainty.join("; ") || "none"),
    "",
    "HOSPITAL STATE",
    hospitalContext,
  ].join("\n");

  const out = await callModel(system, userText, tool);
  if (!out) return null;

  return {
    concurs: out.concurs !== false,
    narrative: typeof out.narrative === "string" ? out.narrative : "",
    additionalConsiderations: Array.isArray(out.additionalConsiderations) ? (out.additionalConsiderations as string[]) : [],
    suggestedQuestions: Array.isArray(out.suggestedQuestions) ? (out.suggestedQuestions as string[]) : [],
  };
}
