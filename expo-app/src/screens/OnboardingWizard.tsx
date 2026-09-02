import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Alert as RNAlert,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { TopAppBar } from "../components/TopAppBar";
import { useAppState } from "../lib/store";
import { symptomOptions } from "../lib/pathways";
import { extractFromNarrative, isAiConfigured, aiModelLabel, type AiExtraction } from "../lib/ai";
import { VoiceCapture } from "../components/VoiceCapture";
import { generateRiskScreening, generateNextQuestions, planVitals, type RiskScreening, type NextQuestions, type VitalsPlan } from "../lib/aiClinical";
import type { DraftEncounter, Encounter, Patient, Sex, Vitals } from "../lib/types";

export type WizardData = Partial<Encounter> & {
  patientName?: string;
  age?: number;
  sex?: Patient["sex"];
  previousRecord?: Patient["previousRecord"];
  photoUri?: string;
  injuryPhotoUri?: string;
  /** Answered AI follow-up questions. Folded into freeText on completion so the
   *  routing engine and every downstream AI call see the answers too. */
  conversation?: { q: string; a: string; why?: string }[];
};

// Six steps, not eight. Published ED triage research puts the median nurse
// triage encounter at ~2.6 minutes with 98% completed inside 5; an eight-screen
// questionnaire cannot fit that budget, and a form nurses skip protects nobody.
// Arrival and information-source merged (both are context, one tap each), and
// onset/trend merged into the chief-concern step where the answers are already
// being discussed. Nothing captured was dropped — only the screen count.
const TOTAL_STEPS = 6;

// Evidence-based target for the whole intake. Shown live so the constraint is
// visible rather than aspirational.
const INTAKE_BUDGET_SECONDS = 300;

// Maps the vital keys the model returns onto the labels shown on screen.
const VITAL_LABELS: Record<string, string> = {
  temperature: "Temperature",
  pulse: "Pulse",
  spo2: "SpO2",
  respiratoryRate: "Respiratory rate",
  bpSystolic: "BP systolic",
  bpDiastolic: "BP diastolic",
  painScore: "Pain score",
  bloodSugar: "Blood sugar",
  consciousness: "Consciousness",
};
const stepTitles = [
  "Arrival & source",
  "Patient basics",
  "Chief concern",
  "Risk screening",
  "Medical history",
  "Vitals & observations",
];

const arrivalOptions: { value: Encounter["arrivalMode"]; label: string; desc: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: "Walk-in", label: "Walk-in", desc: "Arrived independently or with family.", icon: "directions-walk" },
  { value: "Ambulance", label: "Ambulance", desc: "EMS transport, requires handover.", icon: "local-shipping" },
  { value: "Referral", label: "Referral", desc: "Transferred from another facility.", icon: "assignment-ind" },
  { value: "Pre-arrival call", label: "Pre-arrival call", desc: "Expected arrival logged by phone.", icon: "call" },
  // Real arrivals do not fit four boxes — police, inter-department transfer,
  // found collapsed on the premises. Forcing one of the four would record a
  // fact that is simply false.
  { value: "Other", label: "Other", desc: "Police, inter-department transfer, or anything else.", icon: "more-horiz" },
];

// ---------------------------------------------------------------------------
// GATE 0 — direct-to-resuscitation bypass
// ---------------------------------------------------------------------------
// Some patients are visibly dying on arrival. Making the nurse complete a
// questionnaire first is the one design failure a triage tool cannot recover
// from, so this exits the wizard immediately at Level 1 and documents itself
// afterwards. Reasons are the recognised immediate-threat categories.
const GATE0_REASONS = [
  "Unresponsive / cannot be woken",
  "Not breathing, gasping, or choking",
  "Severe uncontrolled bleeding",
  "Active seizure",
  "Obvious major trauma",
  "Visibly critical — other",
];

// Sex is recorded because physiology differs where the rules read it — women
// over 45 sit in the atypical-ACS risk group, pregnancy has its own pathway.
// "Unknown" is a legitimate answer for an unconscious patient and must never be
// forced to a guess; "Prefer not to say" respects the patient without inventing
// a value the engine would then act on.
const sexOptions: Sex[] = ["Female", "Male", "Intersex", "Other", "Unknown", "Prefer not to say"];

// Age groups (Infant / Child / Adult / Geriatric) are DERIVED from the age
// field, not picked here — asking a nurse to re-state what they just typed
// invited disagreement between the two, and the engine reads the category. What
// is left are genuine clinical modifiers that age cannot imply.
const categoryOptions = [
  "Pregnant patient",
  "Postpartum (<6 weeks)",
  "Unconscious/unresponsive",
  "Communication-impaired",
  "Medico-legal/accident case",
  "Diabetic",
  "Immunocompromised",
  "Frail / bedbound",
  "Recent surgery (<30 days)",
  "Mental health crisis",
  "Substance intoxication",
];

// Derived, shown read-only next to the manual modifiers so the nurse can see
// what the engine will apply.
function derivedCategory(age?: number): string | null {
  if (age == null || age < 0) return null;
  if (age < 2) return "Infant";
  if (age < 13) return "Child";
  if (age >= 65) return "Geriatric";
  return "Adult";
}

// ---------------------------------------------------------------------------
// MEDICAL HISTORY — categories to subcategories
// ---------------------------------------------------------------------------
// This was five free-text boxes and nobody filled them, which mattered because
// "Diabetes" here is what arms the atypical-presentation rule in the routing
// engine. Tapping is faster than typing under time pressure, and the free-text
// box stays for anything the list does not cover.
const HISTORY_GROUPS: { label: string; icon: keyof typeof MaterialIcons.glyphMap; items: string[] }[] = [
  { label: "Heart & circulation", icon: "favorite", items: ["Hypertension", "Heart disease / past MI", "Arrhythmia", "Heart failure", "Blood thinners"] },
  { label: "Diabetes & hormones", icon: "water-drop", items: ["Diabetes", "On insulin", "Thyroid disorder"] },
  { label: "Lungs", icon: "air", items: ["Asthma", "COPD", "Past TB", "Home oxygen"] },
  { label: "Brain & nerves", icon: "psychology", items: ["Past stroke / TIA", "Epilepsy", "Dementia"] },
  { label: "Kidney & liver", icon: "healing", items: ["Kidney disease", "On dialysis", "Liver disease"] },
  { label: "Other", icon: "more-horiz", items: ["Cancer", "Immunosuppressed", "Recent surgery", "Pregnancy"] },
];

const speakerOptions: Encounter["speakerSource"][] = ["Patient", "Family", "Caregiver", "Ambulance staff", "Registration staff"];
const languageOptions: Encounter["language"][] = ["English", "Hindi", "Hinglish", "Marathi", "Other"];
const communicationOptions = ["None", "Unable to speak", "Confused", "Hearing/speech limitation", "Language barrier"];

const voiceSamples: Record<string, string> = {
  English: "My father is 72. He has been having trouble breathing since this afternoon and there is heaviness in his chest. He takes blood pressure medicine.",
  Hindi: "मेरे पिता 72 साल के हैं। दोपहर से उन्हें सांस लेने में तकलीफ हो रही है और छाती में भारीपन है। वे बीपी की दवा लेते हैं।",
  Hinglish: "Mere papa 72 saal ke hain. Dopahar se saans lene mein takleef ho rahi hai aur chest mein heaviness hai. BP ki dawai lete hain.",
  Marathi: "माझे वडील ७२ वर्षांचे आहेत. दुपारपासून त्यांना श्वास घ्यायला त्रास होतोय आणि छातीत जडपणा आहे. ते बीपीचं औषध घेतात.",
  Other: "72-year-old father, breathing difficulty since afternoon with chest heaviness, on blood pressure medication.",
};

const riskQuestionSets: Record<string, { key: string; question: string }[]> = {
  "Chest discomfort": [
    { key: "chest_breathing", question: "Any breathing difficulty?" },
    { key: "chest_sweating", question: "Sweating or clammy skin?" },
    { key: "chest_radiation", question: "Pain radiating to arm/jaw?" },
    { key: "chest_fainting", question: "Any fainting or near-fainting?" },
  ],
  "Stroke-like symptoms": [
    { key: "stroke_face", question: "Facial drooping noticed?" },
    { key: "stroke_arm", question: "Arm weakness on one side?" },
    { key: "stroke_speech", question: "Slurred or abnormal speech?" },
    { key: "stroke_onset", question: "Exact time of onset known?" },
  ],
  "Injury / trauma": [
    { key: "trauma_bleeding", question: "Active bleeding?" },
    { key: "trauma_consciousness", question: "Loss of consciousness at any point?" },
    { key: "trauma_mechanism", question: "High-impact mechanism (fall, RTA)?" },
  ],
  "Fever / infection symptoms": [
    { key: "fever_lethargy", question: "Unusual lethargy or reduced activity?" },
    { key: "fever_rash", question: "Any rash present?" },
    { key: "fever_isolation", question: "Recent contact with infectious illness?" },
  ],
  "Breathing difficulty": [
    { key: "breath_speak", question: "Able to speak in full sentences?" },
    { key: "breath_distress", question: "Visible respiratory distress?" },
    { key: "breath_oxygen", question: "Currently on home oxygen support?" },
  ],
  "Allergic reaction": [
    { key: "allergy_swelling", question: "Facial/throat swelling?" },
    { key: "allergy_breathing", question: "Any breathing involvement?" },
    { key: "allergy_trigger", question: "Known trigger identified?" },
  ],
  "Pregnancy-related concern": [
    { key: "preg_bleeding", question: "Any vaginal bleeding?" },
    { key: "preg_pain", question: "Severe abdominal pain?" },
    { key: "preg_movement", question: "Normal fetal movement felt?" },
  ],
  "Mental health concern": [
    { key: "mh_selfharm", question: "Any risk of self-harm?" },
    { key: "mh_agitation", question: "Currently agitated or distressed?" },
    { key: "mh_support", question: "Support person present?" },
  ],
  Bleeding: [
    { key: "bleed_control", question: "Is bleeding controlled with pressure?" },
    { key: "bleed_amount", question: "Heavy or continuous blood loss?" },
  ],
  Burn: [
    { key: "burn_airway", question: "Any facial or airway involvement?" },
    { key: "burn_extent", question: "Larger than the patient's palm?" },
  ],
};

function SelectCard({
  selected,
  icon,
  label,
  desc,
  onPress,
}: {
  selected: boolean;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`flex-row items-center p-4 rounded-xl border min-h-touch-target-min ${
        selected ? "border-2 border-primary bg-primary-fixed-dim/20" : "border-outline-variant bg-surface-container-lowest"
      }`}
    >
      <View className={`w-10 h-10 rounded-full items-center justify-center ${selected ? "bg-primary-fixed-dim/40" : "bg-surface-container"}`}>
        <MaterialIcons name={icon} size={20} color={selected ? "#3525cd" : "#565e74"} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-headline-md text-headline-md text-on-surface">{label}</Text>
        <Text className="font-body-md text-body-md text-on-surface-variant mt-0.5">{desc}</Text>
      </View>
      {selected && <MaterialIcons name="check-circle" size={20} color="#3525cd" />}
    </Pressable>
  );
}

function Chip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`px-3 min-h-[44px] justify-center rounded-lg border mb-2 ${
        selected ? "border-primary bg-primary-fixed-dim/20" : "border-outline-variant bg-surface-container-lowest"
      }`}
    >
      <Text className={`font-body-md text-body-md ${selected ? "text-primary" : "text-on-surface"}`}>{label}</Text>
    </Pressable>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text className="font-label-caps text-label-caps text-on-surface mb-1.5">{children}</Text>;
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 gap-stack-gap">{children}</View>;
}

function TextField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "numeric" | "default";
}) {
  return (
    <TextInput
      className="bg-surface-container-low rounded-lg px-3 h-touch-target-min font-body-lg text-body-lg text-on-surface"
      placeholder={placeholder}
      placeholderTextColor="#777587"
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      returnKeyType="done"
    />
  );
}

function VitalRow({
  label,
  value,
  unavailable,
  onChangeValue,
  onToggleUnavailable,
}: {
  label: string;
  value: string;
  unavailable: boolean;
  onChangeValue: (v: string) => void;
  onToggleUnavailable: () => void;
}) {
  return (
    <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 gap-2 flex-1 min-w-[46%] mb-3">
      <FieldLabel>{label}</FieldLabel>
      {unavailable ? (
        <View className="h-touch-target-min justify-center px-3 bg-surface-container rounded-lg">
          <Text className="font-body-md text-body-md text-on-surface-variant italic">Not available</Text>
        </View>
      ) : (
        <TextField value={value} onChangeText={onChangeValue} placeholder="—" keyboardType="numeric" />
      )}
      <Pressable onPress={onToggleUnavailable} hitSlop={8} className="min-h-[28px] justify-center">
        <Text className={`font-helper-text text-helper-text ${unavailable ? "text-primary" : "text-on-surface-variant"}`}>
          {unavailable ? "↩ Mark available" : "Not available yet"}
        </Text>
      </Pressable>
    </View>
  );
}

export function OnboardingWizard({
  initialDraft,
  onExit,
  onComplete,
  onSaveDraft,
}: {
  initialDraft?: DraftEncounter;
  onExit: () => void;
  onComplete: (data: WizardData) => void;
  onSaveDraft: (draftId: string | undefined, step: number, data: WizardData) => void;
}) {
  // Clamped: drafts saved under the old 8-step numbering are still in
  // AsyncStorage and would resume past the end of the wizard.
  const [step, setStep] = useState(Math.min(TOTAL_STEPS, Math.max(1, initialDraft?.currentStage || 1)));
  const [data, setData] = useState<WizardData>(
    initialDraft
      ? { patientName: initialDraft.patientName, age: initialDraft.age, ...initialDraft.data }
      : { symptoms: [], communicationLimitations: [], patientCategories: [], riskAnswers: {}, observations: [] }
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<AiExtraction | null>(null);
  const [riskScreen, setRiskScreen] = useState<RiskScreening | null>(null);
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskFor, setRiskFor] = useState<string>("");
  const [convo, setConvo] = useState<NextQuestions | null>(null);
  const [convoBusy, setConvoBusy] = useState(false);
  const [vitalsPlan, setVitalsPlan] = useState<VitalsPlan | null>(null);
  const [vitalsPlanFor, setVitalsPlanFor] = useState<string>("");
  const [gate0Open, setGate0Open] = useState(false);
  const [gate0Reason, setGate0Reason] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const draftId = initialDraft?.id;
  const nurse = useAppState().nurseSession;

  // Elapsed intake time against the 5-minute budget. Shown, not enforced — a
  // timer that blocked the nurse would be worse than the problem it measures.
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  /** Gate 0: leave immediately at Level 1 with whatever is already recorded.
   *
   *  Confirmation is a second tap inside the panel, NOT a system dialog.
   *  `Alert.alert` with multiple buttons is a no-op on React Native Web, so the
   *  most safety-critical control in the app did nothing at all there — and a
   *  control whose behaviour depends on the platform is not one to trust in an
   *  emergency. Two taps in-app is also faster than a modal. */
  function confirmGate0() {
    if (!gate0Reason) return;
    onComplete({
      ...data,
      patientName: data.patientName || "UNIDENTIFIED PATIENT",
      nurseCriticalOverride: {
        reason: gate0Reason,
        nurseId: nurse?.name || nurse?.rollNumber || "Triage Nurse",
        at: new Date().toISOString(),
      },
    });
  }

  function update(patch: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...patch }));
  }

  const completionPct = Math.round((step / TOTAL_STEPS) * 100);

  function saveDraftAndExit() {
    onSaveDraft(draftId, step, data);
    onExit();
  }

  function goNext() {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }
    // Fold answered questions into the narrative. Without this the routing
    // engine never sees them — it only reads freeText/symptoms/observations,
    // so an answer like "pain radiates to the arm" would be captured on screen
    // but have no effect on the recommendation.
    const answered = data.conversation ?? [];
    const merged = answered.length
      ? [data.freeText ?? "", ...answered.map((c) => `${c.q} ${c.a}.`)].filter(Boolean).join(" ")
      : data.freeText;
    onComplete({ ...data, freeText: merged });
  }

  function goBack() {
    if (step === 1) onExit();
    else setStep(step - 1);
  }

  async function pickPhoto(kind: "patient" | "injury") {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      let result;
      if (perm.granted) {
        result = await ImagePicker.launchCameraAsync({ quality: 0.5, allowsEditing: true, aspect: [1, 1] });
      } else {
        const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!lib.granted) {
          RNAlert.alert("Permission needed", "Camera and photo access were both declined, so no image can be attached.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, allowsEditing: true, aspect: [1, 1] });
      }
      if (!result.canceled && result.assets?.[0]?.uri) {
        const uri = result.assets[0].uri;
        update(kind === "patient" ? { photoUri: uri } : { injuryPhotoUri: uri, photoAttached: true });
      }
    } catch (err) {
      RNAlert.alert("Camera unavailable", "Could not open the camera. Intake continues without a photo.");
      console.warn("[photo]", err);
    }
  }

  // Composite narrative: what was said PLUS anything already answered, so each
  // round of questions builds on the last instead of restarting.
  function narrativeWithAnswers(): string {
    const answered = data.conversation ?? [];
    return [data.freeText ?? "", ...answered.map((c) => `${c.q} ${c.a}.`)].filter(Boolean).join(" ");
  }

  async function askNextQuestions() {
    const narrative = narrativeWithAnswers();
    if (!narrative.trim()) {
      RNAlert.alert("Nothing to work with yet", "Record or type what the patient described first.");
      return;
    }
    setConvoBusy(true);
    try {
      const asked = (data.conversation ?? []).map((c) => c.q);
      const out = await generateNextQuestions(
        { ...data, freeText: narrative, age: data.age, sex: data.sex },
        asked
      );
      if (!out) {
        RNAlert.alert(
          isAiConfigured() ? "AI unavailable" : "AI key not set",
          "Continue entering details manually — routing still works on rules."
        );
        return;
      }
      setConvo(out);
    } finally {
      setConvoBusy(false);
    }
  }

  function answerQuestion(q: string, why: string, a: string) {
    const existing = data.conversation ?? [];
    const idx = existing.findIndex((c) => c.q === q);
    const next = idx >= 0
      ? existing.map((c, i) => (i === idx ? { ...c, a } : c))
      : [...existing, { q, a, why }];
    update({ conversation: next });
  }

  async function runAiExtraction() {
    const narrative = data.freeText ?? "";
    if (!narrative.trim()) {
      RNAlert.alert("Nothing to analyse", "Type or simulate what the patient/family said first.");
      return;
    }
    setAiBusy(true);
    try {
      const out = await extractFromNarrative(narrative, data.language ?? "English", data.speakerSource);
      if (!out) {
        RNAlert.alert(
          isAiConfigured() ? "AI unavailable" : "AI key not set",
          isAiConfigured()
            ? "Could not reach " + aiModelLabel() + ". Continue entering details manually — routing still works on rules."
            : "Add EXPO_PUBLIC_GROQ_API_KEY, EXPO_PUBLIC_GEMINI_API_KEY, or EXPO_PUBLIC_ANTHROPIC_API_KEY to a .env file. Rules-based routing works without it."
        );
        return;
      }
      setAiResult(out);
      // Merge only fields the nurse has not already filled — never overwrite human input.
      const merged: Partial<WizardData> = {};
      const existing = data.symptoms ?? [];
      const newSymptoms = out.symptoms.filter((s) => !existing.includes(s));
      if (newSymptoms.length) merged.symptoms = [...existing, ...newSymptoms];
      if (!data.primaryConcern && out.primaryConcern) merged.primaryConcern = out.primaryConcern;
      if (!data.onset && out.onset) merged.onset = out.onset;
      if (!data.duration && out.duration) merged.duration = out.duration;
      if (data.reportedSeverity == null && out.reportedSeverity != null) merged.reportedSeverity = out.reportedSeverity;
      if (!data.trend && out.trend) merged.trend = out.trend;
      if (data.age == null && out.age != null) merged.age = out.age;
      if (!data.sex && out.sex) merged.sex = out.sex;
      if (!data.speakerSource && out.speakerSource) merged.speakerSource = out.speakerSource;
      if (out.medicalHistory || out.medications || out.allergies) {
        const h = data.history ?? { conditions: "", medications: "", allergies: "", previousEpisode: "", recentVisit: "" };
        merged.history = {
          ...h,
          conditions: h.conditions || out.medicalHistory || h.conditions,
          medications: h.medications || out.medications || h.medications,
          allergies: h.allergies || out.allergies || h.allergies,
        };
      }
      if (Object.keys(merged).length) update(merged);
    } finally {
      setAiBusy(false);
    }
  }

  const vitals: Vitals = data.vitals ?? { consciousness: "Not recorded" };
  function updateVitals(patch: Partial<Vitals>) {
    update({ vitals: { ...vitals, ...patch } });
  }

  const relevantRiskGroups = (data.symptoms ?? []).filter((s) => riskQuestionSets[s]);

  // Vitals plan: which measurements actually matter for THIS presentation.
  // Generated on entering step 8 and keyed on the presentation, so editing
  // earlier steps and returning regenerates rather than showing a stale plan.
  const vitalsSignature = JSON.stringify([data.symptoms, data.primaryConcern, data.freeText, data.age, data.patientCategories]);
  useEffect(() => {
    if (step !== 6 || !isAiConfigured()) return;
    if (vitalsPlanFor === vitalsSignature) return;
    let cancelled = false;
    planVitals({ ...data, age: data.age })
      .then((plan) => {
        if (cancelled) return;
        setVitalsPlan(plan);
        setVitalsPlanFor(vitalsSignature);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, vitalsSignature]);

  // Dynamic risk screening. Regenerates whenever the presentation changes, so
  // going back to edit symptoms doesn't leave stale questions on screen.
  const riskSignature = JSON.stringify([data.symptoms, data.primaryConcern, data.freeText, data.age, data.sex]);
  useEffect(() => {
    if (step !== 4 || !isAiConfigured()) return;
    if (riskFor === riskSignature) return;
    let cancelled = false;
    setRiskBusy(true);
    generateRiskScreening({ ...data, age: data.age, sex: data.sex })
      .then((r) => {
        if (cancelled) return;
        setRiskScreen(r);
        setRiskFor(riskSignature);
      })
      .finally(() => {
        if (!cancelled) setRiskBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, riskSignature]);

  return (
    <View className="flex-1 bg-background">
      <TopAppBar variant="task" title="New Patient" onBack={goBack} onDashboard={saveDraftAndExit} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 220 }}
          contentContainerClassName="px-container-padding py-section-gap gap-section-gap"
        >
          {/* Progress */}
          <View className="gap-1.5">
            <View className="flex-row justify-between items-center">
              <Text className="font-label-caps text-label-caps text-primary uppercase">
                Step {step} of {TOTAL_STEPS}
              </Text>
              <View className="flex-row items-center gap-2">
                <Text className="font-helper-text text-helper-text text-on-surface-variant">{stepTitles[step - 1]}</Text>
                <Text
                  className={`font-helper-text text-helper-text ${elapsed > INTAKE_BUDGET_SECONDS ? "text-error" : "text-on-surface-variant"}`}
                >
                  {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / 5:00
                </Text>
              </View>
            </View>
            <View className="w-full bg-surface-variant rounded-full h-2 overflow-hidden">
              <View className="bg-primary h-2 rounded-full" style={{ width: `${completionPct}%` }} />
            </View>
          </View>

          {step === 1 && (
            <View className="gap-stack-gap">
              {/* GATE 0 — first thing on the first screen, deliberately. If a
                  patient is dying in front of the nurse, the bypass has to be
                  reachable before any question is asked. */}
              <View className="border-2 border-error rounded-xl overflow-hidden">
                <Pressable
                  onPress={() => setGate0Open((v) => !v)}
                  accessibilityRole="button"
                  className="bg-error-container/60 px-4 py-3 flex-row items-center gap-3"
                >
                  <MaterialIcons name="emergency" size={22} color="#93000a" />
                  <View className="flex-1">
                    <Text className="font-headline-md text-headline-md text-on-surface">Patient is critical right now</Text>
                    <Text className="font-helper-text text-helper-text text-on-surface-variant">
                      Skip triage — send straight to resuscitation
                    </Text>
                  </View>
                  <MaterialIcons name={gate0Open ? "expand-less" : "expand-more"} size={22} color="#93000a" />
                </Pressable>
                {gate0Open && (
                  <View className="px-4 py-3 gap-2 bg-surface-container-lowest">
                    <Text className="font-body-md text-body-md text-on-surface-variant">
                      Tap what you can see. The patient is routed at Level 1 immediately and the record is completed once they are stable.
                    </Text>
                    {GATE0_REASONS.map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setGate0Reason(r)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: gate0Reason === r }}
                        className={`h-touch-target-min rounded-lg border px-3 flex-row items-center gap-2 ${
                          gate0Reason === r ? "border-error bg-error-container" : "border-error/50 bg-error-container/30"
                        }`}
                      >
                        <MaterialIcons
                          name={gate0Reason === r ? "radio-button-checked" : "bolt"}
                          size={18}
                          color="#93000a"
                        />
                        <Text className="font-body-md text-body-md text-on-surface flex-1">{r}</Text>
                      </Pressable>
                    ))}

                    {gate0Reason && (
                      <View className="gap-2 pt-1">
                        <Text className="font-body-md text-body-md text-on-surface">
                          Send this patient straight to resuscitation for: {gate0Reason.toLowerCase()}?
                        </Text>
                        <View className="flex-row gap-2">
                          <Pressable
                            onPress={() => setGate0Reason(null)}
                            accessibilityRole="button"
                            className="flex-1 h-touch-target-min rounded-lg border border-outline-variant items-center justify-center"
                          >
                            <Text className="font-label-caps text-label-caps text-on-surface uppercase">Cancel</Text>
                          </Pressable>
                          <Pressable
                            onPress={confirmGate0}
                            accessibilityRole="button"
                            className="flex-[2] h-touch-target-min rounded-lg bg-error flex-row items-center justify-center gap-2"
                          >
                            <MaterialIcons name="emergency" size={18} color="#ffffff" />
                            <Text className="font-label-caps text-label-caps text-on-error uppercase">Send to resuscitation now</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </View>

              <Text className="font-headline-lg text-headline-lg text-on-surface">How is the patient arriving?</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                This selects the correct triage workflow.
              </Text>
              <View className="gap-stack-gap mt-1">
                {arrivalOptions.map((opt) => (
                  <SelectCard
                    key={opt.value}
                    selected={data.arrivalMode === opt.value}
                    icon={opt.icon}
                    label={opt.label}
                    desc={opt.desc}
                    onPress={() => update({ arrivalMode: opt.value })}
                  />
                ))}
                {data.arrivalMode === "Other" && (
                  <TextField
                    value={data.arrivalModeOther ?? ""}
                    onChangeText={(v) => update({ arrivalModeOther: v })}
                    placeholder="How did they arrive?"
                  />
                )}
              </View>
            </View>
          )}

          {step === 2 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Patient basics</Text>

              <SectionCard>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={() => pickPhoto("patient")}
                    accessibilityRole="button"
                    accessibilityLabel="Add patient photo"
                    className="w-20 h-20 rounded-full border-2 border-dashed border-outline-variant items-center justify-center overflow-hidden bg-surface-container"
                  >
                    {data.photoUri ? (
                      <Image source={{ uri: data.photoUri }} className="w-20 h-20" resizeMode="cover" />
                    ) : (
                      <MaterialIcons name="photo-camera" size={24} color="#464555" />
                    )}
                  </Pressable>
                  <View className="flex-1">
                    <Text className="font-body-md text-body-md text-on-surface font-semibold">
                      {data.photoUri ? "Photo attached" : "Add patient photo"}
                    </Text>
                    <Text className="font-helper-text text-helper-text text-on-surface-variant mt-0.5">
                      Optional. Used only to recognise this patient in the queue — no facial recognition.
                    </Text>
                    {data.photoUri && (
                      <Pressable onPress={() => update({ photoUri: undefined })} hitSlop={8} className="mt-1">
                        <Text className="font-label-caps text-label-caps text-error">Remove</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </SectionCard>

              <View>
                <FieldLabel>Patient name</FieldLabel>
                <TextField value={data.patientName ?? ""} onChangeText={(v) => update({ patientName: v })} placeholder="Full name" />
              </View>

              <View>
                <FieldLabel>Age</FieldLabel>
                <TextField
                  value={data.age?.toString() ?? ""}
                  onChangeText={(v) => update({ age: v ? Number(v) : undefined })}
                  placeholder="Years"
                  keyboardType="numeric"
                />
              </View>

              <View>
                <FieldLabel>Sex</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {sexOptions.map((s) => (
                    <Chip key={s} selected={data.sex === s} label={s} onPress={() => update({ sex: s })} />
                  ))}
                </View>
                <Text className="font-helper-text text-helper-text text-on-surface-variant mt-1">
                  Used only where physiology differs — cardiac risk grouping and obstetric pathways. "Unknown" is a valid answer.
                </Text>
              </View>

              <View>
                <FieldLabel>Area / locality travelled from</FieldLabel>
                <TextField
                  value={data.locality ?? ""}
                  onChangeText={(v) => update({ locality: v })}
                  placeholder="e.g. Kalyan East, Sector 7"
                />
                <Text className="font-helper-text text-helper-text text-on-surface-variant mt-1">
                  Several patients from one area with the same infectious picture is a cluster no single-patient rule can see.
                </Text>
              </View>

              <View>
                <FieldLabel>Previous hospital record</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {(["Available", "Not found", "Unknown"] as const).map((r) => (
                    <Chip key={r} selected={data.previousRecord === r} label={r} onPress={() => update({ previousRecord: r })} />
                  ))}
                </View>
              </View>

              <View>
                <FieldLabel>Clinical modifiers</FieldLabel>
                {derivedCategory(data.age) && (
                  <View className="flex-row items-center gap-2 mb-2">
                    <MaterialIcons name="lock" size={14} color="#464555" />
                    <Text className="font-helper-text text-helper-text text-on-surface-variant">
                      Age group <Text className="text-primary">{derivedCategory(data.age)}</Text> applied automatically from the age above
                    </Text>
                  </View>
                )}
                <View className="flex-row flex-wrap gap-x-2">
                  {categoryOptions.map((c) => {
                    const list = data.patientCategories ?? [];
                    const selected = list.includes(c);
                    return (
                      <Chip
                        key={c}
                        selected={selected}
                        label={c}
                        onPress={() => update({ patientCategories: selected ? list.filter((x) => x !== c) : [...list, c] })}
                      />
                    );
                  })}
                </View>
              </View>

              <View>
                <FieldLabel>Medico-legal / accident case</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  <Chip selected={data.medicoLegal === true} label="Yes" onPress={() => update({ medicoLegal: true })} />
                  <Chip selected={data.medicoLegal !== true} label="No" onPress={() => update({ medicoLegal: false })} />
                </View>
              </View>
            </View>
          )}

          {step === 1 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Who is giving the information?</Text>
              <View>
                <FieldLabel>Information source</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {speakerOptions.map((s) => (
                    <Chip key={s} selected={data.speakerSource === s} label={s} onPress={() => update({ speakerSource: s })} />
                  ))}
                </View>
              </View>
              <View>
                <FieldLabel>Language</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {languageOptions.map((l) => (
                    <Chip key={l} selected={data.language === l} label={l} onPress={() => update({ language: l })} />
                  ))}
                </View>
              </View>
              <View>
                <FieldLabel>Communication limitations</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {communicationOptions.map((c) => {
                    const list = data.communicationLimitations ?? [];
                    const selected = c === "None" ? list.length === 0 : list.includes(c);
                    return (
                      <Chip
                        key={c}
                        selected={selected}
                        label={c}
                        onPress={() =>
                          update({ communicationLimitations: c === "None" ? [] : selected ? list.filter((x) => x !== c) : [...list, c] })
                        }
                      />
                    );
                  })}
                </View>
              </View>
            </View>
          )}

          {step === 3 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">What brings the patient in?</Text>

              {/* Voice first: the fastest way in is to let them talk. Everything
                  below can be filled from what they say. */}
              <View className="bg-primary-fixed-dim/20 border border-primary/30 rounded-xl p-4 gap-3">
                <View className="flex-row items-center gap-2">
                  <MaterialIcons name="record-voice-over" size={20} color="#3525cd" />
                  <Text className="font-headline-md text-headline-md text-on-surface">Describe the problem</Text>
                </View>
                <Text className="font-body-md text-body-md text-on-surface-variant">
                  Tap record and let the patient or family speak naturally, in any language. The AI listens, then asks only what it still needs.
                </Text>
                <View className="self-start">
                  <VoiceCapture
                    language={data.language}
                    onTranscript={(text) => {
                      const existing = (data.freeText ?? "").trim();
                      const merged = existing ? existing + " " + text : text;
                      update({ freeText: merged, transcript: merged });
                    }}
                    onSampleFallback={() =>
                      update({
                        freeText: voiceSamples[data.language ?? "English"],
                        transcript: voiceSamples[data.language ?? "English"],
                      })
                    }
                  />
                </View>
                <TextInput
                  className="bg-surface-container-lowest rounded-lg px-3 py-3 font-body-lg text-body-lg text-on-surface"
                  style={{ minHeight: 96, textAlignVertical: "top" }}
                  placeholder="…or type what they described"
                  placeholderTextColor="#777587"
                  value={data.freeText ?? ""}
                  onChangeText={(v) => update({ freeText: v })}
                  multiline
                />
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={askNextQuestions}
                    disabled={convoBusy}
                    accessibilityRole="button"
                    className={`flex-1 h-touch-target-min rounded-lg flex-row items-center justify-center gap-2 ${convoBusy ? "bg-surface-container" : "bg-primary"}`}
                  >
                    {convoBusy ? (
                      <>
                        <ActivityIndicator size="small" color="#3525cd" />
                        <Text className="font-label-caps text-label-caps text-on-surface-variant">Thinking…</Text>
                      </>
                    ) : (
                      <>
                        <MaterialIcons name="forum" size={18} color="#ffffff" />
                        <Text className="font-label-caps text-label-caps text-on-primary">
                          {convo ? "Ask more" : "Ask AI what to check"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>

              {/* Conversational follow-ups */}
              {convo && convo.questions.length > 0 && (
                <SectionCard>
                  <View className="flex-row items-center gap-2">
                    <MaterialIcons name="forum" size={18} color="#3525cd" />
                    <Text className="font-headline-md text-headline-md text-on-surface">ASK THE PATIENT</Text>
                    {convo.readyToRoute && (
                      <View className="px-2 py-0.5 rounded-md bg-[#F0FDF4]">
                        <Text className="font-label-caps text-label-caps text-[#16A34A]">ENOUGH TO ROUTE</Text>
                      </View>
                    )}
                  </View>
                  {convo.questions.map((q) => {
                    const answered = (data.conversation ?? []).find((c) => c.q === q.question);
                    const opts = q.options && q.options.length ? q.options : ["Yes", "No", "Unsure"];
                    return (
                      <View key={q.question} className="gap-1.5">
                        <Text className="font-body-lg text-body-lg text-on-surface">{q.question}</Text>
                        <Text className="font-helper-text text-helper-text text-on-surface-variant">{q.why}</Text>
                        <View className="flex-row flex-wrap gap-x-2">
                          {opts.map((opt) => (
                            <Chip
                              key={opt}
                              selected={answered?.a === opt}
                              label={opt}
                              onPress={() => answerQuestion(q.question, q.why, opt)}
                            />
                          ))}
                        </View>
                      </View>
                    );
                  })}
                  {convo.stillMissing.length > 0 && (
                    <View className="gap-1">
                      <Text className="font-label-caps text-label-caps text-on-surface-variant">STILL UNKNOWN</Text>
                      {convo.stillMissing.map((m, i) => (
                        <Text key={i} className="font-body-md text-body-md text-on-surface-variant">• {m}</Text>
                      ))}
                    </View>
                  )}
                </SectionCard>
              )}

              {(data.conversation ?? []).length > 0 && (
                <Text className="font-helper-text text-helper-text text-on-surface-variant -mt-2">
                  {(data.conversation ?? []).length} answer(s) recorded — these are added to the narrative and do affect routing.
                </Text>
              )}

              <View>
                <FieldLabel>Primary concern</FieldLabel>
                <TextField
                  value={data.primaryConcern ?? ""}
                  onChangeText={(v) => update({ primaryConcern: v })}
                  placeholder="One-line summary"
                />
              </View>

              <View>
                <FieldLabel>Symptoms (select all that apply)</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {symptomOptions.map((s) => {
                    const list = data.symptoms ?? [];
                    const selected = list.includes(s);
                    return (
                      <Chip
                        key={s}
                        selected={selected}
                        label={s}
                        onPress={() => update({ symptoms: selected ? list.filter((x) => x !== s) : [...list, s] })}
                      />
                    );
                  })}
                </View>
              </View>


              {/* AI extraction */}
              <Pressable
                onPress={runAiExtraction}
                disabled={aiBusy}
                accessibilityRole="button"
                className={`h-touch-target-min rounded-lg flex-row items-center justify-center gap-2 ${
                  aiBusy ? "bg-surface-container" : "bg-primary-container"
                }`}
              >
                {aiBusy ? (
                  <>
                    <ActivityIndicator size="small" color="#3525cd" />
                    <Text className="font-label-caps text-label-caps text-on-surface-variant">Analysing…</Text>
                  </>
                ) : (
                  <>
                    <MaterialIcons name="auto-awesome" size={18} color="#dad7ff" />
                    <Text className="font-label-caps text-label-caps text-on-primary-container">Extract details with AI</Text>
                  </>
                )}
              </Pressable>
              <Text className="font-helper-text text-helper-text text-on-surface-variant -mt-1">
                {isAiConfigured()
                  ? "Model: " + aiModelLabel() + ". Rules remain the source of truth for routing."
                  : "AI key not configured — routing still works on rules alone."}
              </Text>

              {aiResult && (
                <SectionCard>
                  <View className="flex-row items-center gap-2">
                    <MaterialIcons name="auto-awesome" size={16} color="#3525cd" />
                    <Text className="font-headline-md text-headline-md text-on-surface">AI extracted</Text>
                  </View>
                  {aiResult.symptoms.length > 0 && (
                    <Text className="font-body-md text-body-md text-on-surface">Symptoms: {aiResult.symptoms.join(", ")}</Text>
                  )}
                  {aiResult.contradictions.length > 0 && (
                    <View className="bg-error-container/40 rounded-lg p-2 gap-1">
                      <Text className="font-label-caps text-label-caps text-on-error-container">CONFLICTING INFORMATION</Text>
                      {aiResult.contradictions.map((c, i) => (
                        <Text key={i} className="font-body-md text-body-md text-on-surface">• {c}</Text>
                      ))}
                    </View>
                  )}
                  {aiResult.missingCriticalInfo.length > 0 && (
                    <View className="gap-1">
                      <Text className="font-label-caps text-label-caps text-on-surface-variant">STILL MISSING</Text>
                      {aiResult.missingCriticalInfo.map((m, i) => (
                        <Text key={i} className="font-body-md text-body-md text-on-surface-variant">• {m}</Text>
                      ))}
                    </View>
                  )}
                  {aiResult.followUpQuestions.length > 0 && (
                    <View className="gap-1">
                      <Text className="font-label-caps text-label-caps text-primary">SUGGESTED QUESTIONS</Text>
                      {aiResult.followUpQuestions.map((q, i) => (
                        <Text key={i} className="font-body-md text-body-md text-on-surface">• {q}</Text>
                      ))}
                    </View>
                  )}
                  <Text className="font-helper-text text-helper-text text-on-surface-variant">
                    AI fills only blank fields. Anything you typed is never overwritten.
                  </Text>
                </SectionCard>
              )}
            </View>
          )}

          {step === 3 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Onset & trend</Text>
              <View>
                <FieldLabel>Onset</FieldLabel>
                <TextField value={data.onset ?? ""} onChangeText={(v) => update({ onset: v })} placeholder="e.g. This morning" />
              </View>
              <View>
                <FieldLabel>Duration</FieldLabel>
                <TextField value={data.duration ?? ""} onChangeText={(v) => update({ duration: v })} placeholder="e.g. 3 hours" />
              </View>
              <View>
                <FieldLabel>Reported severity (1–10)</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => update({ reportedSeverity: n })}
                      className={`w-11 h-11 rounded-lg border items-center justify-center mb-2 ${
                        data.reportedSeverity === n ? "border-primary bg-primary-fixed-dim/20" : "border-outline-variant bg-surface-container-lowest"
                      }`}
                    >
                      <Text className={`font-body-md text-body-md ${data.reportedSeverity === n ? "text-primary" : "text-on-surface"}`}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <FieldLabel>Trend</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {(["Worsening", "Stable", "Improving", "Unknown"] as const).map((t) => (
                    <Chip key={t} selected={data.trend === t} label={t} onPress={() => update({ trend: t })} />
                  ))}
                </View>
              </View>
            </View>
          )}

          {step === 4 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Risk screening</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                Questions are generated for this specific presentation, not a fixed checklist.
              </Text>
              {riskBusy && !riskScreen && (
                <SectionCard>
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#3525cd" />
                    <Text className="font-body-md text-body-md text-on-surface-variant">
                      Generating questions for this presentation…
                    </Text>
                  </View>
                </SectionCard>
              )}

              {riskScreen && riskScreen.questions.length > 0 ? (
                <>
                  {riskScreen.rationale ? (
                    <Text className="font-helper-text text-helper-text text-on-surface-variant -mt-1">
                      {riskScreen.rationale}
                    </Text>
                  ) : null}
                  <SectionCard>
                    {riskScreen.questions.map((q) => {
                      const answers = data.riskAnswers ?? {};
                      return (
                        <View key={q.key} className="gap-1.5">
                          <View className="flex-row items-start gap-2">
                            {q.critical && <MaterialIcons name="priority-high" size={16} color="#ba1a1a" />}
                            <Text className="flex-1 font-body-md text-body-md text-on-surface">{q.question}</Text>
                          </View>
                          <Text className="font-helper-text text-helper-text text-on-surface-variant">{q.probes}</Text>
                          <View className="flex-row flex-wrap gap-x-2">
                            {["Yes", "No", "Unsure"].map((opt) => (
                              <Chip
                                key={opt}
                                selected={answers[q.key] === opt}
                                label={opt}
                                onPress={() => update({ riskAnswers: { ...answers, [q.key]: opt } })}
                              />
                            ))}
                          </View>
                        </View>
                      );
                    })}
                  </SectionCard>
                </>
              ) : !riskBusy ? (
                <>
                  {/* Offline fallback: fixed per-symptom sets, used when the AI is
                      unreachable or no key is configured. */}
                  {relevantRiskGroups.length === 0 && (
                    <SectionCard>
                      <Text className="font-body-md text-body-md text-on-surface-variant">
                        No symptom-specific questions apply. Continue to medical history.
                      </Text>
                    </SectionCard>
                  )}
                  {relevantRiskGroups.map((group) => (
                    <SectionCard key={group}>
                      <Text className="font-headline-md text-headline-md text-on-surface">{group}</Text>
                      {riskQuestionSets[group].map((q) => {
                        const answers = data.riskAnswers ?? {};
                        return (
                          <View key={q.key} className="gap-1.5">
                            <Text className="font-body-md text-body-md text-on-surface">{q.question}</Text>
                            <View className="flex-row flex-wrap gap-x-2">
                              {["Yes", "No", "Unknown"].map((opt) => (
                                <Chip
                                  key={opt}
                                  selected={answers[q.key] === opt}
                                  label={opt}
                                  onPress={() => update({ riskAnswers: { ...answers, [q.key]: opt } })}
                                />
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </SectionCard>
                  ))}
                </>
              ) : null}
            </View>
          )}

          {step === 5 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Medical history</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                Tap what applies. Diabetes and heart history change how the routing engine reads this patient, so these are worth the ten seconds.
              </Text>

              {(() => {
                const history = data.history ?? {
                  conditions: "",
                  medications: "",
                  allergies: "",
                  previousEpisode: "",
                  recentVisit: "",
                };
                // Selected conditions live in history.conditions as a comma list:
                // the routing engine and every AI prompt already read that field,
                // so the chips need no new plumbing to take effect.
                const picked = (history.conditions || "")
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean);
                const setPicked = (next: string[]) =>
                  update({ history: { ...history, conditions: next.join(", ") } });
                const toggle = (item: string) =>
                  setPicked(picked.includes(item) ? picked.filter((x) => x !== item) : [...picked, item]);

                return (
                  <>
                    {HISTORY_GROUPS.map((group) => (
                      <SectionCard key={group.label}>
                        <View className="flex-row items-center gap-2 mb-1">
                          <MaterialIcons name={group.icon} size={18} color="#3525cd" />
                          <Text className="font-headline-md text-headline-md text-on-surface">{group.label}</Text>
                        </View>
                        <View className="flex-row flex-wrap gap-x-2">
                          {group.items.map((item) => (
                            <Chip key={item} selected={picked.includes(item)} label={item} onPress={() => toggle(item)} />
                          ))}
                        </View>
                      </SectionCard>
                    ))}

                    <View>
                      <FieldLabel>Anything else in their history</FieldLabel>
                      <View className="flex-row flex-wrap gap-x-2">
                        {["None known", "Unknown"].map((quick) => (
                          <Chip key={quick} selected={picked.includes(quick)} label={quick} onPress={() => toggle(quick)} />
                        ))}
                      </View>
                    </View>

                    <View>
                      <FieldLabel>Medications</FieldLabel>
                      <View className="flex-row flex-wrap gap-x-2">
                        {["None", "Unknown", "Regular medication"].map((quick) => (
                          <Chip
                            key={quick}
                            selected={history.medications === quick}
                            label={quick}
                            onPress={() => update({ history: { ...history, medications: quick } })}
                          />
                        ))}
                      </View>
                      <TextField
                        value={history.medications ?? ""}
                        onChangeText={(v) => update({ history: { ...history, medications: v } })}
                        placeholder="Name them if known…"
                      />
                    </View>

                    <View>
                      <FieldLabel>Allergies</FieldLabel>
                      <View className="flex-row flex-wrap gap-x-2">
                        {["None known", "Unknown", "Not asked yet"].map((quick) => (
                          <Chip
                            key={quick}
                            selected={history.allergies === quick}
                            label={quick}
                            onPress={() => update({ history: { ...history, allergies: quick } })}
                          />
                        ))}
                      </View>
                      <TextField
                        value={history.allergies ?? ""}
                        onChangeText={(v) => update({ history: { ...history, allergies: v } })}
                        placeholder="Drug or food allergy…"
                      />
                    </View>

                    {/* These two were free text and were almost never filled.
                        They are yes/no questions, so they are yes/no chips now. */}
                    {(
                      [
                        ["previousEpisode", "Had this same problem before?"],
                        ["recentVisit", "Hospital visit in the last 30 days?"],
                      ] as const
                    ).map(([field, label]) => (
                      <View key={field}>
                        <FieldLabel>{label}</FieldLabel>
                        <View className="flex-row flex-wrap gap-x-2">
                          {["Yes", "No", "Unknown"].map((opt) => (
                            <Chip
                              key={opt}
                              selected={history[field] === opt}
                              label={opt}
                              onPress={() => update({ history: { ...history, [field]: opt } })}
                            />
                          ))}
                        </View>
                      </View>
                    ))}
                  </>
                );
              })()}
            </View>
          )}
          {step === 6 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Vitals & observations</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                Mark anything unavailable rather than guessing — missing data is handled safely.
              </Text>

              <SectionCard>
                <FieldLabel>Injury / visible finding photo (take this first)</FieldLabel>
                {data.injuryPhotoUri ? (
                  <View className="gap-2">
                    <Image source={{ uri: data.injuryPhotoUri }} className="w-full h-48 rounded-lg" resizeMode="cover" />
                    <View className="flex-row gap-2">
                      <Pressable onPress={() => pickPhoto("injury")} className="flex-1 h-touch-target-min rounded-lg border border-outline-variant items-center justify-center">
                        <Text className="font-label-caps text-label-caps text-on-surface">Retake</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => update({ injuryPhotoUri: undefined, photoAttached: false })}
                        className="flex-1 h-touch-target-min rounded-lg border border-outline-variant items-center justify-center"
                      >
                        <Text className="font-label-caps text-label-caps text-error">Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => pickPhoto("injury")}
                    accessibilityRole="button"
                    className="h-touch-target-min rounded-lg border border-outline-variant flex-row items-center justify-center gap-2"
                  >
                    <MaterialIcons name="photo-camera" size={18} color="#3525cd" />
                    <Text className="font-label-caps text-label-caps text-primary">Take photo</Text>
                  </Pressable>
                )}
                <Text className="font-helper-text text-helper-text text-on-surface-variant">
                  Assistive signal only — an image never determines routing on its own.
                </Text>
              </SectionCard>

              {/* AI-prioritised vitals for this specific presentation, so the
                  nurse sees the two or three that matter rather than eight
                  identical boxes. The full set stays one tap away — nothing is
                  hidden, only de-emphasised. */}
              {vitalsPlan && vitalsPlan.priority.length > 0 && (
                <View className="bg-primary-fixed-dim/20 border border-primary/30 rounded-xl p-4 gap-2">
                  <View className="flex-row items-center gap-2">
                    <MaterialIcons name="auto-awesome" size={18} color="#3525cd" />
                    <Text className="font-headline-md text-headline-md text-on-surface">MEASURE THESE FIRST</Text>
                  </View>
                  <Text className="font-helper-text text-helper-text text-on-surface-variant">
                    Chosen for what this patient described. All other vitals remain available below.
                  </Text>
                  {vitalsPlan.priority.map((pv) => (
                    <View key={pv.vital} className="flex-row items-start gap-2">
                      <MaterialIcons name="priority-high" size={14} color="#ba1a1a" />
                      <Text className="flex-1 font-body-md text-body-md text-on-surface">
                        <Text className="font-semibold">{VITAL_LABELS[pv.vital] ?? pv.vital}</Text>
                        {" — " + pv.why}
                      </Text>
                    </View>
                  ))}
                  {vitalsPlan.observations.length > 0 && (
                    <View className="gap-1 mt-1">
                      <Text className="font-label-caps text-label-caps text-on-surface-variant">ALSO WORTH OBSERVING</Text>
                      {vitalsPlan.observations.map((o, i) => (
                        <Text key={i} className="font-body-md text-body-md text-on-surface">• {o}</Text>
                      ))}
                    </View>
                  )}
                </View>
              )}

              <View>
                <FieldLabel>Consciousness</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {(["Alert", "Confused", "Responds to voice", "Responds to pain", "Unresponsive", "Not recorded"] as const).map((c) => (
                    <Chip key={c} selected={vitals.consciousness === c} label={c} onPress={() => updateVitals({ consciousness: c })} />
                  ))}
                </View>
              </View>

              <View className="flex-row flex-wrap gap-x-stack-gap">
                <VitalRow
                  label="Temp (°C)"
                  value={vitals.temperature?.toString() ?? ""}
                  unavailable={!!vitals.tempUnavailable}
                  onChangeValue={(v) => updateVitals({ temperature: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ tempUnavailable: !vitals.tempUnavailable })}
                />
                <VitalRow
                  label="Pulse (bpm)"
                  value={vitals.pulse?.toString() ?? ""}
                  unavailable={!!vitals.pulseUnavailable}
                  onChangeValue={(v) => updateVitals({ pulse: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ pulseUnavailable: !vitals.pulseUnavailable })}
                />
                <VitalRow
                  label="SpO2 (%)"
                  value={vitals.spo2?.toString() ?? ""}
                  unavailable={!!vitals.spo2Unavailable}
                  onChangeValue={(v) => updateVitals({ spo2: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ spo2Unavailable: !vitals.spo2Unavailable })}
                />
                <VitalRow
                  label="Resp. rate"
                  value={vitals.respiratoryRate?.toString() ?? ""}
                  unavailable={!!vitals.respUnavailable}
                  onChangeValue={(v) => updateVitals({ respiratoryRate: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ respUnavailable: !vitals.respUnavailable })}
                />
                <VitalRow
                  label="BP systolic"
                  value={vitals.bpSystolic?.toString() ?? ""}
                  unavailable={!!vitals.bpUnavailable}
                  onChangeValue={(v) => updateVitals({ bpSystolic: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ bpUnavailable: !vitals.bpUnavailable })}
                />
                <VitalRow
                  label="BP diastolic"
                  value={vitals.bpDiastolic?.toString() ?? ""}
                  unavailable={!!vitals.bpUnavailable}
                  onChangeValue={(v) => updateVitals({ bpDiastolic: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ bpUnavailable: !vitals.bpUnavailable })}
                />
                <VitalRow
                  label="Pain (0–10)"
                  value={vitals.painScore?.toString() ?? ""}
                  unavailable={!!vitals.painUnavailable}
                  onChangeValue={(v) => updateVitals({ painScore: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ painUnavailable: !vitals.painUnavailable })}
                />
                <VitalRow
                  label="Blood sugar"
                  value={vitals.bloodSugar?.toString() ?? ""}
                  unavailable={false}
                  onChangeValue={(v) => updateVitals({ bloodSugar: v ? Number(v) : undefined })}
                  onToggleUnavailable={() => updateVitals({ bloodSugar: undefined })}
                />
              </View>

              <View>
                <FieldLabel>Nurse observations</FieldLabel>
                <View className="flex-row flex-wrap gap-x-2">
                  {[
                    "Visible distress",
                    "Breathing difficulty",
                    "Visible bleeding",
                    "Confusion",
                    "Mobility limitation",
                    "Infection/isolation concern",
                  ].map((o) => {
                    const list = data.observations ?? [];
                    const selected = list.includes(o);
                    return (
                      <Chip
                        key={o}
                        selected={selected}
                        label={o}
                        onPress={() => update({ observations: selected ? list.filter((x) => x !== o) : [...list, o] })}
                      />
                    );
                  })}
                </View>
              </View>

            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Persistent action bar */}
      <View className="border-t border-outline-variant bg-surface-container-lowest px-container-padding py-3">
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            className="h-touch-target-min px-5 rounded-full border border-outline-variant items-center justify-center"
          >
            <Text className="font-label-caps text-label-caps text-on-surface uppercase">Back</Text>
          </Pressable>
          <Pressable
            onPress={saveDraftAndExit}
            accessibilityRole="button"
            className="h-touch-target-min px-4 rounded-full border border-outline-variant items-center justify-center"
          >
            <Text className="font-label-caps text-label-caps text-on-surface uppercase">Save draft</Text>
          </Pressable>
          <Pressable
            onPress={goNext}
            accessibilityRole="button"
            className="flex-1 h-touch-target-min rounded-full bg-primary items-center justify-center"
          >
            <Text className="font-label-caps text-label-caps text-on-primary uppercase">
              {step === TOTAL_STEPS ? "Analyze" : "Continue"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
