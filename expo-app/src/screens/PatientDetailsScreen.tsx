import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { TopAppBar } from "../components/TopAppBar";
import { VitalCard } from "../components/VitalCard";
import { OverrideModal } from "../components/OverrideModal";
import { ReassessModal } from "../components/ReassessModal";
import { useAppDispatch, useAppState } from "../lib/store";
import { urgencyStyles, ageLabel } from "../lib/urgency";

type Tab = "OVERVIEW" | "TIMELINE" | "OBSERVATIONS";

// Ported from stitch_patienttriage.ai_nurse_portal/patient_details/code.html
export function PatientDetailsScreen({ encounterId, onBack }: { encounterId: string; onBack: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reassessOpen, setReassessOpen] = useState(false);

  const encounter = state.encounters.find((e) => e.id === encounterId);
  const patient = encounter ? state.patients.find((p) => p.id === encounter.patientId) : undefined;
  if (!encounter || !patient) {
    return (
      <View className="flex-1 bg-surface items-center justify-center">
        <Text className="font-body-md text-body-md text-on-surface-variant">Encounter not found.</Text>
      </View>
    );
  }

  const s = urgencyStyles[encounter.recommendation.level];
  const v = encounter.vitals;

  return (
    <View className="flex-1 bg-surface">
      <TopAppBar variant="task" title="Patient Details" onBack={onBack} onDashboard={onBack} rightIcon="close" />
      <ScrollView className="flex-1" contentContainerClassName="px-container-padding py-section-gap gap-section-gap pb-28">
        <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm relative overflow-hidden flex-row items-center justify-between flex-wrap gap-x-3">
          <View className={`absolute left-0 top-0 bottom-0 w-2 ${s.bar}`} />
          <View className="pl-3 flex-row items-start gap-3 flex-1">
            <View className="w-14 h-14 rounded-full bg-surface-container items-center justify-center border border-outline-variant">
              <MaterialIcons name="person" size={30} color="#3525cd" />
            </View>
            <View>
              <Text className="font-headline-lg text-headline-lg text-on-surface">{patient.name}</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant mt-1">
                {patient.age >= 0 ? `${patient.age} yrs` : ageLabel(patient.age)} • {patient.sex} • Token {encounter.token}
              </Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-x-2 -mb-2">
            <View className={`px-3 py-1.5 rounded-md flex-row items-center gap-1 mb-2 ${s.bgSoft}`}>
              <MaterialIcons name="warning" size={14} color={s.hex} />
              <Text className={`font-label-caps text-label-caps ${s.text}`}>Priority {s.label}</Text>
            </View>
            <View className="bg-surface-container px-3 py-1.5 rounded-md flex-row items-center gap-1 mb-2">
              <MaterialIcons name="route" size={14} color="#464555" />
              <Text className="font-label-caps text-label-caps text-on-surface-variant">{encounter.currentPathway}</Text>
            </View>
            <View className="bg-secondary-container px-3 py-1.5 rounded-md flex-row items-center gap-1 border border-outline-variant mb-2">
              <MaterialIcons name="schedule" size={14} color="#464555" />
              <Text className="font-label-caps text-label-caps text-on-secondary-container">Waiting ({encounter.waitingMins}m)</Text>
            </View>
          </View>
        </View>

        <View className="flex-row border-b border-outline-variant">
          {(["OVERVIEW", "TIMELINE", "OBSERVATIONS"] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} className={`h-touch-target-min px-4 justify-center ${tab === t ? "border-b-2 border-primary" : ""}`}>
              <Text className={`font-label-caps text-label-caps ${tab === t ? "text-primary" : "text-on-surface-variant"}`}>{t}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "OVERVIEW" && (
          <View className="gap-stack-gap">
            <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm">
              <View className="flex-row items-center gap-2 mb-3">
                <MaterialIcons name="monitor-heart" size={18} color="#3525cd" />
                <Text className="font-headline-md text-headline-md text-on-surface">Current Vitals</Text>
              </View>
              <View className="flex-row flex-wrap gap-x-3 -mb-3">
                <VitalCard label="Blood Pressure" value={v.bpUnavailable ? "—" : `${v.bpSystolic ?? "—"}/${v.bpDiastolic ?? "—"}`} danger={!!v.bpSystolic && v.bpSystolic >= 140} />
                <VitalCard label="SpO2" value={v.spo2Unavailable ? "—" : String(v.spo2 ?? "—")} unit="%" danger={!!v.spo2 && v.spo2 < 94} />
                <VitalCard label="Heart Rate" value={v.pulseUnavailable ? "—" : String(v.pulse ?? "—")} unit="bpm" />
                <VitalCard label="Temperature" value={v.tempUnavailable ? "—" : String(v.temperature ?? "—")} unit="°C" />
              </View>
            </View>

            <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm gap-4">
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <MaterialIcons name="coronavirus" size={18} color="#3525cd" />
                  <Text className="font-headline-md text-headline-md text-on-surface">Presenting Symptoms</Text>
                </View>
                {encounter.symptoms.length ? (
                  encounter.symptoms.map((sym) => (
                    <Text key={sym} className="font-body-md text-body-md text-on-surface ml-1">
                      • {sym}
                    </Text>
                  ))
                ) : (
                  <Text className="font-body-md text-body-md text-on-surface-variant italic">None recorded</Text>
                )}
              </View>
              <View className="h-px bg-outline-variant" />
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <MaterialIcons name="history" size={18} color="#3525cd" />
                  <Text className="font-headline-md text-headline-md text-on-surface">Medical History</Text>
                </View>
                <Text className="font-body-md text-body-md text-on-surface-variant ml-1">Conditions: {encounter.history.conditions}</Text>
                <Text className="font-body-md text-body-md text-on-surface-variant ml-1">Medications: {encounter.history.medications}</Text>
                <Text className="font-body-md text-body-md text-on-surface-variant ml-1">Allergies: {encounter.history.allergies}</Text>
              </View>
            </View>

            <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm border-l-4 border-l-primary">
              <View className="flex-row items-center gap-2 mb-3">
                <MaterialIcons name="memory" size={18} color="#3525cd" />
                <Text className="font-headline-md text-headline-md text-on-surface">AI Triage Rationale</Text>
              </View>
              <Text className="font-body-md text-body-md text-on-surface-variant leading-relaxed">{encounter.recommendation.reasons.join(". ")}.</Text>
              <View className="mt-4 p-3 bg-surface-container-low rounded border border-outline-variant flex-row items-start gap-2">
                <MaterialIcons name="info" size={16} color="#777587" />
                <Text className="flex-1 text-on-surface-variant text-helper-text font-helper-text">
                  Confidence score: {Math.round(encounter.recommendation.confidence * 100)}%.
                </Text>
              </View>
            </View>
          </View>
        )}

        {tab === "TIMELINE" && (
          <View className="gap-4">
            {encounter.journey.map((entry, i) => (
              <View key={i} className="flex-row gap-3">
                <View className="items-center">
                  <View className="w-2.5 h-2.5 rounded-full bg-primary mt-1.5" />
                  {i < encounter.journey.length - 1 && <View className="w-px flex-1 bg-outline-variant" />}
                </View>
                <View className="flex-1 pb-4">
                  <Text className="font-body-md text-body-md text-on-surface">{entry.event}</Text>
                  <Text className="font-helper-text text-helper-text text-on-surface-variant mt-0.5">
                    {entry.actor} • {new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === "OBSERVATIONS" && (
          <View className="gap-2">
            {encounter.observations.length ? (
              encounter.observations.map((o, i) => (
                <View key={i} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex-row items-center gap-2">
                  <MaterialIcons name="visibility" size={16} color="#464555" />
                  <Text className="font-body-md text-body-md text-on-surface flex-1">{o}</Text>
                </View>
              ))
            ) : (
              <Text className="font-body-md text-body-md text-on-surface-variant italic">No observations recorded yet.</Text>
            )}
          </View>
        )}
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 p-container-padding bg-surface-container-lowest border-t border-outline-variant flex-row gap-3">
        <Pressable onPress={() => setOverrideOpen(true)} className="flex-1 h-touch-target-min rounded bg-error items-center justify-center flex-row gap-2">
          <MaterialIcons name="gavel" size={18} color="#ffffff" />
          <Text className="font-label-caps text-label-caps text-on-error">OVERRIDE</Text>
        </Pressable>
        <Pressable onPress={() => setReassessOpen(true)} className="flex-1 h-touch-target-min rounded bg-primary items-center justify-center flex-row gap-2">
          <MaterialIcons name="medical-services" size={18} color="#ffffff" />
          <Text className="font-label-caps text-label-caps text-on-primary">REASSESS</Text>
        </Pressable>
      </View>

      <OverrideModal
        visible={overrideOpen}
        currentPathway={encounter.recommendation.pathway}
        currentLevel={encounter.recommendation.level}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={(pathway, level, reason) => {
          dispatch({ type: "override", encounterId, pathway, level, reason });
          setOverrideOpen(false);
        }}
      />
      <ReassessModal
        visible={reassessOpen}
        encounter={encounter}
        onCancel={() => setReassessOpen(false)}
        onConfirm={(note) => {
          dispatch({ type: "reassess", encounterId, note });
          setReassessOpen(false);
        }}
      />
    </View>
  );
}
