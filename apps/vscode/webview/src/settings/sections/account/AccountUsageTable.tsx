import { t } from "../../../i18n.js";
import type { SettingsState } from "../../../types.js";

export function AccountUsageTable({ settings }: { settings: SettingsState }) {
  return (
    <div className="card">
      <div className="card__label">{t("Recent usage")}</div>
      {settings.usage.length === 0 ? (
        <p className="muted">{t("No requests through the gateway yet.")}</p>
      ) : (
        <table className="usage-table">
          <thead>
            <tr>
              <th>{t("Model")}</th>
              <th>{t("Tokens")}</th>
              <th>{t("Credits")}</th>
            </tr>
          </thead>
          <tbody>
            {settings.usage.slice(0, 12).map((u, i) => (
              <tr key={i}>
                <td>
                  <code>{u.model ?? "?"}</code>
                </td>
                <td className="muted">
                  {(u.inputTokens ?? 0).toLocaleString()}/{(u.outputTokens ?? 0).toLocaleString()}
                </td>
                <td>{(u.credits ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
