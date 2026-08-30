import { View, Text, Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initials } from "../lib/urgency";

// Ported from the TopAppBar markup shared across every stitch_patienttriage.ai_nurse_portal/*/code.html.
// paddingTop uses the live status-bar inset so the header never sits under the notch/clock.
export function TopAppBar({
  variant,
  title = "CityCare ED Triage",
  onBack,
  onDashboard,
  nurseName,
  alertCount = 0,
  rightIcon,
  onRight,
}: {
  variant: "main" | "task";
  title?: string;
  onBack?: () => void;
  onDashboard?: () => void;
  nurseName?: string;
  alertCount?: number;
  rightIcon?: "dashboard" | "close";
  onRight?: () => void;
}) {
  const insets = useSafeAreaInsets();

  if (variant === "task") {
    return (
      <View style={{ paddingTop: insets.top }} className="w-full bg-surface border-b border-outline-variant">
        <View className="flex-row items-center justify-between px-container-padding h-touch-target-min">
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="w-11 h-11 items-center justify-center rounded-full active:bg-surface-container-high"
          >
            <MaterialIcons name="arrow-back" size={22} color="#464555" />
          </Pressable>
          <Text className="font-headline-md text-headline-md text-primary flex-1 text-center" numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onRight ?? onDashboard}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={rightIcon === "close" ? "Close" : "Go to dashboard"}
            className="w-11 h-11 items-center justify-center rounded-full active:bg-surface-container-high"
          >
            <MaterialIcons name={rightIcon === "close" ? "close" : "dashboard"} size={22} color="#3525cd" />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: insets.top }} className="w-full bg-surface border-b border-outline-variant">
      <View className="flex-row items-center justify-between px-container-padding h-touch-target-min">
        <View className="flex-row items-center flex-1 min-w-0">
          <MaterialIcons name="emergency" size={22} color="#3525cd" />
          <Text className="font-headline-md text-headline-md font-bold text-primary ml-2" numberOfLines={1}>
            CityCare ED Triage
          </Text>
        </View>
        <View className="flex-row items-center">
          <Pressable
            onPress={onDashboard}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Alerts${alertCount ? `, ${alertCount} active` : ""}`}
            className="relative w-11 h-11 items-center justify-center rounded-full active:bg-surface-container-high"
          >
            <MaterialIcons name="notifications" size={20} color="#464555" />
            {alertCount > 0 && <View className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-error" />}
          </Pressable>
          <View className="w-8 h-8 rounded-full bg-primary-container items-center justify-center ml-1">
            <Text className="font-label-caps text-label-caps text-on-primary-container">{initials(nurseName || "Nurse")}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
