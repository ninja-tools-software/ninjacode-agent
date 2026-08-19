import { parseRetryAfterMs } from "./retryAfter.js";
import { LlmError } from "./types.js";

/**
 * Anthropic reports the interesting part of a failure in a typed body, not in the
 * HTTP status: an overloaded API and a malformed request both arrive as errors
 * the retry logic must tell apart. Mapping the type to a status is what makes
 * `withRetry` treat an overload as transient and a bad request as final.
 */
const STATUS_BY_ERROR_TYPE: Readonly<Record<string, number>> = Object.freeze({
  overloaded_error: 529,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  invalid_request_error: 400,
});

interface AnthropicErrorDetail {
  type?: string;
  message?: string;
}

export function parseAnthropicErrorDetail(body: string): AnthropicErrorDetail {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return {};
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== "object" || error === null) return {};
    const { type, message } = error as AnthropicErrorDetail;
    return {
      type: typeof type === "string" ? type : undefined,
      message: typeof message === "string" ? message : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The typed error wins over the transport status: a 200 stream that ends in an
 * `overloaded_error` is as retryable as a 529, and `invalid_request_error` is
 * final whatever status carried it.
 */
export function anthropicErrorStatus(type: string | undefined, fallback?: number): number | undefined {
  if (type && type in STATUS_BY_ERROR_TYPE) return STATUS_BY_ERROR_TYPE[type];
  return fallback;
}

/** Context window overflow is never worth retrying with the same messages. */
export function isAnthropicContextOverflow(detail: AnthropicErrorDetail): boolean {
  const message = detail.message ?? "";
  return (
    detail.type === "invalid_request_error" &&
    /(context|prompt)[^.]*(too long|too large|exceed)|max(imum)?_tokens/iu.test(message)
  );
}

export function anthropicHttpError(opts: {
  status: number;
  body: string;
  retryAfter?: string | null;
}): LlmError {
  const detail = parseAnthropicErrorDetail(opts.body);
  const status = anthropicErrorStatus(detail.type, opts.status);
  const suffix = isAnthropicContextOverflow(detail)
    ? " — compact the conversation or lower maxTokens before retrying"
    : "";
  const summary = detail.message ?? opts.body;
  return new LlmError(
    `anthropic error ${status}${detail.type ? ` (${detail.type})` : ""}: ${summary}${suffix}`,
    status,
    "anthropic",
    parseRetryAfterMs(opts.retryAfter),
  );
}
