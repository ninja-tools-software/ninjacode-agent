import { describe, expect, it } from "vitest";
import { OtlpHttpExporter, type OtlpFetch } from "./otlpHttpExporter.js";
import type { TelemetryRecord } from "./telemetry.js";

describe("OtlpHttpExporter", () => {
  it("batches OTLP/HTTP JSON without a real network", async () => {
    const requests: Array<{ input: string; body: string; headers: Record<string, string> }> = [];
    const fetch: OtlpFetch = async (input, init) => {
      requests.push({ input, body: init.body, headers: init.headers });
      return { ok: true, status: 200 };
    };
    const exporter = new OtlpHttpExporter({
      endpoint: "https://collector.example",
      serviceName: "test-agent",
      batchSize: 2,
      fetch,
    });

    exporter.export(record("first", "1111111111111111"));
    exporter.export(record("second", "2222222222222222"));
    await exporter.flush();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://collector.example/v1/traces");
    expect(requests[0]?.headers["content-type"]).toBe("application/json");
    const payload = JSON.parse(requests[0]?.body ?? "{}");
    expect(payload.resourceSpans[0].resource.attributes[0]).toEqual({
      key: "service.name",
      value: { stringValue: "test-agent" },
    });
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "1111111111111111",
      startTimeUnixNano: "1000000000",
      endTimeUnixNano: "1250000000",
    });
    expect(JSON.stringify(payload)).not.toContain("unsafe-secret");
  });

  it("uses an abort signal to enforce the export timeout", async () => {
    const fetch: OtlpFetch = (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const exporter = new OtlpHttpExporter({
      endpoint: "https://collector.example/v1/traces",
      timeoutMs: 5,
      fetch,
    });
    exporter.export(record("timeout", "3333333333333333"));

    await expect(exporter.flush()).rejects.toThrow("aborted");
  });
});

function record(name: string, spanId: string): TelemetryRecord {
  return {
    name,
    traceId: "0123456789abcdef0123456789abcdef",
    spanId,
    runId: "run-1",
    sessionId: "session-1",
    startTime: 1_000,
    endTime: 1_250,
    attributes: { ok: true, attempts: 2, apiKey: "unsafe-secret" },
  };
}
