import type {
  AgentLogEntryItem,
  CustomAgentItem,
  McpServerStatusItem,
  RuleItem,
  SettingsState,
  SkillItem,
  VsCodeApi,
} from "../types.js";
import { AgentsCard, McpServersCard, RulesCard, SkillsCard } from "./assets/index.js";
import { SettingsSection } from "./SettingsSection.js";
import { AccountSection } from "./sections/AccountSection.js";
import { AgentSection } from "./sections/AgentSection.js";
import { ChatSection } from "./sections/ChatSection.js";
import { LogsSection } from "./sections/LogsSection.js";
import { ModelSection } from "./sections/ModelSection.js";
import { ProvidersSection } from "./sections/ProvidersSection.js";
import { t } from "../i18n.js";

export function SettingsMain({
  settings,
  setSettings,
  mcpServers,
  mcpConfigFile,
  skills,
  customAgents,
  rules,
  agentLogEntries,
  vscode,
  mainRef,
}: {
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>;
  mcpServers: McpServerStatusItem[];
  mcpConfigFile: string | null;
  skills: SkillItem[];
  customAgents: CustomAgentItem[];
  rules: RuleItem[];
  agentLogEntries: AgentLogEntryItem[];
  vscode: VsCodeApi;
  mainRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <main className="settings-main" ref={mainRef}>
      <AccountSection settings={settings} vscode={vscode} />
      <ProvidersSection settings={settings} setSettings={setSettings} vscode={vscode} />
      <ModelSection settings={settings} vscode={vscode} />
      <AgentSection settings={settings} vscode={vscode} />
      <ChatSection settings={settings} vscode={vscode} />
      <SettingsSection id="mcp" title={t("MCP servers")} description={t("Extra tools from Model Context Protocol servers, connected per workspace.")}>
        <McpServersCard servers={mcpServers} configFile={mcpConfigFile} vscode={vscode} />
      </SettingsSection>
      <SettingsSection id="skills" title={t("Skills")} description={t("Reusable playbooks the agent loads on demand, discovered from the workspace.")}>
        <SkillsCard skills={skills} vscode={vscode} />
      </SettingsSection>
      <SettingsSection id="rules" title={t("Rules & instructions")} description={t("Standing instructions injected into the system prompt of every run.")}>
        <RulesCard rules={rules} vscode={vscode} />
      </SettingsSection>
      <SettingsSection id="agents" title={t("Custom agents")} description={t("Named personas the main agent can hand a task off to.")}>
        <AgentsCard agents={customAgents} models={settings.models} vscode={vscode} />
      </SettingsSection>
      <LogsSection entries={agentLogEntries} vscode={vscode} />
    </main>
  );
}
