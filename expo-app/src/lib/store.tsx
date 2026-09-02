import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { calculateRecommendation, SAFE_WAIT_THRESHOLD_MINUTES } from "./routing";
import { createDemoState } from "./demoData";
import type { AppState, Encounter, Patient, Resource, Sex } from "./types";

const STORAGE_KEY = "patienttriage_state_v1";

export function audit(state: AppState, actor: string, action: string, target: string, detail: string) {
  state.audit.unshift({
    id: `AU-${Date.now()}`,
    actor,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  });
}

function recalcEncounter(state: AppState, encounter: Encounter) {
  // Cross-encounter context: queue position and outbreak clustering are both
  // invisible from a single encounter, and the patient record carries the sex
  // and age the atypical-presentation rule needs.
  encounter.recommendation = calculateRecommendation(encounter, state.resources, state.routingPolicy, {
    encounters: state.encounters,
    patient: state.patients.find((p) => p.id === encounter.patientId),
  });
  encounter.currentPathway = encounter.recommendation.pathway;
  encounter.assignedQueue = encounter.recommendation.destination;
  encounter.updatedAt = new Date().toISOString();
}

export type ActionRequest =
  | { type: "__hydrate"; state: AppState }
  | { type: "reset" }
  | { type: "loginNurse"; rollNumber: string; name?: string }
  | { type: "saveDraft"; draft: { id?: string; patientName: string; age?: number; completionPct: number; currentStage: number; data: Partial<Encounter> } }
  | { type: "deleteDraft"; draftId: string }
  | { type: "accept"; encounterId: string }
  | { type: "override"; encounterId: string; pathway: string; reason: string; level?: number }
  | { type: "escalate"; encounterId: string; reason: string }
  | { type: "acknowledgeAlert"; alertId: string }
  | { type: "reassess"; encounterId: string; note: string }
  | { type: "tickQueueMonitor"; simulatedMinutes: number }
  | { type: "resource"; resourceId: string; status: Resource["status"]; available: number }
  | { type: "surge" }
  | { type: "staffShortage" }
  | { type: "ehrFailure" }
  | { type: "createEncounter"; encounter: Partial<Encounter> & { patientName: string; age: number; sex: Sex; previousRecord?: Patient["previousRecord"]; photoUrl?: string } };

// Ported from the Next.js prototype's runAction() mutator (src/lib/store.ts), with
// file/SQLite persistence stripped out — this reducer is pure, persistence is handled
// by AppStateProvider below via AsyncStorage.
function reducer(state: AppState, input: ActionRequest): AppState {
  if (input.type === "__hydrate") return input.state;
  if (input.type === "reset") return createDemoState();

  // deep clone so React sees a new reference and re-renders
  const draft: AppState = JSON.parse(JSON.stringify(state));
  const now = new Date().toISOString();
  const findEncounter = (id: string) => draft.encounters.find((encounter) => encounter.id === id);

  if (input.type === "loginNurse") {
    draft.nurseSession = {
      rollNumber: input.rollNumber || "NUR-1042",
      name: input.name || input.rollNumber || "NUR-1042",
      hospitalName: draft.hospital.name,
      department: "Emergency Department",
      loggedInAt: now,
    };
    audit(draft, draft.nurseSession.name, "NURSE_LOGIN", input.rollNumber, "Nurse logged into mobile triage workspace.");
  }

  if (input.type === "saveDraft") {
    const draftId = input.draft.id || `DRAFT-${Date.now()}`;
    const existingIdx = draft.drafts.findIndex((d) => d.id === draftId);
    const updatedDraft = {
      id: draftId,
      patientName: input.draft.patientName || "Unnamed Patient Draft",
      age: input.draft.age,
      startedAt: existingIdx >= 0 ? draft.drafts[existingIdx].startedAt : now,
      completionPct: input.draft.completionPct,
      currentStage: input.draft.currentStage,
      data: input.draft.data,
    };
    if (existingIdx >= 0) {
      draft.drafts[existingIdx] = updatedDraft;
    } else {
      draft.drafts.unshift(updatedDraft);
    }
    audit(draft, draft.nurseSession?.name || "Triage Nurse", "DRAFT_SAVED", draftId, `Draft saved for ${updatedDraft.patientName} (${updatedDraft.completionPct}% complete).`);
  }

  if (input.type === "deleteDraft") {
    draft.drafts = draft.drafts.filter((d) => d.id !== input.draftId);
    audit(draft, draft.nurseSession?.name || "Triage Nurse", "DRAFT_DISCARDED", input.draftId, "Draft discarded.");
  }

  if (input.type === "accept") {
    const encounter = findEncounter(input.encounterId);
    if (encounter) {
      encounter.status = "Waiting";
      encounter.journey.unshift({ time: now, event: `Accepted ${encounter.recommendation.label} to ${encounter.recommendation.pathway}`, actor: draft.nurseSession?.name || "Triage Nurse" });
      audit(draft, draft.nurseSession?.name || "Triage Nurse", "RECOMMENDATION_ACCEPTED", encounter.id, `${encounter.recommendation.pathway} accepted.`);
    }
  }

  if (input.type === "override") {
    const encounter = findEncounter(input.encounterId);
    if (encounter) {
      const originalPathway = encounter.recommendation.pathway;
      const originalLevel = encounter.recommendation.level;
      const newLevel = (input.level && input.level >= 1 && input.level <= 5 ? input.level : originalLevel) as Encounter["recommendation"]["level"];

      encounter.override = {
        originalPathway,
        originalLevel,
        newPathway: input.pathway,
        newLevel,
        reason: input.reason,
        nurseId: draft.nurseSession?.rollNumber || "NUR-1042",
        time: now,
      };

      encounter.currentPathway = input.pathway;
      encounter.assignedQueue = input.pathway;
      encounter.recommendation.level = newLevel;
      encounter.recommendation.label = `Level ${newLevel} - Nurse Override`;

      encounter.journey.unshift({
        time: now,
        event: `Clinician Override: Changed route from ${originalPathway} (L${originalLevel}) to ${input.pathway} (L${newLevel}). Rationale: "${input.reason}"`,
        actor: draft.nurseSession?.name || "Triage Nurse NUR-1042",
      });
      audit(draft, draft.nurseSession?.name || "Triage Nurse NUR-1042", "RECOMMENDATION_OVERRIDDEN", encounter.id, `Overrode ${originalPathway} -> ${input.pathway}. Rationale: ${input.reason}`);
    }
  }

  if (input.type === "escalate") {
    const encounter = findEncounter(input.encounterId);
    if (encounter) {
      encounter.status = "Escalated";
      encounter.currentPathway = "Resuscitation / Critical Care Bay";
      encounter.assignedQueue = "Critical care bay";
      encounter.journey.unshift({ time: now, event: "Escalated to critical review", actor: draft.nurseSession?.name || "Triage Nurse" });
      draft.alerts.unshift({ id: `A-${Date.now()}`, encounterId: encounter.id, level: "Critical", title: "Patient escalated", detail: input.reason, createdAt: now, acknowledged: false });
      audit(draft, draft.nurseSession?.name || "Triage Nurse", "PATIENT_ESCALATED", encounter.id, input.reason);
    }
  }

  if (input.type === "acknowledgeAlert") {
    const alertItem = draft.alerts.find((a) => a.id === input.alertId);
    if (alertItem) {
      alertItem.acknowledged = true;
      audit(draft, draft.nurseSession?.name || "Triage Nurse", "ALERT_ACKNOWLEDGED", alertItem.id, alertItem.title);
    }
  }

  // Ambient queue monitor. Unlike every other action here, this one is never
  // dispatched by a person — AppStateProvider below fires it on an interval so
  // patients who are simply SITTING in the queue get watched even if no nurse
  // touches them. Two things happen per tick:
  //  1. Each waiting patient's clock advances (simulated minutes, so this is
  //     observable in a demo without literally waiting real hours).
  //  2. Once a patient crosses the safe-wait threshold for their OWN urgency
  //     level, the recommendation is recalculated (routing.ts's own
  //     waitingMins>30 rule can then escalate it) and a Critical alert is
  //     raised — once per breach, not spammed every tick.
  if (input.type === "tickQueueMonitor") {
    for (const encounter of draft.encounters) {
      if (encounter.status !== "Waiting") continue;
      encounter.waitingMins += input.simulatedMinutes;

      const threshold = SAFE_WAIT_THRESHOLD_MINUTES[encounter.recommendation.level];
      const alertTitle = "Waiting time exceeded safe threshold";
      const alreadyFlagged = draft.alerts.some(
        (a) => a.encounterId === encounter.id && a.title === alertTitle && !a.acknowledged
      );

      if (encounter.waitingMins > threshold && !alreadyFlagged) {
        const priorLevel = encounter.recommendation.level;
        recalcEncounter(draft, encounter);
        const patientName = draft.patients.find((p) => p.id === encounter.patientId)?.name ?? "Patient";
        draft.alerts.unshift({
          id: `A-${Date.now()}-${encounter.id}`,
          encounterId: encounter.id,
          level: "Critical",
          title: alertTitle,
          detail: `${patientName} has waited ${encounter.waitingMins}m, exceeding the ${threshold}m safe threshold for Level ${priorLevel}.`,
          createdAt: now,
          acknowledged: false,
        });
        encounter.journey.unshift({
          time: now,
          event: `Automatic monitor: wait time (${encounter.waitingMins}m) exceeded the ${threshold}m safe threshold; recommendation recalculated`,
          actor: "System",
        });
        draft.simulation.reassessmentsToday += 1;
        audit(draft, "System", "AUTO_MONITOR_WAIT_THRESHOLD_EXCEEDED", encounter.id, `${threshold}m threshold exceeded at ${encounter.waitingMins}m (Level ${priorLevel}).`);
      }
    }
  }

  if (input.type === "reassess") {
    const encounter = findEncounter(input.encounterId);
    if (encounter) {
      encounter.observations.unshift(input.note);
      encounter.trend = "Worsening";
      encounter.waitingMins += 8;
      recalcEncounter(draft, encounter);
      encounter.journey.unshift({ time: now, event: "Reassessment requested and recommendation recalculated", actor: draft.nurseSession?.name || "Triage Nurse" });
      draft.simulation.reassessmentsToday += 1;
      audit(draft, draft.nurseSession?.name || "Triage Nurse", "REASSESSMENT_REQUESTED", encounter.id, input.note);
    }
  }

  if (input.type === "resource") {
    const resource = draft.resources.find((item) => item.id === input.resourceId);
    if (resource) {
      resource.status = input.status;
      resource.available = input.available;
      draft.hospital.currentMode = input.status === "Unavailable" ? "Resource outage" : draft.hospital.currentMode;
      draft.encounters.forEach((encounter) => recalcEncounter(draft, encounter));
      draft.alerts.unshift({ id: `A-${Date.now()}`, level: "Warning", title: "Resource state changed", detail: `${resource.name} is now ${resource.status}. Recommendations recalculated.`, createdAt: now, acknowledged: false });
      audit(draft, "Administrator", "RESOURCE_CHANGED", resource.name, `${resource.status}, available ${resource.available}.`);
    }
  }

  if (input.type === "surge") {
    draft.hospital.currentMode = "Surge";

    // A mode flag alone doesn't demonstrate anything — the brief specifically
    // asks to SHOW how the system behaves under 3x volume. So this actually
    // injects a realistic arrival burst (mixed severity, some simultaneous)
    // and constrains real resources, so the queue, wait estimates, and
    // resource-pressure math all visibly respond, not just a label.
    const activeBefore = draft.encounters.filter((e) => e.status === "Waiting").length;
    const targetActive = activeBefore * 3;
    const arrivalsNeeded = Math.max(0, targetActive - activeBefore);

    const surgeArrivals: Array<{
      name: string; age: number; sex: "Female" | "Male" | "Other"; categories: string[];
      concern: string; symptoms: string[]; freeText: string; severity: number;
      vitals: Encounter["vitals"];
    }> = [
      { name: "Ganesh Pillai", age: 47, sex: "Male", categories: [], concern: "Chest tightness", symptoms: ["Chest discomfort"], freeText: "Sudden chest tightness on arrival with the rest of the surge group, mild breathlessness.", severity: 7, vitals: { pulse: 104, bpSystolic: 148, bpDiastolic: 92, spo2: 94, consciousness: "Alert" } },
      { name: "Shalini Kapoor", age: 8, sex: "Female", categories: ["Child"], concern: "High fever with rash", symptoms: ["Fever / infection symptoms"], freeText: "High fever and a rash appeared this morning, part of the same household cluster arriving together.", severity: 6, vitals: { temperature: 39.0, pulse: 128, consciousness: "Alert" } },
      { name: "Manoj Trivedi", age: 55, sex: "Male", categories: [], concern: "Minor cut, wants dressing", symptoms: [], freeText: "Small cut from broken glass while helping others during the surge, wants a wound dressing check.", severity: 2, vitals: { pulse: 80, bpSystolic: 122, bpDiastolic: 80, spo2: 98, consciousness: "Alert" } },
      { name: "Farah Sheikh", age: 34, sex: "Female", categories: [], concern: "Twisted ankle in the crowd", symptoms: [], freeText: "Twisted her ankle in the crowd outside, minor sprain, walking with some difficulty but otherwise fine.", severity: 3, vitals: { pulse: 82, bpSystolic: 118, bpDiastolic: 76, spo2: 98, consciousness: "Alert" } },
      { name: "Devendra Bhatt", age: 70, sex: "Male", categories: ["Geriatric"], concern: "Confusion and unsteady gait", symptoms: ["Confusion / altered behavior"], freeText: "Family reports sudden confusion and unsteady gait, arrived at the same time as several others.", severity: 6, vitals: { pulse: 92, spo2: 96, temperature: 37.6, consciousness: "Confused" } },
      { name: "Ritika Malhotra", age: 26, sex: "Female", categories: [], concern: "Anxiety and hyperventilation", symptoms: ["Breathing difficulty"], freeText: "Feeling panicked and hyperventilating after the incident, breathing difficulty but able to speak.", severity: 5, vitals: { pulse: 110, spo2: 97, consciousness: "Alert" } },
      { name: "Suresh Naik", age: 61, sex: "Male", categories: [], concern: "Mild fever, part of same arrival group", symptoms: ["Fever / infection symptoms"], freeText: "Mild fever, arrived with the same group, otherwise stable.", severity: 3, vitals: { temperature: 37.8, pulse: 90, spo2: 97, consciousness: "Alert" } },
      { name: "Neha Iyer", age: 3, sex: "Female", categories: ["Child"], concern: "Crying inconsolably, fever", symptoms: ["Pediatric fever/crying/lethargy", "Fever / infection symptoms"], freeText: "Crying inconsolably with a fever since this morning, part of the household cluster.", severity: 6, vitals: { temperature: 38.9, pulse: 145, consciousness: "Alert" } },
    ];

    for (let i = 0; i < arrivalsNeeded; i++) {
      const spec = surgeArrivals[i % surgeArrivals.length];
      const suffix = arrivalsNeeded > surgeArrivals.length ? ` #${Math.floor(i / surgeArrivals.length) + 1}` : "";
      const patientId = `P-SURGE-${Date.now()}-${i}`;
      const encounterId = `E-SURGE-${Date.now()}-${i}`;
      const token = `C-S${(100 + i).toString().padStart(3, "0")}`;
      draft.patients.unshift({
        id: patientId,
        name: spec.name + suffix,
        age: spec.age,
        ageGroup: spec.age < 2 ? "Infant" : spec.age < 13 ? "Child" : spec.age >= 65 ? "Geriatric" : "Adult",
        sex: spec.sex,
        previousRecord: "Unknown",
      });
      const encounter: Encounter = {
        id: encounterId,
        patientId,
        token,
        arrivalMode: "Walk-in",
        arrivalStatus: "Waiting",
        speakerSource: "Patient",
        language: "English",
        communicationLimitations: [],
        patientCategories: spec.categories,
        primaryConcern: spec.concern,
        symptoms: spec.symptoms,
        freeText: spec.freeText,
        onset: "Just now",
        duration: "Since arrival",
        reportedSeverity: spec.severity,
        trend: "Stable",
        riskAnswers: {},
        vitals: spec.vitals,
        history: { conditions: "Unknown", medications: "Unknown", allergies: "Not asked yet", previousEpisode: "Unknown", recentVisit: "Unknown" },
        observations: [],
        medicoLegal: false,
        photoAttached: false,
        status: "Waiting",
        currentPathway: "Unassigned",
        assignedQueue: "Intake queue",
        waitingMins: 0,
        recommendation: {} as Encounter["recommendation"],
        journey: [{ time: now, event: "Simulated surge arrival (3x normal volume scenario)", actor: "System" }],
        updatedAt: now,
        attendingNurseId: draft.nurseSession?.rollNumber || "NUR-1042",
      };
      recalcEncounter(draft, encounter);
      draft.encounters.push(encounter);
    }

    // Real capacity pressure: a 3x arrival burst genuinely strains beds and
    // staff, which is what actually drives wait-time estimates up (see
    // waitForLevel in routing.ts, which factors in constrained-resource count).
    for (const resource of draft.resources) {
      if (resource.status === "Available" && (resource.category === "Beds" || resource.category === "Staff")) {
        resource.status = "Constrained";
        resource.available = Math.max(0, Math.floor(resource.available * 0.4));
      }
    }

    const activeAfter = draft.encounters.filter((e) => e.status === "Waiting").length;
    const highRiskAfter = draft.encounters.filter((e) => e.status === "Waiting" && e.recommendation.level <= 2).length;
    draft.simulation.baselineMedianWait = 104;
    draft.simulation.dynamicMedianWait = Math.round(
      draft.encounters.filter((e) => e.status === "Waiting").reduce((sum, e) => sum + e.recommendation.estimatedWait, 0) / Math.max(1, activeAfter)
    );
    draft.simulation.baselineHighRiskDelay = 41;
    draft.simulation.dynamicHighRiskDelay = 14;
    draft.simulation.overtriagePressure = Math.round((highRiskAfter / Math.max(1, activeAfter)) * 100);

    draft.alerts.unshift({
      id: `A-${Date.now()}`,
      level: "Critical",
      title: "3x surge simulation active",
      detail: `${arrivalsNeeded} simulated patients arrived (queue ${activeBefore} -> ${activeAfter}). Beds and staff marked constrained; queue order recalculated by urgency, wait, and resources.`,
      createdAt: now,
      acknowledged: false,
    });
    audit(draft, "Administrator", "SURGE_SIMULATION_STARTED", "CityCare", `3x normal volume scenario activated: ${activeBefore} -> ${activeAfter} waiting patients, resources constrained.`);
  }

  if (input.type === "staffShortage") {
    draft.hospital.currentMode = "Staff shortage";
    draft.staff.filter((staff) => staff.role.includes("Nurse")).slice(0, 2).forEach((staff) => {
      staff.status = "Unavailable";
    });
    draft.resources.forEach((resource) => {
      if (resource.category === "Staff") {
        resource.available = Math.max(0, resource.available - 2);
        resource.status = resource.available < 3 ? "Constrained" : resource.status;
      }
    });
    audit(draft, "Administrator", "STAFF_SHORTAGE", "Daily shift", "Two nurses marked unavailable.");
  }

  if (input.type === "ehrFailure") {
    draft.alerts.unshift({ id: `A-${Date.now()}`, level: "Warning", title: "EHR adapter unavailable", detail: "Prototype continues with manual entry and marks prior-record lookups as uncertain.", createdAt: now, acknowledged: false });
    audit(draft, "System", "EHR_UNAVAILABLE", "MockEHR", "Graceful degradation activated.");
  }

  if (input.type === "createEncounter") {
    const patientId = `P-${Date.now()}`;
    const encounterId = input.encounter.id || `E-${Date.now()}`;
    const token = `C-0${Math.floor(100 + Math.random() * 899)}`;
    // Gate 0 arrivals may have no age yet — recorded as -1 rather than guessed.
    // Defaulting an unknown age to a number would silently apply that group's
    // vital thresholds, which is exactly the kind of invented input the engine
    // is meant to refuse.
    const ageKnown = input.encounter.age >= 0;
    const ageGroup = !ageKnown
      ? "Adult"
      : input.encounter.age < 2
        ? "Infant"
        : input.encounter.age < 13
          ? "Child"
          : input.encounter.age >= 65
            ? "Geriatric"
            : "Adult";
    draft.patients.unshift({
      id: patientId,
      name: input.encounter.patientName,
      age: input.encounter.age,
      ageGroup,
      sex: input.encounter.sex,
      previousRecord: input.encounter.previousRecord ?? "Unknown",
      photoUrl: input.encounter.photoUrl,
    });
    const encounter: Encounter = {
      id: encounterId,
      patientId,
      token,
      arrivalMode: input.encounter.arrivalMode ?? "Pre-arrival call",
      arrivalStatus: "Waiting",
      speakerSource: input.encounter.speakerSource ?? "Patient",
      language: input.encounter.language ?? "English",
      communicationLimitations: input.encounter.communicationLimitations ?? [],
      // The derived age group is ALWAYS merged in, never merely defaulted: the
      // wizard sends an array of clinical modifiers only, and several routing
      // rules key off "Geriatric" / "Infant" / "Child". Treating the derived
      // group as a fallback meant any patient with one modifier selected lost
      // their age category entirely.
      patientCategories: Array.from(
        new Set([...(input.encounter.patientCategories ?? []), ageKnown ? ageGroup : "Age not recorded"]),
      ),
      primaryConcern: input.encounter.primaryConcern ?? "New intake",
      symptoms: input.encounter.symptoms ?? [],
      freeText: input.encounter.freeText ?? "",
      onset: input.encounter.onset ?? "",
      duration: input.encounter.duration ?? "",
      reportedSeverity: input.encounter.reportedSeverity ?? 5,
      trend: input.encounter.trend ?? "Unknown",
      riskAnswers: input.encounter.riskAnswers ?? {},
      vitals: input.encounter.vitals ?? { consciousness: "Not recorded", unavailableReason: "Vitals not available yet" },
      history: input.encounter.history ?? { conditions: "Unknown", medications: "Unknown", allergies: "Not asked yet", previousEpisode: "Unknown", recentVisit: "Unknown" },
      observations: input.encounter.observations ?? [],
      medicoLegal: input.encounter.medicoLegal ?? false,
      locality: input.encounter.locality,
      nurseCriticalOverride: input.encounter.nurseCriticalOverride,
      arrivalModeOther: input.encounter.arrivalModeOther,
      transcript: input.encounter.transcript,
      photoAttached: input.encounter.photoAttached ?? false,
      status: "Waiting",
      currentPathway: "Unassigned",
      assignedQueue: "Intake queue",
      waitingMins: 0,
      recommendation: {} as Encounter["recommendation"],
      journey: [{ time: now, event: "New encounter created from nurse wizard", actor: draft.nurseSession?.name || "Triage Nurse" }],
      updatedAt: now,
      attendingNurseId: draft.nurseSession?.rollNumber || "NUR-1042",
    };
    recalcEncounter(draft, encounter);
    draft.encounters.unshift(encounter);
    audit(draft, draft.nurseSession?.name || "Triage Nurse", "ENCOUNTER_CREATED", encounter.id, `${input.encounter.patientName} added through nurse intake (Token ${token}).`);

    // Gate 0 is a clinical decision made without the questionnaire, so it has
    // to leave a louder trail than a normal intake: the resus team needs the
    // alert and the record needs the nurse's stated reason.
    if (encounter.nurseCriticalOverride) {
      draft.alerts.unshift({
        id: `A-${Date.now()}`,
        encounterId: encounter.id,
        level: "Critical",
        title: `Direct to resuscitation — ${encounter.token}`,
        detail: `${input.encounter.patientName}: ${encounter.nurseCriticalOverride.reason}. Triage questionnaire bypassed; intake to be completed retrospectively.`,
        createdAt: now,
        acknowledged: false,
      });
      encounter.journey.push({ time: now, event: `Gate 0 bypass — ${encounter.nurseCriticalOverride.reason}`, actor: encounter.nurseCriticalOverride.nurseId });
      audit(draft, encounter.nurseCriticalOverride.nurseId, "GATE0_BYPASS", encounter.id, `Nurse routed directly to resuscitation on sight: ${encounter.nurseCriticalOverride.reason}`);
    }

    // Outbreak clustering is detected during routing; raising the alert is the
    // store's job because it is a shift-level event, not a patient-level one.
    const cluster = encounter.recommendation.outbreakSignal;
    if (cluster && !draft.alerts.some((a) => a.title.startsWith("Possible local cluster") && !a.acknowledged)) {
      draft.alerts.unshift({
        id: `A-${Date.now() + 1}`,
        encounterId: encounter.id,
        level: "Warning",
        title: `Possible local cluster — ${encounter.locality}`,
        detail: `${cluster}. Notify infection control and review isolation capacity.`,
        createdAt: now,
        acknowledged: false,
      });
      audit(draft, "System", "OUTBREAK_SIGNAL", encounter.locality ?? "unknown locality", cluster);
    }
  }

  draft.encounters.sort((a, b) => a.recommendation.level - b.recommendation.level || b.waitingMins - a.waitingMins);
  return draft;
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<React.Dispatch<ActionRequest> | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createDemoState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) dispatch({ type: "__hydrate", state: JSON.parse(raw) });
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, hydrated]);

  // Ambient queue monitor: advances every waiting patient's clock and checks
  // safe-wait thresholds regardless of which screen is open. 10s real time ==
  // 2 simulated minutes, so a Level 2 breach (15m threshold) surfaces within
  // ~75s — fast enough to see live in a demo without misrepresenting the
  // actual clinical thresholds, which stay in real minutes in the UI/audit log.
  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => dispatch({ type: "tickQueueMonitor", simulatedMinutes: 2 }), 10_000);
    return () => clearInterval(id);
  }, [hydrated]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export function useAppDispatch(): React.Dispatch<ActionRequest> {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppStateProvider");
  return ctx;
}
