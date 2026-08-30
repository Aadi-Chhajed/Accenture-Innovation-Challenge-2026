import { useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { pathways } from "../lib/pathways";

const reasonOptions = [
  "Clinical judgment",
  "Patient condition changed",
  "Resource unavailable",
  "Missing information",
  "Doctor instruction",
  "Other",
];

export function OverrideModal({
  visible,
  currentPathway,
  currentLevel,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  currentPathway: string;
  currentLevel: number;
  onCancel: () => void;
  onConfirm: (pathway: string, level: number, reason: string) => void;
}) {
  const [pathway, setPathway] = useState(currentPathway);
  const [level, setLevel] = useState(currentLevel);
  const [reason, setReason] = useState(reasonOptions[0]);
  const [note, setNote] = useState("");
  if (!visible) return null;

  return (
    <View className="absolute inset-0 z-50 bg-black/40 justify-end">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="max-h-[85%]">
        <View className="bg-surface-container-lowest rounded-t-2xl overflow-hidden">
          <Text className="font-headline-lg text-headline-lg text-on-surface px-section-gap pt-section-gap pb-2">
            Override recommendation
          </Text>

          {/* Ten pathway chips + six reason chips can exceed the sheet's max
              height on a phone; without a ScrollView the Confirm button below
              them would be pushed off-screen with no way to reach it. */}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-section-gap gap-stack-gap pb-2">
            <Text className="font-label-caps text-label-caps text-on-surface-variant">New pathway</Text>
            <View className="flex-row flex-wrap gap-x-2">
              {pathways.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPathway(p)}
                  className={`px-3 py-2 rounded-lg border mb-2 ${pathway === p ? "border-primary bg-primary-fixed-dim/20" : "border-outline-variant"}`}
                >
                  <Text className={`font-body-md text-body-md ${pathway === p ? "text-primary" : "text-on-surface"}`}>{p}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="font-label-caps text-label-caps text-on-surface-variant mt-2">New urgency level</Text>
            <View className="flex-row gap-2">
              {[1, 2, 3, 4, 5].map((lvl) => (
                <Pressable
                  key={lvl}
                  onPress={() => setLevel(lvl)}
                  className={`w-11 h-11 rounded-full items-center justify-center border ${level === lvl ? "border-primary bg-primary-fixed-dim/20" : "border-outline-variant"}`}
                >
                  <Text className={`font-headline-md text-headline-md ${level === lvl ? "text-primary" : "text-on-surface"}`}>{lvl}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="font-label-caps text-label-caps text-on-surface-variant mt-2">Reason</Text>
            <View className="flex-row flex-wrap gap-x-2">
              {reasonOptions.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setReason(r)}
                  className={`px-3 py-1.5 rounded-full border mb-2 ${reason === r ? "border-primary bg-primary-fixed-dim/20" : "border-outline-variant"}`}
                >
                  <Text className={`font-label-caps text-label-caps ${reason === r ? "text-primary" : "text-on-surface"}`}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              className="bg-surface-container-low rounded-lg px-3 py-2 font-body-md text-body-md text-on-surface min-h-[44px]"
              placeholder="Add detail (optional)"
              placeholderTextColor="#777587"
              value={note}
              onChangeText={setNote}
              multiline
            />
          </ScrollView>

          <View className="flex-row gap-3 px-section-gap py-3 border-t border-outline-variant">
            <Pressable onPress={onCancel} className="flex-1 h-touch-target-min rounded-lg border border-outline-variant items-center justify-center">
              <Text className="font-label-caps text-label-caps text-on-surface">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(pathway, level, note ? `${reason}: ${note}` : reason)}
              className="flex-1 h-touch-target-min rounded-lg bg-primary items-center justify-center"
            >
              <Text className="font-label-caps text-label-caps text-on-primary">Confirm Override</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
