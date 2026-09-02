import { View, Text, Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import type { Encounter, Patient } from "../lib/types";
import { urgencyStyles, initials, ageLabel } from "../lib/urgency";
import { TriageChip } from "./TriageChip";

// Ported from the "High Priority Card" pattern in nurse_dashboard/code.html
export function PatientCard({ encounter, patient, onPress }: { encounter: Encounter; patient: Patient; onPress: () => void }) {
  const s = urgencyStyles[encounter.recommendation.level];
  return (
    <Pressable
      onPress={onPress}
      className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden relative flex-row"
    >
      <View className={`w-1 ${s.bar}`} />
      <View className="flex-1 p-4 pl-4 gap-3">
        <View className="flex-row items-start gap-3">
          <View className="w-12 h-12 bg-surface-container-high rounded-full items-center justify-center shrink-0">
            <Text className="font-headline-md text-headline-md text-on-surface font-bold">{initials(patient.name)}</Text>
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-x-2 flex-wrap">
              <Text className="font-headline-md text-headline-md text-on-surface">{patient.name}</Text>
              <Text className="font-body-md text-body-md text-on-surface-variant">
                {ageLabel(patient.age)}, {patient.sex}
              </Text>
              {encounter.token ? (
                <View className="px-2 py-0.5 bg-surface-container rounded border border-outline-variant/30">
                  <Text className="font-label-caps text-label-caps text-on-surface-variant">{encounter.token}</Text>
                </View>
              ) : null}
            </View>
            <Text className="font-body-md text-body-md text-on-surface mt-1" numberOfLines={1}>
              {encounter.symptoms.slice(0, 2).join(" • ") || encounter.primaryConcern}
            </Text>
            <View className="flex-row items-center gap-x-3 mt-2 flex-wrap">
              <TriageChip level={encounter.recommendation.level} />
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="directions-walk" size={13} color="#464555" />
                <Text className="font-helper-text text-helper-text text-on-surface-variant">{encounter.currentPathway}</Text>
              </View>
            </View>
          </View>
        </View>
        <View className="flex-row items-center justify-between border-t border-[#E2E8F0] pt-3">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="schedule" size={16} color="#464555" />
            <Text className="font-body-md text-body-md text-on-surface-variant">
              Waiting: <Text className="font-bold text-on-surface">{encounter.waitingMins}m</Text>
            </Text>
          </View>
          {encounter.status === "Waiting" ? (
            <View className="flex-row items-center gap-1 bg-[#F0FDF4] px-2 py-1 rounded">
              <MaterialIcons name="check-circle" size={13} color="#16A34A" />
              <Text className="font-helper-text text-helper-text text-[#16A34A]">Accepted</Text>
            </View>
          ) : encounter.status === "Escalated" ? (
            <View className="flex-row items-center gap-1 bg-error-container px-2 py-1 rounded">
              <MaterialIcons name="priority-high" size={13} color="#93000a" />
              <Text className="font-helper-text text-helper-text text-on-error-container">Escalated</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
