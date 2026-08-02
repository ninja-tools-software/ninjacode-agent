import { useCallback, useState } from "react";
import type { ComposerHandle } from "../composer/Composer.js";
import { EMPTY_DOC } from "../composer/model.js";
import type { ComposerToken } from "../composer/token.js";
import type { AutocompleteItem } from "../menus/AutocompleteMenu.js";
import type { ContextRef, SlashBuiltinItem, SlashPromptItem, VsCodeApi } from "../types.js";
import { useComposerMenuItems } from "./useComposerMenuItems.js";

interface MenuAcceptCtx {
  composerRef: React.RefObject<ComposerHandle | null>;
  slashPrompts: SlashPromptItem[];
  onBuiltinCommand: (name: string) => boolean;
  requestResolution: (pending: ContextRef[]) => void;
  clearToken: () => void;
}

function acceptMention(ctx: MenuAcceptCtx, token: ComposerToken, item: AutocompleteItem) {
  const target = item.label;
  const pending: ContextRef = {
    id: `file:${target}`,
    kind: "file",
    label: target.split("/").pop() || target,
    detail: target,
    target,
    status: "pending",
  };
  ctx.composerRef.current?.replaceTokenWithRefs(token, [pending]);
  ctx.requestResolution([pending]);
  ctx.clearToken();
}

function acceptSlash(ctx: MenuAcceptCtx, token: ComposerToken, item: AutocompleteItem) {
  const name = item.id.split(":")[1] ?? "";
  if (item.id.startsWith("prompt:")) {
    const prompt = ctx.slashPrompts.find((p) => p.name === name);
    ctx.composerRef.current?.replaceToken(token, prompt?.body ?? `/${name} `);
    ctx.clearToken();
    return;
  }
  if (ctx.onBuiltinCommand(name)) {
    ctx.composerRef.current?.setDoc(EMPTY_DOC);
    ctx.clearToken();
    return;
  }
  ctx.composerRef.current?.replaceToken(token, `/${name} `);
  ctx.clearToken();
}

export function useComposerMenu(
  vscode: VsCodeApi,
  composerRef: React.RefObject<ComposerHandle | null>,
  onBuiltinCommand: (name: string) => boolean,
  requestResolution: (pending: ContextRef[]) => void,
) {
  const [token, setToken] = useState<ComposerToken | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [mentions, setMentions] = useState<string[]>([]);
  const [slashBuiltins, setSlashBuiltins] = useState<SlashBuiltinItem[]>([]);
  const [slashPrompts, setSlashPrompts] = useState<SlashPromptItem[]>([]);
  const clearToken = useCallback(() => setToken(null), []);

  const onToken = useCallback(
    (next: ComposerToken | null) => {
      setToken(next);
      setMenuIndex(0);
      if (next?.trigger === "@") vscode.postMessage({ type: "mention_query", query: next.query });
      else if (!next) setMentions([]);
    },
    [vscode],
  );

  const menuItems = useComposerMenuItems(token, mentions, slashBuiltins, slashPrompts);

  const acceptMenuItem = useCallback(
    (index = menuIndex) => {
      const item = menuItems[index] ?? menuItems[0];
      if (!token || !item) return;
      const ctx: MenuAcceptCtx = { composerRef, slashPrompts, onBuiltinCommand, requestResolution, clearToken };
      if (token.trigger === "@") acceptMention(ctx, token, item);
      else acceptSlash(ctx, token, item);
    },
    [clearToken, composerRef, menuIndex, menuItems, onBuiltinCommand, requestResolution, slashPrompts, token],
  );

  return {
    token,
    menuItems,
    menuIndex,
    setMenuIndex,
    onToken,
    acceptMenuItem,
    setMentions,
    setSlashCommands: useCallback((builtins: SlashBuiltinItem[], prompts: SlashPromptItem[]) => {
      setSlashBuiltins(builtins);
      setSlashPrompts(prompts);
    }, []),
    clearToken,
  };
}
