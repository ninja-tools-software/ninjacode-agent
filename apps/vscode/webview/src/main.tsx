import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initL10n } from "./i18n.js";
import { MermaidApp } from "./MermaidApp.js";
import { PlanApp } from "./PlanApp.js";
import { SettingsApp } from "./settings/SettingsApp.js";
import "./styles.css";

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (msg: unknown) => void;
      getState: () => unknown;
      setState: (s: unknown) => void;
    };
  }
}

initL10n(document.body.dataset.locale ?? "en");

const vscode = window.acquireVsCodeApi();
// One bundle serves chat, settings and plan surfaces; the host tags the document with the view to mount.
const view = document.body.dataset.view;
const isSettings = view === "settings";
const isPlan = view === "plan";
const isMermaid = view === "mermaid";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSettings ? (
      <SettingsApp vscode={vscode} />
    ) : isPlan ? (
      <PlanApp vscode={vscode} />
    ) : isMermaid ? (
      <MermaidApp vscode={vscode} />
    ) : (
      <App vscode={vscode} />
    )}
  </React.StrictMode>,
);
