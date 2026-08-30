import { View, Text } from "react-native";

export function VitalCard({ label, value, unit, danger }: { label: string; value: string; unit?: string; danger?: boolean }) {
  return (
    <View className={`p-3 rounded-lg border flex-1 min-w-[45%] mb-3 ${danger ? "bg-error-container/30 border-error/20" : "bg-surface border-outline-variant"}`}>
      <Text className="font-label-caps text-label-caps text-on-surface-variant mb-1">{label}</Text>
      <View className="flex-row items-baseline">
        <Text className={`font-stat-value text-stat-value ${danger ? "text-error" : "text-on-surface"}`}>{value}</Text>
        {unit ? <Text className={`text-lg ml-1 ${danger ? "text-error/70" : "text-on-surface-variant"}`}>{unit}</Text> : null}
      </View>
    </View>
  );
}
