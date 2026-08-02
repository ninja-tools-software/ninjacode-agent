import { AppFooterSection } from "./chat/AppFooterSection.js";
import type { AppViewModel } from "./useAppViewModel.js";
import { buildAppFooterProps } from "./buildAppFooterProps.js";

export function AppShellFooter({ vm, onDismissDragTip }: { vm: AppViewModel; onDismissDragTip: () => void }) {
  return <AppFooterSection {...buildAppFooterProps(vm, onDismissDragTip)} />;
}
