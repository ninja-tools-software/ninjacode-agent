import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

export type TelemetryAttributeValue = string | number | boolean | undefined;
export type TelemetryAttributes = Record<string, TelemetryAttributeValue>;
export type TelemetryScope = "run" | "session" | "turn" | "tool" | "subagent";

export interface TelemetryContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  runId?: string;
  sessionId?: string;
  turnId?: string;
  toolId?: string;
  subagentId?: string;
}

export interface TelemetryRecord extends TelemetryContext {
  name: string;
  startTime: number;
  endTime: number;
  attributes: TelemetryAttributes;
}

export interface TelemetrySpan {
  name: string;
  startTime: number;
  attributes: TelemetryAttributes;
  context: TelemetryContext;
  end: (extra?: TelemetryAttributes) => void;
}

export interface TelemetryExporter {
  export(span: TelemetryRecord): void | Promise<void>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface CreateTelemetryContextOptions {
  parent?: TelemetryContext;
  scope?: TelemetryScope;
  scopeId?: string;
  traceId?: string;
  identifiers?: Partial<Pick<TelemetryContext, "runId" | "sessionId" | "turnId" | "toolId" | "subagentId">>;
}

export interface StartSpanOptions {
  context?: TelemetryContext;
  scope?: TelemetryScope;
  scopeId?: string;
}

export type TelemetryRedactor = (attributes: TelemetryAttributes) => TelemetryAttributes;

const contextStorage = new AsyncLocalStorage<TelemetryContext | undefined>();
const sensitiveKey = /authorization|cookie|password|secret|token|api[-_]?key/i;
const sensitiveValue = /\b(?:bearer|basic)\s+\S+|(?:sk|key|token)[-_][a-z0-9_-]{12,}/gi;
const scopeIdKeys = {
  run: "runId",
  session: "sessionId",
  turn: "turnId",
  tool: "toolId",
  subagent: "subagentId",
} as const;

let enabled = process.env.NINJACODE_OTEL === "1";
let redactor: TelemetryRedactor = redactTelemetryAttributes;
let exporter: TelemetryExporter = {
  export(span) {
    process.stderr.write(`${JSON.stringify({ type: "otel.span", ...span })}\n`);
  },
};

/** Opt-in telemetry. No span is exported unless enabled explicitly or with NINJACODE_OTEL=1. */
export function configureTelemetry(
  options: { enabled?: boolean; exporter?: TelemetryExporter; redactor?: TelemetryRedactor } = {},
): void {
  if (options.enabled !== undefined) enabled = options.enabled;
  if (options.exporter) exporter = options.exporter;
  if (options.redactor) redactor = options.redactor;
}

export function createTelemetryContext(options: CreateTelemetryContextOptions = {}): TelemetryContext {
  const parent = options.parent;
  const context: TelemetryContext = {
    ...parent,
    ...options.identifiers,
    traceId: parent?.traceId ?? options.traceId ?? randomHex(16),
    spanId: randomHex(8),
    parentSpanId: parent?.spanId,
  };
  if (options.scope) context[scopeIdKeys[options.scope]] = options.scopeId ?? randomUUID();
  return context;
}

export function currentTelemetryContext(): TelemetryContext | undefined {
  return contextStorage.getStore();
}

export function runWithTelemetryContext<T>(context: TelemetryContext, operation: () => T): T {
  return contextStorage.run(context, operation);
}

export function injectTelemetryHeaders(
  context: TelemetryContext,
  headers: Record<string, string> = {},
): Record<string, string> {
  const baggage = serializeBaggage(context);
  return {
    ...headers,
    traceparent: `00-${context.traceId}-${context.spanId}-01`,
    ...(baggage ? { baggage } : {}),
  };
}

export function extractTelemetryContext(headers: Record<string, string | undefined>): TelemetryContext | undefined {
  const traceparent = headerValue(headers, "traceparent");
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i.exec(traceparent ?? "");
  if (!match?.[1] || !match[2]) return undefined;
  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    ...parseBaggage(headerValue(headers, "baggage")),
  };
}

export function startSpan(
  name: string,
  attributes: TelemetryAttributes = {},
  options: StartSpanOptions = {},
): TelemetrySpan {
  const startTime = Date.now();
  const parent = options.context ?? currentTelemetryContext();
  const scope = options.scope ?? scopeForSpan(name);
  const context = createTelemetryContext({
    parent,
    scope,
    scopeId: options.scopeId,
    identifiers: identifiersFromAttributes(attributes),
  });
  contextStorage.enterWith(context);
  let hasEnded = false;
  return {
    name,
    startTime,
    attributes: { ...attributes },
    context,
    end(extra = {}) {
      if (hasEnded) return;
      hasEnded = true;
      const current = currentTelemetryContext();
      if (current?.spanId === context.spanId || current?.parentSpanId === context.spanId) {
        contextStorage.enterWith(parent);
      }
      if (!enabled) return;
      exportSafely({
        ...context,
        name,
        startTime,
        endTime: Date.now(),
        attributes: redactor({ ...attributes, ...extra }),
      });
    },
  };
}

export async function flushTelemetry(): Promise<void> {
  await exporter.flush?.();
}

export async function shutdownTelemetry(): Promise<void> {
  await exporter.shutdown?.();
}

export function redactTelemetryAttributes(attributes: TelemetryAttributes): TelemetryAttributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactAttributeValue(value),
    ]),
  );
}

function exportSafely(record: TelemetryRecord): void {
  try {
    const result = exporter.export(record);
    if (result) void result.catch(() => undefined);
  } catch {
    // Telemetry must never interrupt an agent run.
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function scopeForSpan(name: string): TelemetryScope | undefined {
  if (name === "run" || name === "session" || name === "turn" || name === "tool" || name === "subagent") return name;
  return undefined;
}

function identifiersFromAttributes(attributes: TelemetryAttributes): CreateTelemetryContextOptions["identifiers"] {
  const identifiers: CreateTelemetryContextOptions["identifiers"] = {};
  for (const key of ["runId", "sessionId", "turnId", "toolId", "subagentId"] as const) {
    if (typeof attributes[key] === "string") identifiers[key] = attributes[key];
  }
  return identifiers;
}

function serializeBaggage(context: TelemetryContext): string {
  return (["runId", "sessionId", "turnId", "toolId", "subagentId"] as const)
    .flatMap((key) => context[key] ? [`ninjacode.${key}=${encodeURIComponent(context[key])}`] : [])
    .join(",");
}

function parseBaggage(value: string | undefined): Partial<TelemetryContext> {
  if (!value) return {};
  const identifiers: Partial<TelemetryContext> = {};
  for (const item of value.split(",")) {
    const [rawKey, rawValue] = item.trim().split("=", 2);
    const key = rawKey?.replace("ninjacode.", "");
    if (!rawValue || !isIdentifierKey(key)) continue;
    const decoded = decodeBaggageValue(rawValue);
    if (decoded) identifiers[key] = decoded;
  }
  return identifiers;
}

function isIdentifierKey(value: string | undefined): value is keyof Pick<TelemetryContext, "runId" | "sessionId" | "turnId" | "toolId" | "subagentId"> {
  return value === "runId" || value === "sessionId" || value === "turnId" || value === "toolId" || value === "subagentId";
}

function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}

function redactAttributeValue(value: TelemetryAttributeValue): TelemetryAttributeValue {
  if (typeof value !== "string") return value;
  return value.replace(sensitiveValue, "[REDACTED]");
}

function decodeBaggageValue(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
