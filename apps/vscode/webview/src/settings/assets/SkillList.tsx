import { t } from "../../i18n.js";
import type { SkillItem, VsCodeApi } from "../../types.js";
import { AssetRow, isManaged } from "./shared.js";

export function SkillList({
  skills,
  vscode,
  onEdit,
}: {
  skills: SkillItem[];
  vscode: VsCodeApi;
  onEdit: (skill: SkillItem) => void;
}) {
  return (
    <>
      {skills.map((s) => (
        <AssetRow
          key={s.name}
          title={s.name}
          enabled={s.enabled}
          onToggle={() =>
            vscode.postMessage({
              type: "asset_toggle",
              kind: "skill",
              id: s.name,
              enabled: !s.enabled,
            })
          }
          onEdit={() => onEdit(s)}
          onOpen={() => vscode.postMessage({ type: "asset_open", kind: "skill", path: s.path })}
          onDelete={() =>
            vscode.postMessage({ type: "asset_delete", kind: "skill", id: s.name, path: s.path })
          }
          badges={
            <>
              <span className="badge">{t(s.context)}</span>
              {!isManaged(s.source) && <span className="badge muted">{s.source}</span>}
            </>
          }
          summary={s.description || <em>{t("No description")}</em>}
        />
      ))}
    </>
  );
}
