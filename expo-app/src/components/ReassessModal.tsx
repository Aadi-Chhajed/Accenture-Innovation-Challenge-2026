import { useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { analyzeReassessment, type ReassessmentAnalysis } from "../lib/aiClinical";
import { isAiConfigured } from "../lib/ai";
import type { Encounter } from "../lib/types";

export function ReassessModal({
  visible,
  encounter,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  /** Optional: when supplied, the nurse can have the AI judge whether the
   *  change is clinically meaningful before committing the reassessment. */
  encounter?: Encounter;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [analysis, setAnalysis] = useState<ReassessmentAnalysis | null>(null);
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const canAnalyze = !!encounter && isAiConfigured();

  async function runAnalysis() {
    if (!encounter) return;
    if (!note.trim()) return;
    setBusy(true);
    try {
      // The encounter's own vitals stand in as the "at triage" baseline: the
      // nurse is describing a change against what was recorded, and no separate
      // historical snapshot is stored yet.
      const out = await analyzeReassessment(
        encounter,
        encounter.vitals,
        encounter.recommendation.level,
        note
      );
      setAnalysis(out);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setAnalysis(null);
    setNote("");
    onCancel();
  }

  return (
    <View className="absolute inset-0 z-50 bg-black/40 justify-end">
      <View className="bg-surface-container-lowest rounded-t-2xl overflow-hidden max-h-[85%]">
        <Text className="font-headline-lg text-headline-lg text-on-surface px-section-gap pt-section-gap pb-1">
          Request reassessment
        </Text>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-section-gap gap-stack-gap pb-2">
          <Text className="font-body-md text-body-md text-on-surface-variant">
            What changed? The routing recommendation will be recalculated with this new observation.
          </Text>
          <TextInput
            className="bg-surface-container-low rounded-lg px-3 py-2 font-body-md text-body-md text-on-surface min-h-[88px]"
            style={{ textAlignVertical: "top" }}
            placeholder="e.g. Patient now reports worsening breathlessness"
            placeholderTextColor="#777587"
            value={note}
            onChangeText={(v) => {
              setNote(v);
              // The note drove the previous analysis; once it changes that
              // analysis is stale, so drop it rather than show a stale verdict.
              if (analysis) setAnalysis(null);
            }}
            multiline
            autoFocus
          />

          {canAnalyze && (
            <Pressable
              onPress={runAnalysis}
              disabled={busy || !note.trim()}
              accessibilityRole="button"
              className={`h-touch-target-min rounded-lg flex-row items-center justify-center gap-2 ${
                busy || !note.trim() ? "bg-surface-container" : "bg-primary-container"
              }`}
            >
              {busy ? (
                <>
                  <ActivityIndicator size="small" color="#3525cd" />
                  <Text className="font-label-caps text-label-caps text-on-surface-variant">Assessing change…</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="auto-awesome" size={18} color={note.trim() ? "#dad7ff" : "#777587"} />
                  <Text
                    className={`font-label-caps text-label-caps ${note.trim() ? "text-on-primary-container" : "text-on-surface-variant"}`}
                  >
                    Is this change significant?
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {analysis && (
            <View
              className={`rounded-xl p-4 gap-2 border ${
                analysis.recommendEscalation
                  ? "bg-error-container/40 border-error/30"
                  : "bg-surface-container-low border-outline-variant"
              }`}
            >
              <View className="flex-row items-center gap-2">
                <MaterialIcons
                  name={analysis.recommendEscalation ? "warning" : "info"}
                  size={16}
                  color={analysis.recommendEscalation ? "#93000a" : "#464555"}
                />
                <Text className="font-label-caps text-label-caps text-on-surface">
                  {analysis.meaningfulChange ? "MEANINGFUL CHANGE" : "NO MEANINGFUL CHANGE"}
                </Text>
                {analysis.recommendEscalation && (
                  <View className="px-2 py-0.5 rounded-md bg-error">
                    <Text className="font-label-caps text-label-caps text-on-error">ESCALATE</Text>
                  </View>
                )}
              </View>

              <Text className="font-body-md text-body-md text-on-surface">{analysis.changeSummary}</Text>

              {analysis.deteriorationSignals.length > 0 && (
                <View className="gap-1">
                  <Text className="font-label-caps text-label-caps text-on-surface-variant">DETERIORATION SIGNALS</Text>
                  {analysis.deteriorationSignals.map((d, i) => (
                    <Text key={i} className="font-body-md text-body-md text-on-surface">• {d}</Text>
                  ))}
                </View>
              )}

              {analysis.suggestedAction ? (
                <View className="gap-1">
                  <Text className="font-label-caps text-label-caps text-primary">SUGGESTED ACTION</Text>
                  <Text className="font-body-md text-body-md text-on-surface">{analysis.suggestedAction}</Text>
                </View>
              ) : null}

              <Text className="font-helper-text text-helper-text text-on-surface-variant">
                Advisory only — confirming below recalculates routing from the rules, not from this assessment.
              </Text>
            </View>
          )}
        </ScrollView>

        <View className="flex-row gap-3 px-section-gap py-3 border-t border-outline-variant">
          <Pressable onPress={close} className="flex-1 h-touch-target-min rounded-lg border border-outline-variant items-center justify-center">
            <Text className="font-label-caps text-label-caps text-on-surface">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onConfirm(note || "Nurse requested reassessment");
              setAnalysis(null);
              setNote("");
            }}
            className="flex-1 h-touch-target-min rounded-lg bg-primary items-center justify-center"
          >
            <Text className="font-label-caps text-label-caps text-on-primary">Reassess</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
