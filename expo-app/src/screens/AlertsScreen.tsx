import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { TopAppBar } from "../components/TopAppBar";
import { BottomNavBar, type TabKey } from "../components/BottomNavBar";
import { AlertCard } from "../components/AlertCard";
import { useAppDispatch, useAppState } from "../lib/store";

type FilterKey = "All" | "Critical" | "Warning" | "Info";
const filters: FilterKey[] = ["All", "Critical", "Warning", "Info"];

// Ported from stitch_patienttriage.ai_nurse_portal/alerts_needs_attention/code.html
export function AlertsScreen({
  onNavigateTab,
  onOpenEncounter,
}: {
  onNavigateTab: (tab: TabKey) => void;
  onOpenEncounter: (encounterId: string) => void;
}) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [filter, setFilter] = useState<FilterKey>("All");

  const alerts = state.alerts.filter((a) => filter === "All" || a.level === filter);

  return (
    <View className="flex-1 bg-surface-bright">
      <TopAppBar variant="main" nurseName={state.nurseSession?.name} onDashboard={() => onNavigateTab("dashboard")} />
      <ScrollView className="flex-1" contentContainerClassName="px-container-padding pt-6 gap-section-gap pb-28">
        <View>
          <Text className="font-headline-lg text-headline-lg text-on-surface mb-1">Needs Attention</Text>
          <Text className="font-body-md text-body-md text-on-surface-variant">Review critical patient alerts and outstanding tasks.</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {filters.map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              className={`h-8 px-4 rounded-md items-center justify-center border ${f === filter ? "bg-primary-container border-primary-container" : "bg-surface-container border-outline-variant"}`}
            >
              <Text className={`font-label-caps text-label-caps ${f === filter ? "text-on-primary-container" : "text-on-surface"}`}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View className="gap-stack-gap">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAction={() => {
                dispatch({ type: "acknowledgeAlert", alertId: alert.id });
                if (alert.encounterId) onOpenEncounter(alert.encounterId);
              }}
            />
          ))}
          {alerts.length === 0 && <Text className="font-body-md text-body-md text-on-surface-variant text-center py-8">No alerts in this category.</Text>}
        </View>
      </ScrollView>
      <BottomNavBar active="alerts" onSelect={onNavigateTab} />
    </View>
  );
}
