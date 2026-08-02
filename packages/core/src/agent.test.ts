import { describe, expect, it } from "vitest";
import { MockProvider } from "@ninjacode/providers";
import { createDefaultToolRegistry, listPlans } from "@ninjacode/tools";
import { Agent } from "./agent.js";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { compactHistorySync, truncateToolOutput } from "./context.js";
import type {
  Completion,
  CompletionRequest,
  LlmProvider,
  Message,
  StreamSink,
} from "@ninjacode/providers";
import type { RunState } from "./types.js";
import { listSessions, loadSession } from "./sessions.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Provider whose completeStreaming never resolves on its own — only via abort. */
class HangingProvider implements LlmProvider {
  readonly name = "hanging";

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  completeStreaming(req: CompletionRequest, _sink?: StreamSink): Promise<Completion> {
    return new Promise<Completion>((_resolve, reject) => {
      if (req.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      req.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  }
}

/** Provider whose completeStreaming always throws — simulates an LLM error on the first call. */
class FailingProvider implements LlmProvider {
  readonly name = "failing";

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(_req: CompletionRequest): Promise<Completion> {
    throw new Error("simulated LLM failure");
  }
}

describe("truncateToolOutput", () => {
  it("leaves short output alone", () => {
    expect(truncateToolOutput("hello")).toBe("hello");
  });

  it("truncates long output", () => {
    const long = "x".repeat(20_000);
    const out = truncateToolOutput(long, 1000);
    expect(out.length).toBeLessThan(1200);
    expect(out).toContain("truncated");
  });
});

describe("compactHistorySync", () => {
  it("preserves recent messages", () => {
    const history: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      content: `msg ${i}`,
    }));
    expect(compactHistorySync(history)).toHaveLength(10);
  });
});

describe("Agent with mock provider", () => {
  it("completes a simple task without tools", async () => {
    const provider = new MockProvider([{ text: "Hello from NinjaCode." }]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const outcome = await agent.run("Say hello");
    expect(outcome.completed).toBe(true);
    expect(outcome.answer).toContain("Hello");
  });

  it("executes a tool call then finishes", async () => {
    const provider = new MockProvider([
      {
        text: "Listing…",
        toolCalls: [
          {
            id: "call_1",
            name: "list_dir",
            arguments: { path: "." },
          },
        ],
      },
      { text: "Done listing." },
    ]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const outcome = await agent.run("List the directory");
    expect(outcome.completed).toBe(true);
    expect(outcome.turns.length).toBeGreaterThanOrEqual(1);
    expect(outcome.turns[0]?.toolInvocations[0]?.toolCall.name).toBe("list_dir");
  });

  it("persists and resumes a session", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-sess-"));
    try {
      const provider = new MockProvider([
        { text: "First answer" },
        { text: "Second answer" },
      ]);
      const tools = createDefaultToolRegistry();
      const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
      permissions.update({ allowlist: tools.names() });

      const agent = new Agent({
        provider,
        tools,
        permissions,
        workspaceRoot: dir,
        agentDir: path.join(dir, ".ninjacode"),
        enableCheckpoints: false,
        enableSubagents: false,
        persistSessions: true,
      });

      const first = await agent.run("hello");
      expect(first.completed).toBe(true);
      const sessions = await listSessions(path.join(dir, ".ninjacode"));
      expect(sessions.length).toBe(1);

      const tools2 = createDefaultToolRegistry();
      const perms2 = new PermissionEngine(defaultPermissionPolicy("autonomous"));
      perms2.update({ allowlist: tools2.names() });
      const { agent: resumed } = await Agent.resume({
        provider: new MockProvider([{ text: "Second answer" }]),
        tools: tools2,
        permissions: perms2,
        workspaceRoot: dir,
        agentDir: path.join(dir, ".ninjacode"),
        sessionId: first.sessionId,
        enableCheckpoints: false,
        enableSubagents: false,
      });
      const second = await resumed.run("follow up");
      expect(second.completed).toBe(true);
      expect(second.answer).toContain("Second");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not duplicate the user message when resending after a failed run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-dup-"));
    try {
      const tools = createDefaultToolRegistry();
      const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
      permissions.update({ allowlist: tools.names() });

      const agent = new Agent({
        provider: new FailingProvider(),
        tools,
        permissions,
        workspaceRoot: dir,
        agentDir: path.join(dir, ".ninjacode"),
        enableCheckpoints: false,
        enableSubagents: false,
        persistSessions: true,
        enableRetry: false,
      });

      const first = await agent.run("repeat me");
      expect(first.completed).toBe(false);

      const tools2 = createDefaultToolRegistry();
      const perms2 = new PermissionEngine(defaultPermissionPolicy("autonomous"));
      perms2.update({ allowlist: tools2.names() });
      const { agent: resumed } = await Agent.resume({
        provider: new MockProvider([{ text: "done" }]),
        tools: tools2,
        permissions: perms2,
        workspaceRoot: dir,
        agentDir: path.join(dir, ".ninjacode"),
        sessionId: first.sessionId,
        enableCheckpoints: false,
        enableSubagents: false,
        enableRetry: false,
      });

      const second = await resumed.run("repeat me");
      expect(second.completed).toBe(true);
      const dupes = resumed
        .getSession()
        .history.filter((m) => m.role === "user" && m.content === "repeat me");
      expect(dupes).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("maps each request to a checkpoint and numbers labels uniquely across resume", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-req-cp-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const build = () => {
        const tools = createDefaultToolRegistry();
        const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
        permissions.update({ allowlist: tools.names() });
        return { tools, permissions };
      };

      const one = build();
      const agent = new Agent({
        provider: new MockProvider([{ text: "one" }]),
        tools: one.tools,
        permissions: one.permissions,
        workspaceRoot: dir,
        agentDir,
        enableCheckpoints: true,
        enableSubagents: false,
        persistSessions: true,
      });
      const first = await agent.run("first task");
      expect(first.completed).toBe(true);

      const session1 = await loadSession(agentDir, first.sessionId);
      expect(session1?.requests).toHaveLength(1);
      expect(session1?.requests?.[0]?.userMessageIndex).toBe(0);

      const two = build();
      const { agent: resumed } = await Agent.resume({
        provider: new MockProvider([{ text: "two" }]),
        tools: two.tools,
        permissions: two.permissions,
        workspaceRoot: dir,
        agentDir,
        sessionId: first.sessionId,
        enableCheckpoints: true,
        enableSubagents: false,
        persistSessions: true,
      });
      const second = await resumed.run("second task");
      expect(second.completed).toBe(true);

      const session2 = await loadSession(agentDir, first.sessionId);
      expect(session2?.requests).toHaveLength(2);

      const checkpoints = await resumed.getCheckpointManager().list();
      const labels = checkpoints.map((c) => c.label);
      expect(labels.some((l) => l.startsWith("request-1:"))).toBe(true);
      expect(labels.some((l) => l.startsWith("request-2:"))).toBe(true);

      const secondCheckpointId = session2?.requests?.[1]?.checkpointId;
      expect(checkpoints.find((c) => c.id === secondCheckpointId)?.sessionId).toBe(first.sessionId);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Agent abort", () => {
  it("starts idle and transitions to running once run() starts", async () => {
    const provider = new MockProvider([{ text: "Hello" }]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    expect(agent.getState()).toBe("idle");
    const outcome = await agent.run("Say hello");
    expect(outcome.completed).toBe(true);
    expect(agent.getState()).toBe("completed");
  });

  it("aborts a hanging LLM call and reports a stopped, uncompleted outcome", async () => {
    const states: RunState[] = [];
    const agent = new Agent({
      provider: new HangingProvider(),
      tools: createDefaultToolRegistry(),
      permissions: new PermissionEngine(defaultPermissionPolicy("autonomous")),
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
      onEvent: (ev) => {
        if (ev.type === "state_change") {
          states.push((ev.payload as { state: RunState }).state);
        }
      },
    });

    const runPromise = agent.run("Do something that never returns");
    await new Promise((r) => setTimeout(r, 20));
    expect(agent.getState()).toBe("running");

    agent.abort();
    const outcome = await runPromise;

    expect(outcome.completed).toBe(false);
    expect(outcome.answer).toContain("Aborted");
    expect(agent.getState()).toBe("stopped");
    expect(states).toEqual(
      expect.arrayContaining(["running", "stopping", "stopped"]),
    );
  });

  it("is idempotent when abort() is called multiple times", async () => {
    const agent = new Agent({
      provider: new HangingProvider(),
      tools: createDefaultToolRegistry(),
      permissions: new PermissionEngine(defaultPermissionPolicy("autonomous")),
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const runPromise = agent.run("Do something that never returns");
    await new Promise((r) => setTimeout(r, 10));
    agent.abort();
    agent.abort();
    agent.abort();
    const outcome = await runPromise;
    expect(outcome.completed).toBe(false);
    expect(agent.getState()).toBe("stopped");
  });

  it("cancels a pending tool approval when aborted", async () => {
    const provider = new MockProvider([
      {
        text: "Editing a file",
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: { path: "scratch.txt", content: "hi" },
          },
        ],
      },
    ]);
    const tools = createDefaultToolRegistry();
    // "strict" mode requires approval for write_file; never resolve the approval
    // so we can abort while the agent is "waiting".
    const permissions = new PermissionEngine(defaultPermissionPolicy("strict"));

    const states: RunState[] = [];
    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
      onApproval: () => new Promise(() => undefined), // never resolves
      onEvent: (ev) => {
        if (ev.type === "state_change") {
          states.push((ev.payload as { state: RunState }).state);
        }
      },
    });

    const runPromise = agent.run("Edit a file");
    await new Promise((r) => setTimeout(r, 20));
    expect(agent.getState()).toBe("waiting");

    agent.abort();
    const outcome = await runPromise;

    expect(outcome.completed).toBe(false);
    expect(agent.getState()).toBe("stopped");
    expect(states).toEqual(expect.arrayContaining(["waiting", "stopping", "stopped"]));
  });

  it("aborts an in-flight shell tool call without hanging", async () => {
    const provider = new MockProvider([
      {
        text: "Running a long command",
        toolCalls: [
          { id: "call_1", name: "run_shell", arguments: { command: "sleep 30" } },
        ],
      },
    ]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const runPromise = agent.run("Run a long shell command");
    // Give the shell tool time to actually spawn the child process.
    await new Promise((r) => setTimeout(r, 300));
    agent.abort();

    const outcome = await runPromise;
    expect(outcome.completed).toBe(false);
    expect(agent.getState()).toBe("stopped");
    const invocation = outcome.turns[0]?.toolInvocations[0];
    expect(invocation?.error).toBe("aborted");
  }, 10_000);
});

describe("Agent multimodal task input", () => {
  const TINY_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAg1KH9+8AAAAASUVORK5CYII=";

  it("attaches image parts to history when the model supports vision", async () => {
    const provider = new MockProvider([{ text: "I see it." }]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      model: "claude-sonnet-4-20250514",
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    await agent.run({
      text: "What's in this screenshot?",
      images: [{ type: "image", mimeType: "image/png", data: TINY_PNG_BASE64 }],
    });

    const userMsg = agent.getSession().history.find((m) => m.role === "user");
    expect(userMsg?.parts).toHaveLength(1);
    expect(userMsg?.parts?.[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(userMsg?.content).not.toContain("omitted");
  });

  it("drops image parts and notes the omission for a non-vision model", async () => {
    const provider = new MockProvider([{ text: "No images for me." }]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      model: "deepseek-v4-flash",
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    await agent.run({
      text: "What's in this screenshot?",
      images: [{ type: "image", mimeType: "image/png", data: TINY_PNG_BASE64 }],
    });

    const userMsg = agent.getSession().history.find((m) => m.role === "user");
    expect(userMsg?.parts).toBeUndefined();
    expect(userMsg?.content).toContain("omitted");
  });

  it("still accepts a plain string task for backward compatibility", async () => {
    const provider = new MockProvider([{ text: "ok" }]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const outcome = await agent.run("plain string task");
    expect(outcome.completed).toBe(true);
  });
});

describe("Agent codebase index wiring", () => {
  it("passes the configured codebaseIndex through to tool execution via ToolContext", async () => {
    const provider = new MockProvider([
      {
        text: "Searching…",
        toolCalls: [{ id: "call_1", name: "search_codebase", arguments: { query: "widget" } }],
      },
      { text: "Found it." },
    ]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const fakeIndex = {
      search: (query: string) => [{ path: "src/widget.ts", score: 1, symbols: [query] }],
    };

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      codebaseIndex: fakeIndex,
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const outcome = await agent.run("Find the widget code");
    expect(outcome.completed).toBe(true);
    const invocation = outcome.turns[0]?.toolInvocations[0];
    expect(invocation?.output).toContain("src/widget.ts");
  });

  it("continues the run when the model hits max_tokens without tool calls", async () => {
    const provider = new MockProvider([
      { text: "partial answer", stopReason: "max_tokens" },
      { text: "completed after continuation." },
    ]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: process.cwd(),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const outcome = await agent.run("Explain something long");
    expect(outcome.completed).toBe(true);
    expect(outcome.answer).toContain("completed after continuation");
    expect(outcome.turns).toHaveLength(2);
    expect(outcome.turns[0]?.turn).toBe(0);
    expect(outcome.turns[1]?.turn).toBe(1);
  });
});

describe("write_plan session store", () => {
  it("keeps a single plan file when write_plan is called twice in one run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-agent-plan-"));
    const workspaceRoot = path.join(dir, "ws");
    const agentDir = path.join(workspaceRoot, ".ninjacode");
    await fs.mkdir(agentDir, { recursive: true });
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    const provider = new MockProvider([
      {
        text: "Planning…",
        toolCalls: [
          {
            id: "call_1",
            name: "write_plan",
            arguments: { title: "First", content: "Body v1" },
          },
        ],
      },
      {
        text: "Revising…",
        toolCalls: [
          {
            id: "call_2",
            name: "write_plan",
            arguments: { title: "Second", content: "Body v2" },
          },
        ],
      },
      { text: "Plan ready." },
    ]);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot,
      agentDir,
      sessionId,
      mode: "plan",
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
    });

    const outcome = await agent.run("Create a plan");
    expect(outcome.completed).toBe(true);
    const plans = await listPlans(agentDir);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.title).toBe("Second");
  });
});

describe("Agent.estimateContextForSession", () => {
  it("returns a non-zero breakdown for persisted history", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-agent-"));
    const workspaceRoot = path.join(dir, "ws");
    const agentDir = path.join(workspaceRoot, ".ninjacode");
    await fs.mkdir(agentDir, { recursive: true });

    const history: Message[] = [
      { role: "user", content: "Hello there" },
      { role: "assistant", content: "Hi!" },
    ];

    const usage = await Agent.estimateContextForSession({
      workspaceRoot,
      agentDir,
      mode: "agent",
      history,
      tools: createDefaultToolRegistry(),
      contextWindow: 128_000,
      maxTokens: 8192,
      providerKind: "mock",
    });

    expect(usage.total).toBeGreaterThan(0);
    expect(usage.window).toBe(128_000);
    expect(usage.output).toBe(8192);
    expect(usage.history).toBeGreaterThan(0);
  });
});
