import { useCallback, useState } from "react";
import { GlobalTooltip } from "../GlobalTooltip.js";
import { useLocaleSync } from "../hooks/useLocaleSync.js";
import type {
  AgentLogEntryItem,
  CustomAgentItem,
  McpServerStatusItem,
  RuleItem,
  SettingsState,
  SkillItem,
  VsCodeApi,
} from "../types.js";
import { useSettingsMessages } from "./hooks/useSettingsMessages.js";
import { SettingsPage } from "./SettingsPage.js";

/**
 * Full-width Settings surface, rendered in its own editor tab. Everything writes
 * back to the same `ninjacode.*` configuration keys the native settings editor
 * exposes, so the two views stay in sync.
 */
export function SettingsApp({ vscode }: { vscode: VsCodeApi }) {
  const { locale, applyLocale } = useLocaleSync(document.body.dataset.locale ?? "en");
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerStatusItem[]>([]);
  const [mcpConfigFile, setMcpConfigFile] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [customAgents, setCustomAgents] = useState<CustomAgentItem[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [agentLogEntries, setAgentLogEntries] = useState<AgentLogEntryItem[]>([]);

  const onAgentLogEntry = useCallback((entry: AgentLogEntryItem) => {
    setAgentLogEntries((prev) => [...prev, entry].slice(-500));
  }, []);

  const onSettings = useCallback(
    (next: SettingsState) => {
      setSettings(next);
      if (next.locale) applyLocale(next.locale);
    },
    [applyLocale],
  );

  useSettingsMessages(vscode, {
    onSettings,
    onLocale: applyLocale,
    onMcpStatus: (servers, configFile) => {
      setMcpServers(servers);
      setMcpConfigFile(configFile);
    },
    onSkills: setSkills,
    onCustomAgents: setCustomAgents,
    onRules: setRules,
    onAgentLogs: setAgentLogEntries,
    onAgentLogEntry,
  });

  return (
    <>
      <GlobalTooltip />
      <SettingsPage
        key={locale}
        settings={settings}
        setSettings={setSettings}
        mcpServers={mcpServers}
        mcpConfigFile={mcpConfigFile}
        skills={skills}
        customAgents={customAgents}
        rules={rules}
        agentLogEntries={agentLogEntries}
        vscode={vscode}
      />
    </>
  );
}
