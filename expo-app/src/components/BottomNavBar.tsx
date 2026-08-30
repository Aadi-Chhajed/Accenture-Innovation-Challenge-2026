import { View, Text, Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type TabKey = "dashboard" | "newPatient" | "drafts" | "alerts" | "more";

const tabs: { key: TabKey; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "newPatient", label: "New Patient", icon: "person-add" },
  { key: "drafts", label: "Drafts", icon: "drafts" },
  { key: "alerts", label: "Alerts", icon: "notifications" },
  { key: "more", label: "More", icon: "more-horiz" },
];

export function BottomNavBar({
  active,
  onSelect,
  draftCount = 0,
  alertCount = 0,
}: {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
  draftCount?: number;
  alertCount?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
      className="w-full border-t border-outline-variant bg-surface flex-row justify-around items-start pt-1.5"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const badge = tab.key === "drafts" ? draftCount : tab.key === "alerts" ? alertCount : 0;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            className={`flex-1 min-h-touch-target-min items-center justify-center px-1 py-1 rounded-lg ${isActive ? "bg-primary-container" : ""}`}
          >
            <View>
              <MaterialIcons name={tab.icon} size={22} color={isActive ? "#dad7ff" : "#464555"} />
              {badge > 0 && (
                <View className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-error items-center justify-center">
                  <Text className="text-[10px] leading-[14px] text-on-error font-bold">{badge > 9 ? "9+" : badge}</Text>
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              className={`font-label-caps text-[10px] mt-0.5 ${isActive ? "text-on-primary-container" : "text-on-surface-variant"}`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
