import { t } from "../../i18n.js";
import type { AgentLogEntryItem, VsCodeApi } from "../../types.js";
import { SettingsSection } from "../SettingsSection.js";

export function LogsSection({
  entries,
  vscode,
}: {
  entries: AgentLogEntryItem[];
  vscode: VsCodeApi;
}) {
  return (
    <SettingsSection
      id="logs"
      title={t("Agent logs")}
      description={t(
        "Redacted internals (LLM calls, tool calls, cache, cancellations) — never includes API keys.",
      )}
    >
      <div className="card">
        <div className="card__label">
          {t("Recent entries")}
          <button
            className="btn subtle"
            data-tooltip={t("Reload agent log entries")}
            onClick={() => vscode.postMessage({ type: "get_agent_logs" })}
          >
            {t("Reload")}
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="muted">{t("No log entries yet.")}</p>
        ) : (
          <ul className="agent-log-list">
            {entries
              .slice(-100)
              .reverse()
              .map((e, i) => (
                <li key={i} className={`agent-log-entry type-${e.type}`}>
                  <details>
                    <summary>
                      <span className="badge">{e.type}</span>
                      <span className="agent-log-summary">{e.summary}</span>
                    </summary>
                    {e.detail && <pre>{e.detail}</pre>}
                  </details>
                </li>
              ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}
