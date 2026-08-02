import { PlusIcon, SettingsIcon } from "../icons.js";
import { t } from "../i18n.js";
import { SessionMenu } from "./menus/SessionMenu.js";
import { HistoryHeaderPopover } from "./HistoryHeaderPopover.js";
import { PlansHeaderPopover } from "./PlansHeaderPopover.js";
import type { AppHeaderProps } from "./AppHeader.types.js";

type HeaderActionsProps = Pick<
  AppHeaderProps,
  | "activeSession"
  | "historyOpen"
  | "historyClosing"
  | "historyMounted"
  | "historySessions"
  | "historyQuery"
  | "plansOpen"
  | "plansClosing"
  | "plansMounted"
  | "plansItems"
  | "plansQuery"
  | "activePlanId"
  | "plansLoading"
  | "activeSessionId"
  | "sessionsLoading"
  | "onToggleHistory"
  | "onHistoryClose"
  | "onHistoryQuery"
  | "onHistoryOpen"
  | "onHistoryDelete"
  | "onTogglePlans"
  | "onPlansClose"
  | "onPlansQuery"
  | "onPlanOpen"
  | "onPlanActivate"
  | "onPlanDelete"
  | "onNewSession"
  | "onOpenSettings"
  | "vscode"
> & { onRename: () => void };

export function AppHeaderActions(props: HeaderActionsProps) {
  return (
    <div className="header-actions">
      <button
        type="button"
        className="icon-btn"
        data-tooltip={t("New chat")}
        aria-label={t("New chat")}
        onClick={props.onNewSession}
      >
        <PlusIcon size={20} />
      </button>
      <PlansHeaderPopover
        plansOpen={props.plansOpen}
        plansClosing={props.plansClosing}
        plansMounted={props.plansMounted}
        plansItems={props.plansItems}
        plansQuery={props.plansQuery}
        activePlanId={props.activePlanId}
        plansLoading={props.plansLoading}
        onToggle={props.onTogglePlans}
        onClose={props.onPlansClose}
        onQuery={props.onPlansQuery}
        onOpen={props.onPlanOpen}
        onActivate={props.onPlanActivate}
        onDelete={props.onPlanDelete}
        vscode={props.vscode}
      />
      <HistoryHeaderPopover
        historyOpen={props.historyOpen}
        historyClosing={props.historyClosing}
        historyMounted={props.historyMounted}
        historySessions={props.historySessions}
        historyQuery={props.historyQuery}
        activeSessionId={props.activeSessionId}
        sessionsLoading={props.sessionsLoading}
        onToggle={props.onToggleHistory}
        onClose={props.onHistoryClose}
        onQuery={props.onHistoryQuery}
        onOpen={props.onHistoryOpen}
        onDelete={props.onHistoryDelete}
        vscode={props.vscode}
      />
      <SessionMenu
        session={props.activeSession}
        sessionId={props.activeSessionId}
        onRename={props.onRename}
        vscode={props.vscode}
      />
      <button
        type="button"
        className="icon-btn"
        data-tooltip={t("Settings")}
        aria-label={t("Settings")}
        onClick={props.onOpenSettings}
      >
        <SettingsIcon size={20} />
      </button>
    </div>
  );
}
