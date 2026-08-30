import { View, Text, Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import type { Alert } from "../lib/types";

const levelStyle = {
  Critical: { bar: "bg-error", text: "text-error", icon: "warning" as const, cta: "Review" },
  Warning: { bar: "bg-urgency-3", text: "text-urgency-3", icon: "route" as const, cta: "Update" },
  Info: { bar: "bg-secondary", text: "text-secondary", icon: "info" as const, cta: "Acknowledge" },
};

export function AlertCard({ alert, onAction }: { alert: Alert; onAction: () => void }) {
  const s = levelStyle[alert.level];
  return (
    <View className="relative flex-row w-full bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sm overflow-hidden min-h-[72px]">
      <View className={`w-1 ${s.bar}`} />
      <View className="flex-1 p-3 pl-4 justify-center gap-2">
        <View className="flex-row justify-between items-start w-full">
          <View className="flex-1 pr-2">
            <Text className="font-headline-md text-headline-md text-on-surface leading-tight" numberOfLines={1}>
              {alert.title}
            </Text>
            <View className={`flex-row items-center gap-1 mt-0.5`}>
              <MaterialIcons name={s.icon} size={15} color="#464555" />
              <Text className={`font-body-md text-body-md font-medium ${s.text}`} numberOfLines={1}>
                {alert.detail}
              </Text>
            </View>
          </View>
          <Text className="font-body-md text-body-md text-on-surface-variant">
            {new Date(alert.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        <Pressable
          onPress={onAction}
          className={`self-end h-8 px-4 rounded flex-row items-center gap-1 ${alert.level === "Critical" ? "bg-primary-container" : "border border-outline-variant"}`}
        >
          <Text className={`font-label-caps text-label-caps ${alert.level === "Critical" ? "text-on-primary-container" : "text-on-surface"}`}>
            {alert.acknowledged ? "Acknowledged" : s.cta}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
