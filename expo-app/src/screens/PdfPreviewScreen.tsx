import { View, Text, ScrollView, Pressable, Platform } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { TopAppBar } from "../components/TopAppBar";
import { useAppState } from "../lib/store";

function buildReportHtml(args: {
  patientName: string;
  age: number;
  sex: string;
  encounterId: string;
  token: string;
  arrivalTime: string;
  vitalsHtml: string;
  chiefComplaint: string;
  historyItems: string[];
  pathway: string;
  level: string;
  reasons: string[];
  missingInfo: string;
  confidence: number;
  decision: string;
}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body { font-family: -apple-system, Inter, sans-serif; color: #1b1b24; padding: 32px; }
    h1 { font-size: 22px; margin-bottom: 4px; } h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; }
    .muted { color: #464555; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .grid { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }
    .cell { background: #F5F2FF; border-radius: 8px; padding: 10px 14px; min-width: 90px; }
    .ai { background: rgba(79,70,229,0.05); border: 1px solid rgba(79,70,229,0.2); border-radius: 12px; padding: 16px; margin-top: 16px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #E2E8F0; font-size: 11px; font-style: italic; color: #777587; text-align: center; }
  </style></head><body>
    <h1>Patient Routing Summary</h1>
    <p class="muted">PatientTriage.ai | CityCare Hospital</p>
    <div class="grid">
      <div class="cell"><div class="muted">Patient</div><b>${args.patientName}</b></div>
      <div class="cell"><div class="muted">Encounter</div>${args.encounterId}</div>
      <div class="cell"><div class="muted">Token</div><b>${args.token}</b></div>
      <div class="cell"><div class="muted">Arrival</div>${args.arrivalTime}</div>
    </div>
    <h2>Vitals & Presentation</h2>
    <div class="grid">${args.vitalsHtml}</div>
    <p><b>Chief complaint:</b> ${args.chiefComplaint}</p>
    <h2>History & Observations</h2>
    <ul>${args.historyItems.map((h) => `<li>${h}</li>`).join("")}</ul>
    <div class="ai">
      <div class="muted">AI Routing — ${args.level}</div>
      <p><b>Recommendation:</b> ${args.pathway}</p>
      <p><b>Rationale:</b> ${args.reasons.join(". ")}.</p>
      <p><b>Missing information:</b> ${args.missingInfo}</p>
      <p><b>Confidence:</b> ${Math.round(args.confidence * 100)}%</p>
    </div>
    <h2>Clinical Decision</h2>
    <p>${args.decision}</p>
    <p class="footer">AI-generated decision-support recommendation — not a diagnosis. Final clinical judgment relies entirely on the attending medical professional.</p>
  </body></html>`;
}

// Ported from stitch_patienttriage.ai_nurse_portal/pdf_report_preview/code.html
export function PdfPreviewScreen({ encounterId, onBack }: { encounterId: string; onBack: () => void }) {
  const state = useAppState();
  const encounter = state.encounters.find((e) => e.id === encounterId);
  const patient = encounter ? state.patients.find((p) => p.id === encounter.patientId) : undefined;
  if (!encounter || !patient) return null;

  const v = encounter.vitals;
  const rec = encounter.recommendation;
  const arrivalTime = new Date(encounter.journey[encounter.journey.length - 1]?.time ?? Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const decisionEntry = encounter.override
    ? `Overridden by ${encounter.override.nurseId}: ${encounter.override.reason}`
    : encounter.status === "Waiting"
      ? `AI recommendation accepted by ${encounter.attendingNurseId}`
      : "Pending nurse decision";

  const vitalsHtml = [
    ["HR", v.pulseUnavailable ? "—" : `${v.pulse ?? "—"} bpm`],
    ["BP", v.bpUnavailable ? "—" : `${v.bpSystolic ?? "—"}/${v.bpDiastolic ?? "—"}`],
    ["SpO2", v.spo2Unavailable ? "—" : `${v.spo2 ?? "—"}%`],
    ["Temp", v.tempUnavailable ? "—" : `${v.temperature ?? "—"}°C`],
  ]
    .map(([label, value]) => `<div class="cell"><div class="muted">${label}</div><b>${value}</b></div>`)
    .join("");

  async function handleDownload() {
    const html = buildReportHtml({
      patientName: patient!.name,
      age: patient!.age,
      sex: patient!.sex,
      encounterId: encounter!.id,
      token: encounter!.token ?? "—",
      arrivalTime,
      vitalsHtml,
      chiefComplaint: encounter!.freeText || encounter!.primaryConcern,
      historyItems: [
        `Conditions: ${encounter!.history.conditions}`,
        `Allergies: ${encounter!.history.allergies}`,
        ...encounter!.observations.map((o) => `Observation: ${o}`),
      ],
      pathway: rec.pathway,
      level: rec.label,
      reasons: rec.reasons,
      missingInfo: rec.missingInfo.join(", ") || "None",
      confidence: rec.confidence,
      decision: decisionEntry,
    });

    if (Platform.OS === "web") {
      await Print.printAsync({ html });
      return;
    }
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  }

  return (
    <View className="flex-1 bg-background">
      <TopAppBar variant="task" title="PDF Preview" onBack={onBack} onDashboard={onBack} rightIcon="close" />
      <ScrollView className="flex-1" contentContainerClassName="px-container-padding py-section-gap gap-section-gap pb-8">
        <View className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6 gap-section-gap shadow-sm">
          <View className="border-b border-outline-variant pb-4 gap-1">
            <Text className="font-headline-lg text-headline-lg text-on-surface">Patient Routing Summary</Text>
            <Text className="font-label-caps text-label-caps text-outline uppercase tracking-wider">PatientTriage.ai | CityCare Hospital</Text>
          </View>

          <View className="bg-surface-container-low rounded-lg p-4 border border-outline-variant/50 gap-4">
            <View className="flex-row gap-4">
              <View className="flex-1">
                <Text className="font-label-caps text-label-caps text-on-surface-variant mb-1">Patient Name</Text>
                <Text className="font-headline-md text-headline-md text-on-surface">{patient.name}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-label-caps text-label-caps text-on-surface-variant mb-1">Encounter ID</Text>
                <Text className="font-body-md text-body-md text-on-surface">{encounter.id}</Text>
              </View>
            </View>
            <View className="flex-row gap-4">
              <View className="flex-1">
                <Text className="font-label-caps text-label-caps text-on-surface-variant mb-1">Token</Text>
                <Text className="font-stat-value text-stat-value text-primary">{encounter.token}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-label-caps text-label-caps text-on-surface-variant mb-1">Arrival Time</Text>
                <Text className="font-body-md text-body-md text-on-surface">{arrivalTime}</Text>
              </View>
            </View>
          </View>

          <View className="gap-2">
            <Text className="font-headline-md text-headline-md text-on-surface border-b border-outline-variant/30 pb-2">Vitals & Presentation</Text>
            <View className="gap-3">
              <View className="flex-row gap-3">
                <View className="flex-1 p-3 bg-surface rounded border border-outline-variant/30">
                  <Text className="font-label-caps text-label-caps text-outline mb-1">HR</Text>
                  <Text className="font-stat-value text-stat-value text-error">{v.pulseUnavailable ? "—" : v.pulse ?? "—"}</Text>
                </View>
                <View className="flex-1 p-3 bg-surface rounded border border-outline-variant/30">
                  <Text className="font-label-caps text-label-caps text-outline mb-1">BP</Text>
                  <Text className="font-stat-value text-stat-value text-on-surface">
                    {v.bpUnavailable ? "—" : `${v.bpSystolic ?? "—"}/${v.bpDiastolic ?? "—"}`}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1 p-3 bg-surface rounded border border-outline-variant/30">
                  <Text className="font-label-caps text-label-caps text-outline mb-1">SpO2</Text>
                  <Text className="font-stat-value text-stat-value text-on-surface">{v.spo2Unavailable ? "—" : `${v.spo2 ?? "—"}%`}</Text>
                </View>
                <View className="flex-1 p-3 bg-surface rounded border border-outline-variant/30">
                  <Text className="font-label-caps text-label-caps text-outline mb-1">Temp</Text>
                  <Text className="font-stat-value text-stat-value text-on-surface">{v.tempUnavailable ? "—" : `${v.temperature ?? "—"}°C`}</Text>
                </View>
              </View>
            </View>
            <View className="bg-surface-container p-3 rounded-md border-l-4 border-primary mt-2">
              <Text className="font-label-caps text-label-caps text-primary mb-1">Chief Complaint</Text>
              <Text className="font-body-lg text-body-lg text-on-surface">{encounter.freeText || encounter.primaryConcern}</Text>
            </View>
          </View>

          <View className="bg-primary/5 border border-primary/20 rounded-xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-headline-md text-headline-md text-primary">AI Routing — {rec.label}</Text>
            </View>
            <Text className="font-body-md text-body-md text-on-surface font-semibold">{rec.pathway}</Text>
            <Text className="font-helper-text text-helper-text text-on-surface-variant">{rec.reasons.join(". ")}.</Text>
            <Text className="font-helper-text text-helper-text text-on-surface">Missing: {rec.missingInfo.join(", ") || "None"}</Text>
          </View>

          <View className="border border-outline-variant rounded-xl p-4">
            <Text className="font-label-caps text-label-caps text-on-surface-variant mb-2">Clinical Decision</Text>
            <View className="flex-row items-center gap-3">
              <MaterialIcons name="check-circle" size={18} color="#16a34a" />
              <Text className="font-body-md text-body-md text-on-surface flex-1">{decisionEntry}</Text>
            </View>
          </View>

          <Text className="font-helper-text text-helper-text text-outline italic text-center mt-2">
            AI-generated decision-support recommendation — not a diagnosis. Final clinical judgment relies entirely on the attending medical professional.
          </Text>
        </View>

        <View className="gap-stack-gap">
          <Pressable onPress={handleDownload} className="bg-primary-container h-touch-target-min rounded-lg flex-row items-center justify-center gap-2 shadow-sm">
            <MaterialIcons name="download" size={18} color="#ffffff" />
            <Text className="font-body-md text-body-md font-semibold text-on-primary">Download PDF</Text>
          </Pressable>
          <Pressable onPress={onBack} className="border border-outline-variant bg-surface-container-lowest h-touch-target-min rounded-lg flex-row items-center justify-center gap-2">
            <MaterialIcons name="arrow-back" size={18} color="#1b1b24" />
            <Text className="font-body-md text-body-md text-on-surface">Back to Patient</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
