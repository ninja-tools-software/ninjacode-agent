import { useEffect, useState } from "react";
import { MermaidBlock } from "./MermaidBlock.js";
import { t } from "./i18n.js";
import type { VsCodeApi } from "./chat/types.js";

function useMermaidDoc(vscode: VsCodeApi) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; source?: string };
      if (msg.type !== "mermaid_doc") return;
      setSource(msg.source ?? "");
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [vscode]);

  return source;
}

function MermaidAppLoading() {
  return (
    <div className="mermaid-app">
      <p className="muted mermaid-app-loading">{t("Loading diagram…")}</p>
    </div>
  );
}

export function MermaidApp({ vscode }: { vscode: VsCodeApi }) {
  const source = useMermaidDoc(vscode);

  if (source === null) return <MermaidAppLoading />;

  return (
    <div className="mermaid-app screen-enter">
      <div className="mermaid-app-body">
        <MermaidBlock source={source} />
      </div>
    </div>
  );
}
