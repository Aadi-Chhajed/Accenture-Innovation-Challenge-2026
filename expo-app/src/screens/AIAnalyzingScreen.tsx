import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";

const steps = [
  "Patient information collected",
  "Symptoms structured",
  "Missing information checked",
  "Patient context evaluated",
  "Hospital queue checked",
  "Available resources checked",
];

// Ported from stitch_patienttriage.ai_nurse_portal/ai_analysis_in_progress/code.html
export function AIAnalyzingScreen({ onDone }: { onDone: () => void }) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount >= steps.length) {
      const finish = setTimeout(onDone, 900);
      return () => clearTimeout(finish);
    }
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), 220);
    return () => clearTimeout(timer);
  }, [visibleCount, onDone]);

  return (
    <SafeAreaView className="flex-1 bg-surface-dim items-center justify-center px-container-padding">
      <View className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-6 items-center">
        <View className="mb-section-gap w-20 h-20 rounded-full bg-primary-container/10 items-center justify-center">
          <MaterialIcons name="psychology" size={40} color="#3525cd" />
        </View>
        <Text className="font-headline-lg text-headline-lg text-on-surface text-center mb-1">Analyzing Patient & Hospital Context</Text>
        <Text className="font-body-lg text-body-lg text-on-surface-variant text-center mb-section-gap">Generating a routing recommendation…</Text>

        <View className="w-full gap-stack-gap mb-section-gap">
          {steps.map((s, i) => (
            <View key={s} className="flex-row items-center gap-3" style={{ opacity: i < visibleCount ? 1 : 0.25 }}>
              <MaterialIcons name="check-circle" size={20} color={i < visibleCount ? "#3525cd" : "#c7c4d8"} />
              <Text className="font-body-md text-body-md text-on-surface">{s}</Text>
            </View>
          ))}
          {visibleCount >= steps.length && (
            <View className="flex-row items-center gap-3 mt-2">
              <ActivityIndicator size="small" color="#3525cd" />
              <Text className="font-body-md text-body-md text-primary font-bold">Generating recommendation</Text>
            </View>
          )}
        </View>

        <View className="w-full h-px bg-outline-variant/30 my-4" />
        <MaterialIcons name="info" size={20} color="#464555" />
        <Text className="font-helper-text text-helper-text text-on-surface-variant text-center px-4 mt-2">
          AI provides decision support. Final action remains with the nurse.
        </Text>
      </View>
    </SafeAreaView>
  );
}
