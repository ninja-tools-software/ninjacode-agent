import { AutocompleteMenu } from "./menus/AutocompleteMenu.js";
import { ContextPicker } from "./menus/ContextPicker.js";
import { ContextMeter } from "./panels/ContextMeter.js";
import { DragTip } from "./DragTip.js";
import type { AppComposerAreaProps } from "./AppComposerArea.types.js";

export function ComposerOverlays(props: AppComposerAreaProps) {
  return (
    <>
      {props.dragTipMounted && (
        <DragTip closing={props.dragTipClosing} onDismiss={props.onDismissDragTip} />
      )}
      {props.contextUsage && props.contextUsage.window > 0 && (
        <ContextMeter
          usage={props.contextUsage}
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
