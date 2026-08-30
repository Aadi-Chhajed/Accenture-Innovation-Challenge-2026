import { View, Text } from "react-native";

const toneClasses = {
  default: { bg: "bg-white border-[#E2E8F0]", label: "text-on-surface-variant", value: "text-on-surface" },
  error: { bg: "bg-[#FFF5F5] border-[#FECACA]", label: "text-error", value: "text-error" },
  warning: { bg: "bg-[#FFFBEB] border-[#FDE68A]", label: "text-urgency-3", value: "text-urgency-3" },
} as const;

export function StatCard({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: keyof typeof toneClasses;
}) {
  const c = toneClasses[tone];
  return (
    <View className={`flex-1 min-w-[45%] rounded-xl p-4 border justify-between ${c.bg}`}>
      <Text className={`font-label-caps text-label-caps uppercase ${c.label}`}>{label}</Text>
      <View className="flex-row items-baseline mt-2">
        <Text className={`font-stat-value text-stat-value ${c.value}`}>{value}</Text>
        {unit ? <Text className={`font-body-md text-body-md ml-1 ${c.label}`}>{unit}</Text> : null}
      </View>
    </View>
  );
}
