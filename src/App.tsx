import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import Dashboard from "./routes/Dashboard";
import Overlay from "./routes/Overlay";

export default function App() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWindow().label);
  }, []);

  if (label === null) return null;
  return label === "overlay" ? <Overlay /> : <Dashboard />;
}
