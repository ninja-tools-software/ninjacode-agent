import { AutocompleteMenu } from "./menus/AutocompleteMenu.js";
import { ContextPicker } from "./menus/ContextPicker.js";
import { ContextMeter } from "./panels/ContextMeter.js";
import { DragTip } from "./DragTip.js";
import type { AppComposerAreaProps } from "./AppComposerArea.types.js";
import type { ContextUsage, ModelInfo, SettingsState } from "./types.js";

/** Prefer live usage; fall back to a baseline from known model/settings window. */
export function resolveMeterUsage(
  usage: ContextUsage | null | undefined,
  settings: SettingsState | null | undefined,
  modelInfo?: ModelInfo,
): ContextUsage | null {
  if (usage && usage.window > 0) return usage;
  const configured = settings?.contextWindow ?? 0;
  const modelMax = modelInfo?.contextWindow ?? 0;
  const modelDefault = modelInfo?.defaultContextWindow ?? modelMax;
  const window =
    configured > 0 ? Math.min(configured, modelMax || configured) : modelDefault;
  if (window <= 0) return null;
  return {
    total: usage?.total ?? 0,
    window,
    system: usage?.system ?? 0,
    history: usage?.history ?? 0,
    tools: usage?.tools ?? 0,
    files: usage?.files ?? 0,
    output: usage?.output ?? 0,
  };
}

export function ComposerOverlays(props: AppComposerAreaProps) {
  const meterUsage = resolveMeterUsage(props.contextUsage, props.settings, props.modelInfo);
  return (
    <>
      {props.dragTipMounted && (
        <DragTip closing={props.dragTipClosing} onDismiss={props.onDismissDragTip} />
      )}
      {meterUsage && (
        <ContextMeter
          usage={meterUsage}
          attachedTokens={props.attachedTokens}
          onCompact={props.onCompact}
        />
      )}
      {props.pickerMounted && (
        <ContextPicker
          queryType={props.picker.type}
          query={props.picker.query}
          suggestions={props.picker.suggestions}
          closing={props.pickerClosing}
          onQueryType={props.picker.setType}
          onQuery={props.picker.setQuery}
          onPick={props.picker.pick}
          onAddSelection={props.picker.addSelection}
          onPickFiles={props.picker.pickFiles}
          onClose={props.picker.close}
        />
      )}
      {props.menuMounted && (
        <AutocompleteMenu
          items={props.menuItems}
          activeIndex={props.menuIndex}
          className={props.menuClassName}
          closing={props.menuClosing}
          onHover={props.onMenuHover}
          onPick={(_item, index) => props.onMenuPick(index)}
        />
      )}
    </>
  );
}
