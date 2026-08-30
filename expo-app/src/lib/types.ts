export type UrgencyLevel = 1 | 2 | 3 | 4 | 5;

export type ArrivalMode = "Pre-arrival call" | "Walk-in" | "Ambulance" | "Referral";

export type EncounterStatus =
  | "Expected"
  | "Intake"
  | "Draft"
  | "Waiting"
  | "In pathway"
  | "Escalated"
  | "Transferred";

export type ResourceStatus = "Available" | "Constrained" | "Unavailable";

export type Department = {
  id: string;
  name: string;
  type: "Queue" | "Support" | "Escalation";
  capacity: number;
  currentLoad: number;
  staffAvailable: number;
  averageServiceMins: number;
};

export type Resource = {
  id: string;
  name: string;
  category: "Beds" | "Rooms" | "Equipment" | "Staff";
  total: number;
  available: number;
  status: ResourceStatus;
  location: string;
};

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  department: string;
  status: "Available" | "Busy" | "On break" | "Unavailable";
};

export type Patient = {
  id: string;
  name: string;
  age: number;
  ageGroup: "Infant" | "Child" | "Adult" | "Geriatric";
  sex: "Female" | "Male" | "Other";
  phone?: string;
  previousRecord: "Available" | "Not found" | "Unknown";
  previousSummary?: string;
  photoUrl?: string;
};

export type Vitals = {
  temperature?: number;
  pulse?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  spo2?: number;
  respiratoryRate?: number;
  painScore?: number;
  bloodSugar?: number;
  consciousness: "Alert" | "Confused" | "Responds to voice" | "Responds to pain" | "Unresponsive" | "Not recorded";
  unavailableReason?: string;
  tempUnavailable?: boolean;
  pulseUnavailable?: boolean;
  bpUnavailable?: boolean;
  spo2Unavailable?: boolean;
  respUnavailable?: boolean;
  painUnavailable?: boolean;
};

export type Recommendation = {
  id: string;
  encounterId: string;
  level: UrgencyLevel;
  label: string;
  pathway: string;
  destination: string;
  estimatedWait: number;
  confidence: number;
  resources: string[];
  reasons: string[];
  missingInfo: string[];
  uncertainty: string[];
  humanReviewRequired: boolean;
  undertriageSafeguard: boolean;
  overtriageRiskScore: number;
  pediatricDangerFlag?: boolean;
  geriatricAtypicalFlag?: boolean;
  zeroHistoryFlag?: boolean;
  createdAt: string;
};

export type OverrideRecord = {
  originalPathway: string;
  originalLevel: UrgencyLevel;
  newPathway: string;
  newLevel: UrgencyLevel;
  reason: string;
  nurseId: string;
  time: string;
};

export type Encounter = {
  id: string;
  patientId: string;
  token?: string; // e.g. C-084
  arrivalMode: ArrivalMode;
  arrivalStatus: EncounterStatus;
  speakerSource: "Patient" | "Family" | "Caregiver" | "Ambulance staff" | "Registration staff";
  language: "English" | "Hindi" | "Hinglish" | "Marathi" | "Other";
  communicationLimitations: string[];
  patientCategories: string[];
  primaryConcern: string;
  symptoms: string[];
  freeText: string;
  onset: string;
  duration: string;
  reportedSeverity: number;
  trend: "Worsening" | "Stable" | "Improving" | "Unknown";
  riskAnswers: Record<string, string>;
  vitals: Vitals;
  history: {
    conditions: string;
    medications: string;
    allergies: string;
    previousEpisode: string;
    recentVisit: string;
  };
  observations: string[];
  medicoLegal: boolean;
  transcript?: string;
  photoAttached?: boolean;
  status: EncounterStatus;
  currentPathway: string;
  assignedQueue: string;
  waitingMins: number;
  recommendation: Recommendation;
  override?: OverrideRecord;
  journey: { time: string; event: string; actor: string }[];
  updatedAt: string;
  attendingNurseId?: string;
};

export type DraftEncounter = {
  id: string;
  patientName: string;
  age?: number;
  startedAt: string;
  completionPct: number;
  currentStage: number;
  data: Partial<Encounter> & { patientName?: string; age?: number; sex?: Patient["sex"] };
};

export type NurseSession = {
  rollNumber: string;
  name: string;
  hospitalName: string;
  department: string;
  loggedInAt: string;
};

export type Alert = {
  id: string;
  encounterId?: string;
  level: "Info" | "Warning" | "Critical";
  title: string;
  detail: string;
  createdAt: string;
  acknowledged: boolean;
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
};

export type RoutingPolicy = {
  safetyBias: number;
  waitingTimeWeight: number;
  congestionWeight: number;
  uncertaintyEscalation: number;
};

export type AppState = {
  hospital: {
    id: string;
    name: string;
    location: string;
    jurisdiction: string;
    normalDailyVolume: number;
    currentMode: "Normal" | "Surge" | "Staff shortage" | "Resource outage";
    syntheticDataNotice: string;
  };
  nurseSession?: NurseSession;
  drafts: DraftEncounter[];
  departments: Department[];
  resources: Resource[];
  staff: StaffMember[];
  patients: Patient[];
  encounters: Encounter[];
  alerts: Alert[];
  audit: AuditEvent[];
  routingPolicy: RoutingPolicy;
  simulation: {
    baselineMedianWait: number;
    dynamicMedianWait: number;
    baselineHighRiskDelay: number;
    dynamicHighRiskDelay: number;
    overtriagePressure: number;
    reassessmentsToday: number;
  };
};
