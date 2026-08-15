import { useCallback, useState } from "react";
import { applyDocumentLocale } from "../i18n.js";

/** Tracks UI locale and re-inits `@vscode/l10n` so `t()` updates on the next render. */
export function useLocaleSync(initial: string) {
  const [locale, setLocale] = useState(() => applyDocumentLocale(initial));

  const applyLocale = useCallback((next: string) => {
    setLocale(applyDocumentLocale(next));
  }, []);

  return { locale, applyLocale };
}
