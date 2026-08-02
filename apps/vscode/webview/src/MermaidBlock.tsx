import { useEffect, useId, useRef, useState, type RefObject } from "react";
import mermaid from "mermaid";
import { sanitizeMermaidSource } from "./mermaidSanitize.js";
import { initializeMermaidTheme, onEditorThemeChange } from "./mermaidTheme.js";
import { queueMermaidRender } from "./mermaidRenderQueue.js";

type ViewMode = "render" | "source";

const RENDER_DEBOUNCE_MS = 300;

async function renderDiagram(id: string, source: string): Promise<string> {
  const { svg } = await mermaid.render(id, source);
  const trimmed = svg.trim();
  if (!trimmed || !/<svg[\s>]/i.test(trimmed)) {
    throw new Error("Diagram produced no output");
  }
  return trimmed;
}

function MermaidToggleButton({ mode, onToggle }: { mode: ViewMode; onToggle: () => void }) {
  const label = mode === "render" ? "Show source" : "Show diagram";
  return (
    <button
      type="button"
      className="icon-btn mermaid-toggle"
      data-tooltip={label}
      aria-label={label}
      onClick={onToggle}
    >
      {mode === "render" ? "{}" : "◫"}
    </button>
  );
}

function MermaidSourcePanel({ source, pending = false }: { source: string; pending?: boolean }) {
  return (
    <pre className={`mermaid-source${pending ? " mermaid-pending" : ""}`}>
      <code>{source}</code>
    </pre>
  );
}

function MermaidErrorPanel({ message, source }: { message: string; source: string }) {
  return (
    <div className="mermaid-error">
      Could not render diagram — {message}
      <MermaidSourcePanel source={source} />
    </div>
  );
}

function useDebouncedSource(source: string, deferRender: boolean) {
  const wasDeferredRef = useRef(deferRender);
  const [debouncedSource, setDebouncedSource] = useState(source);

  useEffect(() => {
    if (deferRender) {
      wasDeferredRef.current = true;
      return;
    }
    const delay = wasDeferredRef.current ? 0 : RENDER_DEBOUNCE_MS;
    wasDeferredRef.current = false;
    const timer = window.setTimeout(() => setDebouncedSource(source), delay);
    return () => window.clearTimeout(timer);
  }, [source, deferRender]);

  return debouncedSource;
}

type MermaidRenderOptions = {
  debouncedSource: string;
  mode: ViewMode;
  id: string;
  themeVersion: number;
  deferRender: boolean;
  renderRef: RefObject<HTMLDivElement | null>;
  setRenderError: (message: string | null) => void;
};

function useMermaidDiagramRender({
  debouncedSource,
  mode,
  id,
  themeVersion,
  deferRender,
  renderRef,
  setRenderError,
}: MermaidRenderOptions) {
  const renderGenerationRef = useRef(0);

  useEffect(() => {
    if (deferRender || mode !== "render") return;

    const generation = ++renderGenerationRef.current;
    let cancelled = false;
    const container = renderRef.current;
    if (!container) return;

    void (async () => {
      try {
        initializeMermaidTheme(mermaid);
        if (cancelled) return;

        const sanitized = sanitizeMermaidSource(debouncedSource);
        const renderId = `mermaid-${id}-${themeVersion}-${generation}`;

        const svg = await queueMermaidRender(async () => {
          try {
            return await renderDiagram(renderId, sanitized);
          } catch (firstError) {
            if (sanitized === debouncedSource) throw firstError;
            return renderDiagram(`${renderId}-raw`, debouncedSource);
          }
        });

        if (cancelled || renderGenerationRef.current !== generation || !renderRef.current) return;
        renderRef.current.innerHTML = svg;
        setRenderError(null);
      } catch (e) {
        if (cancelled || renderGenerationRef.current !== generation) return;
        let message = (e as Error).message || "Invalid Mermaid diagram";
        try {
          await mermaid.parse(sanitizeMermaidSource(debouncedSource), { suppressErrors: false });
        } catch (parseError) {
          message = (parseError as Error).message || message;
        }
        setRenderError(message.split("\n")[0] ?? message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedSource, mode, id, themeVersion, deferRender, renderRef, setRenderError]);
}

function MermaidContent({
  mode,
  source,
  deferRender,
  renderError,
  renderRef,
  onOpen,
}: {
  mode: ViewMode;
  source: string;
  deferRender: boolean;
  renderError: string | null;
  renderRef: RefObject<HTMLDivElement | null>;
  onOpen?: () => void;
}) {
  if (mode === "source") return <MermaidSourcePanel source={source} />;
  if (deferRender) return <MermaidSourcePanel source={source} pending />;
  if (renderError) return <MermaidErrorPanel message={renderError} source={source} />;
  if (!onOpen) return <div className="mermaid-render" ref={renderRef} />;
  return (
    <div
      className="mermaid-render mermaid-render-clickable"
      ref={renderRef}
      role="button"
      tabIndex={0}
      data-tooltip="Open diagram in editor tab"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    />
  );
}

export function MermaidBlock({
  source,
  deferRender = false,
  onOpen,
}: {
  source: string;
  deferRender?: boolean;
  onOpen?: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const renderRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ViewMode>("render");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const debouncedSource = useDebouncedSource(source, deferRender);

  useEffect(() => onEditorThemeChange(() => setThemeVersion((v) => v + 1)), []);
  useMermaidDiagramRender({
    debouncedSource,
    mode,
    id,
    themeVersion,
    deferRender,
    renderRef,
    setRenderError,
  });

  return (
    <div className="mermaid-block">
      <MermaidToggleButton mode={mode} onToggle={() => setMode((m) => (m === "render" ? "source" : "render"))} />
      <MermaidContent
        mode={mode}
        source={source}
        deferRender={deferRender}
        renderError={renderError}
        renderRef={renderRef}
        onOpen={onOpen}
      />
    </div>
  );
}
