import { describe, expect, it } from "vitest";
import { configureTelemetry, startSpan } from "./telemetry.js";

describe("telemetry", () => {
  it("does not export spans when disabled", () => {
    const exported: unknown[] = [];
    configureTelemetry({
      enabled: false,
      exporter: { export: (span) => exported.push(span) },
    });
    startSpan("run", { session: "s" }).end({ ok: true });
    expect(exported).toEqual([]);
  });

  it("exports opt-in spans without content payloads", () => {
    const exported: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    configureTelemetry({
      enabled: true,
      exporter: { export: (span) => exported.push(span) },
    });
    startSpan("tool", { tool: "read_file", risk: "read_only" }).end({ durationMs: 12 });
    expect(exported).toHaveLength(1);
    expect(exported[0]?.name).toBe("tool");
    expect(exported[0]?.attributes.tool).toBe("read_file");
    expect(JSON.stringify(exported[0])).not.toMatch(/password|secret|token/i);
    configureTelemetry({ enabled: false });
  });
});
