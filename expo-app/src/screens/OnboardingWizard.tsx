import { useState } from "react";
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
import { symptomOptions } from "../lib/pathways";
import { extractFromNarrative, isAiConfigured, aiModelLabel, type AiExtraction } from "../lib/ai";
import type { DraftEncounter, Encounter, Patient, Vitals } from "../lib/types";

export type WizardData = Partial<Encounter> & {
  patientName?: string;
  age?: number;
  sex?: Patient["sex"];
  previousRecord?: Patient["previousRecord"];
  photoUri?: string;
  injuryPhotoUri?: string;
};

const TOTAL_STEPS = 8;
const stepTitles = [
  "Arrival",
  "Patient basics",
  "Information source",
  "Chief concern",
  "Onset & trend",
  "Risk screening",
  "Medical history",
  "Vitals & observations",
];

const arrivalOptions: { value: Encounter["arrivalMode"]; label: string; desc: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: "Walk-in", label: "Walk-in", desc: "Arrived independently or with family.", icon: "directions-walk" },
  { value: "Ambulance", label: "Ambulance", desc: "EMS transport, requires handover.", icon: "local-shipping" },
  { value: "Referral", label: "Referral", desc: "Transferred from another facility.", icon: "assignment-ind" },
  { value: "Pre-arrival call", label: "Pre-arrival call", desc: "Expected arrival logged by phone.", icon: "call" },
];

const categoryOptions = [
  "Infant",
  "Child",
  "Adult",
  "Pregnant patient",
  "Geriatric",
  "Unconscious/unresponsive",
  "Communication-impaired",
  "Medico-legal/accident case",
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
  const [step, setStep] = useState(initialDraft?.currentStage || 1);
  const [data, setData] = useState<WizardData>(
    initialDraft
      ? { patientName: initialDraft.patientName, age: initialDraft.age, ...initialDraft.data }
      : { symptoms: [], communicationLimitations: [], patientCategories: [], riskAnswers: {}, observations: [] }
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<AiExtraction | null>(null);
  const draftId = initialDraft?.id;

  function update(patch: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...patch }));
  }

  const completionPct = Math.round((step / TOTAL_STEPS) * 100);

  function saveDraftAndExit() {
    onSaveDraft(draftId, step, data);
    onExit();
  }

  function goNext() {
    if (step < TOTAL_STEPS) setStep(step + 1);
    else onComplete(data);
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
              <Text className="font-helper-text text-helper-text text-on-surface-variant">{stepTitles[step - 1]}</Text>
            </View>
            <View className="w-full bg-surface-variant rounded-full h-2 overflow-hidden">
              <View className="bg-primary h-2 rounded-full" style={{ width: `${completionPct}%` }} />
            </View>
          </View>

          {step === 1 && (
            <View className="gap-stack-gap">
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
                  {(["Female", "Male", "Other"] as const).map((s) => (
                    <Chip key={s} selected={data.sex === s} label={s} onPress={() => update({ sex: s })} />
                  ))}
                </View>
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
                <FieldLabel>Patient category</FieldLabel>
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

          {step === 3 && (
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

          {step === 4 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">What brings the patient in?</Text>

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

              <View>
                <View className="flex-row items-center justify-between mb-1.5">
                  <FieldLabel>What was said</FieldLabel>
                  <Pressable
                    onPress={() =>
                      update({
                        freeText: voiceSamples[data.language ?? "English"],
                        transcript: voiceSamples[data.language ?? "English"],
                      })
                    }
                    hitSlop={8}
                    className="flex-row items-center gap-1 min-h-[32px]"
                  >
                    <MaterialIcons name="mic" size={16} color="#3525cd" />
                    <Text className="font-label-caps text-label-caps text-primary">Simulate voice</Text>
                  </Pressable>
                </View>
                <TextInput
                  className="bg-surface-container-low rounded-lg px-3 py-3 font-body-lg text-body-lg text-on-surface"
                  style={{ minHeight: 110, textAlignVertical: "top" }}
                  placeholder="Type or dictate what the patient/family described…"
                  placeholderTextColor="#777587"
                  value={data.freeText ?? ""}
                  onChangeText={(v) => update({ freeText: v })}
                  multiline
                />
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

          {step === 5 && (
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

          {step === 6 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Risk screening</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                Questions adapt to the symptoms selected in step 4.
              </Text>
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
            </View>
          )}

          {step === 7 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Medical history</Text>
              {(
                [
                  ["conditions", "Known conditions"],
                  ["medications", "Medications"],
                  ["allergies", "Allergies"],
                  ["previousEpisode", "Previous similar episode"],
                  ["recentVisit", "Recent hospital visit"],
                ] as const
              ).map(([field, label]) => {
                const history = data.history ?? {
                  conditions: "",
                  medications: "",
                  allergies: "",
                  previousEpisode: "",
                  recentVisit: "",
                };
                return (
                  <View key={field}>
                    <FieldLabel>{label}</FieldLabel>
                    <View className="flex-row flex-wrap gap-x-2">
                      {["None known", "Unknown", "Not asked yet"].map((quick) => (
                        <Chip
                          key={quick}
                          selected={history[field] === quick}
                          label={quick}
                          onPress={() => update({ history: { ...history, [field]: quick } })}
                        />
                      ))}
                    </View>
                    <TextField
                      value={history[field] ?? ""}
                      onChangeText={(v) => update({ history: { ...history, [field]: v } })}
                      placeholder="Add detail…"
                    />
                  </View>
                );
              })}
            </View>
          )}

          {step === 8 && (
            <View className="gap-section-gap">
              <Text className="font-headline-lg text-headline-lg text-on-surface">Vitals & observations</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                Mark anything unavailable rather than guessing — missing data is handled safely.
              </Text>

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

              <SectionCard>
                <FieldLabel>Injury / visible finding photo</FieldLabel>
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
