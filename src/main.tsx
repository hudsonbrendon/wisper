import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, getTheme } from "./lib/theme";

// Apply the saved theme before first paint to avoid a flash.
applyTheme(getTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
