import { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";

// Ported from stitch_patienttriage.ai_nurse_portal/splash_screen/code.html
export function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <SafeAreaView className="flex-1 bg-surface items-center justify-between px-container-padding py-16">
      <View className="flex-1" />

      <View className="flex-[2] w-full items-center justify-center">
        <View className="w-32 h-32 mb-4 rounded-3xl bg-surface-container-lowest shadow-sm border border-outline-variant items-center justify-center">
          <MaterialIcons name="emergency" size={56} color="#3525cd" />
        </View>

        <Text className="font-headline-lg text-headline-lg text-on-surface text-center">
          PATIENTTRIAGE.AI
        </Text>
        <Text className="font-headline-md text-headline-md text-primary text-center mt-stack-gap">
          Smarter Patient Routing. Faster Care.
        </Text>

        <View className="w-12 h-1 bg-outline-variant rounded-full my-section-gap" />

        <Text className="font-body-lg text-body-lg text-on-surface-variant text-center px-6">
          AI-powered decision support for emergency departments
        </Text>

        <View className="mt-section-gap flex-row items-center">
          <ActivityIndicator size="small" color="#3525cd" />
          <Text className="font-helper-text text-helper-text text-on-surface-variant ml-2">
            Connecting to CityCare EHR...
          </Text>
        </View>
      </View>

      <View className="flex-1 w-full items-center justify-end">
        <Text className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider text-center">
          CityCare Hospital • Emergency Department
        </Text>
        <View className="flex-row items-center mt-2">
          <MaterialIcons name="verified-user" size={16} color="#3525cd" />
          <Text className="font-helper-text text-helper-text text-on-surface-variant ml-1">
            Secure clinical decision support
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
