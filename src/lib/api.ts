import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type InjectMethod = "type" | "paste";

export interface Config {
  hotkey: string;
  model_id: string;
  mic_device: string | null;
  language: string;
  inject_method: InjectMethod;
}

export interface ModelMeta {
  id: string;
  filename: string;
  downloaded: boolean;
}

export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (newConfig: Config) =>
  invoke<void>("save_config", { newConfig });
export const listMicrophones = () => invoke<string[]>("list_microphones");
export const listModels = () => invoke<ModelMeta[]>("list_models");
export const downloadModel = (id: string) =>
  invoke<void>("download_model", { id });
export const getState = () => invoke<string>("get_state");

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
