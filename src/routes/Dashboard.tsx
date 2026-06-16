import { useEffect, useState } from "react";
import Sidebar, { type View } from "../components/Sidebar";
import Home from "./Home";
import Insights from "./Insights";
import Settings from "./Settings";
import Onboarding from "./Onboarding";
import UpdateBanner from "../components/UpdateBanner";
import { onEvent, getConfig } from "../lib/api";

/// The main window shell: a fixed sidebar plus a rounded content surface, in
/// the light "Flow"-style theme. View switching is local state — the app has
/// only three top-level screens, so a router would be overkill.
export default function Dashboard() {
  const [view, setView] = useState<View>("home");
  // null while loading; true/false once config is read. The onboarding wizard
  // shows over the dashboard until completed (or replayed from Settings).
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    getConfig().then((c) => setOnboarded(c.onboarded));
    // The tray "Home" item shows the window and navigates here.
    const un = onEvent<string>("tray_navigate", (v) => setView(v as View));
    // Settings' "Replay tutorial" re-opens the wizard (same window).
    const replay = () => setOnboarded(false);
    window.addEventListener("replay-tutorial", replay);
    return () => {
      un.then((f) => f());
      window.removeEventListener("replay-tutorial", replay);
    };
  }, []);

  return (
    <div className="flex h-full bg-stone-100 text-stone-900">
      <Sidebar view={view} onNavigate={setView} />
      <main className="min-w-0 flex-1 py-3 pr-3">
        <div className="h-full overflow-y-auto rounded-2xl border border-stone-200 bg-stone-50 px-8 py-7">
          <div className="mb-4 empty:mb-0">
            <UpdateBanner />
          </div>
          {view === "home" && <Home />}
          {view === "insights" && <Insights />}
          {view === "settings" && <Settings />}
        </div>
      </main>
      {onboarded === false && <Onboarding onDone={() => setOnboarded(true)} />}
    </div>
  );
}
