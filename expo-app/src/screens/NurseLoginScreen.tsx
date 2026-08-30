import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppDispatch } from "../lib/store";

// Ported from stitch_patienttriage.ai_nurse_portal/nurse_login/code.html
export function NurseLoginScreen({ onLogin }: { onLogin: () => void }) {
  const dispatch = useAppDispatch();
  const [rollNumber, setRollNumber] = useState("NUR-1042");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function handleSignIn() {
    dispatch({ type: "loginNurse", rollNumber: rollNumber.trim() || "NUR-1042" });
    onLogin();
  }

  return (
    <SafeAreaView className="flex-1 bg-background items-center justify-center px-container-padding">
      <View className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
        <View className="p-section-gap pb-0">
          <View className="w-12 h-12 bg-primary-container rounded-full items-center justify-center mb-section-gap">
            <MaterialIcons name="local-hospital" size={24} color="#dad7ff" />
          </View>
          <Text className="font-headline-lg text-headline-lg text-on-surface mb-1">Welcome back</Text>
          <Text className="font-body-md text-body-md text-on-surface-variant">
            Sign in to continue to CityCare Emergency Department
          </Text>
        </View>

        <View className="p-section-gap gap-section-gap">
          <View className="gap-stack-gap">
            <View>
              <Text className="font-label-caps text-label-caps text-on-surface mb-1">Nurse Roll Number</Text>
              <View className="relative flex-row items-center bg-surface-container-low rounded-lg h-touch-target-min px-3">
                <MaterialIcons name="badge" size={20} color="#464555" />
                <TextInput
                  className="flex-1 ml-2 font-body-lg text-body-lg text-on-surface"
                  placeholder="NUR-1042"
                  placeholderTextColor="#777587"
                  value={rollNumber}
                  onChangeText={setRollNumber}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View>
              <Text className="font-label-caps text-label-caps text-on-surface mb-1">Password</Text>
              <View className="relative flex-row items-center bg-surface-container-low rounded-lg h-touch-target-min px-3">
                <MaterialIcons name="lock" size={20} color="#464555" />
                <TextInput
                  className="flex-1 ml-2 font-body-lg text-body-lg text-on-surface"
                  placeholder="Enter password"
                  placeholderTextColor="#777587"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                  <MaterialIcons name={showPassword ? "visibility-off" : "visibility"} size={20} color="#464555" />
                </Pressable>
              </View>
            </View>
          </View>

          <Pressable
            className="w-full h-touch-target-min bg-primary-container rounded-lg items-center justify-center active:opacity-80"
            onPress={handleSignIn}
          >
            <Text className="font-headline-md text-headline-md text-on-primary-container">Sign In</Text>
          </Pressable>
        </View>
      </View>

      <Text className="font-helper-text text-helper-text text-on-surface-variant mt-section-gap text-center">
        CITYCARE HOSPITAL • Emergency Department • India
      </Text>
    </SafeAreaView>
  );
}
