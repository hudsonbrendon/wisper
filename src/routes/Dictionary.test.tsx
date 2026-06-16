import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../lib/i18n";
import Dictionary from "./Dictionary";

const { mockGetConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

const CONFIG = {
  hotkey: "Alt+Space",
  model_id: "base",
  mic_device: null,
  language: "auto",
  inject_method: "type" as const,
  show_in_dock: true,
  show_pill: true,
  dictation_sounds: true,
  mute_music: false,
  onboarded: true,
  dictionary: ["OpenWispr"],
  replacements: [],
};

function renderDict() {
  return render(
    <I18nProvider>
      <Dictionary />
    </I18nProvider>,
  );
}

describe("Dictionary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({ ...CONFIG });
    mockSaveConfig.mockResolvedValue(undefined);
  });

  it("lists existing words", async () => {
    renderDict();
    expect(await screen.findByText("OpenWispr")).toBeInTheDocument();
  });

  it("adds a word via the Add button and saves", async () => {
    renderDict();
    await screen.findByText("OpenWispr");
    await userEvent.type(screen.getByPlaceholderText(/add a word/i), "Tauri");
    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dictionary: ["OpenWispr", "Tauri"] }),
    );
  });

  it("removes a word and saves", async () => {
    renderDict();
    const chip = await screen.findByText("OpenWispr");
    const removeBtn = chip.parentElement!.querySelector("button")!;
    await userEvent.click(removeBtn);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dictionary: [] }),
    );
  });

  it("shows the empty state with no words", async () => {
    mockGetConfig.mockResolvedValue({ ...CONFIG, dictionary: [] });
    renderDict();
    expect(await screen.findByText(/no words yet/i)).toBeInTheDocument();
  });
});
