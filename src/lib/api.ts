import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type InjectMethod = "type" | "paste";

export interface Config {
  hotkey: string;
  model_id: string;
  mic_device: string | null;
  language: string;
  inject_method: InjectMethod;
  show_in_dock: boolean;
  show_pill: boolean;
  dictation_sounds: boolean;
  mute_music: boolean;
  onboarded: boolean;
  dictionary: string[];
  replacements: Replacement[];
}

export interface Replacement {
  from: string;
  to: string;
}

export interface ModelMeta {
  id: string;
  filename: string;
  downloaded: boolean;
}

export interface HistoryEntry {
  ts_ms: number;
  text: string;
  words: number;
  duration_ms: number;
}

export const getHistory = () => invoke<HistoryEntry[]>("get_history");
export const clearHistory = () => invoke<void>("clear_history");

export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (newConfig: Config) =>
  invoke<void>("save_config", { newConfig });
export const listMicrophones = () => invoke<string[]>("list_microphones");
export const listModels = () => invoke<ModelMeta[]>("list_models");
export const downloadModel = (id: string) =>
  invoke<void>("download_model", { id });
export const cancelDownload = (id: string) =>
  invoke<void>("cancel_download", { id });
export const removeModel = (id: string) => invoke<void>("remove_model", { id });
export const getState = () => invoke<string>("get_state");
export const uiStartRecording = () => invoke<void>("ui_start_recording");
export const uiStopAndInsert = () => invoke<void>("ui_stop_and_insert");
export const uiCancelRecording = () => invoke<void>("ui_cancel_recording");
export const setLanguage = (lang: string) =>
  invoke<void>("set_language", { lang });
/// Tell the backend the interface language so the native tray menu and error
/// toasts match the UI.
export const setUiLanguage = (lang: string) =>
  invoke<void>("set_ui_language", { lang });
export const setPillExpanded = (expanded: boolean) =>
  invoke<void>("set_pill_expanded", { expanded });
export const setLaunchAtLogin = (enabled: boolean) =>
  invoke<void>("set_launch_at_login", { enabled });
export const getLaunchAtLogin = () => invoke<boolean>("get_launch_at_login");
export const resetApp = () => invoke<void>("reset_app");

export interface Permissions {
  accessibility: boolean;
  microphone: boolean;
}
export const getPermissions = () => invoke<Permissions>("get_permissions");
export const promptAccessibility = () => invoke<void>("prompt_accessibility");
export const resetMicrophone = () => invoke<void>("reset_microphone");
export const openPrivacySettings = (which: "microphone" | "accessibility") =>
  invoke<void>("open_privacy_settings", { which });

export type StatePayload = { state: string };
export type LevelPayload = { level: number };
export type TranscriptPayload = { text: string };
export type DownloadProgressPayload = {
  id: string;
  received: number;
  total: number;
};

export interface MeetingSegment {
  speaker: "me" | "them";
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Meeting {
  id: string;
  title: string;
  started_ms: number;
  duration_ms: number;
  language: string;
  partial: boolean;
  segments: MeetingSegment[];
  summary?: string;
  has_audio?: boolean;
}

export interface MeetingSummary {
  id: string;
  title: string;
  started_ms: number;
  duration_ms: number;
  language: string;
  partial: boolean;
}

export const startMeeting = () => invoke<void>("start_meeting");
export const stopMeeting = () => invoke<void>("stop_meeting");
export const cancelMeeting = () => invoke<void>("cancel_meeting");
export const getMeetingState = () => invoke<string>("get_meeting_state");
export const listMeetings = () => invoke<MeetingSummary[]>("list_meetings");
export const getMeeting = (id: string) =>
  invoke<Meeting | null>("get_meeting", { id });
export const deleteMeeting = (id: string) =>
  invoke<void>("delete_meeting", { id });
export const renameMeeting = (id: string, title: string) =>
  invoke<void>("rename_meeting", { id, title });
// Opens a native save dialog and writes `contents`. Resolves to the saved path,
// or null if the user cancelled.
export const exportMeetingFile = (defaultName: string, contents: string) =>
  invoke<string | null>("export_meeting_file", { defaultName, contents });
// Absolute path to the meeting's recorded audio (feed to convertFileSrc), or
// null if there's no recording.
export const meetingAudioPath = (id: string) =>
  invoke<string | null>("meeting_audio_path", { id });
// Native save dialog to download the meeting's audio; resolves to the saved
// path or null if cancelled.
export const exportMeetingAudio = (id: string) =>
  invoke<string | null>("export_meeting_audio", { id });
export const meetingSupported = () => invoke<boolean>("meeting_supported");
export const checkSystemAudioPermission = () =>
  invoke<boolean>("check_system_audio_permission");
export const requestSystemAudioPermission = () =>
  invoke<void>("request_system_audio_permission");
export const openSystemAudioSettings = () =>
  invoke<void>("open_system_audio_settings");

export type MeetingStatePayload = { state: string };
export type MeetingSavedPayload = { id: string };
export type MeetingLiveSegmentPayload = {
  speaker: "me" | "them";
  start_ms: number;
  end_ms: number;
  text: string;
};

export const onEvent = <T>(
  name: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> => listen<T>(name, (e) => handler(e.payload));

export const generateSummary = (id: string) =>
  invoke<string>("generate_summary", { id });
export const llmModelDownloaded = () => invoke<boolean>("llm_model_downloaded");
export const downloadLlmModel = () => invoke<void>("download_llm_model");

export type LlmDownloadProgressPayload = { received: number; total: number };

export interface EntitlementsSnapshot {
  loggedIn: boolean;
  pro: boolean;
  remainingWords: number;
  remainingMeetings: number;
}

export const setEntitlements = (ent: EntitlementsSnapshot) =>
  invoke<void>("set_entitlements", { ent });
