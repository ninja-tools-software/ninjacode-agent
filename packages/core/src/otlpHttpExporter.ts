import {
  redactTelemetryAttributes,
  type TelemetryAttributeValue,
  type TelemetryExporter,
  type TelemetryRecord,
} from "./telemetry.js";

export interface OtlpFetchResponse {
  ok: boolean;
  status: number;
}

export type OtlpFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<OtlpFetchResponse>;

export interface OtlpHttpExporterOptions {
  endpoint: string;
  serviceName?: string;
  headers?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
  timeoutMs?: number;
  fetch?: OtlpFetch;
  onError?: (error: Error) => void;
}

const defaultBatchSize = 64;
const defaultFlushIntervalMs = 5_000;
const defaultTimeoutMs = 10_000;

export class OtlpHttpExporter implements TelemetryExporter {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly headers: Record<string, string>;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchRequest: OtlpFetch;
  private readonly onError?: (error: Error) => void;
  private queue: TelemetryRecord[] = [];
  private timer?: NodeJS.Timeout;
  private pendingFlush: Promise<void> = Promise.resolve();
  private isShutdown = false;

  constructor(options: OtlpHttpExporterOptions) {
    this.endpoint = tracesEndpoint(options.endpoint);
    this.serviceName = options.serviceName ?? "ninjacode-agent";
    this.headers = options.headers ?? {};
    this.batchSize = positiveInteger(options.batchSize, defaultBatchSize);
    this.flushIntervalMs = positiveInteger(options.flushIntervalMs, defaultFlushIntervalMs);
    this.timeoutMs = positiveInteger(options.timeoutMs, defaultTimeoutMs);
    this.fetchRequest = options.fetch ?? defaultFetch;
    this.onError = options.onError;
  }

  export(span: TelemetryRecord): void {
    if (this.isShutdown) return;
    this.queue.push(span);
    if (this.queue.length >= this.batchSize) {
      this.scheduleFlush();
      return;
    }
    this.scheduleTimer();
  }

  async flush(): Promise<void> {
    this.clearTimer();
    this.pendingFlush = this.pendingFlush
      .catch(() => undefined)
      .then(() => this.flushQueue());
    await this.pendingFlush;
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;
    await this.flush();
  }

  private scheduleFlush(): void {
    this.clearTimer();
    void this.flush().catch((error: unknown) => this.reportError(error));
  }

  private scheduleTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error: unknown) => this.reportError(error));
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async flushQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      try {
        await this.send(batch);
      } catch (error) {
        this.queue.unshift(...batch);
        throw error;
      }
    }
  }

  private async send(batch: TelemetryRecord[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchRequest(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: JSON.stringify(toOtlpPayload(batch, this.serviceName)),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OTLP export failed with HTTP ${response.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private reportError(error: unknown): void {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

export function toOtlpPayload(spans: TelemetryRecord[], serviceName: string): object {
  return {
    resourceSpans: [{
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
      },
      scopeSpans: [{
        scope: { name: "@ninjacode/core" },
        spans: spans.map(toOtlpSpan),
      }],
    }],
  };
}

function toOtlpSpan(span: TelemetryRecord): object {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: 1,
    startTimeUnixNano: millisecondsToNanoseconds(span.startTime),
    endTimeUnixNano: millisecondsToNanoseconds(span.endTime),
    attributes: recordAttributes(span),
    status: { code: span.attributes.failed === true ? 2 : 1 },
  };
}

function recordAttributes(span: TelemetryRecord): object[] {
  const identifiers: Record<string, TelemetryAttributeValue> = {
    "ninjacode.run.id": span.runId,
    "ninjacode.session.id": span.sessionId,
    "ninjacode.turn.id": span.turnId,
    "ninjacode.tool.id": span.toolId,
    "ninjacode.subagent.id": span.subagentId,
  };
  return Object.entries({ ...identifiers, ...redactTelemetryAttributes(span.attributes) })
    .filter((entry): entry is [string, Exclude<TelemetryAttributeValue, undefined>] => entry[1] !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function otlpValue(value: Exclude<TelemetryAttributeValue, undefined>): object {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return { doubleValue: value };
}

function millisecondsToNanoseconds(value: number): string {
  return (BigInt(Math.round(value * 1_000)) * 1_000n).toString();
}

function tracesEndpoint(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, "");
  return normalized.endsWith("/v1/traces") ? normalized : `${normalized}/v1/traces`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

async function defaultFetch(input: string, init: Parameters<OtlpFetch>[1]): Promise<OtlpFetchResponse> {
  return fetch(input, init);
}
