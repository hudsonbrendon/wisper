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
export const setPillExpanded = (expanded: boolean) =>
  invoke<void>("set_pill_expanded", { expanded });
export const setLaunchAtLogin = (enabled: boolean) =>
  invoke<void>("set_launch_at_login", { enabled });
export const getLaunchAtLogin = () => invoke<boolean>("get_launch_at_login");
export const resetApp = () => invoke<void>("reset_app");

export interface Permissions {
  accessibility: boolean;
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

export const onEvent = <T>(
  name: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> => listen<T>(name, (e) => handler(e.payload));
