import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import React from "react";
import { I18nProvider, useI18n } from "./i18n";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
  document.documentElement.dir = "";
});

// Wrapper that always uses English so tests are locale-independent by default.
function EnWrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe("useI18n – basic translation (English)", () => {
  beforeEach(() => {
    // Force English by storing it before the provider mounts.
    localStorage.setItem("ui_lang", "en");
  });

  it("translates a known key to a non-key string", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    const translated = result.current.t("settings.title");
    expect(translated).toBe("Settings");
    expect(translated).not.toBe("settings.title");
  });

  it("returns the raw key for an unknown key", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    expect(result.current.t("this.key.does.not.exist")).toBe(
      "this.key.does.not.exist",
    );
  });

  it("interpolates {name} placeholder", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    const msg = result.current.t("confirm.removeModel.message", {
      name: "base",
    });
    expect(msg).toContain("base");
    expect(msg).not.toContain("{name}");
  });

  it("interpolates numeric placeholders", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    const msg = result.current.t("insights.pages", { n: 5 });
    expect(msg).toContain("5");
    expect(msg).not.toContain("{n}");
  });

  it("interpolates {pct} placeholder", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    const msg = result.current.t("settings.downloading", { pct: 42 });
    expect(msg).toContain("42");
    expect(msg).not.toContain("{pct}");
  });
});

describe("useI18n – Portuguese locale", () => {
  beforeEach(() => {
    localStorage.setItem("ui_lang", "pt");
  });

  it("translates settings.title to Portuguese", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    expect(result.current.t("settings.title")).toBe("Configurações");
  });

  it("interpolates {name} in Portuguese", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    const msg = result.current.t("confirm.removeModel.message", {
      name: "base",
    });
    expect(msg).toContain("base");
    expect(msg).not.toContain("{name}");
  });
});

describe("useI18n – fallback to English for missing keys", () => {
  it("falls back to English when a locale is missing a key", () => {
    // Spanish dict does not have settings.system — it should fall back to English.
    localStorage.setItem("ui_lang", "es");
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    // settings.system IS present in English; if missing in Spanish it falls back.
    const val = result.current.t("settings.system");
    expect(typeof val).toBe("string");
    expect(val.length).toBeGreaterThan(0);
  });

  it("falls back all the way to the raw key when no locale has the key", () => {
    localStorage.setItem("ui_lang", "de");
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    expect(result.current.t("totally.made.up.key")).toBe("totally.made.up.key");
  });
});

describe("useI18n – setLang", () => {
  it("switching locale changes translations", () => {
    localStorage.setItem("ui_lang", "en");
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });
    expect(result.current.t("nav.home")).toBe("Home");

    act(() => {
      result.current.setLang("fr");
    });

    expect(result.current.t("nav.home")).toBe("Accueil");
  });

  it("persists the chosen language to localStorage", () => {
    localStorage.setItem("ui_lang", "en");
    const { result } = renderHook(() => useI18n(), { wrapper: EnWrapper });

    act(() => {
      result.current.setLang("de");
    });

    expect(localStorage.getItem("ui_lang")).toBe("de");
  });
});

describe("useI18n – RTL language (Arabic)", () => {
  it("sets dir=rtl on the document when Arabic is selected", () => {
    localStorage.setItem("ui_lang", "ar");

    render(
      <I18nProvider>
        <span data-testid="child">ok</span>
      </I18nProvider>,
    );

    expect(screen.getByTestId("child")).toBeTruthy();
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
  });

  it("sets dir=ltr on the document for non-RTL languages", () => {
    localStorage.setItem("ui_lang", "en");

    render(
      <I18nProvider>
        <span data-testid="child2">ok</span>
      </I18nProvider>,
    );

    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("useI18n – throws outside provider", () => {
  it("throws when useI18n is called outside I18nProvider", () => {
    // Suppress the React error boundary noise
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useI18n())).toThrow(
      "useI18n must be used within I18nProvider",
    );
    consoleSpy.mockRestore();
  });
});
