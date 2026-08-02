/**
 * Host message listener for the Settings editor tab.
 * Same ref-stable pattern as chat's useHostMessages — one subscription, handlers via ref.
 */
import { useEffect, useRef } from "react";
import type {
  AgentLogEntryItem,
  CustomAgentItem,
  McpServerStatusItem,
  RuleItem,
  SettingsState,
  SkillItem,
  VsCodeApi,
} from "../../types.js";

interface SettingsHostHandlers {
  onSettings: (settings: SettingsState) => void;
  onLocale?: (locale: string) => void;
  onMcpStatus: (servers: McpServerStatusItem[], configFile: string | null) => void;
  onSkills: (items: SkillItem[]) => void;
  onCustomAgents: (items: CustomAgentItem[]) => void;
  onRules: (items: RuleItem[]) => void;
  onAgentLogs: (entries: AgentLogEntryItem[]) => void;
  onAgentLogEntry: (entry: AgentLogEntryItem) => void;
}

export function useSettingsMessages(vscode: VsCodeApi, handlers: SettingsHostHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const msg = event.data as Record<string, unknown> & { type?: string };
      const h = handlersRef.current;

      switch (msg.type) {
        case "settings":
          h.onSettings(msg as unknown as SettingsState);
          break;
        case "set_locale":
          if (typeof msg.locale === "string") h.onLocale?.(msg.locale);
          break;
        case "mcp_status":
          h.onMcpStatus(
            Array.isArray(msg.servers) ? (msg.servers as McpServerStatusItem[]) : [],
            typeof msg.configFile === "string" ? msg.configFile : null,
          );
          break;
        case "skills":
          h.onSkills(Array.isArray(msg.items) ? (msg.items as SkillItem[]) : []);
          break;
        case "custom_agents":
          h.onCustomAgents(Array.isArray(msg.items) ? (msg.items as CustomAgentItem[]) : []);
          break;
        case "rules":
          h.onRules(Array.isArray(msg.items) ? (msg.items as RuleItem[]) : []);
          break;
        case "agent_logs":
          h.onAgentLogs(Array.isArray(msg.entries) ? (msg.entries as AgentLogEntryItem[]) : []);
          break;
        case "agent_log_entry":
          if (msg.entry) h.onAgentLogEntry(msg.entry as AgentLogEntryItem);
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, [vscode]);
}
