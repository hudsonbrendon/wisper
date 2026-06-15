import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import Dashboard from "./routes/Dashboard";
import Overlay from "./routes/Overlay";
import { I18nProvider } from "./lib/i18n";

export default function App() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWindow().label);
  }, []);

  if (label === null) return null;
  return (
    <I18nProvider>{label === "overlay" ? <Overlay /> : <Dashboard />}</I18nProvider>
  );
}
