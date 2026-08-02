import { useState } from "react";
import type { ModelInfo, SettingsState, VsCodeApi } from "../types.js";
import { ModelMenu } from "./ModelMenu.js";
import { ModelSettingsMenu } from "./ModelSettingsMenu.js";

/** Model picker + effort/context settings; only one popover open at a time. */
export function ModelControls({
  settings,
  modelInfo,
  vscode,
  setSettings,
}: {
  settings: SettingsState;
  modelInfo?: ModelInfo;
  vscode: VsCodeApi;
  setSettings: (s: SettingsState) => void;
}) {
  const [openMenu, setOpenMenu] = useState<"model" | "settings" | null>(null);

  return (
    <>
      <ModelMenu
        settings={settings}
        modelInfo={modelInfo}
        vscode={vscode}
        setSettings={setSettings}
        open={openMenu === "model"}
        onOpenChange={(open) => setOpenMenu(open ? "model" : null)}
      />
      <ModelSettingsMenu
        settings={settings}
        modelInfo={modelInfo}
        vscode={vscode}
        setSettings={setSettings}
        open={openMenu === "settings"}
        onOpenChange={(open) => setOpenMenu(open ? "settings" : null)}
      />
    </>
  );
}
