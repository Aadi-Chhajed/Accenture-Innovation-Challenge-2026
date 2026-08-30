import { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert as RNAlert } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { TopAppBar } from "../components/TopAppBar";
import { BottomNavBar, type TabKey } from "../components/BottomNavBar";
import { useAppDispatch, useAppState } from "../lib/store";

// This is the "More" tab's destination. It carries the demo/simulation
// controls the product spec calls for (surge, staff shortage, EHR failure,
// reset) — previously implemented in the reducer but with no way to trigger
// them from the app at all.
function SimButton({
  icon,
  title,
  desc,
  tone = "default",
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  desc: string;
  tone?: "default" | "danger";
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex-row items-center gap-3"
    >
      <View className={`w-10 h-10 rounded-full items-center justify-center ${tone === "danger" ? "bg-error-container" : "bg-primary-container"}`}>
        <MaterialIcons name={icon} size={20} color={tone === "danger" ? "#93000a" : "#dad7ff"} />
      </View>
      <View className="flex-1">
        <Text className="font-headline-md text-headline-md text-on-surface">{title}</Text>
        <Text className="font-body-md text-body-md text-on-surface-variant mt-0.5">{desc}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color="#777587" />
    </Pressable>
  );
}

export function SimulationScreen({ onNavigateTab }: { onNavigateTab: (tab: TabKey) => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [resetConfirm, setResetConfirm] = useState(false);

  const waiting = state.encounters.filter((e) => e.status === "Waiting").length;

  return (
    <View className="flex-1 bg-surface-bright">
      <TopAppBar variant="main" nurseName={state.nurseSession?.name} onDashboard={() => onNavigateTab("dashboard")} />
      <ScrollView className="flex-1" contentContainerClassName="px-container-padding pt-6 gap-section-gap pb-28">
        <View>
          <Text className="font-headline-lg text-headline-lg text-on-surface mb-1">Simulation & Demo Controls</Text>
          <Text className="font-body-md text-body-md text-on-surface-variant">
            Trigger operational scenarios to see how routing responds under stress. Mode: {state.hospital.currentMode} • {waiting} waiting now.
          </Text>
        </View>

        <View className="gap-stack-gap">
          <SimButton
            icon="groups"
            title="Simulate 3x Surge"
            desc="Injects a burst of simulated arrivals and constrains beds/staff to match — queue, wait estimates, and priorities all respond live."
            onPress={() => {
              dispatch({ type: "surge" });
              RNAlert.alert("Surge simulated", "A 3x arrival burst has been added to the live queue. Check the Dashboard and Alerts.");
            }}
          />
          <SimButton
            icon="person-off"
            title="Simulate Staff Shortage"
            desc="Marks two nurses and part of the staff pool unavailable — resource-constrained wait times increase."
            onPress={() => {
              dispatch({ type: "staffShortage" });
              RNAlert.alert("Staff shortage simulated", "Staffing has been reduced for this session.");
            }}
          />
          <SimButton
            icon="wifi-off"
            title="Simulate EHR / Device Unavailable"
            desc="Demonstrates graceful degradation: the system stays usable with manual entry and flags the outage."
            onPress={() => {
              dispatch({ type: "ehrFailure" });
              RNAlert.alert("EHR outage simulated", "A graceful-degradation alert has been logged.");
            }}
          />
          <SimButton
            icon="restart-alt"
            title="Reset Demo Data"
            desc="Wipes all changes made this session and restores the original 20-patient seeded dataset."
            tone="danger"
            onPress={() => {
              if (!resetConfirm) {
                setResetConfirm(true);
                return;
              }
              dispatch({ type: "reset" });
              setResetConfirm(false);
              onNavigateTab("dashboard");
            }}
          />
          {resetConfirm && (
            <View className="bg-error-container/30 border border-error/20 rounded-xl p-3 flex-row items-center justify-between">
              <Text className="font-body-md text-body-md text-on-surface flex-1">Tap Reset again to confirm — this discards session changes.</Text>
              <Pressable onPress={() => setResetConfirm(false)} hitSlop={8}>
                <Text className="font-label-caps text-label-caps text-primary">Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 gap-1">
          <Text className="font-label-caps text-label-caps text-on-surface-variant">HOSPITAL</Text>
          <Text className="font-body-md text-body-md text-on-surface">{state.hospital.name}</Text>
          <Text className="font-helper-text text-helper-text text-on-surface-variant">{state.hospital.jurisdiction}</Text>
          <Text className="font-helper-text text-helper-text text-on-surface-variant">{state.hospital.syntheticDataNotice}</Text>
        </View>
      </ScrollView>
      <BottomNavBar active="more" onSelect={onNavigateTab} />
    </View>
  );
}
