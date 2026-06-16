/// Light/dark theme, stored locally and applied via the `dark` class on <html>
/// (Tailwind's class strategy). No account, no sync — just a local preference.

export type Theme = "light" | "dark";

const KEY = "theme";

/// The active theme: a stored choice, else the OS preference, else light.
export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/// Toggle the `dark` class on the document root.
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/// Persist and apply a theme.
export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
