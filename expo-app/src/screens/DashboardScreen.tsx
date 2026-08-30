import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppState } from "../lib/store";
import { TopAppBar } from "../components/TopAppBar";
import { BottomNavBar, type TabKey } from "../components/BottomNavBar";
import { StatCard } from "../components/StatCard";
import { PatientCard } from "../components/PatientCard";
import { DraftCard } from "../components/DraftCard";
import type { DraftEncounter } from "../lib/types";

type FilterKey = "All" | "Critical" | "High" | "Moderate" | "Routine" | "Drafts";
const filters: FilterKey[] = ["All", "Critical", "High", "Moderate", "Routine", "Drafts"];

// Ported from stitch_patienttriage.ai_nurse_portal/nurse_dashboard/code.html
export function DashboardScreen({
  onNavigateTab,
  onSelectPatient,
  onResumeDraft,
  initialFilter = "All",
}: {
  onNavigateTab: (tab: TabKey) => void;
  onSelectPatient: (encounterId: string) => void;
  onResumeDraft: (draft: DraftEncounter) => void;
  initialFilter?: FilterKey;
}) {
  const state = useAppState();
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [search, setSearch] = useState("");

  // Keep the chip row in sync when the Drafts tab is tapped from the nav bar.
  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const staffAvailable = state.staff.filter((s) => s.status === "Available").length;
  const bedsAvailable = state.resources.filter((r) => r.category === "Beds").reduce((sum, r) => sum + r.available, 0);
  const roomsAvailable = state.resources.filter((r) => r.category === "Rooms").reduce((sum, r) => sum + r.available, 0);
  const activeAlerts = state.alerts.filter((a) => !a.acknowledged).length;

  const activeEncounters = state.encounters.filter((e) => e.status !== "Transferred");
  const waiting = activeEncounters.length;
  const highPriority = activeEncounters.filter((e) => e.recommendation.level <= 2).length;
  const avgWait = waiting ? Math.round(activeEncounters.reduce((sum, e) => sum + e.waitingMins, 0) / waiting) : 0;
  const needsAttention = state.alerts.filter((a) => !a.acknowledged).length;

  const filteredEncounters = useMemo(() => {
    if (filter === "Drafts") return [];
    let list = activeEncounters;
    if (filter === "Critical") list = list.filter((e) => e.recommendation.level === 1);
    if (filter === "High") list = list.filter((e) => e.recommendation.level === 2);
    if (filter === "Moderate") list = list.filter((e) => e.recommendation.level === 3);
    if (filter === "Routine") list = list.filter((e) => e.recommendation.level >= 4);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => {
        const patient = state.patients.find((p) => p.id === e.patientId);
        return patient?.name.toLowerCase().includes(q) || e.token?.toLowerCase().includes(q);
      });
    }
    return list;
  }, [activeEncounters, filter, search, state.patients]);

  const query = search.trim().toLowerCase();
  const visibleDrafts = useMemo(
    () => (query ? state.drafts.filter((d) => d.patientName.toLowerCase().includes(query)) : state.drafts),
    [state.drafts, query]
  );
  const showDrafts = filter === "All" || filter === "Drafts";

  return (
    <View className="flex-1 bg-[#F8FAFC]">
      <TopAppBar variant="main" nurseName={state.nurseSession?.name} alertCount={activeAlerts} onDashboard={() => onNavigateTab("alerts")} />
      <ScrollView className="flex-1" contentContainerClassName="px-container-padding py-section-gap gap-section-gap pb-32">
        <View>
          <Text className="font-headline-lg text-headline-lg text-on-surface">
            Good morning, {state.nurseSession?.name ?? "Nurse"}
          </Text>
          <Text className="font-body-md text-body-md text-on-surface-variant mt-1">{state.hospital.name} Emergency Department</Text>
        </View>

        {/* Explicit 2x2 grid, not flex-wrap: on this RN build a wrapped
            container's intrinsic height doesn't reliably include the gap
            contributed by later wrapped rows, so a sibling below it (the
            hospital status bar) rendered on top of row 2 instead of under it.
            Two fixed rows sidestep the bug entirely — verified on device. */}
        <View className="gap-stack-gap">
          <View className="flex-row gap-stack-gap">
            <StatCard label="Waiting" value={waiting} unit="pts" />
            <StatCard label="High Priority" value={highPriority} unit="pts" tone="error" />
          </View>
          <View className="flex-row gap-stack-gap">
            <StatCard label="Avg Wait" value={avgWait} unit="min" />
            <StatCard label="Needs Attention" value={needsAttention} unit="pts" tone="warning" />
          </View>
        </View>

        <View className="bg-surface-container-low rounded-lg p-3 flex-row flex-wrap gap-x-4 items-center border border-outline-variant/30">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="group" size={16} color="#464555" />
            <Text className="font-label-caps text-label-caps text-on-surface">
              Staff: <Text className="font-bold">{staffAvailable}</Text>
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="bed" size={16} color="#464555" />
            <Text className="font-label-caps text-label-caps text-on-surface">
              Beds: <Text className="font-bold">{bedsAvailable}</Text>
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="meeting-room" size={16} color="#464555" />
            <Text className="font-label-caps text-label-caps text-on-surface">
              Rooms: <Text className="font-bold">{roomsAvailable}</Text>
            </Text>
          </View>
          <View className="flex-row items-center gap-2 ml-auto">
            <MaterialIcons name="warning" size={16} color="#ba1a1a" />
            <Text className="font-label-caps text-label-caps text-error">
              Active Alerts: <Text className="font-bold">{activeAlerts}</Text>
            </Text>
          </View>
        </View>

        <View className="gap-stack-gap">
          <Text className="font-headline-md text-headline-md text-on-surface">Live Patient Queue</Text>
          <View className="flex-row items-center bg-[#F1F5F9] rounded-md px-3 h-touch-target-min gap-2">
            <MaterialIcons name="search" size={18} color="#464555" />
            <TextInput
              className="flex-1 font-body-md text-body-md text-on-surface"
              placeholder="Search patients..."
              placeholderTextColor="#777587"
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {filters.map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full border ${f === filter ? "bg-primary-container border-primary-container" : "bg-white border-[#E2E8F0]"}`}
            >
              <Text className={`font-label-caps text-label-caps ${f === filter ? "text-on-primary-container" : "text-on-surface-variant"}`}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View className="gap-stack-gap">
          {filteredEncounters.map((encounter) => {
            const patient = state.patients.find((p) => p.id === encounter.patientId);
            if (!patient) return null;
            return <PatientCard key={encounter.id} encounter={encounter} patient={patient} onPress={() => onSelectPatient(encounter.id)} />;
          })}
          {showDrafts &&
            visibleDrafts.map((draft) => <DraftCard key={draft.id} draft={draft} onResume={() => onResumeDraft(draft)} />)}
          {filteredEncounters.length === 0 && !(showDrafts && visibleDrafts.length) ? (
            <Text className="font-body-md text-body-md text-on-surface-variant text-center py-8">No patients match this filter.</Text>
          ) : null}
        </View>
      </ScrollView>

      <Pressable
        onPress={() => onNavigateTab("newPatient")}
        className="absolute bottom-20 right-4 w-14 h-14 bg-primary rounded-2xl items-center justify-center shadow-lg active:scale-95"
      >
        <MaterialIcons name="add" size={26} color="#ffffff" />
      </Pressable>

      <BottomNavBar active="dashboard" onSelect={onNavigateTab} draftCount={state.drafts.length} alertCount={activeAlerts} />
    </View>
  );
}
