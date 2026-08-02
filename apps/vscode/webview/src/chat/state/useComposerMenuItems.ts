import { useMemo } from "react";
import type { ComposerToken } from "../composer/token.js";
import type { AutocompleteItem } from "../menus/AutocompleteMenu.js";
import type { SlashBuiltinItem, SlashPromptItem } from "../types.js";

export function useComposerMenuItems(
  token: ComposerToken | null,
  mentions: string[],
  slashBuiltins: SlashBuiltinItem[],
  slashPrompts: SlashPromptItem[],
) {
  return useMemo<AutocompleteItem[]>(() => {
    if (!token) return [];
    if (token.trigger === "@") {
      return mentions.slice(0, 12).map((m) => ({ id: `@${m}`, label: m }));
    }
    const q = token.query;
    return [
      ...slashBuiltins
        .filter((c) => c.name.startsWith(q))
        .map((c) => ({ id: `builtin:${c.name}`, label: `/${c.name}`, detail: c.description })),
      ...slashPrompts
        .filter((p) => p.name.startsWith(q))
        .map((p) => ({ id: `prompt:${p.name}`, label: `/${p.name}`, detail: p.description })),
    ];
  }, [mentions, slashBuiltins, slashPrompts, token]);
}
