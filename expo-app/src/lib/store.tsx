import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { calculateRecommendation } from "./routing";
import { createDemoState } from "./demoData";
import type { AppState, Encounter, Patient, Resource } from "./types";

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
  encounter.recommendation = calculateRecommendation(encounter, state.resources, state.routingPolicy);
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
  | { type: "resource"; resourceId: string; status: Resource["status"]; available: number }
  | { type: "surge" }
  | { type: "staffShortage" }
  | { type: "ehrFailure" }
  | { type: "createEncounter"; encounter: Partial<Encounter> & { patientName: string; age: number; sex: "Female" | "Male" | "Other"; previousRecord?: Patient["previousRecord"]; photoUrl?: string } };

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
    draft.simulation.baselineMedianWait = 104;
    draft.simulation.dynamicMedianWait = 61;
    draft.simulation.baselineHighRiskDelay = 41;
    draft.simulation.dynamicHighRiskDelay = 14;
    draft.simulation.overtriagePressure = 78;
    draft.alerts.unshift({ id: `A-${Date.now()}`, level: "Critical", title: "3x surge simulation active", detail: "Arrival pressure increased; queue order recalculated by urgency, wait, and resources.", createdAt: now, acknowledged: false });
    audit(draft, "Administrator", "SURGE_SIMULATION_STARTED", "CityCare", "3x normal volume scenario activated.");
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
    const ageGroup = input.encounter.age < 2 ? "Infant" : input.encounter.age < 13 ? "Child" : input.encounter.age >= 65 ? "Geriatric" : "Adult";
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
      patientCategories: input.encounter.patientCategories ?? [ageGroup],
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
