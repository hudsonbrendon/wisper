import { useEffect, useState } from "react";
import Sidebar, { type View } from "../components/Sidebar";
import Home from "./Home";
import Insights from "./Insights";
import Settings from "./Settings";
import UpdateBanner from "../components/UpdateBanner";
import { onEvent } from "../lib/api";

/// The main window shell: a fixed sidebar plus a rounded content surface, in
/// the light "Flow"-style theme. View switching is local state — the app has
/// only three top-level screens, so a router would be overkill.
export default function Dashboard() {
  const [view, setView] = useState<View>("home");

  // The tray "Home" item shows the window and navigates here.
  useEffect(() => {
    const un = onEvent<string>("tray_navigate", (v) => setView(v as View));
    return () => {
      un.then((f) => f());
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
    </div>
  );
}
