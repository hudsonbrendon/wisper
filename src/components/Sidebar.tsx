import { useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import UpdateControl from "./UpdateControl";

export type View = "home" | "insights" | "meetings" | "dictionary" | "snippets" | "settings";

/// Inline SVGs keep the bundle dependency-free. Each takes the current text
/// color via `stroke="currentColor"`, so active/inactive styling is just text
/// color on the parent button.
const icons: Record<string, ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  insights: (
    <>
      <line x1="5" y1="20" x2="5" y2="12" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="19" y1="20" x2="19" y2="9" />
    </>
  ),
  meetings: (
    <>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </>
  ),
  dictionary: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
  snippets: (
    <>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
};

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-stone-600 transition-colors hover:bg-stone-200/40 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
      <span className="flex-1">
        {theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
      </span>
    </button>
  );
}

function Icon({ name }: { name: string }) {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

function NavButton({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors " +
        (active
          ? "bg-stone-200/70 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
          : "text-stone-600 hover:bg-stone-200/40 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100")
      }
    >
      <Icon name={icon} />
      <span className="flex-1">{label}</span>
      {badge}
    </button>
  );
}

export default function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="flex w-56 shrink-0 flex-col px-3 py-5">
      {/* Brand */}
      <div className="mb-6 flex items-center gap-2 px-2">
        <svg
          className="h-5 w-5 text-stone-900 dark:text-stone-100"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <line x1="4" y1="14" x2="4" y2="10" />
          <line x1="9" y1="19" x2="9" y2="5" />
          <line x1="14" y1="16" x2="14" y2="8" />
          <line x1="19" y1="14" x2="19" y2="10" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight text-stone-900">
          Wisper
        </span>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-1">
        <NavButton
          icon="home"
          label={t("nav.home")}
          active={view === "home"}
          onClick={() => onNavigate("home")}
        />
        <NavButton
          icon="insights"
          label={t("nav.insights")}
          active={view === "insights"}
          onClick={() => onNavigate("insights")}
        />
        <NavButton
          icon="meetings"
          label={t("nav.meetings")}
          active={view === "meetings"}
          onClick={() => onNavigate("meetings")}
        />
        <NavButton
          icon="dictionary"
          label={t("nav.dictionary")}
          active={view === "dictionary"}
          onClick={() => onNavigate("dictionary")}
        />
        <NavButton
          icon="snippets"
          label={t("nav.snippets")}
          active={view === "snippets"}
          onClick={() => onNavigate("snippets")}
        />
      </nav>

      {/* Bottom group */}
      <div className="mt-auto flex flex-col gap-1 border-t border-stone-200 pt-3 dark:border-stone-800">
        <NavButton
          icon="settings"
          label={t("nav.settings")}
          active={view === "settings"}
          onClick={() => onNavigate("settings")}
        />
        <a
          href="https://github.com/99labdev/wisper.chat"
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-stone-600 transition-colors hover:bg-stone-200/40 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
        >
          <Icon name="help" />
          <span className="flex-1">{t("nav.help")}</span>
        </a>
        <ThemeToggle />
        <UpdateControl />
      </div>
    </aside>
  );
}
