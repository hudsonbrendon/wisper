import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import Settings from "./routes/Settings";
import Overlay from "./routes/Overlay";

export default function App() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWindow().label);
  }, []);

  if (label === null) return null;
  return label === "overlay" ? <Overlay /> : <Settings />;
}
