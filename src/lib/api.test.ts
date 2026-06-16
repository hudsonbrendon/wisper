import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getHistory,
  clearHistory,
  getConfig,
  saveConfig,
  listMicrophones,
  listModels,
  downloadModel,
  cancelDownload,
  removeModel,
  getState,
  uiStartRecording,
  uiStopAndInsert,
  uiCancelRecording,
  setLanguage,
  setPillExpanded,
  setLaunchAtLogin,
  getLaunchAtLogin,
  resetApp,
  onEvent,
  type Config,
} from "./api";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getHistory", () => {
  it("calls invoke with get_history", () => {
    mockInvoke.mockResolvedValueOnce([]);
    getHistory();
    expect(mockInvoke).toHaveBeenCalledWith("get_history");
  });
});

describe("clearHistory", () => {
  it("calls invoke with clear_history", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    clearHistory();
    expect(mockInvoke).toHaveBeenCalledWith("clear_history");
  });
});

describe("getConfig", () => {
  it("calls invoke with get_config", () => {
    mockInvoke.mockResolvedValueOnce({});
    getConfig();
    expect(mockInvoke).toHaveBeenCalledWith("get_config");
  });
});

describe("saveConfig", () => {
  it("calls invoke with save_config and newConfig arg", () => {
    const cfg: Config = {
      hotkey: "Alt+Space",
      model_id: "base",
      mic_device: null,
      language: "en",
      inject_method: "type",
      show_in_dock: true,
      show_pill: false,
      dictation_sounds: true,
      mute_music: false,
    };
    mockInvoke.mockResolvedValueOnce(undefined);
    saveConfig(cfg);
    expect(mockInvoke).toHaveBeenCalledWith("save_config", { newConfig: cfg });
  });
});

describe("listMicrophones", () => {
  it("calls invoke with list_microphones", () => {
    mockInvoke.mockResolvedValueOnce([]);
    listMicrophones();
    expect(mockInvoke).toHaveBeenCalledWith("list_microphones");
  });
});

describe("listModels", () => {
  it("calls invoke with list_models", () => {
    mockInvoke.mockResolvedValueOnce([]);
    listModels();
    expect(mockInvoke).toHaveBeenCalledWith("list_models");
  });
});

describe("downloadModel", () => {
  it("calls invoke with download_model and id arg", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    downloadModel("base");
    expect(mockInvoke).toHaveBeenCalledWith("download_model", { id: "base" });
  });
});

describe("cancelDownload", () => {
  it("calls invoke with cancel_download and id arg", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    cancelDownload("base");
    expect(mockInvoke).toHaveBeenCalledWith("cancel_download", { id: "base" });
  });
});

describe("removeModel", () => {
  it("calls invoke with remove_model and id arg", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    removeModel("base");
    expect(mockInvoke).toHaveBeenCalledWith("remove_model", { id: "base" });
  });
});

describe("getState", () => {
  it("calls invoke with get_state", () => {
    mockInvoke.mockResolvedValueOnce("idle");
    getState();
    expect(mockInvoke).toHaveBeenCalledWith("get_state");
  });
});

describe("uiStartRecording", () => {
  it("calls invoke with ui_start_recording", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    uiStartRecording();
    expect(mockInvoke).toHaveBeenCalledWith("ui_start_recording");
  });
});

describe("uiStopAndInsert", () => {
  it("calls invoke with ui_stop_and_insert", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    uiStopAndInsert();
    expect(mockInvoke).toHaveBeenCalledWith("ui_stop_and_insert");
  });
});

describe("uiCancelRecording", () => {
  it("calls invoke with ui_cancel_recording", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    uiCancelRecording();
    expect(mockInvoke).toHaveBeenCalledWith("ui_cancel_recording");
  });
});

describe("setLanguage", () => {
  it("calls invoke with set_language and lang arg", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    setLanguage("pt");
    expect(mockInvoke).toHaveBeenCalledWith("set_language", { lang: "pt" });
  });
});

describe("setPillExpanded", () => {
  it("calls invoke with set_pill_expanded and expanded=true", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    setPillExpanded(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_pill_expanded", {
      expanded: true,
    });
  });

  it("calls invoke with set_pill_expanded and expanded=false", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    setPillExpanded(false);
    expect(mockInvoke).toHaveBeenCalledWith("set_pill_expanded", {
      expanded: false,
    });
  });
});

describe("setLaunchAtLogin", () => {
  it("calls invoke with set_launch_at_login and enabled=true", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    setLaunchAtLogin(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_launch_at_login", {
      enabled: true,
    });
  });

  it("calls invoke with set_launch_at_login and enabled=false", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    setLaunchAtLogin(false);
    expect(mockInvoke).toHaveBeenCalledWith("set_launch_at_login", {
      enabled: false,
    });
  });
});

describe("getLaunchAtLogin", () => {
  it("calls invoke with get_launch_at_login", () => {
    mockInvoke.mockResolvedValueOnce(false);
    getLaunchAtLogin();
    expect(mockInvoke).toHaveBeenCalledWith("get_launch_at_login");
  });
});

describe("resetApp", () => {
  it("calls invoke with reset_app", () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    resetApp();
    expect(mockInvoke).toHaveBeenCalledWith("reset_app");
  });
});

describe("onEvent", () => {
  it("calls listen with the given event name", async () => {
    mockListen.mockResolvedValueOnce(() => {});
    await onEvent("state_changed", () => {});
    expect(mockListen).toHaveBeenCalledWith(
      "state_changed",
      expect.any(Function),
    );
  });

  it("unwraps payload and passes it to the handler", async () => {
    const handler = vi.fn();
    let capturedCb: ((e: { payload: string }) => void) | undefined;

    mockListen.mockImplementationOnce((_name, cb) => {
      capturedCb = cb as (e: { payload: string }) => void;
      return Promise.resolve(() => {});
    });

    await onEvent<string>("transcript", handler);

    capturedCb!({ payload: "hello world" });
    expect(handler).toHaveBeenCalledWith("hello world");
  });

  it("returns the unlisten function from listen", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValueOnce(unlisten);
    const result = await onEvent("foo", () => {});
    expect(result).toBe(unlisten);
  });
});
