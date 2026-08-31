import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert as RNAlert, Platform } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { transcribeAudio, isSttConfigured } from "../lib/aiClinical";

/**
 * Real voice capture: records audio, sends it to Groq-hosted Whisper, returns
 * the transcript. Replaces the previous "Simulate voice" button, which only
 * pasted a canned paragraph while showing a microphone icon.
 *
 * Degrades in three stages, so intake is never blocked:
 *   no STT key  -> button hidden, nurse types (or uses the sample below)
 *   mic denied  -> explains once, nurse types
 *   STT fails   -> keeps the recording, tells the nurse to type
 */
export function VoiceCapture({
  language,
  onTranscript,
  onSampleFallback,
}: {
  language?: string;
  onTranscript: (text: string) => void;
  onSampleFallback?: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [busy, setBusy] = useState(false);

  const sttReady = isSttConfigured();

  async function startRecording() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        RNAlert.alert("Microphone unavailable", "Voice capture needs microphone access. You can still type the description.");
        return;
      }
      // Required on iOS so recording works while the device is in silent mode.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (err) {
      console.warn("[voice] start failed", err);
      RNAlert.alert("Could not start recording", "Please type the description instead.");
    }
  }

  async function stopAndTranscribe() {
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        RNAlert.alert("Nothing recorded", "No audio was captured. Please try again or type instead.");
        return;
      }
      const text = await transcribeAudio(uri, language);
      if (!text) {
        RNAlert.alert(
          "Transcription unavailable",
          "The audio was recorded but could not be transcribed. Please type what was said — routing still works normally."
        );
        return;
      }
      onTranscript(text);
    } catch (err) {
      console.warn("[voice] stop/transcribe failed", err);
      RNAlert.alert("Voice capture failed", "Please type the description instead.");
    } finally {
      setBusy(false);
    }
  }

  // Web has no expo-audio recording support in this SDK; offer the sample so the
  // browser demo still shows the downstream AI flow.
  if (Platform.OS === "web" || !sttReady) {
    return onSampleFallback ? (
      <Pressable onPress={onSampleFallback} hitSlop={8} className="flex-row items-center gap-1 min-h-[32px]">
        <MaterialIcons name="mic-off" size={16} color="#777587" />
        <Text className="font-label-caps text-label-caps text-on-surface-variant">
          {Platform.OS === "web" ? "Use sample (voice needs device)" : "Use sample (no STT key)"}
        </Text>
      </Pressable>
    ) : null;
  }

  if (busy) {
    return (
      <View className="flex-row items-center gap-2 min-h-[32px]">
        <ActivityIndicator size="small" color="#3525cd" />
        <Text className="font-label-caps text-label-caps text-on-surface-variant">Transcribing…</Text>
      </View>
    );
  }

  if (recorderState.isRecording) {
    return (
      <Pressable
        onPress={stopAndTranscribe}
        accessibilityRole="button"
        accessibilityLabel="Stop recording and transcribe"
        className="flex-row items-center gap-2 min-h-[32px] px-3 py-1 rounded-full bg-error-container"
      >
        <View className="w-2.5 h-2.5 rounded-full bg-error" />
        <Text className="font-label-caps text-label-caps text-on-error-container">
          Recording — tap to stop
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={startRecording}
      accessibilityRole="button"
      accessibilityLabel="Record what the patient said"
      className="flex-row items-center gap-1 min-h-[32px]"
    >
      <MaterialIcons name="mic" size={16} color="#3525cd" />
      <Text className="font-label-caps text-label-caps text-primary">Record voice</Text>
    </Pressable>
  );
}
