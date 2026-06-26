import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import Dashboard from "./routes/Dashboard";
import MeetingBubble from "./routes/MeetingBubble";
import Overlay from "./routes/Overlay";
import { I18nProvider } from "./lib/i18n";
import { AuthProvider } from "./lib/authContext";
import { UsageProvider } from "./lib/usageContext";

export default function App() {
  const [label] = useState(() => getCurrentWindow().label);

  return (
    <I18nProvider>
      {label === "overlay" ? (
        <Overlay />
      ) : label === "meeting-bubble" ? (
        <MeetingBubble />
      ) : (
        <AuthProvider>
          <UsageProvider>
            <Dashboard />
          </UsageProvider>
        </AuthProvider>
      )}
    </I18nProvider>
  );
}
