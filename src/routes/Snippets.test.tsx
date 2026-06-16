import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../lib/i18n";
import Snippets from "./Snippets";

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
  dictionary: [],
  replacements: [{ from: "my email", to: "me@x.com" }],
};

function renderSnippets() {
  return render(
    <I18nProvider>
      <Snippets />
    </I18nProvider>,
  );
}

describe("Snippets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({ ...CONFIG });
    mockSaveConfig.mockResolvedValue(undefined);
  });

  it("lists existing replacements", async () => {
    renderSnippets();
    expect(await screen.findByText("my email")).toBeInTheDocument();
    expect(screen.getByText("me@x.com")).toBeInTheDocument();
  });

  it("adds a replacement and saves", async () => {
    renderSnippets();
    await screen.findByText("my email");
    await userEvent.type(screen.getByPlaceholderText(/when i say/i), "brb");
    await userEvent.type(
      screen.getByPlaceholderText(/insert/i),
      "be right back",
    );
    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        replacements: [
          { from: "my email", to: "me@x.com" },
          { from: "brb", to: "be right back" },
        ],
      }),
    );
  });

  it("shows the empty state with no replacements", async () => {
    mockGetConfig.mockResolvedValue({ ...CONFIG, replacements: [] });
    renderSnippets();
    expect(await screen.findByText(/no snippets yet/i)).toBeInTheDocument();
  });
});
