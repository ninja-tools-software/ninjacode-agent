import type { AppViewModel } from "./useAppViewModel.js";
import { AppLogSection } from "./chat/AppLogSection.js";
import { AppHeader } from "./chat/AppHeader.js";
import { SessionStatsBar } from "./chat/panels/SessionStatsBar.js";
import { GlobalTooltip } from "./GlobalTooltip.js";
import { AppShellFooter } from "./AppShellFooter.js";
import { Onboarding } from "./chat/onboarding/Onboarding.js";
import { useAppHeaderCallbacks } from "./useAppHeaderCallbacks.js";

function AppChatBody({ vm, onDismissDragTip }: { vm: AppViewModel; onDismissDragTip: () => void }) {
  return (
    <>
      {vm.state.sessionUsage && (
        <SessionStatsBar
          usage={vm.state.sessionUsage}
          expanded={vm.statsExpanded}
          onToggle={vm.setStatsExpanded}
        />
      )}
      {vm.shell.busy && (
        <div className={`run-progress run-${vm.state.runState}`} aria-hidden="true" />
      )}
      <div className="app-body">
        <div className="app-main">
          <AppLogSection
            logRef={vm.logRef}
            contentRef={vm.contentRef}
            stuck={vm.stuck}
            hasNewContent={vm.hasNewContent}
            onScrollToBottom={() => {
              vm.stickToBottom();
              vm.scrollToBottom("smooth");
            }}
            runState={vm.state.runState}
            runPillMounted={vm.presence.runPillPresence.mounted}
            runPillClosing={vm.presence.runPillPresence.closing}
            onStop={vm.shell.stopAgent}
            log={vm.state.log}
            composer={vm.composer}
            hypotheses={vm.state.hypotheses}
            debugLogCount={vm.state.debugLogCount}
            hypothesesMounted={vm.presence.hypothesesPresence.mounted}
            hypothesesClosing={vm.presence.hypothesesPresence.closing}
            busy={vm.shell.busy}
            agentActive={vm.agentActive}
            activeSessionId={vm.state.activeSessionId}
            plan={vm.state.plan}
            todos={vm.state.todos}
            settings={vm.shell.settings}
            vscode={vm.vscode}
          />
          <AppShellFooter vm={vm} onDismissDragTip={onDismissDragTip} />
        </div>
      </div>
    </>
  );
}

export function AppShell({ vm }: { vm: AppViewModel }) {
  const header = useAppHeaderCallbacks(vm);

  return (
    <div className="app screen-enter">
      <GlobalTooltip />
      <AppHeader {...header.props} />
      {vm.onboarding.visible ? (
        <div className="app-body">
          <Onboarding vscode={vm.vscode} onSkip={vm.onboarding.skip} />
        </div>
      ) : (
        <AppChatBody vm={vm} onDismissDragTip={header.dismissDragTip} />
      )}
    </div>
  );
}
