import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppState } from "../lib/store";
import { urgencyStyles, ageLabel } from "../lib/urgency";

// Ported from stitch_patienttriage.ai_nurse_portal/patient_token_generated/code.html
export function PatientTokenScreen({
  encounterId,
  onGoDashboard,
  onGeneratePdf,
  onViewPatient,
}: {
  encounterId: string;
  onGoDashboard: () => void;
  onGeneratePdf: () => void;
  onViewPatient: () => void;
}) {
  const state = useAppState();
  const encounter = state.encounters.find((e) => e.id === encounterId);
  const patient = encounter ? state.patients.find((p) => p.id === encounter.patientId) : undefined;
  if (!encounter || !patient) return null;

  const s = urgencyStyles[encounter.recommendation.level];
  const arrivalTime = new Date(encounter.journey[encounter.journey.length - 1]?.time ?? Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <SafeAreaView className="flex-1 bg-background items-center justify-center px-container-padding">
      <View className="w-full max-w-md items-center gap-section-gap py-12">
        <View className="items-center gap-2">
          <View className="w-16 h-16 rounded-full bg-primary-container/10 items-center justify-center mb-1">
            <MaterialIcons name="check-circle" size={36} color="#3525cd" />
          </View>
          <Text className="font-headline-lg text-headline-lg text-on-background">Patient Token Generated</Text>
          <Text className="font-body-md text-body-md text-on-surface-variant">Registration and initial triage complete.</Text>
        </View>

        <View className="w-full bg-surface-container-lowest border border-outline-variant rounded-xl p-8 items-center shadow-sm">
          <Text className="font-label-caps text-label-caps text-on-surface-variant mb-2">Triage Token Number</Text>
          <Text className="font-headline-lg text-on-surface tracking-tight" style={{ fontSize: 48, lineHeight: 52, fontWeight: "700" }}>
            {encounter.token}
          </Text>
          <View className="items-center gap-1 mt-4">
            <Text className="font-headline-md text-headline-md text-on-surface">{patient.name}</Text>
            <Text className="font-body-md text-body-md text-on-surface-variant">
              {patient.age >= 0 ? `${patient.age} yrs` : ageLabel(patient.age)} • {patient.sex}
            </Text>
          </View>
        </View>

        <View className="w-full gap-stack-gap">
          <View className="flex-row gap-stack-gap">
            <View className={`flex-1 rounded-lg p-4 gap-1 border ${s.bgSoft} border-outline-variant`}>
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="emergency" size={14} color={s.hex} />
                <Text className={`font-label-caps text-label-caps ${s.text}`}>Triage Priority</Text>
              </View>
              <Text className={`font-stat-value text-stat-value ${s.text}`}>{s.label}</Text>
            </View>
            <View className="flex-1 bg-surface-container-low border border-outline-variant/30 rounded-lg p-4 gap-1">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="schedule" size={14} color="#464555" />
                <Text className="font-label-caps text-label-caps text-on-surface-variant">Est. Wait</Text>
              </View>
              <Text className="font-stat-value text-stat-value text-on-surface">{encounter.recommendation.estimatedWait} min</Text>
            </View>
          </View>
          <View className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-3 gap-1">
            <Text className="font-label-caps text-label-caps text-on-surface-variant">Clinical Route</Text>
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="route" size={16} color="#3525cd" />
              <Text className="font-body-md text-body-md text-on-surface font-semibold">{encounter.currentPathway}</Text>
            </View>
          </View>
          <View className="flex-row gap-stack-gap">
            <View className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg p-3 gap-1">
              <Text className="font-label-caps text-label-caps text-on-surface-variant">Arrival Time</Text>
              <Text className="font-body-md text-body-md text-on-surface font-semibold">{arrivalTime}</Text>
            </View>
            <View className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg p-3 gap-1">
              <Text className="font-label-caps text-label-caps text-on-surface-variant">Assigned To</Text>
              <Text className="font-body-md text-body-md text-on-surface font-semibold">{encounter.attendingNurseId}</Text>
            </View>
          </View>
        </View>

        <View className="w-full gap-stack-gap mt-2">
          <Pressable onPress={onGoDashboard} className="w-full h-touch-target-min bg-primary rounded-lg flex-row items-center justify-center gap-2 shadow-sm active:opacity-80">
            <MaterialIcons name="dashboard" size={18} color="#ffffff" />
            <Text className="font-label-caps text-label-caps text-on-primary">Go to Dashboard</Text>
          </Pressable>
          <View className="flex-row justify-center items-center gap-6 mt-1">
            <Pressable onPress={onGeneratePdf} className="flex-row items-center gap-1">
              <MaterialIcons name="picture-as-pdf" size={16} color="#3525cd" />
              <Text className="font-body-md text-body-md text-primary">Generate PDF Report</Text>
            </Pressable>
            <View className="w-px h-4 bg-outline-variant" />
            <Pressable onPress={onViewPatient} className="flex-row items-center gap-1">
              <MaterialIcons name="person" size={16} color="#3525cd" />
              <Text className="font-body-md text-body-md text-primary">View Patient</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
