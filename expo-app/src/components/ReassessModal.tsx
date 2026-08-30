import { useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";

export function ReassessModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  if (!visible) return null;

  return (
    <View className="absolute inset-0 z-50 bg-black/40 justify-end">
      <View className="bg-surface-container-lowest rounded-t-2xl p-section-gap gap-stack-gap">
          <Text className="font-headline-lg text-headline-lg text-on-surface">Request reassessment</Text>
          <Text className="font-body-md text-body-md text-on-surface-variant">
            What changed? The routing recommendation will be recalculated with this new observation.
          </Text>
          <TextInput
            className="bg-surface-container-low rounded-lg px-3 py-2 font-body-md text-body-md text-on-surface min-h-[88px]"
            placeholder="e.g. Patient now reports worsening breathlessness"
            placeholderTextColor="#777587"
            value={note}
            onChangeText={setNote}
            multiline
            autoFocus
          />
          <View className="flex-row gap-3 mt-2">
            <Pressable onPress={onCancel} className="flex-1 h-touch-target-min rounded-lg border border-outline-variant items-center justify-center">
              <Text className="font-label-caps text-label-caps text-on-surface">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(note || "Nurse requested reassessment")}
              className="flex-1 h-touch-target-min rounded-lg bg-primary items-center justify-center"
            >
              <Text className="font-label-caps text-label-caps text-on-primary">Reassess</Text>
            </Pressable>
          </View>
        </View>
    </View>
  );
}
