/**
 * Risk taxonomy for tools — enforced by the harness permission engine.
 */
export type RiskClass = "read_only" | "write" | "destructive" | "network" | "shell" | "user";
export type GrantPolicy = "never" | "exact" | "scoped";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** A single ranked hit returned by a codebase index (lexical or semantic). */
export interface CodebaseSearchHit {
  /** Path relative to the workspace root. */
  path: string;
  score: number;
  /** Short excerpt(s) around the strongest match, for display/context. */
  snippet?: string;
  /** Symbol names in this file that matched the query, if any. */
  symbols?: string[];
}

/**
 * Minimal structural interface implemented by `CodebaseIndex` (see
 * codebaseIndex.ts). Kept separate from that concrete class so `ToolContext`
 * doesn't force a hard import — hosts (e.g. the VS Code extension) build a
 * real index and hand it in; tools that don't care just ignore the field.
 */
export interface CodebaseIndexLike {
  search(query: string, opts?: { limit?: number }): CodebaseSearchHit[] | Promise<CodebaseSearchHit[]>;
  /** Optional embeddings-backed search when configured by the host. */
  semanticSearch?(query: string, opts?: { limit?: number }): CodebaseSearchHit[] | Promise<CodebaseSearchHit[]>;
  /** True when a semantic backend is available. */
  hasSemanticLayer?: boolean;
}

/** A single linter/type diagnostic surfaced to the agent. */
export interface DiagnosticEntry {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
}

export type DiagnosticsProvider = (paths?: string[]) => Promise<DiagnosticEntry[]>;

export interface ToolContext {
  workspaceRoot: string;
  /** Scratch / agent memory directory (.ninjacode). */
  agentDir: string;
  signal?: AbortSignal;
  /** Active persisted session id (for plan bookkeeping). */
  sessionId?: string;
  /** OS execution boundary used by shell-like tools. Defaults to workspace-write. */
  sandboxMode?: SandboxMode;
  /** Stable plan id for the session (defaults to hash of sessionId). */
  planId?: string;
  /** Optional local codebase index used by `search_codebase` when available. */
  codebaseIndex?: CodebaseIndexLike;
  /** Host-provided diagnostics (VS Code languages API, etc.). */
  diagnosticsProvider?: DiagnosticsProvider;
}

export interface ToolResult {
  output: string;
  /** Optional structured metadata for the harness (e.g. edited paths). */
  meta?: Record<string, unknown>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_args"
      | "not_found"
      | "permission"
      | "runtime"
      | "timeout"
      | "aborted" = "runtime",
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly risk: RiskClass;
  readonly inputSchema: Record<string, unknown>;
  /** Resolve the capability target for permission checks (path, URL, command…). */
  target(args: Record<string, unknown>): string;
  /**
   * Optional per-call risk escalation. A tool whose danger depends on its
   * arguments — `run_shell` above all — reports the risk of this specific call
   * here; `risk` stays the floor for anything this returns nothing for.
   */
  riskFor?(args: Record<string, unknown>): RiskClass;
  /**
   * Optional capability "scopes" for coarse-grained "always approve" grants.
   * When it returns a non-empty list, approving with "remember" grants every
   * scope (e.g. a command type) instead of the exact target, and a later call
   * is auto-approved only when all of its scopes are already granted. An empty
   * list falls back to remembering the exact `target`.
   */
  grantScopes?(args: Record<string, unknown>): string[];
  /**
   * Controls whether an approval may be persisted. Dynamic interpreters and
   * wrappers use `never`; ordinary calls default to `scoped` when scopes are
   * present and `exact` otherwise.
   */
  grantPolicy?(args: Record<string, unknown>): GrantPolicy;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

export type ToolsetName = "core" | "plan" | "ask" | "network" | "all";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  specs() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  filter(predicate: (t: Tool) => boolean): ToolRegistry {
    const next = new ToolRegistry();
    for (const t of this.list()) {
      if (predicate(t)) next.register(t);
    }
    return next;
  }

  forMode(mode: "agent" | "plan" | "ask" | "debug"): ToolRegistry {
    const isDebugTool = (t: Tool) =>
      t.name === "record_hypotheses" ||
      t.name === "read_debug_logs" ||
      t.name === "clear_debug_logs" ||
      t.name === "cleanup_instrumentation";

    if (mode === "ask") {
      return this.filter(
        (t) => !isDebugTool(t) && (t.risk === "read_only" || t.name === "ask_user"),
      );
    }
    if (mode === "plan") {
      return this.filter(
        (t) =>
          !isDebugTool(t) &&
          (t.risk === "read_only" ||
            t.name === "ask_user" ||
            t.name === "request_user_action" ||
            t.name === "todo_write" ||
            t.name === "write_scratchpad" ||
            t.name === "write_plan"),
      );
    }
    if (mode === "debug") {
      // Full registry including debug tools
      return this;
    }
    // agent: everything except debug-only tools
    return this.filter((t) => !isDebugTool(t));
  }
}
