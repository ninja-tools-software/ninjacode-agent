import { ToolError } from "@ninjacode/tools";

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
  | "BlockedByHook";

export interface ClassifiedToolError {
  category: ToolErrorCategory;
  message: string;
  retryable: boolean;
}

const BY_TOOL_ERROR_CODE: Partial<
  Record<ToolError["code"], Omit<ClassifiedToolError, "message">>
> = {
  invalid_args: { category: "InvalidArguments", retryable: true },
  not_found: { category: "NotFound", retryable: false },
  permission: { category: "PermissionDenied", retryable: false },
  timeout: { category: "Timeout", retryable: true },
  aborted: { category: "UserAborted", retryable: false },
};

type MessageRule = {
  test: (lower: string, args?: Record<string, unknown>) => boolean;
  category: ToolErrorCategory;
  retryable: boolean;
};

const MESSAGE_RULES: MessageRule[] = [
  {
    test: (lower) => lower.includes("aborted"),
    category: "UserAborted",
    retryable: false,
  },
  {
    test: (lower) => lower.includes("user denied"),
    category: "PermissionDenied",
    retryable: false,
  },
  { test: (lower) => lower.includes("timeout"), category: "Timeout", retryable: true },
  {
    test: (lower) => lower.includes("circuit-open") || lower.includes("circuit open"),
    category: "CircuitOpen",
    retryable: false,
  },
  {
    test: (lower) => lower.includes("blocked by") && lower.includes("hook"),
    category: "BlockedByHook",
    retryable: false,
  },
  {
    test: (lower) => lower.includes("denied") || lower.includes("permission"),
    category: "PermissionDenied",
    retryable: false,
  },
  {
    test: (lower, args) => args?._truncated === true || lower.includes("truncated json"),
    category: "InvalidArguments",
    retryable: true,
  },
  {
    test: (lower) =>
      lower.includes("invalid") ||
      lower.includes("old_string not found") ||
      lower.includes("hunk context not found") ||
      lower.includes("empty patch"),
    category: "InvalidArguments",
    retryable: true,
  },
  {
    test: (lower) => lower.includes("not found") || lower.includes("cannot read"),
    category: "NotFound",
    retryable: false,
  },
  {
    test: (lower) => lower.includes("provider") || lower.includes("rate limit") || lower.includes("503"),
    category: "ProviderError",
    retryable: true,
  },
  {
    test: (lower) => lower.includes("unknown tool"),
    category: "UnexpectedEnvironment",
    retryable: false,
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
      return { category: rule.category, message: msg, retryable: rule.retryable };
    }
  }

  return { category: "Unknown", message: `${toolName}: ${msg}`, retryable: false };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return error === undefined || error === null ? "unknown error" : String(error);
}
