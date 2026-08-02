import { t } from "../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../types.js";
import { SettingsSection } from "../SettingsSection.js";

export function ChatSection({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  const oppositeSide = settings.primarySidebarSide === "left" ? "right" : "left";
  const locationLabel =
    settings.chatLocation === "primary" ? t("Primary Side Bar") : t("Secondary Side Bar");
  const sideLabel = (side: "left" | "right") => t(side);

  return (
    <SettingsSection
      id="chat"
      title={t("Chat panel")}
      description={t("Which VS Code side bar hosts the conversation.")}
    >
      <div className="card">
        <div className="card__label">{t("Side bar")}</div>
        <div className="segmented">
          {(
            [
              { id: "primary" as const, label: t("Primary Side Bar") },
              { id: "secondary" as const, label: t("Secondary Side Bar") },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              className={settings.chatLocation === id ? "active" : ""}
              data-tooltip={
                id === "primary"
                  ? t(
                      "Show chat in the Primary Side Bar (Explorer, Search, Source Control, …)",
                    )
                  : t("Show chat in the Secondary Side Bar (opposite the Primary Side Bar)")
              }
              onClick={() => vscode.postMessage({ type: "update_settings", chatLocation: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted">
          {t(
            "Currently on the {0} — {1} sits on the {2}. The Secondary Side Bar is always opposite the Primary Side Bar.",
            sideLabel(settings.chatSide),
            locationLabel,
            sideLabel(
              settings.chatLocation === "primary" ? settings.primarySidebarSide : oppositeSide,
            ),
          )}
        </p>
        <button
          className="btn subtle"
          data-tooltip={t(
            "Runs the VS Code command to move the Primary Side Bar to the other side",
          )}
          onClick={() => vscode.postMessage({ type: "toggle_sidebar_position" })}
        >
          {oppositeSide === "left"
            ? t("Move Primary Side Bar Left")
            : t("Move Primary Side Bar Right")}
        </button>
      </div>
    </SettingsSection>
  );
}
