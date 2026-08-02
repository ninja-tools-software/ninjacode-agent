import { useEffect, useRef, useState } from "react";
import type {
  AgentLogEntryItem,
  CustomAgentItem,
  McpServerStatusItem,
  RuleItem,
  SettingsState,
  SkillItem,
  VsCodeApi,
} from "../types.js";
import { SECTIONS, type SectionId } from "./constants.js";
import { SettingsMain } from "./SettingsMain.js";
import { SettingsNav } from "./SettingsNav.js";
import { SettingsTopbar } from "./SettingsTopbar.js";

function useSettingsSectionObserver(settingsReady: boolean) {
  const [active, setActive] = useState<SectionId>("account");
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id as SectionId);
      },
      { root, rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = root.querySelector(`#${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [settingsReady]);

  const goTo = (id: SectionId) => {
    setActive(id);
    mainRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return { active, mainRef, goTo };
}

export function SettingsPage({
  settings,
  setSettings,
  mcpServers,
  mcpConfigFile,
  skills,
  customAgents,
  rules,
  agentLogEntries,
  vscode,
}: {
  settings: SettingsState | null;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>;
  mcpServers: McpServerStatusItem[];
  mcpConfigFile: string | null;
  skills: SkillItem[];
  customAgents: CustomAgentItem[];
  rules: RuleItem[];
  agentLogEntries: AgentLogEntryItem[];
  vscode: VsCodeApi;
}) {
  const { active, mainRef, goTo } = useSettingsSectionObserver(settings !== null);

  if (!settings) {
    return (
      <div className="settings-page">
        <div className="settings-loading">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <SettingsTopbar settings={settings} vscode={vscode} />
      <div className="settings-shell">
        <SettingsNav active={active} onSelect={goTo} />
        <SettingsMain
          settings={settings}
          setSettings={setSettings}
          mcpServers={mcpServers}
          mcpConfigFile={mcpConfigFile}
          skills={skills}
          customAgents={customAgents}
          rules={rules}
          agentLogEntries={agentLogEntries}
          vscode={vscode}
          mainRef={mainRef}
        />
      </div>
    </div>
  );
}
