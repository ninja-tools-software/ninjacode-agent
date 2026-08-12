import { useCallback } from "react";
import { needsGatewayOnboarding } from "../onboarding/onboardingVisibility.js";
import type { ChatAction } from "../state/chatReducer.js";
import type { SettingsState, VsCodeApi } from "../types.js";

/**
 * Whether the welcome screen owns the chat body, and how to leave it. Skipping is
 * mirrored to the host so it stays skipped across reloads.
 */
export function useOnboardingGate(input: {
  vscode: VsCodeApi;
  dispatch: (action: ChatAction) => void;
  dismissed: boolean;
  settings: SettingsState | null;
}) {
  const { vscode, dispatch } = input;
  const skip = useCallback(() => {
    dispatch({ kind: "dismiss_onboarding" });
    vscode.postMessage({ type: "dismiss_onboarding" });
  }, [dispatch, vscode]);

  return { visible: !input.dismissed && needsGatewayOnboarding(input.settings), skip };
}
