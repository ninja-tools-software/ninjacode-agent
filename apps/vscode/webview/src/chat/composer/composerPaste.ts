import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { readFileAsDataUrl } from "../format.js";
import type { DropItem } from "../types.js";
import { insertText, type ComposerDoc } from "./model.js";
import type { useComposerEditor } from "./useComposerEditor.js";

type ComposerEditor = ReturnType<typeof useComposerEditor>;

interface ComposerPasteDeps {
  editor: ComposerEditor;
  docRef: React.MutableRefObject<ComposerDoc>;
  notifyToken: (next: ComposerDoc, caret: number) => void;
  onDropItems: (items: DropItem[], offset: number) => void;
}

export function createComposerPasteHandler(deps: ComposerPasteDeps) {
  return (e: ReactClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items);
    const images = items.filter((it) => it.type.startsWith("image/"));
    if (images.length > 0) {
      e.preventDefault();
      const files = images.map((it) => it.getAsFile()).filter((f): f is File => f !== null);
      void Promise.all(
        files.map(async (file): Promise<DropItem> => ({
          kind: "file",
          value: file.name || "pasted image",
          name: file.name || "pasted image",
          mimeType: file.type,
          dataUrl: await readFileAsDataUrl(file),
        })),
      ).then((dropped) => deps.onDropItems(dropped, deps.editor.caret()));
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const edit = insertText(deps.docRef.current, deps.editor.caret(), text);
    deps.editor.apply(edit);
    deps.notifyToken(edit.doc, edit.caret);
  };
}
