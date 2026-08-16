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
});
