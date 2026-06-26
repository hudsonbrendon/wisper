import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../lib/i18n";

vi.mock("../lib/usageContext", () => ({ useUsage: vi.fn() }));
vi.mock("../lib/authContext", () => ({ useAuth: vi.fn() }));

import { useUsage } from "../lib/usageContext";
import { useAuth } from "../lib/authContext";
import UsageBanner from "./UsageBanner";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("ui_lang", "en");
});

describe("UsageBanner", () => {
  it("renders nothing for a pro user", () => {
    vi.mocked(useAuth).mockReturnValue({ plan: "pro" } as never);
    vi.mocked(useUsage).mockReturnValue({ usage: { dictation_words: 1999, meetings: 2 } } as never);
    const { container } = render(<I18nProvider><UsageBanner /></I18nProvider>);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a free user below 80%", () => {
    vi.mocked(useAuth).mockReturnValue({ plan: "free" } as never);
    vi.mocked(useUsage).mockReturnValue({ usage: { dictation_words: 100, meetings: 0 } } as never);
    const { container } = render(<I18nProvider><UsageBanner /></I18nProvider>);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns when a free metric is at/over 80%", () => {
    vi.mocked(useAuth).mockReturnValue({ plan: "free" } as never);
    vi.mocked(useUsage).mockReturnValue({ usage: { dictation_words: 1800, meetings: 0 } } as never);
    render(<I18nProvider><UsageBanner /></I18nProvider>);
    expect(screen.getByText(/1[.,]?800\s*\/\s*2[.,]?000 words/i)).toBeInTheDocument();
  });
});
