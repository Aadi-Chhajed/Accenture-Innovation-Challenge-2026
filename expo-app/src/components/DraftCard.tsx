import { View, Text, Pressable } from "react-native";
import type { DraftEncounter } from "../lib/types";
import { initials } from "../lib/urgency";

export function DraftCard({ draft, onResume }: { draft: DraftEncounter; onResume: () => void }) {
  return (
    <View className="bg-white rounded-2xl border border-dashed border-outline-variant shadow-sm overflow-hidden relative flex-row opacity-90">
      <View className="w-1 bg-outline-variant" />
      <View className="flex-1 p-4 pl-4 gap-3">
        <View className="flex-row items-start gap-3">
          <View className="w-12 h-12 border-2 border-dashed border-outline-variant rounded-full items-center justify-center shrink-0">
            <Text className="font-headline-md text-headline-md text-on-surface-variant font-bold">{initials(draft.patientName)}</Text>
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="font-headline-md text-headline-md text-on-surface">{draft.patientName}</Text>
              <View className="px-2 py-0.5 bg-surface-container rounded border border-outline-variant/30">
                <Text className="font-label-caps text-label-caps text-on-surface-variant">Draft</Text>
              </View>
            </View>
            <Text className="font-body-md text-body-md text-on-surface-variant mt-1 italic">Incomplete onboarding…</Text>
            <View className="flex-row items-center gap-2 mt-2">
              <View className="h-2 flex-1 max-w-[160px] bg-surface-container-high rounded-full overflow-hidden">
                <View className="h-full bg-primary" style={{ width: `${draft.completionPct}%` }} />
              </View>
              <Text className="font-helper-text text-helper-text text-on-surface-variant">{draft.completionPct}%</Text>
            </View>
          </View>
        </View>
        <Pressable onPress={onResume} className="self-end border border-primary/20 rounded-md px-4 py-2 active:bg-surface-container-low">
          <Text className="font-label-caps text-label-caps text-primary">RESUME</Text>
        </Pressable>
      </View>
    </View>
  );
}
