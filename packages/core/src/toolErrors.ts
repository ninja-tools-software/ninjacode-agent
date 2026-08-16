import { ToolError, type Tool } from "@ninjacode/tools";

export type ToolErrorCategory =
  | "Unknown"
  | "InvalidArguments"
  | "UnexpectedEnvironment"
  | "ProviderError"
  | "UserAborted"
  | "Timeout"
  | "PermissionDenied"
  | "NotFound"
  | "CircuitOpen"
  | "BlockedByHook"
  | "StalePatch"
  | "AmbiguousEdit";

export interface ClassifiedToolError {
  category: ToolErrorCategory;
  message: string;
  retryable: boolean;
  blame: "model" | "user" | "tool" | "environment" | "provider" | "harness";
  recoveryHint: string;
}

const BY_TOOL_ERROR_CODE: Partial<
  Record<ToolError["code"], Omit<ClassifiedToolError, "message">>
> = {
  invalid_args: {
    category: "InvalidArguments",
    retryable: true,
    blame: "model",
    recoveryHint: "Correct the arguments before issuing a new tool call.",
  },
  not_found: {
    category: "NotFound",
    retryable: false,
    blame: "model",
    recoveryHint: "Verify the target exists before trying a different call.",
  },
  permission: {
    category: "PermissionDenied",
    retryable: false,
    blame: "user",
    recoveryHint: "Request the required permission or choose an allowed operation.",
  },
  timeout: {
    category: "Timeout",
    retryable: true,
    blame: "environment",
    recoveryHint: "Retry only when the operation is explicitly safe and idempotent.",
  },
  aborted: {
    category: "UserAborted",
    retryable: false,
    blame: "user",
    recoveryHint: "Stop unless the user explicitly asks to continue.",
  },
  stale_patch: {
    category: "StalePatch",
    retryable: true,
    blame: "model",
    recoveryHint: "Re-read the target and regenerate the edit from current content.",
  },
  ambiguous_edit: {
    category: "AmbiguousEdit",
    retryable: true,
    blame: "model",
    recoveryHint: "Add offsets or more unchanged context to identify one occurrence.",
  },
};

type MessageRule = {
  test: (lower: string, args?: Record<string, unknown>) => boolean;
  result: Omit<ClassifiedToolError, "message">;
};

function result(
  category: ToolErrorCategory,
  retryable: boolean,
  blame: ClassifiedToolError["blame"],
  recoveryHint: string,
): MessageRule["result"] {
  return { category, retryable, blame, recoveryHint };
}

const MESSAGE_RULES: MessageRule[] = [
  {
    test: (lower) => lower.includes("aborted"),
    result: result("UserAborted", false, "user", "Stop unless the user asks to continue."),
  },
  {
    test: (lower) => lower.includes("user denied"),
    result: result("PermissionDenied", false, "user", "Do not repeat a denied operation."),
  },
  {
    test: (lower) => lower.includes("timeout"),
    result: result("Timeout", true, "environment", "Retry only if the call is safe and idempotent."),
  },
  {
    test: (lower) => lower.includes("circuit-open") || lower.includes("circuit open"),
    result: result("CircuitOpen", false, "harness", "Use another tool or wait for the cooldown."),
  },
  {
    test: (lower) => lower.includes("blocked by") && lower.includes("hook"),
    result: result("BlockedByHook", false, "user", "Respect the hook feedback; do not repeat unchanged."),
  },
  {
    test: (lower) => lower.includes("denied") || lower.includes("permission"),
    result: result("PermissionDenied", false, "user", "Request permission or choose an allowed action."),
  },
  {
    test: (lower, args) => args?._truncated === true || lower.includes("truncated json"),
    result: result("InvalidArguments", true, "model", "Send a smaller, complete argument object."),
  },
  {
    test: (lower) =>
      lower.includes("invalid") ||
      lower.includes("old_string not found") ||
      lower.includes("hunk context not found") ||
      lower.includes("empty patch"),
    result: result("InvalidArguments", true, "model", "Correct the arguments before a new call."),
  },
  {
    test: (lower) => lower.includes("not found") || lower.includes("cannot read"),
    result: result("NotFound", false, "model", "Verify the target before trying another call."),
  },
  {
    test: (lower) => lower.includes("provider") || lower.includes("rate limit") || lower.includes("503"),
    result: result("ProviderError", true, "provider", "Retry with bounded backoff if the call is safe."),
  },
  {
    test: (lower) =>
      lower.includes("econnreset") ||
      lower.includes("eai_again") ||
      lower.includes("temporarily unavailable"),
    result: result("UnexpectedEnvironment", true, "environment", "Retry with bounded backoff if safe."),
  },
  {
    test: (lower) => lower.includes("unknown tool"),
    result: result("UnexpectedEnvironment", false, "harness", "Refresh the available tool list."),
  },
];

export function classifyToolFailure(
  toolName: string,
  error: unknown,
  args?: Record<string, unknown>,
): ClassifiedToolError {
  if (error instanceof ToolError) {
    const byCode = BY_TOOL_ERROR_CODE[error.code];
    if (byCode) return { ...byCode, message: error.message };
  }

  const msg = messageOf(error);
  const lower = msg.toLowerCase();
  for (const rule of MESSAGE_RULES) {
    if (rule.test(lower, args)) {
      return { ...rule.result, message: msg };
    }
  }

  return {
    category: "Unknown",
    message: `${toolName}: ${msg}`,
    retryable: false,
    blame: "tool",
    recoveryHint: "Inspect the error before choosing a different action.",
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return error === undefined || error === null ? "unknown error" : String(error);
}

interface ValidationState {
  root: Record<string, unknown>;
  visited: number;
}

interface ValidationCursor {
  path: string;
  depth: number;
}

const MAX_SCHEMA_DEPTH = 32;
const MAX_VALIDATION_NODES = 10_000;

/** Validate provider-supplied arguments before permission checks or execution. */
export function validateToolArguments(tool: Tool, args: Record<string, unknown>): void {
  if (args?._truncated === true) {
    throw new ToolError("Arguments contain truncated JSON and are incomplete.", "invalid_args");
  }
  const issue = validateSchema(
    tool.inputSchema,
    args,
    { root: tool.inputSchema, visited: 0 },
    { path: "$", depth: 0 },
  );
  if (issue) throw new ToolError(`Arguments for ${tool.name} do not match inputSchema: ${issue}`, "invalid_args");
}

function validateSchema(
  raw: unknown,
  value: unknown,
  state: ValidationState,
  cursor: ValidationCursor,
): string | undefined {
  state.visited += 1;
  if (state.visited > MAX_VALIDATION_NODES) return `${cursor.path} exceeds validation budget`;
  if (cursor.depth > MAX_SCHEMA_DEPTH) return `${cursor.path} exceeds schema depth limit`;
  if (raw === true) return undefined;
  if (raw === false) return `${cursor.path} is forbidden by the schema`;
  if (!isRecord(raw)) return `${cursor.path} has an invalid schema`;
  const schema = resolveReference(raw, state.root);
  if (!schema) return `${cursor.path} contains an unresolved $ref`;

  const combined = validateCombinators(schema, value, state, cursor);
  if (combined) return combined;
  const basic = validateBasicRules(schema, value, cursor.path);
  if (basic) return basic;
  return validateValue(schema, value, state, cursor);
}

function validateBasicRules(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
): string | undefined {
  if ("const" in schema && !jsonEqual(value, schema.const)) return `${path} must equal const`;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonEqual(item, value))) {
    return `${path} must be one of the allowed values`;
  }
  if (schema.type && !matchesType(schema.type, value)) {
    return `${path} must be ${Array.isArray(schema.type) ? schema.type.join(" or ") : String(schema.type)}`;
  }
  return undefined;
}

function validateValue(
  schema: Record<string, unknown>,
  value: unknown,
  state: ValidationState,
  cursor: ValidationCursor,
): string | undefined {
  if (Array.isArray(value)) return validateArray(schema, value, state, cursor);
  if (isRecord(value)) return validateObject(schema, value, state, cursor);
  const { path } = cursor;
  if (typeof value === "string") return validateString(schema, value, path);
  if (typeof value === "number") return validateNumber(schema, value, path);
  return undefined;
}

function validateCombinators(
  schema: Record<string, unknown>,
  value: unknown,
  state: ValidationState,
  cursor: ValidationCursor,
): string | undefined {
  const next = { path: cursor.path, depth: cursor.depth + 1 };
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const issue = validateSchema(branch, value, state, next);
      if (issue) return issue;
    }
  }
  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some((branch) => !validateSchema(branch, value, state, next));
    if (!valid) return `${cursor.path} must match at least one allowed schema`;
  }
  if (Array.isArray(schema.oneOf)) {
    const count = schema.oneOf.filter((branch) => !validateSchema(branch, value, state, next)).length;
    if (count !== 1) return `${cursor.path} must match exactly one allowed schema`;
  }
  return undefined;
}

function validateObject(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
  state: ValidationState,
  cursor: ValidationCursor,
): string | undefined {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && !Object.hasOwn(value, key)) return `${cursor.path}.${key} is required`;
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, child] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue;
    const issue = validateSchema(child, value[key], state, {
      path: `${cursor.path}.${key}`,
      depth: cursor.depth + 1,
    });
    if (issue) return issue;
  }
  if (schema.additionalProperties === false) {
    const extra = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
    if (extra) return `${cursor.path}.${extra} is not allowed`;
  }
  return undefined;
}

function validateArray(
  schema: Record<string, unknown>,
  value: unknown[],
  state: ValidationState,
  cursor: ValidationCursor,
): string | undefined {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    return `${cursor.path} has too few items`;
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    return `${cursor.path} has too many items`;
  }
  if (schema.items === undefined) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const issue = validateSchema(schema.items, value[index], state, {
      path: `${cursor.path}[${index}]`,
      depth: cursor.depth + 1,
    });
    if (issue) return issue;
  }
  return undefined;
}

function validateString(schema: Record<string, unknown>, value: string, path: string): string | undefined {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${path} is too short`;
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${path} is too long`;
  if (typeof schema.pattern === "string") {
    if (!isBoundedPattern(schema.pattern, value)) return `${path} exceeds safe pattern validation budget`;
    try {
      if (!new RegExp(schema.pattern, "u").test(value)) return `${path} does not match pattern`;
    } catch {
      return `${path} has an invalid schema pattern`;
    }
  }
  return undefined;
}

function isBoundedPattern(pattern: string, value: string): boolean {
  if (pattern.length > 256 || value.length > 4_096) return false;
  if (/\\[1-9]|\(\?/.test(pattern)) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  return !/\([^)]*\|[^)]*\)[+*{]/.test(pattern);
}

function validateNumber(schema: Record<string, unknown>, value: number, path: string): string | undefined {
  if (!Number.isFinite(value)) return `${path} must be finite`;
  if (typeof schema.minimum === "number" && value < schema.minimum) return `${path} is below minimum`;
  if (typeof schema.maximum === "number" && value > schema.maximum) return `${path} is above maximum`;
  return undefined;
}

function matchesType(expected: unknown, value: unknown): boolean {
  if (Array.isArray(expected)) return expected.some((type) => matchesType(type, value));
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return isRecord(value);
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === expected;
}

function resolveReference(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (typeof schema.$ref !== "string") return schema;
  if (!schema.$ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const rawPart of schema.$ref.slice(2).split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return isRecord(current) ? current : undefined;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface RetryOptIn {
  retryPolicy?: { idempotent?: boolean; maxAttempts?: number };
}

/** Same-call retries require explicit opt-in and a read-only effective risk. */
export function toolMaxAttempts(tool: Tool, args: Record<string, unknown>): number {
  const schemaPolicy = tool.inputSchema["x-ninjacode-retry"];
  const policy =
    (tool as Tool & RetryOptIn).retryPolicy ??
    (isRecord(schemaPolicy) ? schemaPolicy : undefined);
  if (policy?.idempotent !== true || tool.risk !== "read_only") return 1;
  try {
    const effectiveRisk = tool.riskFor?.(args);
    if (effectiveRisk && effectiveRisk !== "read_only") return 1;
  } catch {
    return 1;
  }
  const requested = typeof policy.maxAttempts === "number" ? policy.maxAttempts : 2;
  if (!Number.isFinite(requested)) return 1;
  return Math.min(3, Math.max(1, Math.floor(requested)));
}
