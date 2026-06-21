import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import Dashboard from "./routes/Dashboard";
import MeetingBubble from "./routes/MeetingBubble";
import Overlay from "./routes/Overlay";
import { I18nProvider } from "./lib/i18n";

export default function App() {
  // The window label is available synchronously in the webview, so read it once
  // at init instead of in an effect.
  const [label] = useState(() => getCurrentWindow().label);

  return (
    <I18nProvider>
      {label === "overlay" ? (
        <Overlay />
      ) : label === "meeting-bubble" ? (
        <MeetingBubble />
      ) : (
        <Dashboard />
      )}
    </I18nProvider>
  );
}
