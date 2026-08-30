import { View, Text } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import type { UrgencyLevel } from "../lib/types";
import { urgencyStyles } from "../lib/urgency";

export function TriageChip({ level }: { level: UrgencyLevel }) {
  const s = urgencyStyles[level];
  return (
    <View className={`px-2 py-1 rounded-md flex-row items-center gap-1 ${s.bgSoft}`}>
      <MaterialIcons name="priority-high" size={13} color={s.hex} />
      <Text className={`font-label-caps text-label-caps ${s.text}`}>{s.label}</Text>
    </View>
  );
}
