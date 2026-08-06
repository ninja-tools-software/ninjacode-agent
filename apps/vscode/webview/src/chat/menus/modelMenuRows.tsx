import { CheckIcon, StarIcon } from "../../icons.js";
import { formatContext } from "../format.js";
import type { ModelInfo, SettingsState, VsCodeApi } from "../types.js";
import {
  budgetOptions,
  capitalizeEffort,
  defaultContextWindow,
  defaultReasoningEffort,
  defaultThinkingBudget,
  formatContextSizeLabel,
  isDefaultContextSelected,
  labelForBudgetOption,
} from "./modelMenuHelpers.js";
import { costIndexColor, formatCostIndex } from "./costIndexTone.js";
import { t } from "../../i18n.js";

export function ModelCostBadge({ costIndex }: { costIndex: number }) {
  const label = formatCostIndex(costIndex);
  return (
    <span
      className="model-menu-cost"
      style={{ color: costIndexColor(costIndex) }}
      aria-label={t("Cost index {0}", label)}
      data-tooltip={t("Cost index {0}", label)}
    >
      {label}
    </span>
  );
}

function ModelRow({
  model,
  selected,
  highlighted,
  favorite,
  showFavoriteDivider,
  onSelect,
  onHover,
  onToggleFavorite,
}: {
  model: ModelInfo;
  selected: boolean;
  highlighted: boolean;
  favorite: boolean;
  showFavoriteDivider: boolean;
  onSelect: () => void;
  onHover: () => void;
  onToggleFavorite: () => void;
}) {
  const hasCost = typeof model.costIndex === "number";
  return (
    <div
      className={`model-menu-row${highlighted ? " highlighted" : ""}${
        showFavoriteDivider ? " after-favorites" : ""
      }`}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={`model-menu-item${selected ? " selected" : ""}${hasCost ? " has-cost" : ""}`}
        onClick={onSelect}
      >
        <span className="model-menu-check">{selected && <CheckIcon size={13} />}</span>
        <span className="model-menu-main">
          <span className="model-menu-label" data-tooltip={model.label}>
            {model.label}
          </span>
          {model.reasoning && <span className="model-menu-badge">{t("reasoning")}</span>}
          {model.vision && <span className="model-menu-badge">{t("vision")}</span>}
          {model.hostingRegion && (
            <span className="model-menu-badge region">{model.hostingRegion}</span>
          )}
        </span>
        {hasCost ? <ModelCostBadge costIndex={model.costIndex as number} /> : null}
        <span className="model-menu-meta">{formatContext(model.contextWindow)} ctx</span>
      </button>
      <button
        type="button"
        className={`model-menu-star${favorite ? " active" : ""}`}
        aria-pressed={favorite}
        aria-label={favorite ? t("Unstar {0}", model.label) : t("Star {0}", model.label)}
        data-tooltip={favorite ? t("Remove from favorites") : t("Pin to the top")}
        onClick={onToggleFavorite}
      >
        <StarIcon size={12} filled={favorite} />
      </button>
    </div>
  );
}

function SettingsOptionRow({
  label,
  selected,
  isDefault,
  onSelect,
}: {
  label: string;
  selected: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`model-settings-item${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      <span className="model-settings-check" aria-hidden={!selected}>
        {selected ? <CheckIcon size={13} /> : null}
      </span>
      <span className="model-settings-item-label">{label}</span>
      <span className="model-settings-default">{isDefault ? t("Default") : ""}</span>
    </button>
  );
}

export function ModelMenuReasoningSection({
  modelInfo,
  settings,
  setSettings,
  vscode,
}: {
  modelInfo: ModelInfo;
  settings: SettingsState;
  setSettings: (s: SettingsState) => void;
  vscode: VsCodeApi;
}) {
  if (modelInfo.reasoning?.kind === "levels") {
    const active = settings.reasoningEffort || defaultReasoningEffort(modelInfo);
    const def = defaultReasoningEffort(modelInfo);
    return (
      <div className="model-menu-section">
        <div className="model-menu-section-title">{t("Thinking Effort")}</div>
        <div className="model-settings-list" role="listbox" aria-label={t("Thinking Effort")}>
          {modelInfo.reasoning.levels.map((l) => (
            <SettingsOptionRow
              key={l}
              label={t(capitalizeEffort(l))}
              selected={active === l}
              isDefault={l === def}
              onSelect={() => {
                setSettings({ ...settings, reasoningEffort: l });
                vscode.postMessage({ type: "set_reasoning", reasoningEffort: l });
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (modelInfo.reasoning?.kind === "budget") {
    const def = defaultThinkingBudget(modelInfo) ?? modelInfo.reasoning.default;
    const active = settings.thinkingBudgetTokens || def;
    const options = budgetOptions(modelInfo);
    return (
      <div className="model-menu-section">
        <div className="model-menu-section-title">{t("Thinking Effort")}</div>
        <div className="model-settings-list" role="listbox" aria-label={t("Thinking Effort")}>
          {options.map((n) => (
            <SettingsOptionRow
              key={n}
              label={t(labelForBudgetOption(options, n))}
              selected={active === n}
              isDefault={n === def}
              onSelect={() => {
                setSettings({ ...settings, thinkingBudgetTokens: n });
                vscode.postMessage({ type: "set_reasoning", thinkingBudgetTokens: n });
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  return null;
}

export function ModelMenuContextSection({
  ctxOptions,
  settings,
  setSettings,
  vscode,
  modelInfo,
}: {
  currentCtx?: number;
  ctxOptions: number[];
  settings: SettingsState;
  setSettings: (s: SettingsState) => void;
  vscode: VsCodeApi;
  modelInfo?: ModelInfo;
}) {
  if (ctxOptions.length === 0) return null;
  const def = defaultContextWindow(modelInfo);
  const options = [...ctxOptions];
  if (def > 0 && !options.includes(def)) {
    options.push(def);
    options.sort((a, b) => a - b);
  }
  const onDefault = isDefaultContextSelected(settings, modelInfo);
  return (
    <div className="model-menu-section">
      <div className="model-menu-section-title">{t("Context Size")}</div>
      <div className="model-settings-list" role="listbox" aria-label={t("Context Size")}>
        {options.map((n) => {
          const isDefault = n === def;
          return (
            <SettingsOptionRow
              key={n}
              label={formatContextSizeLabel(n)}
              selected={isDefault ? onDefault : !onDefault && settings.contextWindow === n}
              isDefault={isDefault}
              onSelect={() => {
                // Default writes 0 so runConfig resolves the model default.
                const next = isDefault ? 0 : n;
                setSettings({ ...settings, contextWindow: next });
                vscode.postMessage({ type: "set_context_window", contextWindow: next });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ModelMenuListSection({
  models,
  favorites,
  favoriteCount,
  highlight,
  settings,
  setHighlight,
  selectModel,
  toggleFavorite,
  setOpen,
}: {
  models: ModelInfo[];
  favorites: string[];
  favoriteCount: number;
  highlight: number;
  settings: SettingsState;
  setHighlight: (i: number) => void;
  selectModel: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setOpen: (open: boolean) => void;
}) {
  return (
    <div className="model-menu-section">
      {models.map((m, i) => (
        <ModelRow
          key={m.id}
          model={m}
          selected={m.id === settings.model}
          highlighted={i === highlight}
          favorite={favorites.includes(m.id)}
          showFavoriteDivider={favoriteCount > 0 && i === favoriteCount}
          onHover={() => setHighlight(i)}
          onSelect={() => {
            selectModel(m.id);
            setOpen(false);
          }}
          onToggleFavorite={() => toggleFavorite(m.id)}
        />
      ))}
    </div>
  );
}
