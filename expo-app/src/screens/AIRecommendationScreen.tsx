import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { TopAppBar } from "../components/TopAppBar";
import { BottomNavBar, type TabKey } from "../components/BottomNavBar";
import { OverrideModal } from "../components/OverrideModal";
import { ReassessModal } from "../components/ReassessModal";
import { useAppDispatch, useAppState } from "../lib/store";
import { urgencyStyles } from "../lib/urgency";
import { reviewRecommendation, isAiConfigured, type AiReview } from "../lib/ai";
import {
  analyzeHolistic,
  analyzePriorRecord,
  findSimilarEncounters,
  type HolisticAnalysis,
  type PriorRecordAnalysis,
} from "../lib/aiClinical";

// Ported from stitch_patienttriage.ai_nurse_portal/ai_recommendation_result/code.html
export function AIRecommendationScreen({
  encounterId,
  onBack,
  onAccepted,
  onNavigateTab,
}: {
  encounterId: string;
  onBack: () => void;
  onAccepted: () => void;
  onNavigateTab: (tab: TabKey) => void;
}) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reassessOpen, setReassessOpen] = useState(false);
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [holistic, setHolistic] = useState<HolisticAnalysis | null>(null);
  const [prior, setPrior] = useState<PriorRecordAnalysis | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);

  const encounter = state.encounters.find((e) => e.id === encounterId);
  const patient = encounter ? state.patients.find((p) => p.id === encounter.patientId) : undefined;

  // Progressive enrichment: the rule-based recommendation renders immediately;
  // this advisory second opinion arrives afterwards and never gates it.
  // NOTE: this hook must stay ABOVE the "not found" early return below, or the
  // hook count changes between renders and React throws.
  useEffect(() => {
    if (!isAiConfigured() || !encounter) return;
    let cancelled = false;
    setAiBusy(true);
    const beds = state.resources.filter((r) => r.category === "Beds").reduce((n, r) => n + r.available, 0);
    const constrained = state.resources.filter((r) => r.status !== "Available").map((r) => r.name).join(", ") || "none";
    const context = [
      "Mode: " + state.hospital.currentMode,
      "Patients waiting: " + state.encounters.length,
      "Beds available: " + beds,
      "Constrained resources: " + constrained,
    ].join(" | ");
    reviewRecommendation(encounter, encounter.recommendation, context)
      .then((r) => {
        if (!cancelled) setAiReview(r);
      })
      .finally(() => {
        if (!cancelled) setAiBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId]);

  // Deep situational analysis: prior-record comparison, similar-case retrieval,
  // then a holistic read of the whole picture. Runs after the rule-based
  // recommendation is already on screen and never gates it. Also stays BELOW
  // the early return guard concern by living above it (see note on the hook
  // ordering rule in the effect above).
  useEffect(() => {
    if (!isAiConfigured() || !encounter || !patient) return;
    let cancelled = false;
    setDeepBusy(true);

    const beds = state.resources.filter((r) => r.category === "Beds").reduce((n, r) => n + r.available, 0);
    const constrained = state.resources.filter((r) => r.status !== "Available").map((r) => r.name).join(", ") || "none";
    const context = [
      "Mode: " + state.hospital.currentMode,
      "Patients waiting: " + state.encounters.filter((e) => e.status === "Waiting").length,
      "Beds available: " + beds,
      "Constrained: " + constrained,
    ].join(" | ");

    const similar = findSimilarEncounters(encounter, state.encounters, state.patients, 3);

    analyzePriorRecord(patient, encounter)
      .then((p) => {
        if (!cancelled) setPrior(p);
        return analyzeHolistic({
          encounter,
          patient,
          recommendation: encounter.recommendation,
          priorAnalysis: p,
          similarCases: similar,
          hospitalContext: context,
        });
      })
      .then((h) => {
        if (!cancelled) setHolistic(h);
      })
      .catch((err) => console.warn("[ai] deep analysis failed:", err))
      .finally(() => {
        if (!cancelled) setDeepBusy(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId]);

  if (!encounter || !patient) {
    return (
      <View className="flex-1 bg-surface items-center justify-center">
        <Text className="font-body-md text-body-md text-on-surface-variant">Encounter not found.</Text>
      </View>
    );
  }

  const rec = encounter.recommendation;
  const s = urgencyStyles[rec.level];

  const known: string[] = [];
  if (encounter.symptoms.length) known.push("Symptoms");
  if (encounter.onset) known.push("Onset");
  if (encounter.vitals.pulse || encounter.vitals.bpSystolic || encounter.vitals.spo2) known.push("Vitals");
  if (encounter.history.conditions && !["Unknown", "Not asked yet"].includes(encounter.history.conditions)) known.push("History");
  if (!known.length) known.push("Basic demographics");

  return (
    <View className="flex-1 bg-surface">
      <TopAppBar variant="task" title="CityCare ED Triage" onBack={onBack} onDashboard={() => onNavigateTab("dashboard")} />
      <ScrollView className="flex-1" contentContainerClassName="px-container-padding py-section-gap gap-section-gap pb-8">
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="smart-toy" size={20} color="#3525cd" />
            <Text className="font-headline-lg text-headline-lg text-on-surface">AI Routing Recommendation</Text>
          </View>
          <Text className="font-body-md text-body-md text-on-surface-variant">
            {patient.name}, {patient.age} • {patient.sex}, {encounter.id}
          </Text>
        </View>

        <View className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-5 gap-4 relative overflow-hidden">
          <View className={`absolute top-0 left-0 right-0 h-1 ${s.bar}`} />
          <View className="flex-row justify-between items-start">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="warning" size={18} color={s.hex} />
              <Text className={`font-label-caps text-label-caps uppercase ${s.text}`}>PRIORITY: {s.label}</Text>
            </View>
            <View className="bg-surface-container-high px-3 py-1 rounded-full flex-row items-center gap-1 border border-outline-variant">
              <MaterialIcons name="verified" size={14} color="#3525cd" />
              <Text className="font-helper-text text-helper-text text-on-surface">Confidence: {Math.round(rec.confidence * 100)}%</Text>
            </View>
          </View>
          <View className="gap-1">
            <Text className="font-label-caps text-label-caps text-on-surface-variant">PATHWAY</Text>
            <Text className="font-stat-value text-stat-value text-on-surface">{rec.pathway}</Text>
          </View>
          <View className="flex-row gap-4">
            <View className="flex-1 bg-surface-container-low p-3 rounded-lg border border-outline-variant gap-1">
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="location-on" size={13} color="#464555" />
                <Text className="font-label-caps text-label-caps text-on-surface-variant">DESTINATION</Text>
              </View>
              <Text className="font-body-lg text-body-lg text-on-surface font-semibold">{rec.destination}</Text>
            </View>
            <View className="flex-1 bg-surface-container-low p-3 rounded-lg border border-outline-variant gap-1">
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="schedule" size={13} color="#464555" />
                <Text className="font-label-caps text-label-caps text-on-surface-variant">EST. WAIT</Text>
              </View>
              <Text className="font-body-lg text-body-lg text-on-surface font-semibold">{rec.estimatedWait} min</Text>
            </View>
          </View>
        </View>

        <View className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-5 gap-3">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="psychology" size={18} color="#3525cd" />
            <Text className="font-headline-md text-headline-md text-on-surface">WHY THIS RECOMMENDATION?</Text>
          </View>
          {rec.reasons.map((r, i) => (
            <View key={i} className="flex-row items-start gap-3">
              <View className="mt-1.5 w-2 h-2 rounded-full bg-primary" />
              <Text className="flex-1 font-body-md text-body-md text-on-surface">{r}</Text>
            </View>
          ))}
        </View>

        <View className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-5 gap-4">
          <Text className="font-headline-md text-headline-md text-on-surface border-b border-outline-variant pb-2">INFORMATION STATUS</Text>
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="check-circle" size={16} color="#16A34A" />
              <Text className="font-label-caps text-label-caps text-[#16A34A]">KNOWN</Text>
            </View>
            <Text className="font-body-md text-body-md text-on-surface ml-6">{known.join(", ")}</Text>
          </View>
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="error" size={16} color="#DC2626" />
              <Text className="font-label-caps text-label-caps text-[#DC2626]">MISSING</Text>
            </View>
            <Text className="font-body-md text-body-md text-on-surface ml-6">{rec.missingInfo.join(", ") || "None"}</Text>
          </View>
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="help" size={16} color="#D97706" />
              <Text className="font-label-caps text-label-caps text-[#D97706]">UNCERTAIN</Text>
            </View>
            <Text className="font-body-md text-body-md text-on-surface ml-6">{rec.uncertainty.join(", ") || "None"}</Text>
          </View>
        </View>

        {(aiBusy || aiReview) && (
          <View className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="auto-awesome" size={18} color="#3525cd" />
              <Text className="font-headline-md text-headline-md text-on-surface">AI SECOND OPINION</Text>
              {aiBusy && <ActivityIndicator size="small" color="#3525cd" />}
            </View>
            {aiReview ? (
              <>
                <View className={`self-start px-2 py-1 rounded-md ${aiReview.concurs ? "bg-[#F0FDF4]" : "bg-error-container"}`}>
                  <Text className={`font-label-caps text-label-caps ${aiReview.concurs ? "text-[#16A34A]" : "text-on-error-container"}`}>
                    {aiReview.concurs ? "CONCURS WITH ROUTING" : "FLAGS A CONCERN"}
                  </Text>
                </View>
                <Text className="font-body-md text-body-md text-on-surface">{aiReview.narrative}</Text>
                {aiReview.additionalConsiderations.length > 0 && (
                  <View className="gap-1">
                    <Text className="font-label-caps text-label-caps text-on-surface-variant">ALSO CONSIDER</Text>
                    {aiReview.additionalConsiderations.map((c, i) => (
                      <Text key={i} className="font-body-md text-body-md text-on-surface">• {c}</Text>
                    ))}
                  </View>
                )}
                {aiReview.suggestedQuestions.length > 0 && (
                  <View className="gap-1">
                    <Text className="font-label-caps text-label-caps text-primary">ASK NEXT</Text>
                    {aiReview.suggestedQuestions.map((q, i) => (
                      <Text key={i} className="font-body-md text-body-md text-on-surface">• {q}</Text>
                    ))}
                  </View>
                )}
                <Text className="font-helper-text text-helper-text text-on-surface-variant">
                  Advisory only. The routing above comes from the rule engine and is unchanged by this review.
                </Text>
              </>
            ) : (
              <Text className="font-body-md text-body-md text-on-surface-variant">Reviewing against hospital state…</Text>
            )}
          </View>
        )}

        {prior && (
          <View className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="history" size={18} color="#3525cd" />
              <Text className="font-headline-md text-headline-md text-on-surface">PRIOR RECORD</Text>
              {prior.isRepresentation && (
                <View className="px-2 py-0.5 rounded-md bg-error-container">
                  <Text className="font-label-caps text-label-caps text-on-error-container">RE-PRESENTATION</Text>
                </View>
              )}
            </View>
            <Text className="font-body-md text-body-md text-on-surface">{prior.summary}</Text>
            {prior.representationConcern ? (
              <Text className="font-body-md text-body-md text-error">{prior.representationConcern}</Text>
            ) : null}
            {prior.changedSinceLastVisit.length > 0 && (
              <View className="gap-1">
                <Text className="font-label-caps text-label-caps text-on-surface-variant">CHANGED SINCE LAST VISIT</Text>
                {prior.changedSinceLastVisit.map((c, i) => (
                  <Text key={i} className="font-body-md text-body-md text-on-surface">• {c}</Text>
                ))}
              </View>
            )}
            {prior.relevantRisks.length > 0 && (
              <View className="gap-1">
                <Text className="font-label-caps text-label-caps text-on-surface-variant">RELEVANT PRIOR RISKS</Text>
                {prior.relevantRisks.map((r, i) => (
                  <Text key={i} className="font-body-md text-body-md text-on-surface">• {r}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {(deepBusy || holistic) && (
          <View className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="psychology" size={18} color="#3525cd" />
              <Text className="font-headline-md text-headline-md text-on-surface">SITUATIONAL ANALYSIS</Text>
              {deepBusy && <ActivityIndicator size="small" color="#3525cd" />}
            </View>

            {holistic ? (
              <>
                {holistic.atypicalPresentationWarning ? (
                  <View className="bg-error-container/40 border border-error/20 rounded-lg p-3 gap-1">
                    <View className="flex-row items-center gap-1">
                      <MaterialIcons name="warning" size={14} color="#93000a" />
                      <Text className="font-label-caps text-label-caps text-on-error-container">ATYPICAL PRESENTATION RISK</Text>
                    </View>
                    <Text className="font-body-md text-body-md text-on-surface">{holistic.atypicalPresentationWarning}</Text>
                  </View>
                ) : null}

                <Text className="font-body-md text-body-md text-on-surface">{holistic.overallAssessment}</Text>

                {holistic.riskssMissedByRules.length > 0 && (
                  <View className="gap-1">
                    <Text className="font-label-caps text-label-caps text-on-surface-variant">RULES MAY HAVE MISSED</Text>
                    {holistic.riskssMissedByRules.map((r, i) => (
                      <Text key={i} className="font-body-md text-body-md text-on-surface">• {r}</Text>
                    ))}
                  </View>
                )}

                {holistic.recommendedNextActions.length > 0 && (
                  <View className="gap-1">
                    <Text className="font-label-caps text-label-caps text-primary">SUGGESTED NEXT ACTIONS</Text>
                    {holistic.recommendedNextActions.map((a, i) => (
                      <Text key={i} className="font-body-md text-body-md text-on-surface">• {a}</Text>
                    ))}
                  </View>
                )}

                {holistic.precedentInsight ? (
                  <View className="gap-1">
                    <Text className="font-label-caps text-label-caps text-on-surface-variant">SIMILAR PAST CASES</Text>
                    <Text className="font-body-md text-body-md text-on-surface">{holistic.precedentInsight}</Text>
                    <Text className="font-helper-text text-helper-text text-on-surface-variant">
                      Retrieved from synthetic demo records — illustrative precedent, not clinical evidence.
                    </Text>
                  </View>
                ) : null}

                <View className="flex-row items-center gap-2 pt-1">
                  <Text className="font-label-caps text-label-caps text-on-surface-variant">
                    AI CONFIDENCE: {holistic.confidenceInAssessment.toUpperCase()}
                  </Text>
                </View>
                <Text className="font-helper-text text-helper-text text-on-surface-variant">
                  {holistic.confidenceRationale} · Advisory only — the routing above comes from the rule engine and is unchanged.
                </Text>
              </>
            ) : (
              <Text className="font-body-md text-body-md text-on-surface-variant">Reviewing the full picture…</Text>
            )}
          </View>
        )}

        <View className="gap-3">
          <Pressable
            onPress={() => {
              dispatch({ type: "accept", encounterId });
              onAccepted();
            }}
            className="bg-primary-container w-full h-touch-target-min rounded-lg flex-row items-center justify-center gap-2 shadow-sm active:opacity-80"
          >
            <MaterialIcons name="check" size={18} color="#dad7ff" />
            <Text className="font-label-caps text-label-caps text-on-primary-container">Accept Recommendation</Text>
          </Pressable>
          <View className="flex-row gap-2">
            <Pressable onPress={() => setOverrideOpen(true)} className="flex-1 bg-surface-container-lowest border border-outline-variant h-touch-target-min rounded-lg items-center justify-center gap-1">
              <MaterialIcons name="edit-note" size={18} color="#1b1b24" />
              <Text className="font-label-caps text-label-caps text-on-surface">Override</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                dispatch({ type: "escalate", encounterId, reason: "Nurse escalated from AI recommendation screen" });
                onAccepted();
              }}
              className="flex-1 bg-surface-container-lowest border border-outline-variant h-touch-target-min rounded-lg items-center justify-center gap-1"
            >
              <MaterialIcons name="priority-high" size={18} color="#ba1a1a" />
              <Text className="font-label-caps text-label-caps text-error">Escalate</Text>
            </Pressable>
            <Pressable onPress={() => setReassessOpen(true)} className="flex-1 bg-surface-container-lowest border border-outline-variant h-touch-target-min rounded-lg items-center justify-center gap-1">
              <MaterialIcons name="restart-alt" size={18} color="#1b1b24" />
              <Text className="font-label-caps text-label-caps text-on-surface">Reassess</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <BottomNavBar active="dashboard" onSelect={onNavigateTab} />

      <OverrideModal
        visible={overrideOpen}
        currentPathway={rec.pathway}
        currentLevel={rec.level}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={(pathway, level, reason) => {
          dispatch({ type: "override", encounterId, pathway, level, reason });
          setOverrideOpen(false);
          onAccepted();
        }}
      />
      <ReassessModal
        visible={reassessOpen}
        onCancel={() => setReassessOpen(false)}
        onConfirm={(note) => {
          dispatch({ type: "reassess", encounterId, note });
          setReassessOpen(false);
        }}
      />
    </View>
  );
}
