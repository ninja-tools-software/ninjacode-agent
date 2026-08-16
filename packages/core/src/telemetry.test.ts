import { describe, expect, it } from "vitest";
import {
  configureTelemetry,
  createTelemetryContext,
  extractTelemetryContext,
  injectTelemetryHeaders,
  runWithTelemetryContext,
  startSpan,
} from "./telemetry.js";

describe("telemetry", () => {
  it("does not export spans when disabled", () => {
    const exported: unknown[] = [];
    configureTelemetry({
      enabled: false,
      exporter: { export: (span) => { exported.push(span); } },
    });
    startSpan("run", { session: "s" }).end({ ok: true });
    expect(exported).toEqual([]);
  });

  it("exports opt-in spans without content payloads", () => {
    const exported: Array<{
      name: string;
      traceId: string;
      spanId: string;
      toolId?: string;
      attributes: Record<string, unknown>;
    }> = [];
    configureTelemetry({
      enabled: true,
      exporter: { export: (span) => { exported.push(span); } },
    });
    startSpan("tool", { tool: "read_file", risk: "read_only", password: "unsafe" })
      .end({ durationMs: 12 });
    expect(exported).toHaveLength(1);
    expect(exported[0]?.name).toBe("tool");
    expect(exported[0]?.attributes.tool).toBe("read_file");
    expect(exported[0]?.attributes.password).toBe("[REDACTED]");
    expect(exported[0]?.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(exported[0]?.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(exported[0]?.toolId).toBeTypeOf("string");
    configureTelemetry({ enabled: false });
  });

  it("propagates trace and learning-loop identifiers through nested spans", () => {
    const parent = createTelemetryContext({
      scope: "run",
      scopeId: "run-1",
      identifiers: { sessionId: "session-1" },
    });
    const span = runWithTelemetryContext(parent, () => startSpan("turn", {}, { scopeId: "turn-1" }));

    expect(span.context.traceId).toBe(parent.traceId);
    expect(span.context.parentSpanId).toBe(parent.spanId);
    expect(span.context.runId).toBe("run-1");
    expect(span.context.sessionId).toBe("session-1");
    expect(span.context.turnId).toBe("turn-1");
    span.end();
  });

  it("makes started spans active for existing nested instrumentation", () => {
    const run = startSpan("run", { sessionId: "session-2" }, { scopeId: "run-2" });
    const tool = startSpan("tool", {}, { scopeId: "tool-2" });

    expect(tool.context.traceId).toBe(run.context.traceId);
    expect(tool.context.parentSpanId).toBe(run.context.spanId);
    expect(tool.context.runId).toBe("run-2");
    expect(tool.context.sessionId).toBe("session-2");
    expect(tool.context.toolId).toBe("tool-2");
    tool.end();
    run.end();
  });

  it("injects and extracts W3C trace context and NinjaCode baggage", () => {
    const context = createTelemetryContext({
      traceId: "0123456789abcdef0123456789abcdef",
      scope: "tool",
      scopeId: "tool-1",
      identifiers: { runId: "run-1", sessionId: "session with spaces" },
    });

    const headers = injectTelemetryHeaders(context, { "x-test": "value" });
    const extracted = extractTelemetryContext({
      TraceParent: headers.traceparent,
      BAGGAGE: headers.baggage,
    });

    expect(headers["x-test"]).toBe("value");
    expect(extracted).toEqual({
      traceId: context.traceId,
      spanId: context.spanId,
      runId: "run-1",
      sessionId: "session with spaces",
      toolId: "tool-1",
    });
  });
});
