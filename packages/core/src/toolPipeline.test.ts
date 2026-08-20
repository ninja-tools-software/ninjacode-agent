import { describe, expect, it, vi } from "vitest";
import { ToolError, ToolRegistry, type Tool } from "@ninjacode/tools";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { ToolCircuitBreaker } from "./reliability.js";
import { validateToolArguments } from "./toolErrors.js";
import { ToolPipeline } from "./toolPipeline.js";

function pipeline(signal = new AbortController().signal): ToolPipeline {
  return new ToolPipeline({
    signal,
    permissions: new PermissionEngine(defaultPermissionPolicy("autonomous")),
    breaker: new ToolCircuitBreaker(3),
    workspaceRoot: "/tmp/workspace",
    agentDir: "/tmp/workspace/.ninjacode",
    sessionId: "session",
    planId: "plan",
    sandboxMode: "workspace-write",
    persistSessionContext: false,
    parallelToolReads: true,
    getState: () => "running",
    setState: async () => undefined,
    runHooks: async () => [],
    emit: async () => undefined,
    logAgentEvent: () => undefined,
    waitOrAbort: async (promise) => promise,
    isAbortError: (error) => error instanceof Error && error.name === "AbortError",
    onModifiedFiles: () => undefined,
  });
}

function testTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "test_tool",
    description: "test",
    risk: "read_only",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        options: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1 } },
          required: ["limit"],
          additionalProperties: false,
        },
      },
      required: ["path", "options"],
      additionalProperties: false,
    },
    target: () => "target",
    execute: async () => ({ output: "ok" }),
    ...overrides,
  };
}

describe("ToolPipeline runtime input validation", () => {
  it("returns a typed invalid_args failure before approval, hooks, or execution", async () => {
    const execute = vi.fn(async () => ({ output: "must not run" }));
    const tool = testTool({ execute });
    const registry = new ToolRegistry().register(tool);

    const invocation = await pipeline().runToolCall(registry, {
      id: "bad",
      name: tool.name,
      arguments: { path: "a", options: { limit: "many" } },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(invocation.error).toBe("invalid_args");
    expect(invocation.output).toContain("$.options.limit must be integer");
    expect(invocation.meta?.error).toMatchObject({
      category: "InvalidArguments",
      blame: "model",
      retryable: true,
    });
  });

  it("rejects truncated and unexpected arguments without executing", async () => {
    const execute = vi.fn(async () => ({ output: "must not run" }));
    const tool = testTool({ execute });
    const registry = new ToolRegistry().register(tool);

    const [truncated, extra] = await Promise.all([
      pipeline().runToolCall(registry, {
        id: "truncated",
        name: tool.name,
        arguments: { _truncated: true },
      }),
      pipeline().runToolCall(registry, {
        id: "extra",
        name: tool.name,
        arguments: { path: "a", options: { limit: 1 }, surprise: true },
      }),
    ]);

    expect(truncated.error).toBe("invalid_args");
    expect(extra.error).toBe("invalid_args");
    expect(execute).not.toHaveBeenCalled();
  });

  it("bounds adversarial schema traversal", () => {
    const tool = testTool({
      inputSchema: {
        type: "object",
        properties: { values: { type: "array", items: { type: "number" } } },
        required: ["values"],
      },
    });

    expect(() => validateToolArguments(tool, { values: Array.from({ length: 10_001 }, () => 1) }))
      .toThrowError(ToolError);
    try {
      validateToolArguments(tool, { values: Array.from({ length: 10_001 }, () => 1) });
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_args" });
    }
  });

  it("fails closed on potentially catastrophic schema patterns", () => {
    const tool = testTool({
      inputSchema: {
        type: "object",
        properties: { value: { type: "string", pattern: "(a+)+$" } },
        required: ["value"],
      },
    });

    expect(() => validateToolArguments(tool, { value: `${"a".repeat(4_096)}!` })).toThrow(
      /safe pattern validation budget/,
    );
  });
});

describe("ToolPipeline bounded retries", () => {
  it("retries an opted-in read-only transient failure", async () => {
    let attempts = 0;
    const inputSchema = {
      ...testTool().inputSchema,
      "x-ninjacode-retry": { idempotent: true, maxAttempts: 3 },
    };
    const tool = testTool({
      inputSchema,
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new ToolError("temporary timeout", "timeout");
        return { output: "recovered" };
      },
    });

    const result = await pipeline().runToolCall(new ToolRegistry().register(tool), {
      id: "retry",
      name: tool.name,
      arguments: { path: "a", options: { limit: 1 } },
    });

    expect(result.output).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("does not retry without opt-in", async () => {
    let attempts = 0;
    const tool = testTool({
      execute: async () => {
        attempts += 1;
        throw new ToolError("temporary timeout", "timeout");
      },
    });

    await pipeline().runToolCall(new ToolRegistry().register(tool), {
      id: "single",
      name: tool.name,
      arguments: { path: "a", options: { limit: 1 } },
    });
    expect(attempts).toBe(1);
  });

  it("never replays a write even when it incorrectly opts in", async () => {
    let effects = 0;
    const inputSchema = {
      ...testTool().inputSchema,
      "x-ninjacode-retry": { idempotent: true, maxAttempts: 3 },
    };
    const tool = testTool({
      risk: "write",
      inputSchema,
      execute: async () => {
        effects += 1;
        throw new ToolError("timeout after possible effect", "timeout");
      },
    });

    await pipeline().runToolCall(new ToolRegistry().register(tool), {
      id: "write",
      name: tool.name,
      arguments: { path: "a", options: { limit: 1 } },
    });
    expect(effects).toBe(1);
  });

  it("stops the retry loop when the run aborts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const tool = testTool({
      inputSchema: {
        ...testTool().inputSchema,
        "x-ninjacode-retry": { idempotent: true, maxAttempts: 3 },
      },
      execute: async () => {
        attempts += 1;
        controller.abort("stop");
        throw new ToolError("temporary timeout", "timeout");
      },
    });

    const result = await pipeline(controller.signal).runToolCall(
      new ToolRegistry().register(tool),
      {
        id: "abort",
        name: tool.name,
        arguments: { path: "a", options: { limit: 1 } },
      },
    );

    expect(attempts).toBe(1);
    expect(result.error).toBe("aborted");
  });

  it("blocks the tool when a PreToolUse hook reports blocked without running", async () => {
    const execute = vi.fn(async () => ({ output: "must not run" }));
    const tool = testTool({
      execute,
      inputSchema: { type: "object", properties: {} },
    });
    const pipe = new ToolPipeline({
      signal: new AbortController().signal,
      permissions: new PermissionEngine(defaultPermissionPolicy("autonomous")),
      breaker: new ToolCircuitBreaker(3),
      workspaceRoot: "/tmp/workspace",
      agentDir: "/tmp/workspace/.ninjacode",
      sessionId: "session",
      planId: "plan",
      sandboxMode: "workspace-write",
      persistSessionContext: false,
      parallelToolReads: true,
      getState: () => "running",
      setState: async () => undefined,
      runHooks: async () => [
        {
          event: "PreToolUse",
          command: "echo hi",
          ran: false,
          blocked: true,
          reason: "denied by user",
        },
      ],
      emit: async () => undefined,
      logAgentEvent: () => undefined,
      waitOrAbort: async (promise) => promise,
      isAbortError: (error) => error instanceof Error && error.name === "AbortError",
      onModifiedFiles: () => undefined,
    });

    const result = await pipe.runToolCall(new ToolRegistry().register(tool), {
      id: "hooked",
      name: tool.name,
      arguments: {},
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.error).toBe("blocked_by_hook");
    expect(result.output).toContain("denied by user");
  });
});

describe("ToolPipeline read concurrency", () => {
  it("preserves result order and never overlaps a mutation barrier", async () => {
    let readsInFlight = 0;
    let mutationOverlapped = false;
    const registry = new ToolRegistry();
    for (const [name, delay] of [["read_file", 25], ["grep", 5]] as const) {
      registry.register({
        ...testTool(),
        name,
        inputSchema: { type: "object", properties: {} },
        target: (args) => String(args.path ?? args.pattern ?? name),
        execute: async () => {
          readsInFlight += 1;
          await new Promise((resolve) => setTimeout(resolve, delay));
          readsInFlight -= 1;
          return { output: name };
        },
      });
    }
    registry.register({
      ...testTool(),
      name: "edit_file",
      risk: "write",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        mutationOverlapped ||= readsInFlight > 0;
        return { output: "edit" };
      },
    });

    const results = await pipeline().executeToolCalls(registry, [
      { id: "slow", name: "read_file", arguments: { path: "a.ts" } },
      { id: "fast", name: "grep", arguments: { pattern: "x" } },
      { id: "write", name: "edit_file", arguments: { path: "a.ts" } },
    ]);

    expect(results.map((result) => result.toolCall.id)).toEqual(["slow", "fast", "write"]);
    expect(mutationOverlapped).toBe(false);
  });
});
