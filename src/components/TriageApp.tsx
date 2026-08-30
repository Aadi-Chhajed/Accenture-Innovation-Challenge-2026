"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Filter,
  HeartPulse,
  Info,
  LayoutDashboard,
  Lock,
  PhoneCall,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  User,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import type { AppState, Encounter, Patient, DraftEncounter } from "@/lib/types";

type ScreenView = "splash" | "login" | "dashboard" | "onboarding" | "analyzing" | "triage_summary" | "patient_details";

const symptomOptions = [
  "Chest discomfort",
  "Breathing difficulty",
  "Fever / infection symptoms",
  "Injury / trauma",
  "Bleeding",
  "Abdominal pain",
  "Weakness / fainting",
  "Confusion / altered behavior",
  "Stroke-like symptoms",
  "Pregnancy-related concern",
  "Burn",
  "Allergic reaction",
  "Mental health concern",
  "Pediatric fever/crying/lethargy",
];

const pathways = [
  "Resuscitation / Critical Care Bay",
  "Cardiac Review",
  "Stroke / Neuro Review",
  "Trauma",
  "Pediatrics",
  "Obstetrics",
  "Isolation / Infection Concern",
  "Emergency General",
  "Observation",
  "Fast Track / Minor Care",
];

function cls(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function levelClass(level: number) {
  return `level level${level}`;
}

export function TriageApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [currentScreen, setCurrentScreen] = useState<ScreenView>("splash");
  const [selectedEncounterId, setSelectedEncounterId] = useState<string>("E-2001");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Dashboard Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilterTab, setActiveFilterTab] = useState<"all" | "high" | "reassess" | "overridden" | "drafts">("all");

  // Nurse Login Form State
  const [rollNumber, setRollNumber] = useState("NUR-1042");
  const [password, setPassword] = useState("••••••••");

  // Onboarding Wizard State
  const [wizardStage, setWizardStage] = useState(1);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [arrivalMode, setArrivalMode] = useState<"Pre-arrival call" | "Walk-in" | "Ambulance" | "Referral">("Pre-arrival call");
  const [speakerSource, setSpeakerSource] = useState<"Patient" | "Family" | "Caregiver" | "Ambulance staff">("Patient");
  const [language, setLanguage] = useState<"English" | "Hindi" | "Hinglish" | "Marathi" | "Other">("Hinglish");

  // Patient details
  const [patientName, setPatientName] = useState("Rajesh Kumar");
  const [patientAge, setPatientAge] = useState("67");
  const [patientSex, setPatientSex] = useState<"Male" | "Female" | "Other">("Male");
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>(["Chest discomfort", "Breathing difficulty"]);
  const [freeTextDescription, setFreeTextDescription] = useState("Mere father ko afternoon se saans lene mein takleef hai aur chest mein heaviness bol rahe hain.");
  const [onsetDuration, setOnsetDuration] = useState("4 hours");
  const [reportedSeverity, setReportedSeverity] = useState(8);

  // Vitals
  const [temp, setTemp] = useState<string>("37.2");
  const [pulse, setPulse] = useState<string>("112");
  const [bpSystolic, setBpSystolic] = useState<string>("154");
  const [bpDiastolic, setBpDiastolic] = useState<string>("92");
  const [spo2, setSpo2] = useState<string>("90");
  const [respRate, setRespRate] = useState<string>("28");
  const [painScore, setPainScore] = useState<string>("7");
  const [spo2Unavailable, setSpo2Unavailable] = useState(false);

  // History & Nurse Obs
  const [knownConditions, setKnownConditions] = useState<string>("Hypertension");
  const [medications, setMedications] = useState<string>("Lisinopril 10mg");
  const [allergies, setAllergies] = useState<string>("None known");
  const [obsDistress, setObsDistress] = useState(true);
  const [obsBleeding, setObsBleeding] = useState(false);
  const [obsConfusion, setObsConfusion] = useState(false);
  const [nurseNotes, setNurseNotes] = useState("Patient diaphoretic upon arrival, family speaking.");
  const [photoAttached, setPhotoAttached] = useState(false);

  // Clinician Override Modal State
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overridePathway, setOverridePathway] = useState("Fast Track / Minor Care");
  const [overrideLevel, setOverrideLevel] = useState<number>(4);
  const [overrideReason, setOverrideReason] = useState("Patient pain score stabilized upon clinical nurse review");

  // Reassessment Note Modal State
  const [showReassessModal, setShowReassessModal] = useState(false);
  const [reassessNote, setReassessNote] = useState("Patient reporting increased pain while waiting in queue.");

  // PDF Preview Modal
  const [showPdfModal, setShowPdfModal] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) return;
      const text = await response.text();
      if (!text) return;
      const data = JSON.parse(text) as AppState;
      if (data) setState(data);
    } catch (e) {
      console.error("Failed to load state:", e);
    }
  }

  async function act(body: unknown) {
    setBusy(true);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const text = await response.text();
        if (text) {
          const next = JSON.parse(text) as AppState;
          setState(next);
        }
      }
    } catch (e) {
      console.error("Failed to run action:", e);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    load();
    const id = window.setInterval(load, 10000);
    return () => window.clearInterval(id);
  }, []);

  const selectedEncounter = useMemo(() => {
    return state?.encounters.find((e) => e.id === selectedEncounterId) ?? state?.encounters[0];
  }, [state, selectedEncounterId]);

  // Filtered Patient Queue
  const filteredEncounters = useMemo(() => {
    if (!state?.encounters) return [];
    return state.encounters.filter((enc) => {
      // Search match
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        enc.id.toLowerCase().includes(q) ||
        enc.patientId.toLowerCase().includes(q) ||
        (enc.token && enc.token.toLowerCase().includes(q)) ||
        enc.primaryConcern.toLowerCase().includes(q) ||
        enc.currentPathway.toLowerCase().includes(q);

      if (!matchSearch) return false;

      // Filter tabs
      if (activeFilterTab === "high") return enc.recommendation.level <= 2;
      if (activeFilterTab === "reassess") return enc.waitingMins >= 25 || enc.trend === "Worsening";
      if (activeFilterTab === "overridden") return !!enc.override;
      return true;
    });
  }, [state, searchQuery, activeFilterTab]);

  if (!mounted || !state) {
    return (
      <main className="loading" suppressHydrationWarning>
        <HeartPulse size={36} className="animate-spin text-teal-400" />
        <span>Loading CityCare Nurse Workspace</span>
      </main>
    );
  }

  async function handleLogin() {
    await act({ type: "loginNurse", rollNumber: rollNumber || "NUR-1042" });
    setCurrentScreen("dashboard");
  }

  function handleVoicePreset(type: "hinglish" | "hindi" | "marathi" | "english") {
    if (type === "hinglish") {
      setFreeTextDescription("Mere father ko afternoon se saans lene mein takleef hai aur chest mein heaviness bol rahe hain.");
      setSelectedSymptoms(["Chest discomfort", "Breathing difficulty"]);
      setLanguage("Hinglish");
      setSpeakerSource("Family");
    } else if (type === "hindi") {
      setFreeTextDescription("अचानक बहुत चक्कर आ रहा है और बोलने में तकलीफ हो रही है।");
      setSelectedSymptoms(["Confusion / altered behavior", "Stroke-like symptoms"]);
      setLanguage("Hindi");
      setSpeakerSource("Family");
    } else if (type === "marathi") {
      setFreeTextDescription("बाळाला काल रात्रीपासून खूप ताप आहे आणि दूध पित नाहीये.");
      setSelectedSymptoms(["Pediatric fever/crying/lethargy"]);
      setLanguage("Marathi");
      setSpeakerSource("Family");
    } else {
      setFreeTextDescription("Severe right ankle sprain after falling down the stairs.");
      setSelectedSymptoms(["Injury / trauma"]);
      setLanguage("English");
      setSpeakerSource("Patient");
    }
  }

  function handleJumpToDashboard() {
    if (currentScreen === "onboarding") {
      const draftData = {
        id: activeDraftId || `DRAFT-${Date.now()}`,
        patientName: patientName || "Unnamed Patient",
        age: parseInt(patientAge) || 45,
        completionPct: Math.round((wizardStage / 10) * 100),
        currentStage: wizardStage,
        data: {
          arrivalMode,
          speakerSource,
          language,
          primaryConcern: selectedSymptoms[0] || "General Intake",
          symptoms: selectedSymptoms,
          freeText: freeTextDescription,
          vitals: {
            bpSystolic: bpSystolic ? parseInt(bpSystolic) : undefined,
            bpDiastolic: bpDiastolic ? parseInt(bpDiastolic) : undefined,
            spo2: spo2Unavailable ? undefined : spo2 ? parseInt(spo2) : undefined,
            spo2Unavailable,
          },
        },
      };
      act({ type: "saveDraft", draft: draftData });
    }
    setCurrentScreen("dashboard");
  }

  function handleCompleteOnboarding() {
    setCurrentScreen("analyzing");
    setTimeout(() => {
      const ageNum = parseInt(patientAge) || 45;
      act({
        type: "createEncounter",
        encounter: {
          patientName,
          age: ageNum,
          sex: patientSex,
          arrivalMode,
          speakerSource,
          language,
          primaryConcern: selectedSymptoms[0] || "Emergency Intake",
          symptoms: selectedSymptoms,
          freeText: freeTextDescription,
          onset: onsetDuration,
          duration: onsetDuration,
          reportedSeverity,
          vitals: {
            temperature: temp ? parseFloat(temp) : undefined,
            pulse: pulse ? parseInt(pulse) : undefined,
            bpSystolic: bpSystolic ? parseInt(bpSystolic) : undefined,
            bpDiastolic: bpDiastolic ? parseInt(bpDiastolic) : undefined,
            spo2: spo2Unavailable ? undefined : spo2 ? parseInt(spo2) : undefined,
            respiratoryRate: respRate ? parseInt(respRate) : undefined,
            painScore: painScore ? parseInt(painScore) : undefined,
            consciousness: "Alert",
            unavailableReason: spo2Unavailable ? "SpO2 sensor not available yet" : undefined,
            spo2Unavailable,
          },
          history: {
            conditions: knownConditions,
            medications,
            allergies,
            previousEpisode: "Unknown",
            recentVisit: "None",
          },
          observations: [
            ...(obsDistress ? ["Visible distress"] : []),
            ...(obsBleeding ? ["Visible bleeding"] : []),
            ...(obsConfusion ? ["Confusion"] : []),
            nurseNotes,
          ],
          photoAttached,
        },
      });
      setCurrentScreen("triage_summary");
    }, 2400);
  }

  function handleResumeDraft(draft: DraftEncounter) {
    setActiveDraftId(draft.id);
    if (draft.patientName) setPatientName(draft.patientName);
    if (draft.age) setPatientAge(draft.age.toString());
    setWizardStage(draft.currentStage || 1);
    setCurrentScreen("onboarding");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* TOP PERSISTENT NAVBAR */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
            <HeartPulse size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide">
              PatientTriage<span className="text-teal-400">.ai</span>
            </h1>
            <p className="text-[10px] text-slate-400">
              Nurse Mobile Workspace • {state.hospital.name}
            </p>
          </div>
        </div>

        {/* PERSISTENT TOP-RIGHT DASHBOARD BUTTON WITH DRAFT COUNTER */}
        {currentScreen !== "splash" && currentScreen !== "login" && (
          <button
            onClick={handleJumpToDashboard}
            className="px-3 py-1.5 rounded-lg bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 text-xs font-semibold flex items-center space-x-1.5 transition-all shadow"
          >
            <LayoutDashboard size={14} />
            <span>Dashboard</span>
            {(state.drafts?.length ?? 0) > 0 && (
              <span className="ml-1 bg-amber-500 text-slate-950 font-extrabold text-[10px] px-1.5 py-0.2 rounded-full">
                {state.drafts?.length} Draft
              </span>
            )}
          </button>
        )}
      </header>

      {/* SCREEN 1: SPLASH SCREEN */}
      {currentScreen === "splash" && (
        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-6">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-teal-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-teal-500/30 animate-pulse">
            <HeartPulse size={48} className="text-white" />
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-extrabold text-white tracking-tight">
              PatientTriage<span className="text-teal-400">.ai</span>
            </h2>
            <p className="text-teal-300 font-semibold text-base">Smarter Patient Routing. Faster Care.</p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              AI-powered decision support for emergency departments.
            </p>
          </div>
          <button
            onClick={() => setCurrentScreen("login")}
            className="w-full max-w-xs py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-400 hover:to-blue-500 text-white font-bold shadow-lg shadow-teal-500/25 transition-all flex items-center justify-center space-x-2"
          >
            <span>Nurse Sign In</span>
            <ArrowRight size={18} />
          </button>
          <div className="text-[11px] text-slate-500">Regulatory Framework: {state.hospital.jurisdiction}</div>
        </main>
      )}

      {/* SCREEN 2: NURSE LOGIN */}
      {currentScreen === "login" && (
        <main className="flex-1 flex flex-col items-center justify-center p-6 max-w-sm w-full mx-auto space-y-6">
          <div className="w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xl">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-white">Welcome to PatientTriage.ai</h2>
              <p className="text-xs text-slate-400">Sign in to begin patient triage and routing.</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nurse Roll Number</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-3 text-slate-500" />
                  <input
                    type="text"
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-600 focus:border-teal-500 focus:outline-none"
                    placeholder="e.g. NUR-1042"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-3 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-600 focus:border-teal-500 focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleLogin}
              className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold shadow-lg shadow-teal-600/20 transition-all flex items-center justify-center space-x-2 text-sm"
            >
              <span>Login & Start Shift</span>
              <ArrowRight size={16} />
            </button>

            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-center text-slate-400">
              Hospital: <strong className="text-slate-200">{state.hospital.name}</strong> • Emergency Dept
            </div>
          </div>
        </main>
      )}

      {/* SCREEN 6: COMMON DASHBOARD */}
      {currentScreen === "dashboard" && (
        <main className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">
          {/* Top ED Census Summary Cards */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl">
              <div className="text-slate-400 text-[10px]">Total Waiting</div>
              <div className="text-xl font-bold text-white mt-0.5">{(state.encounters || []).length}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl">
              <div className="text-slate-400 text-[10px]">High Priority</div>
              <div className="text-xl font-bold text-red-400 mt-0.5">
                {(state.encounters || []).filter((e) => e.recommendation.level <= 2).length}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl">
              <div className="text-slate-400 text-[10px]">Avg Wait</div>
              <div className="text-xl font-bold text-teal-400 mt-0.5">{state.simulation?.dynamicMedianWait || 36}m</div>
            </div>
          </div>

          {/* DRAFTS / INCOMPLETE ONBOARDING SECTION */}
          {(state.drafts?.length ?? 0) > 0 && (
            <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-3.5 space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-amber-300">
                <span className="flex items-center space-x-1.5">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <span>Incomplete Onboarding Drafts ({state.drafts?.length})</span>
                </span>
                <span className="text-[10px] text-amber-400/80">Saved automatically</span>
              </div>
              <div className="space-y-2">
                {(state.drafts || []).map((draft) => (
                  <div
                    key={draft.id}
                    className="bg-slate-900/90 border border-amber-500/20 p-2.5 rounded-xl flex justify-between items-center text-xs"
                  >
                    <div>
                      <div className="font-bold text-white">{draft.patientName}</div>
                      <div className="text-[10px] text-slate-400">
                        Stage {draft.currentStage} of 10 • {draft.completionPct}% complete
                      </div>
                    </div>
                    <button
                      onClick={() => handleResumeDraft(draft)}
                      className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs"
                    >
                      Resume
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NEW PATIENT INTAKE BUTTON */}
          <button
            onClick={() => {
              setActiveDraftId(null);
              setWizardStage(1);
              setCurrentScreen("onboarding");
            }}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-400 hover:to-blue-500 text-white font-bold shadow-lg shadow-teal-500/20 transition-all flex items-center justify-center space-x-2 text-sm"
          >
            <UserPlus size={18} />
            <span>Start New Patient Onboarding</span>
          </button>

          {/* QUEUE SEARCH BAR & FILTER TABS */}
          <div className="space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search queue by Name, ID, or Token (e.g. C-084)..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="flex space-x-1 overflow-x-auto pb-1 text-[11px]">
              <button
                onClick={() => setActiveFilterTab("all")}
                className={cls("px-3 py-1 rounded-lg border font-medium whitespace-nowrap transition-all", activeFilterTab === "all" ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold" : "bg-slate-900 border-slate-800 text-slate-400")}
              >
                All Queue ({(state.encounters || []).length})
              </button>
              <button
                onClick={() => setActiveFilterTab("high")}
                className={cls("px-3 py-1 rounded-lg border font-medium whitespace-nowrap transition-all", activeFilterTab === "high" ? "bg-red-600/20 border-red-500 text-red-300 font-bold" : "bg-slate-900 border-slate-800 text-slate-400")}
              >
                🔴 High Priority (L1-L2)
              </button>
              <button
                onClick={() => setActiveFilterTab("reassess")}
                className={cls("px-3 py-1 rounded-lg border font-medium whitespace-nowrap transition-all", activeFilterTab === "reassess" ? "bg-amber-600/20 border-amber-500 text-amber-300 font-bold" : "bg-slate-900 border-slate-800 text-slate-400")}
              >
                ⚠️ Reassessment Needed
              </button>
              <button
                onClick={() => setActiveFilterTab("overridden")}
                className={cls("px-3 py-1 rounded-lg border font-medium whitespace-nowrap transition-all", activeFilterTab === "overridden" ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold" : "bg-slate-900 border-slate-800 text-slate-400")}
              >
                ⚡ Nurse Overridden
              </button>
            </div>
          </div>

          {/* LIVE PATIENT QUEUE WITH COLOR-GRADED BORDER CARDS */}
          <div className="space-y-3">
            <div className="flex justify-between items-center px-1">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1">
                <Users size={14} className="text-teal-400" />
                <span>Live Priority Patient Queue</span>
              </h3>
              <span className="text-[10px] text-slate-500">Showing {filteredEncounters.length} patients</span>
            </div>

            <div className="space-y-2.5">
              {filteredEncounters.map((enc) => {
                const borderColors: Record<number, string> = {
                  1: "border-l-4 border-l-red-500 border-slate-800",
                  2: "border-l-4 border-l-orange-500 border-slate-800",
                  3: "border-l-4 border-l-amber-400 border-slate-800",
                  4: "border-l-4 border-l-indigo-400 border-slate-800",
                  5: "border-l-4 border-l-slate-400 border-slate-800",
                };

                return (
                  <div
                    key={enc.id}
                    onClick={() => {
                      setSelectedEncounterId(enc.id);
                      setCurrentScreen("patient_details");
                    }}
                    className={cls(
                      "bg-slate-900 rounded-2xl p-3.5 space-y-2 cursor-pointer hover:bg-slate-850 transition-all shadow-md",
                      borderColors[enc.recommendation?.level ?? 4]
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-teal-400 text-xs shadow">
                          {enc.patientId.slice(-3)}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-white text-sm">{enc.patientId}</span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-teal-300 border border-slate-700">
                              {enc.token || "C-084"}
                            </span>
                            {enc.override && (
                              <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.2 rounded font-semibold flex items-center space-x-0.5">
                                <Zap size={10} />
                                <span>Overridden</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {enc.primaryConcern} • {enc.symptoms.slice(0, 2).join(", ")}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className={levelClass(enc.recommendation?.level ?? 4)}>
                          L{enc.recommendation?.level ?? 4}
                        </span>
                        <div className="text-[10px] text-teal-400 font-medium mt-1">
                          Wait: {enc.waitingMins}m
                        </div>
                      </div>
                    </div>

                    {/* CLINICAL SAFEGUARD BADGES */}
                    <div className="flex flex-wrap gap-1 text-[9px]">
                      {enc.recommendation?.undertriageSafeguard && (
                        <span className="bg-amber-950/60 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-semibold flex items-center space-x-1">
                          <ShieldAlert size={10} />
                          <span>Undertriage Protection Active</span>
                        </span>
                      )}
                      {enc.recommendation?.pediatricDangerFlag && (
                        <span className="bg-purple-950/60 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded font-semibold">
                          👶 Pediatric Danger Flag
                        </span>
                      )}
                      {enc.recommendation?.geriatricAtypicalFlag && (
                        <span className="bg-sky-950/60 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded font-semibold">
                          👴 Geriatric Atypical Screen
                        </span>
                      )}
                      {enc.recommendation?.zeroHistoryFlag && (
                        <span className="bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
                          📁 Zero-History Patient
                        </span>
                      )}
                    </div>

                    <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-800/60 text-slate-400">
                      <div>
                        Pathway: <strong className="text-slate-200">{enc.currentPathway}</strong>
                      </div>
                      <div>
                        Nurse: <strong className="text-slate-300">{enc.attendingNurseId || "NUR-1042"}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* SCREEN 3: PATIENT ONBOARDING (MULTI-STAGE STEP-BY-STEP WIZARD) */}
      {currentScreen === "onboarding" && (
        <main className="flex-1 p-4 space-y-4 max-w-xl mx-auto w-full">
          {/* Wizard Header & Progress Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-teal-400">Patient Onboarding Wizard</span>
              <span className="text-slate-400">Stage {wizardStage} of 10</span>
            </div>
            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-teal-500 to-blue-500 h-full transition-all duration-300"
                style={{ width: `${(wizardStage / 10) * 100}%` }}
              ></div>
            </div>
          </div>

          {/* STAGE CONTENT CARDS */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            {/* STAGE 1: ARRIVAL CONTEXT */}
            {wizardStage === 1 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <PhoneCall size={16} className="text-teal-400" />
                  <span>Stage 1 — How is the patient arriving?</span>
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <button
                    onClick={() => setArrivalMode("Pre-arrival call")}
                    className={cls(
                      "p-3 rounded-xl border text-left font-medium transition-all",
                      arrivalMode === "Pre-arrival call"
                        ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-300"
                    )}
                  >
                    📞 Pre-Arrival Call
                  </button>
                  <button
                    onClick={() => setArrivalMode("Walk-in")}
                    className={cls(
                      "p-3 rounded-xl border text-left font-medium transition-all",
                      arrivalMode === "Walk-in"
                        ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-300"
                    )}
                  >
                    🚶 Physical Walk-In
                  </button>
                  <button
                    onClick={() => setArrivalMode("Ambulance")}
                    className={cls(
                      "p-3 rounded-xl border text-left font-medium transition-all",
                      arrivalMode === "Ambulance"
                        ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-300"
                    )}
                  >
                    🚑 Ambulance Arrival
                  </button>
                  <button
                    onClick={() => setArrivalMode("Referral")}
                    className={cls(
                      "p-3 rounded-xl border text-left font-medium transition-all",
                      arrivalMode === "Referral"
                        ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                        : "bg-slate-950 border-slate-800 text-slate-300"
                    )}
                  >
                    🏥 Facility Referral
                  </button>
                </div>
              </div>
            )}

            {/* STAGE 2: SPEAKER & LANGUAGE */}
            {wizardStage === 2 && (
              <div className="space-y-4 text-xs">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Users size={16} className="text-teal-400" />
                  <span>Stage 2 — Who is providing information?</span>
                </h3>
                <div>
                  <label className="block text-slate-400 mb-1">Speaker Source</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Patient", "Family", "Caregiver", "Ambulance staff"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setSpeakerSource(s)}
                        className={cls(
                          "p-2.5 rounded-xl border text-left transition-all",
                          speakerSource === s
                            ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                            : "bg-slate-950 border-slate-800 text-slate-400"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Language Spoken</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="Hinglish">Hinglish (Hindi + English)</option>
                    <option value="Hindi">Hindi</option>
                    <option value="English">English</option>
                    <option value="Marathi">Marathi</option>
                  </select>
                </div>
              </div>
            )}

            {/* STAGE 3: BASIC PATIENT INFO & PHOTO */}
            {wizardStage === 3 && (
              <div className="space-y-3 text-xs">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <User size={16} className="text-teal-400" />
                  <span>Stage 3 — Basic Patient Information</span>
                </h3>

                <div className="flex items-center space-x-3 p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 border border-slate-700">
                    <Camera size={20} />
                  </div>
                  <div>
                    <button
                      onClick={() => setPhotoAttached(true)}
                      className="px-3 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-teal-300 font-bold text-xs"
                    >
                      {photoAttached ? "✓ Photo Captured" : "Take Patient Photo"}
                    </button>
                    <div className="text-[10px] text-slate-500 mt-0.5">Used for encounter identification</div>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Patient Name</label>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Age</label>
                    <input
                      type="number"
                      value={patientAge}
                      onChange={(e) => setPatientAge(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Sex</label>
                    <select
                      value={patientSex}
                      onChange={(e) => setPatientSex(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 4: MAIN PROBLEM & VOICE INPUT SIMULATOR */}
            {wizardStage === 4 && (
              <div className="space-y-3 text-xs">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Stethoscope size={16} className="text-teal-400" />
                  <span>Stage 4 — What brings the patient today?</span>
                </h3>

                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {symptomOptions.map((sym) => {
                    const isSelected = selectedSymptoms.includes(sym);
                    return (
                      <button
                        key={sym}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedSymptoms(selectedSymptoms.filter((s) => s !== sym));
                          } else {
                            setSelectedSymptoms([...selectedSymptoms, sym]);
                          }
                        }}
                        className={cls(
                          "p-2 rounded-xl text-left border transition-all text-[11px]",
                          isSelected
                            ? "bg-teal-600/20 border-teal-500 text-teal-300 font-bold"
                            : "bg-slate-950 border-slate-800 text-slate-400"
                        )}
                      >
                        {sym}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center">
                    <label className="text-slate-400 font-semibold">Narrative Description / Voice Input</label>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => handleVoicePreset("hinglish")}
                        className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-teal-400 border border-slate-700"
                      >
                        🎙 Hinglish
                      </button>
                      <button
                        onClick={() => handleVoicePreset("hindi")}
                        className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-teal-400 border border-slate-700"
                      >
                        🎙 Hindi
                      </button>
                      <button
                        onClick={() => handleVoicePreset("english")}
                        className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-teal-400 border border-slate-700"
                      >
                        🎙 English
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    value={freeTextDescription}
                    onChange={(e) => setFreeTextDescription(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600"
                    placeholder="Tell us what happened..."
                  ></textarea>
                </div>
              </div>
            )}

            {/* STAGE 5: AI ENTITY EXTRACTION SUMMARY */}
            {wizardStage === 5 && (
              <div className="space-y-3 text-xs">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Activity size={16} className="text-teal-400" />
                  <span>Stage 5 — AI Entity Extraction Summary</span>
                </h3>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-slate-300">
                  <div>
                    • Extracted Symptoms:{" "}
                    <strong className="text-teal-300">{selectedSymptoms.join(", ") || "None"}</strong>
                  </div>
                  <div>
                    • Language Detected: <strong className="text-white">{language}</strong>
                  </div>
                  <div>
                    • Onset: <strong className="text-white">{onsetDuration}</strong>
                  </div>
                  <div className="text-amber-400 font-semibold">• Missing High-Value Field: SpO2 Saturation Reading</div>
                </div>
              </div>
            )}

            {/* STAGE 7: VITALS MANUAL ENTRY WITH NOT AVAILABLE YET */}
            {wizardStage === 7 && (
              <div className="space-y-3 text-xs">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <HeartPulse size={16} className="text-teal-400" />
                  <span>Stage 7 — Vitals & Measurements</span>
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Heart Rate (bpm)</label>
                    <input
                      type="number"
                      value={pulse}
                      onChange={(e) => setPulse(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">BP (Systolic / Diastolic)</label>
                    <div className="flex space-x-1">
                      <input
                        type="number"
                        value={bpSystolic}
                        onChange={(e) => setBpSystolic(e.target.value)}
                        className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl p-2 text-white"
                        placeholder="154"
                      />
                      <input
                        type="number"
                        value={bpDiastolic}
                        onChange={(e) => setBpDiastolic(e.target.value)}
                        className="w-1/2 bg-slate-950 border border-slate-800 rounded-xl p-2 text-white"
                        placeholder="92"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-slate-400">SpO2 %</label>
                      <label className="text-[10px] text-amber-400 flex items-center space-x-1">
                        <input
                          type="checkbox"
                          checked={spo2Unavailable}
                          onChange={(e) => setSpo2Unavailable(e.target.checked)}
                        />
                        <span>Not available yet</span>
                      </label>
                    </div>
                    <input
                      type="number"
                      disabled={spo2Unavailable}
                      value={spo2}
                      onChange={(e) => setSpo2(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white disabled:opacity-40"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Resp Rate (/min)</label>
                    <input
                      type="number"
                      value={respRate}
                      onChange={(e) => setRespRate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 9: NURSE OBSERVATION */}
            {wizardStage === 9 && (
              <div className="space-y-3 text-xs">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <UserCheck size={16} className="text-teal-400" />
                  <span>Stage 9 — Nurse Physical Observation</span>
                </h3>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={obsDistress}
                      onChange={(e) => setObsDistress(e.target.checked)}
                    />
                    <span>Visible Respiratory Distress</span>
                  </label>
                  <label className="flex items-center space-x-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={obsConfusion}
                      onChange={(e) => setObsConfusion(e.target.checked)}
                    />
                    <span>Confusion / Disorientation</span>
                  </label>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Nurse Notes</label>
                  <textarea
                    rows={2}
                    value={nurseNotes}
                    onChange={(e) => setNurseNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white"
                  ></textarea>
                </div>
              </div>
            )}

            {/* DEFAULT FALLBACK STAGE NAVIGATION */}
            {wizardStage !== 1 &&
              wizardStage !== 2 &&
              wizardStage !== 3 &&
              wizardStage !== 4 &&
              wizardStage !== 5 &&
              wizardStage !== 7 &&
              wizardStage !== 9 && (
                <div className="p-4 text-center text-slate-400 text-xs space-y-2">
                  <div>Stage {wizardStage} Medical Context Confirmed</div>
                  <div className="text-[11px] text-slate-500">Proceeding to final AI analysis...</div>
                </div>
              )}
          </div>

          {/* WIZARD NAVIGATION BUTTONS */}
          <div className="flex space-x-3">
            {wizardStage > 1 && (
              <button
                onClick={() => setWizardStage(wizardStage - 1)}
                className="w-1/3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                Back
              </button>
            )}
            {wizardStage < 10 ? (
              <button
                onClick={() => setWizardStage(wizardStage + 1)}
                className="flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center justify-center space-x-1"
              >
                <span>Next Stage</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={handleCompleteOnboarding}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-400 hover:to-blue-500 text-white text-xs font-bold flex items-center justify-center space-x-2 shadow-lg"
              >
                <span>Submit to AI Engine</span>
                <Activity size={16} />
              </button>
            )}
          </div>
        </main>
      )}

      {/* SCREEN 4: AI ANALYZING SCREEN */}
      {currentScreen === "analyzing" && (
        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-6 max-w-sm mx-auto w-full">
          <div className="w-16 h-16 rounded-full border-4 border-teal-500/20 border-t-teal-400 animate-spin flex items-center justify-center">
            <Activity size={28} className="text-teal-400" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">Analyzing Patient & Hospital Context</h2>
            <p className="text-xs text-slate-400">Matching patient urgency with CityCare real-time capacity.</p>
          </div>

          <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-left text-xs space-y-2 text-slate-300 shadow-xl">
            <div className="flex items-center space-x-2 text-teal-400 font-medium">
              <CheckCircle2 size={14} />
              <span>Patient information collected</span>
            </div>
            <div className="flex items-center space-x-2 text-teal-400 font-medium">
              <CheckCircle2 size={14} />
              <span>Symptoms structured & categorized</span>
            </div>
            <div className="flex items-center space-x-2 text-teal-400 font-medium">
              <CheckCircle2 size={14} />
              <span>Missing information checked</span>
            </div>
            <div className="flex items-center space-x-2 text-teal-400 font-medium">
              <CheckCircle2 size={14} />
              <span>CityCare Hospital queue checked</span>
            </div>
            <div className="flex items-center space-x-2 text-teal-400 font-medium">
              <CheckCircle2 size={14} />
              <span>Available beds & staff checked</span>
            </div>
            <div className="flex items-center space-x-2 text-amber-400 font-medium animate-pulse">
              <Clock size={14} />
              <span>Generating routing recommendation...</span>
            </div>
          </div>
        </main>
      )}

      {/* SCREEN 5: AI TRIAGE / REPORT SUMMARY & TOKEN GENERATION */}
      {currentScreen === "triage_summary" && selectedEncounter && (
        <main className="flex-1 p-4 space-y-4 max-w-md mx-auto w-full">
          {/* PATIENT TOKEN CARD */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center space-y-2 shadow-2xl">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Patient Token Generated</div>
            <div className="text-4xl font-extrabold text-teal-400 tracking-tight">
              {selectedEncounter.token || "C-084"}
            </div>
            <div className="text-xs text-white font-bold">
              {patientName} ({patientAge} yo)
            </div>
            <div className="text-[11px] text-slate-400">Encounter ID: {selectedEncounter.id}</div>
          </div>

          {/* AI RECOMMENDATION SUMMARY CARD */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs shadow-xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-bold text-white">AI Routing Decision Support</span>
              <span className={levelClass(selectedEncounter.recommendation.level)}>
                Level {selectedEncounter.recommendation.level} - Urgent
              </span>
            </div>

            <div className="space-y-1.5">
              <div>
                Recommended Pathway: <strong className="text-teal-300">{selectedEncounter.recommendation.pathway}</strong>
              </div>
              <div>
                Destination: <strong className="text-white">{selectedEncounter.recommendation.destination}</strong>
              </div>
              <div>
                Estimated Wait Time:{" "}
                <strong className="text-teal-400">{selectedEncounter.recommendation.estimatedWait} mins</strong>
              </div>
              <div>
                AI Engine Confidence:{" "}
                <strong className="text-emerald-400">
                  {Math.round((selectedEncounter.recommendation.confidence || 0.84) * 100)}%
                </strong>
              </div>
            </div>

            {/* CLINICAL SAFEGUARDS ALERTS */}
            {selectedEncounter.recommendation.undertriageSafeguard && (
              <div className="p-2.5 bg-amber-950/60 border border-amber-500/40 rounded-xl text-amber-300 text-[11px] space-y-1">
                <div className="font-bold flex items-center space-x-1">
                  <ShieldAlert size={14} className="text-amber-400" />
                  <span>Undertriage Protection Active</span>
                </div>
                <div>Asymmetric safety bias upgraded priority level to prevent diagnostic delay.</div>
              </div>
            )}

            {selectedEncounter.recommendation.pediatricDangerFlag && (
              <div className="p-2 bg-purple-950/60 border border-purple-500/40 rounded-xl text-purple-300 text-[11px]">
                👶 Pediatric danger flag triggered (physiological threshold breach).
              </div>
            )}

            {selectedEncounter.recommendation.geriatricAtypicalFlag && (
              <div className="p-2 bg-sky-950/60 border border-sky-500/40 rounded-xl text-sky-300 text-[11px]">
                👴 Geriatric atypical symptom protocol applied.
              </div>
            )}

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1">
              <div className="font-bold text-slate-300 text-[11px]">Recommendation Rationale:</div>
              {selectedEncounter.recommendation.reasons.map((r, i) => (
                <div key={i} className="text-[11px] text-slate-400">
                  • {r}
                </div>
              ))}
            </div>

            {selectedEncounter.recommendation.missingInfo.length > 0 && (
              <div className="p-2 bg-amber-950/40 border border-amber-500/30 rounded-xl text-amber-300 text-[11px]">
                ⚠ Missing Information: {selectedEncounter.recommendation.missingInfo.join(", ")}
              </div>
            )}
          </div>

          {/* ACTIONS: ACCEPT, OVERRIDE, PDF */}
          <div className="space-y-2">
            <button
              onClick={() => {
                act({ type: "accept", encounterId: selectedEncounter.id });
                setCurrentScreen("dashboard");
              }}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg flex items-center justify-center space-x-2"
            >
              <CheckCircle2 size={16} />
              <span>Accept Recommendation & Add to Queue</span>
            </button>

            <div className="flex space-x-2">
              <button
                onClick={() => setShowOverrideModal(true)}
                className="w-1/2 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold"
              >
                Override
              </button>
              <button
                onClick={() => setShowPdfModal(true)}
                className="w-1/2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1"
              >
                <Download size={14} />
                <span>PDF Summary</span>
              </button>
            </div>
          </div>
        </main>
      )}

      {/* SCREEN 8: PATIENT DETAILS & TIMELINE MODAL/VIEW */}
      {currentScreen === "patient_details" && selectedEncounter && (
        <main className="flex-1 p-4 space-y-4 max-w-md mx-auto w-full text-xs">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <button
              onClick={() => setCurrentScreen("dashboard")}
              className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h2 className="text-sm font-bold text-white">Patient Record Details</h2>
              <p className="text-[10px] text-slate-400">
                Token {selectedEncounter.token} • {selectedEncounter.id}
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-white text-sm">{selectedEncounter.patientId}</div>
                <div className="text-[11px] text-slate-400">Chief Concern: {selectedEncounter.primaryConcern}</div>
              </div>
              <span className={levelClass(selectedEncounter.recommendation?.level ?? 4)}>
                L{selectedEncounter.recommendation?.level ?? 4}
              </span>
            </div>

            {selectedEncounter.override && (
              <div className="p-2.5 bg-indigo-950/60 border border-indigo-500/40 rounded-xl text-indigo-200 space-y-1">
                <div className="font-bold flex items-center space-x-1">
                  <Zap size={14} className="text-indigo-400" />
                  <span>Clinician Override Recorded</span>
                </div>
                <div>Original Route: {selectedEncounter.override.originalPathway} (L{selectedEncounter.override.originalLevel})</div>
                <div>New Route: {selectedEncounter.override.newPathway} (L{selectedEncounter.override.newLevel})</div>
                <div className="text-indigo-300 italic font-medium">"{selectedEncounter.override.reason}"</div>
              </div>
            )}

            <div className="bg-slate-950 p-2.5 rounded-xl space-y-1 text-slate-300">
              <div>
                • Pathway: <strong className="text-teal-300">{selectedEncounter.currentPathway}</strong>
              </div>
              <div>
                • Attending Nurse: <strong className="text-white">{selectedEncounter.attendingNurseId || "NUR-1042"}</strong>
              </div>
              <div>
                • Free Text: <em className="text-slate-400">"{selectedEncounter.freeText}"</em>
              </div>
            </div>

            {/* ACTION: REASSESS PATIENT */}
            <button
              onClick={() => setShowReassessModal(true)}
              className="w-full py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-bold text-xs flex items-center justify-center space-x-1"
            >
              <Activity size={14} />
              <span>Reassess Patient (Update Clinical State)</span>
            </button>

            {/* AUDIT & JOURNEY TIMELINE */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                Patient Journey & Audit Timeline
              </div>
              <div className="space-y-2">
                {selectedEncounter.journey.map((j, i) => (
                  <div
                    key={i}
                    className="p-2 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center text-[11px]"
                  >
                    <div>
                      <div className="font-semibold text-white">{j.event}</div>
                      <div className="text-[9px] text-slate-500">Actor: {j.actor}</div>
                    </div>
                    <div className="text-[9px] text-slate-400">
                      {new Date(j.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* CLINICIAN OVERRIDE MODAL */}
      {showOverrideModal && selectedEncounter && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 text-xs shadow-2xl">
            <h3 className="font-bold text-white text-sm flex items-center space-x-1.5">
              <AlertTriangle size={16} className="text-amber-400" />
              <span>Clinician Override Workflow</span>
            </h3>

            <div>
              <label className="block text-slate-400 mb-1">Select New Pathway</label>
              <select
                value={overridePathway}
                onChange={(e) => setOverridePathway(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
              >
                {pathways.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Select New Urgency Level</label>
              <select
                value={overrideLevel}
                onChange={(e) => setOverrideLevel(parseInt(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
              >
                <option value={1}>Level 1 - Immediate Resuscitation</option>
                <option value={2}>Level 2 - Very Urgent Review</option>
                <option value={3}>Level 3 - Urgent Review</option>
                <option value={4}>Level 4 - Standard Review</option>
                <option value={5}>Level 5 - Non-Urgent / Fast Track</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Mandatory Override Rationale</label>
              <textarea
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                placeholder="Explain clinical reason..."
              ></textarea>
            </div>

            <div className="flex space-x-2">
              <button
                onClick={() => setShowOverrideModal(false)}
                className="w-1/2 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  act({
                    type: "override",
                    encounterId: selectedEncounter.id,
                    pathway: overridePathway,
                    level: overrideLevel,
                    reason: overrideReason,
                  });
                  setShowOverrideModal(false);
                  setCurrentScreen("dashboard");
                }}
                className="w-1/2 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold"
              >
                Submit Override
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REASSESSMENT MODAL */}
      {showReassessModal && selectedEncounter && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 text-xs shadow-2xl">
            <h3 className="font-bold text-white text-sm flex items-center space-x-1.5">
              <Activity size={16} className="text-amber-400" />
              <span>Reassess Waiting Patient</span>
            </h3>

            <div>
              <label className="block text-slate-400 mb-1">Reassessment Observations / Note</label>
              <textarea
                rows={3}
                value={reassessNote}
                onChange={(e) => setReassessNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
              ></textarea>
            </div>

            <div className="flex space-x-2">
              <button
                onClick={() => setShowReassessModal(false)}
                className="w-1/2 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  act({
                    type: "reassess",
                    encounterId: selectedEncounter.id,
                    note: reassessNote,
                  });
                  setShowReassessModal(false);
                  setCurrentScreen("dashboard");
                }}
                className="w-1/2 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold"
              >
                Save & Recalculate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF REPORT MODAL */}
      {showPdfModal && selectedEncounter && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-bold text-white flex items-center space-x-1">
                <FileText size={16} className="text-teal-400" />
                <span>Patient Triage Report PDF</span>
              </span>
              <button onClick={() => setShowPdfModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="bg-white text-slate-950 p-4 rounded-xl space-y-2 text-[11px] font-mono shadow-inner">
              <div className="font-bold text-center border-b border-slate-300 pb-1">
                PATIENTTRIAGE.AI — CITYCARE HOSPITAL
              </div>
              <div>
                Token: <strong>{selectedEncounter.token}</strong> | ID: {selectedEncounter.id}
              </div>
              <div>
                Patient: <strong>{patientName}</strong> ({patientAge} yo)
              </div>
              <div>Nurse: {state.nurseSession?.name || "Nurse NUR-1042"}</div>
              <div>Arrival: {selectedEncounter.arrivalMode}</div>
              <div className="border-t border-slate-200 pt-1">
                Priority: Level {selectedEncounter.recommendation?.level ?? 4}
              </div>
              <div>Pathway: {selectedEncounter.currentPathway}</div>
              <div>Est Wait: {selectedEncounter.recommendation?.estimatedWait} mins</div>
              {selectedEncounter.override && (
                <div className="text-amber-800 font-semibold border-t border-slate-200 pt-1">
                  ⚡ Overridden by {selectedEncounter.override.nurseId}: "{selectedEncounter.override.reason}"
                </div>
              )}
              <div className="border-t border-slate-200 pt-1 text-[10px] text-slate-600">
                Decision-support output recorded under DPDP audit compliance.
              </div>
            </div>

            <button
              onClick={() => {
                alert("PDF Report Downloaded!");
                setShowPdfModal(false);
              }}
              className="w-full py-2.5 rounded-xl bg-teal-600 text-white font-bold"
            >
              Download PDF Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
