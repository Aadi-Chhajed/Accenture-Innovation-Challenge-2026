import "./global.css";
import { useState } from "react";
import { useFonts, Inter_400Regular, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppStateProvider, useAppDispatch } from "./src/lib/store";
import { SplashScreen } from "./src/screens/SplashScreen";
import { NurseLoginScreen } from "./src/screens/NurseLoginScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { AlertsScreen } from "./src/screens/AlertsScreen";
import { OnboardingWizard, type WizardData } from "./src/screens/OnboardingWizard";
import { AIAnalyzingScreen } from "./src/screens/AIAnalyzingScreen";
import { AIRecommendationScreen } from "./src/screens/AIRecommendationScreen";
import { PatientTokenScreen } from "./src/screens/PatientTokenScreen";
import { PatientDetailsScreen } from "./src/screens/PatientDetailsScreen";
import { PdfPreviewScreen } from "./src/screens/PdfPreviewScreen";
import type { TabKey } from "./src/components/BottomNavBar";
import type { DraftEncounter } from "./src/lib/types";

type Screen =
  | "splash"
  | "login"
  | "dashboard"
  | "alerts"
  | "onboarding"
  | "analyzing"
  | "recommendation"
  | "token"
  | "patientDetails"
  | "pdfPreview";

function Root() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [resumeDraft, setResumeDraft] = useState<DraftEncounter | undefined>(undefined);
  const [pendingWizardData, setPendingWizardData] = useState<WizardData | null>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  // Lets the Drafts tab open the dashboard already filtered to drafts.
  const [dashboardFilter, setDashboardFilter] = useState<"All" | "Drafts">("All");
  const dispatch = useAppDispatch();

  function handleNavigateTab(tab: TabKey) {
    if (tab === "newPatient") {
      setResumeDraft(undefined);
      setScreen("onboarding");
    } else if (tab === "alerts") {
      setScreen("alerts");
    } else if (tab === "drafts") {
      setDashboardFilter("Drafts");
      setScreen("dashboard");
    } else {
      setDashboardFilter("All");
      setScreen("dashboard");
    }
  }

  if (screen === "splash") return <SplashScreen onDone={() => setScreen("login")} />;
  if (screen === "login") return <NurseLoginScreen onLogin={() => setScreen("dashboard")} />;

  if (screen === "dashboard") {
    return (
      <DashboardScreen
        initialFilter={dashboardFilter}
        onNavigateTab={handleNavigateTab}
        onSelectPatient={(id) => {
          setActiveEncounterId(id);
          setScreen("patientDetails");
        }}
        onResumeDraft={(draft) => {
          setResumeDraft(draft);
          setScreen("onboarding");
        }}
      />
    );
  }

  if (screen === "alerts") {
    return (
      <AlertsScreen
        onNavigateTab={handleNavigateTab}
        onOpenEncounter={(id) => {
          setActiveEncounterId(id);
          setScreen("patientDetails");
        }}
      />
    );
  }

  if (screen === "onboarding") {
    return (
      <OnboardingWizard
        initialDraft={resumeDraft}
        onExit={() => setScreen("dashboard")}
        onSaveDraft={(draftId, step, data) => {
          dispatch({
            type: "saveDraft",
            draft: {
              id: draftId,
              patientName: data.patientName || "Unnamed Patient Draft",
              age: data.age,
              completionPct: Math.round((step / 8) * 100),
              currentStage: step,
              data,
            },
          });
        }}
        onComplete={(data) => {
          if (resumeDraft) dispatch({ type: "deleteDraft", draftId: resumeDraft.id });
          setPendingWizardData(data);
          setScreen("analyzing");
        }}
      />
    );
  }

  if (screen === "analyzing") {
    return (
      <AIAnalyzingScreen
        onDone={() => {
          const data = pendingWizardData;
          if (!data) {
            setScreen("dashboard");
            return;
          }
          const encounterId = `E-${Date.now()}`;
          dispatch({
            type: "createEncounter",
            encounter: {
              ...data,
              id: encounterId,
              patientName: data.patientName || "Unnamed Patient",
              age: data.age ?? 0,
              sex: data.sex ?? "Other",
              photoUrl: data.photoUri,
            },
          });
          setPendingWizardData(null);
          setActiveEncounterId(encounterId);
          setScreen("recommendation");
        }}
      />
    );
  }

  if (screen === "recommendation" && activeEncounterId) {
    return (
      <AIRecommendationScreen
        encounterId={activeEncounterId}
        onBack={() => setScreen("dashboard")}
        onAccepted={() => setScreen("token")}
        onNavigateTab={handleNavigateTab}
      />
    );
  }

  if (screen === "token" && activeEncounterId) {
    return (
      <PatientTokenScreen
        encounterId={activeEncounterId}
        onGoDashboard={() => setScreen("dashboard")}
        onGeneratePdf={() => setScreen("pdfPreview")}
        onViewPatient={() => setScreen("patientDetails")}
      />
    );
  }

  if (screen === "patientDetails" && activeEncounterId) {
    return <PatientDetailsScreen encounterId={activeEncounterId} onBack={() => setScreen("dashboard")} />;
  }

  if (screen === "pdfPreview" && activeEncounterId) {
    return <PdfPreviewScreen encounterId={activeEncounterId} onBack={() => setScreen("token")} />;
  }

  return null;
}

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold });

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View className="flex-1 bg-surface" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <StatusBar style="dark" />
        <Root />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
