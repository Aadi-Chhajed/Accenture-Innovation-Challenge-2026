import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { calculateRecommendation } from "./routing";
import { createDemoState } from "./demoData";
import type { AppState, Encounter, Resource } from "./types";

let inMemoryState: AppState | null = null;
const dbPath = join(process.cwd(), "data", "citycare.sqlite");
const jsonPath = join(process.cwd(), "data", "citycare.json");

function getSqliteDb() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    return db;
  } catch (err) {
    console.warn("SQLite not available or failed to open, using file/memory fallback:", err);
    return null;
  }
}

export function resetState(): AppState {
  const state = createDemoState();
  inMemoryState = state;
  
  const db = getSqliteDb();
  if (db) {
    try {
      db.prepare("INSERT OR REPLACE INTO app_state (id, json, updated_at) VALUES ('main', ?, ?)").run(
        JSON.stringify(state),
        new Date().toISOString()
      );
      db.close();
    } catch {
      // ignore
    }
  }

  try {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // ignore
  }

  return state;
}

export function getState(): AppState {
  if (inMemoryState) {
    return inMemoryState;
  }

  const db = getSqliteDb();
  if (db) {
    try {
      const row = db.prepare("SELECT json FROM app_state WHERE id = 'main'").get() as { json: string } | undefined;
      db.close();
      if (row?.json) {
        inMemoryState = JSON.parse(row.json) as AppState;
        return inMemoryState;
      }
    } catch {
      // fallback
    }
  }

  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8");
      if (content) {
        inMemoryState = JSON.parse(content) as AppState;
        return inMemoryState;
      }
    } catch {
      // fallback
    }
  }

  return resetState();
}

export function updateState(mutator: (state: AppState) => AppState): AppState {
  const current = getState();
  const next = mutator(current);
  inMemoryState = next;

  const db = getSqliteDb();
  if (db) {
    try {
      db.prepare("INSERT OR REPLACE INTO app_state (id, json, updated_at) VALUES ('main', ?, ?)").run(
        JSON.stringify(next),
        new Date().toISOString()
      );
      db.close();
    } catch {
      // ignore
    }
  }

  try {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(next, null, 2), "utf-8");
  } catch {
    // ignore
  }

  return next;
}

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
  | { type: "reset" }
  | { type: "loginNurse"; rollNumber: string; name?: string }
  | { type: "saveDraft"; draft: { id?: string; patientName: string; age?: number; completionPct: number; currentStage: number; data: Partial<Encounter> } }
  | { type: "deleteDraft"; draftId: string }
  | { type: "accept"; encounterId: string }
  | { type: "override"; encounterId: string; pathway: string; reason: string; level?: number }
  | { type: "escalate"; encounterId: string; reason: string }
  | { type: "reassess"; encounterId: string; note: string }
  | { type: "resource"; resourceId: string; status: Resource["status"]; available: number }
  | { type: "surge" }
  | { type: "staffShortage" }
  | { type: "ehrFailure" }
  | { type: "createEncounter"; encounter: Partial<Encounter> & { patientName: string; age: number; sex: "Female" | "Male" | "Other" } };

export function runAction(input: ActionRequest): AppState {
  if (input.type === "reset") return resetState();

  return updateState((state) => {
    const now = new Date().toISOString();
    const findEncounter = (id: string) => state.encounters.find((encounter) => encounter.id === id);

    if (input.type === "loginNurse") {
      state.nurseSession = {
        rollNumber: input.rollNumber || "NUR-1042",
        name: input.name || `Nurse (${input.rollNumber || "NUR-1042"})`,
        hospitalName: state.hospital.name,
        department: "Emergency Department",
        loggedInAt: now,
      };
      audit(state, state.nurseSession.name, "NURSE_LOGIN", input.rollNumber, "Nurse logged into mobile triage workspace.");
    }

    if (input.type === "saveDraft") {
      const draftId = input.draft.id || `DRAFT-${Date.now()}`;
      const existingIdx = state.drafts.findIndex((d) => d.id === draftId);
      const updatedDraft = {
        id: draftId,
        patientName: input.draft.patientName || "Unnamed Patient Draft",
        age: input.draft.age,
        startedAt: existingIdx >= 0 ? state.drafts[existingIdx].startedAt : now,
        completionPct: input.draft.completionPct,
        currentStage: input.draft.currentStage,
        data: input.draft.data,
      };
      if (existingIdx >= 0) {
        state.drafts[existingIdx] = updatedDraft;
      } else {
        state.drafts.unshift(updatedDraft);
      }
      audit(state, state.nurseSession?.name || "Triage Nurse", "DRAFT_SAVED", draftId, `Draft saved for ${updatedDraft.patientName} (${updatedDraft.completionPct}% complete).`);
    }

    if (input.type === "deleteDraft") {
      state.drafts = state.drafts.filter((d) => d.id !== input.draftId);
      audit(state, state.nurseSession?.name || "Triage Nurse", "DRAFT_DISCARDED", input.draftId, "Draft discarded.");
    }

    if (input.type === "accept") {
      const encounter = findEncounter(input.encounterId);
      if (encounter) {
        encounter.status = "Waiting";
        encounter.journey.unshift({ time: now, event: `Accepted ${encounter.recommendation.label} to ${encounter.recommendation.pathway}`, actor: state.nurseSession?.name || "Triage Nurse" });
        audit(state, state.nurseSession?.name || "Triage Nurse", "RECOMMENDATION_ACCEPTED", encounter.id, `${encounter.recommendation.pathway} accepted.`);
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
          nurseId: state.nurseSession?.rollNumber || "NUR-1042",
          time: now,
        };

        encounter.currentPathway = input.pathway;
        encounter.assignedQueue = input.pathway;
        encounter.recommendation.level = newLevel;
        encounter.recommendation.label = `Level ${newLevel} - Nurse Override`;
        
        encounter.journey.unshift({
          time: now,
          event: `Clinician Override: Changed route from ${originalPathway} (L${originalLevel}) to ${input.pathway} (L${newLevel}). Rationale: "${input.reason}"`,
          actor: state.nurseSession?.name || "Triage Nurse NUR-1042"
        });
        audit(state, state.nurseSession?.name || "Triage Nurse NUR-1042", "RECOMMENDATION_OVERRIDDEN", encounter.id, `Overrode ${originalPathway} -> ${input.pathway}. Rationale: ${input.reason}`);
      }
    }

    if (input.type === "escalate") {
      const encounter = findEncounter(input.encounterId);
      if (encounter) {
        encounter.status = "Escalated";
        encounter.currentPathway = "Resuscitation / Critical Care Bay";
        encounter.assignedQueue = "Critical care bay";
        encounter.journey.unshift({ time: now, event: "Escalated to critical review", actor: state.nurseSession?.name || "Triage Nurse" });
        state.alerts.unshift({ id: `A-${Date.now()}`, encounterId: encounter.id, level: "Critical", title: "Patient escalated", detail: input.reason, createdAt: now, acknowledged: false });
        audit(state, state.nurseSession?.name || "Triage Nurse", "PATIENT_ESCALATED", encounter.id, input.reason);
      }
    }

    if (input.type === "reassess") {
      const encounter = findEncounter(input.encounterId);
      if (encounter) {
        encounter.observations.unshift(input.note);
        encounter.trend = "Worsening";
        encounter.waitingMins += 8;
        recalcEncounter(state, encounter);
        encounter.journey.unshift({ time: now, event: "Reassessment requested and recommendation recalculated", actor: state.nurseSession?.name || "Triage Nurse" });
        state.simulation.reassessmentsToday += 1;
        audit(state, state.nurseSession?.name || "Triage Nurse", "REASSESSMENT_REQUESTED", encounter.id, input.note);
      }
    }

    if (input.type === "resource") {
      const resource = state.resources.find((item) => item.id === input.resourceId);
      if (resource) {
        resource.status = input.status;
        resource.available = input.available;
        state.hospital.currentMode = input.status === "Unavailable" ? "Resource outage" : state.hospital.currentMode;
        state.encounters.forEach((encounter) => recalcEncounter(state, encounter));
        state.alerts.unshift({ id: `A-${Date.now()}`, level: "Warning", title: "Resource state changed", detail: `${resource.name} is now ${resource.status}. Recommendations recalculated.`, createdAt: now, acknowledged: false });
        audit(state, "Administrator", "RESOURCE_CHANGED", resource.name, `${resource.status}, available ${resource.available}.`);
      }
    }

    if (input.type === "surge") {
      state.hospital.currentMode = "Surge";
      state.simulation.baselineMedianWait = 104;
      state.simulation.dynamicMedianWait = 61;
      state.simulation.baselineHighRiskDelay = 41;
      state.simulation.dynamicHighRiskDelay = 14;
      state.simulation.overtriagePressure = 78;
      state.alerts.unshift({ id: `A-${Date.now()}`, level: "Critical", title: "3x surge simulation active", detail: "Arrival pressure increased; queue order recalculated by urgency, wait, and resources.", createdAt: now, acknowledged: false });
      audit(state, "Administrator", "SURGE_SIMULATION_STARTED", "CityCare", "3x normal volume scenario activated.");
    }

    if (input.type === "staffShortage") {
      state.hospital.currentMode = "Staff shortage";
      state.staff.filter((staff) => staff.role.includes("Nurse")).slice(0, 2).forEach((staff) => {
        staff.status = "Unavailable";
      });
      state.resources.forEach((resource) => {
        if (resource.category === "Staff") {
          resource.available = Math.max(0, resource.available - 2);
          resource.status = resource.available < 3 ? "Constrained" : resource.status;
        }
      });
      audit(state, "Administrator", "STAFF_SHORTAGE", "Daily shift", "Two nurses marked unavailable.");
    }

    if (input.type === "ehrFailure") {
      state.alerts.unshift({ id: `A-${Date.now()}`, level: "Warning", title: "EHR adapter unavailable", detail: "Prototype continues with manual entry and marks prior-record lookups as uncertain.", createdAt: now, acknowledged: false });
      audit(state, "System", "EHR_UNAVAILABLE", "MockEHR", "Graceful degradation activated.");
    }

    if (input.type === "createEncounter") {
      const patientId = `P-${Date.now()}`;
      const encounterId = `E-${Date.now()}`;
      const token = `C-0${Math.floor(100 + Math.random() * 899)}`;
      const ageGroup = input.encounter.age < 2 ? "Infant" : input.encounter.age < 13 ? "Child" : input.encounter.age >= 65 ? "Geriatric" : "Adult";
      state.patients.unshift({
        id: patientId,
        name: input.encounter.patientName,
        age: input.encounter.age,
        ageGroup,
        sex: input.encounter.sex,
        previousRecord: "Unknown",
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
        journey: [{ time: now, event: "New encounter created from nurse wizard", actor: state.nurseSession?.name || "Triage Nurse" }],
        updatedAt: now,
        attendingNurseId: state.nurseSession?.rollNumber || "NUR-1042",
      };
      recalcEncounter(state, encounter);
      state.encounters.unshift(encounter);
      audit(state, state.nurseSession?.name || "Triage Nurse", "ENCOUNTER_CREATED", encounter.id, `${input.encounter.patientName} added through nurse intake (Token ${token}).`);
    }

    state.encounters.sort((a, b) => a.recommendation.level - b.recommendation.level || b.waitingMins - a.waitingMins);
    return state;
  });
}
