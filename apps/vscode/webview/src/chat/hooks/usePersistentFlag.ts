/**
 * A boolean the webview remembers across reloads. Stored under its own key and
 * merged into the existing webview state, so it never clobbers the composer
 * drafts kept in the same object.
 */
import { useCallback, useState } from "react";
import type { VsCodeApi } from "../types.js";

export function usePersistentFlag(
  vscode: VsCodeApi,
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const state = vscode.getState?.();
    if (!state || typeof state !== "object") return fallback;
    const stored = (state as Record<string, unknown>)[key];
    return typeof stored === "boolean" ? stored : fallback;
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      const state = vscode.getState?.();
      const base = state && typeof state === "object" ? state : {};
      vscode.setState?.({ ...base, [key]: next });
    },
    [key, vscode],
  );

  return [value, update];
}
