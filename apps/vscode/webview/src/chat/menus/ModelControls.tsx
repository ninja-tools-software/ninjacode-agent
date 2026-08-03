import { useEffect, useState } from "react";
import type { ModelInfo, SettingsState, VsCodeApi } from "../types.js";
import { ModelMenu } from "./ModelMenu.js";
import { ModelSettingsMenu } from "./ModelSettingsMenu.js";

/** Model picker + effort/context settings; only one popover open at a time. */
export function ModelControls({
  settings,
  modelInfo,
  vscode,
  setSettings,
  openModelMenuNonce = 0,
}: {
  settings: SettingsState;
  modelInfo?: ModelInfo;
  vscode: VsCodeApi;
  setSettings: (s: SettingsState) => void;
  /** Incremented by the host when a gateway error CTA asks to pick another model. */
  openModelMenuNonce?: number;
}) {
  const [openMenu, setOpenMenu] = useState<"model" | "settings" | null>(null);

  useEffect(() => {
    if (openModelMenuNonce > 0) setOpenMenu("model");
  }, [openModelMenuNonce]);

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
