import { LlmError } from "./types.js";

export type GatewayErrorCode =
  | "insufficient_credits"
  | "rate_limited"
  | "model_not_priced"
  | "model_not_in_catalog"
  | "account_suspended"
  | "unauthorized"
  | "upstream_timeout";

const KNOWN_CODES = new Set<string>([
  "insufficient_credits",
  "rate_limited",
  "model_not_priced",
  "model_not_in_catalog",
  "account_suspended",
  "unauthorized",
]);

const TERMINAL_CODES = new Set<GatewayErrorCode>([
  "insufficient_credits",
  "model_not_priced",
  "model_not_in_catalog",
  "account_suspended",
  "unauthorized",
]);

export interface GatewayErrorInfo {
  code: GatewayErrorCode;
  renewsAt?: string;
  planTier?: string;
  model?: string;
  catalog?: string;
  /** Output already reached the user: the answer above is truncated. */
  partial?: boolean;
}

export class GatewayError extends LlmError {
  readonly code: GatewayErrorCode;
  readonly renewsAt?: string;
  readonly planTier?: string;
  readonly model?: string;
  readonly catalog?: string;
  readonly partial?: boolean;

  constructor(
    code: GatewayErrorCode,
    message: string,
    opts: {
      status?: number;
      provider?: string;
      renewsAt?: string;
      planTier?: string;
      model?: string;
      catalog?: string;
      partial?: boolean;
    } = {},
  ) {
    super(message, opts.status, opts.provider);
    this.name = "GatewayError";
    this.code = code;
    this.renewsAt = opts.renewsAt;
    this.planTier = opts.planTier;
    this.model = opts.model;
    this.catalog = opts.catalog;
    this.partial = opts.partial;
  }
}

interface GatewayErrorBody {
  error?: unknown;
  message?: unknown;
  renewsAt?: unknown;
  planTier?: unknown;
  model?: unknown;
  catalog?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractJsonObject(raw: string): GatewayErrorBody | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as GatewayErrorBody;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as GatewayErrorBody;
    } catch {
      return null;
    }
  }
}

function resolveCode(errorField: unknown, raw: string): GatewayErrorCode | null {
  if (typeof errorField === "string" && KNOWN_CODES.has(errorField)) {
    return errorField as GatewayErrorCode;
  }
  const trimmed = raw.trim();
  if (KNOWN_CODES.has(trimmed)) return trimmed as GatewayErrorCode;
  if (/idle timeout/i.test(raw)) return "upstream_timeout";
  if (typeof errorField === "string" && /idle timeout/i.test(errorField)) {
    return "upstream_timeout";
  }
  return null;
}

function defaultMessage(code: GatewayErrorCode, body: GatewayErrorBody): string {
  const fromBody = asString(body.message);
  if (fromBody) return fromBody;
  switch (code) {
    case "insufficient_credits":
      return "insufficient_credits";
    case "rate_limited":
      return "rate_limited";
    case "model_not_priced":
      return body.model ? `model_not_priced: ${String(body.model)}` : "model_not_priced";
    case "model_not_in_catalog":
      return body.model ? `model_not_in_catalog: ${String(body.model)}` : "model_not_in_catalog";
    case "account_suspended":
      return "account_suspended";
    case "unauthorized":
      return "unauthorized";
    case "upstream_timeout":
      return asString(body.error) ?? "Upstream idle timeout";
  }
}

/**
 * Parse a gateway error payload into a typed GatewayError.
 * Returns null when the payload is not a typed gateway error (e.g. a 502 passthrough).
 */
export function parseGatewayError(
  raw: string,
  opts: { status?: number; provider?: string; partial?: boolean } = {},
): GatewayError | null {
  const body = extractJsonObject(raw) ?? {};
  const code = resolveCode(body.error, raw);
  if (!code) return null;
  return new GatewayError(code, defaultMessage(code, body), {
    status: opts.status,
    provider: opts.provider,
    renewsAt: asString(body.renewsAt),
    planTier: asString(body.planTier),
    model: asString(body.model),
    catalog: asString(body.catalog),
    partial: opts.partial,
  });
}

export function isTerminalGatewayCode(code: GatewayErrorCode): boolean {
  return TERMINAL_CODES.has(code);
}

/** Serializable DTO for agent events / UI surfaces. */
export function gatewayErrorInfo(error: unknown): GatewayErrorInfo | undefined {
  if (!(error instanceof GatewayError)) return undefined;
  return {
    code: error.code,
    renewsAt: error.renewsAt,
    planTier: error.planTier,
    model: error.model,
    catalog: error.catalog,
    partial: error.partial,
  };
}
