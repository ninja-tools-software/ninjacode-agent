import { AppShell } from "./AppShell.js";
import { useAppViewModel } from "./useAppViewModel.js";
import type { VsCodeApi } from "./chat/types.js";

export function App({ vscode }: { vscode: VsCodeApi }) {
  const vm = useAppViewModel(vscode);
  return <AppShell key={vm.locale} vm={vm} />;
}
