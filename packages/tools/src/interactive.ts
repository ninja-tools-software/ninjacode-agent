import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { truncateForModel } from "./output.js";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export const todoWriteTool: Tool = {
  name: "todo_write",
  description: "Update the task list for the current agent session. Prefer merge=true.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      merge: { type: "boolean" },
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled"],
            },
          },
          required: ["id", "content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  target() {
    return "todos.json";
  },
  async execute(ctx, args): Promise<ToolResult> {
    const merge = args.merge !== false;
    const incoming = (args.todos as TodoItem[]) ?? [];
    const file = path.join(ctx.agentDir, "todos.json");
    await fs.mkdir(ctx.agentDir, { recursive: true });

    let todos: TodoItem[] = [];
    if (merge) {
      try {
        todos = JSON.parse(await fs.readFile(file, "utf8")) as TodoItem[];
      } catch {
        todos = [];
      }
      const byId = new Map(todos.map((t) => [t.id, t]));
      for (const t of incoming) byId.set(t.id, t);
      todos = [...byId.values()];
    } else {
      todos = incoming;
    }

    await fs.writeFile(file, JSON.stringify(todos, null, 2), "utf8");
    const summary = todos.map((t) => `[${t.status}] ${t.id}: ${t.content}`).join("\n");
    return { output: summary || "(empty todo list)", meta: { count: todos.length } };
  },
};

export function scratchpadFilename(sessionId?: string): string {
  const id = sessionId?.trim();
  if (!id) return "scratchpad.md";
  return `scratchpad.${id.replace(/[/\\]/g, "_")}.md`;
}

export const writeScratchpadTool: Tool = {
  name: "write_scratchpad",
  description:
    "Write durable notes to the current session's scratchpad (survives context compaction). " +
    "Defaults to a per-session file so notes from other chats are not injected.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Filename under .ninjacode/ (default: scratchpad.<sessionId>.md)",
      },
      content: { type: "string" },
      append: { type: "boolean" },
    },
    required: ["content"],
  },
  target(args) {
    return String(args.filename ?? "scratchpad.md");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const filename = String(args.filename ?? scratchpadFilename(ctx.sessionId)).replace(/[/\\]/g, "_");
    const content = String(args.content ?? "");
    const append = Boolean(args.append);
    await fs.mkdir(ctx.agentDir, { recursive: true });
    const file = path.join(ctx.agentDir, filename);
    if (append) {
      await fs.appendFile(file, content, "utf8");
    } else {
      await fs.writeFile(file, content, "utf8");
    }
    return { output: `Wrote scratchpad ${filename}`, meta: { path: file } };
  },
};

export interface AskUserOption {
  id: string;
  label: string;
}

export interface AskUserQuestion {
  id: string;
  prompt: string;
  options: AskUserOption[];
  allowMultiple?: boolean;
}

export interface AskUserRequest {
  questions: AskUserQuestion[];
}

export interface AskUserAnswer {
  questionId: string;
  /** Labels of the option(s) the user picked, if any. */
  selectedLabels?: string[];
  /** Free-form text the user typed (the "Other" answer). */
  freeText?: string;
}

export type AskUserHandler = (request: AskUserRequest) => Promise<AskUserAnswer[]>;

let askUserHandler: AskUserHandler | null = null;

export function setAskUserHandler(handler: AskUserHandler | null): void {
  askUserHandler = handler;
}

/** Normalize tool args (`questions` array) into AskUserRequest. */
export function parseAskUserArgs(args: Record<string, unknown>): AskUserRequest {
  const rawQuestions = Array.isArray(args.questions) ? (args.questions as unknown[]) : [];
  const questions: AskUserQuestion[] = rawQuestions.map((raw, i) => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const rawOptions = Array.isArray(q.options) ? (q.options as unknown[]) : [];
    const options: AskUserOption[] = rawOptions.map((o, j) => {
      if (typeof o === "string") return { id: `opt-${j + 1}`, label: o };
      const obj = (o ?? {}) as Record<string, unknown>;
      return {
        id: String(obj.id ?? `opt-${j + 1}`),
        label: String(obj.label ?? obj.id ?? ""),
      };
    });
    return {
      id: String(q.id ?? `q-${i + 1}`),
      prompt: String(q.prompt ?? q.question ?? ""),
      options,
      allowMultiple: Boolean(q.allow_multiple ?? q.allowMultiple),
    };
  });
  return { questions };
}

export function formatAskUserAnswers(request: AskUserRequest, answers: AskUserAnswer[]): string {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const lines: string[] = [];
  for (const q of request.questions) {
    const a = byId.get(q.id);
    const parts: string[] = [];
    if (a?.selectedLabels?.length) parts.push(a.selectedLabels.join(", "));
    if (a?.freeText?.trim()) parts.push(a.freeText.trim());
    lines.push(`Q: ${q.prompt}`);
    lines.push(`A: ${parts.length ? parts.join(" — ") : "(no answer)"}`);
  }
  return lines.join("\n");
}

export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the human one or more clarifying questions with clickable options. " +
    "Each question should include at least 2 options; the user can always type a free-form answer instead. " +
    "List options with the most relevant choice first — the UI marks the first option as (Recommended). " +
    "Set allow_multiple to true to let the user pick several options.",
  risk: "user",
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique identifier for this question" },
            prompt: { type: "string", description: "The question text, without the options" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                },
                required: ["id", "label"],
              },
            },
            allow_multiple: {
              type: "boolean",
              description: "If true, the user can select multiple options",
            },
          },
          required: ["id", "prompt", "options"],
        },
      },
    },
    required: ["questions"],
  },
  target(args) {
    const req = parseAskUserArgs(args);
    return req.questions.map((q) => q.prompt).join(" | ");
  },
  async execute(_ctx, args): Promise<ToolResult> {
    const request = parseAskUserArgs(args);
    if (!request.questions.length || !request.questions.some((q) => q.prompt.trim())) {
      throw new ToolError("ask_user requires at least one question with a prompt", "invalid_args");
    }
    if (!askUserHandler) {
      throw new ToolError("ask_user is not available in this surface", "runtime");
    }
    const answers = await askUserHandler(request);
    return {
      output: formatAskUserAnswers(request, answers),
      meta: { questionCount: request.questions.length },
    };
  },
};

export interface UserActionRequest {
  /** What the user must do manually. */
  action: string;
  /** Why the agent cannot do it itself. */
  reason?: string;
}

export interface UserActionResult {
  /** Optional note the user typed when resuming. */
  comment?: string;
}

export type UserActionHandler = (request: UserActionRequest) => Promise<UserActionResult>;

let userActionHandler: UserActionHandler | null = null;

export function setUserActionHandler(handler: UserActionHandler | null): void {
  userActionHandler = handler;
}

export const requestUserActionTool: Tool = {
  name: "request_user_action",
  description:
    "Pause the run and ask the human to perform a manual action you cannot or are not allowed to do " +
    "(e.g. log into a service, plug in a device, run a privileged command, click something in an external UI). " +
    "The run stays paused until the user confirms the action is done; their optional comment is returned to you.",
  risk: "user",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Clear, concrete description of what the user must do manually",
      },
      reason: {
        type: "string",
        description: "Why this needs to be done by the user (e.g. missing permission)",
      },
    },
    required: ["action"],
  },
  target(args) {
    return String(args.action ?? "");
  },
  async execute(_ctx, args): Promise<ToolResult> {
    const action = String(args.action ?? "").trim();
    if (!action) {
      throw new ToolError("request_user_action requires an action description", "invalid_args");
    }
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    if (!userActionHandler) {
      throw new ToolError("request_user_action is not available in this surface", "runtime");
    }
    const result = await userActionHandler({ action, reason });
    const comment = result.comment?.trim();
    return {
      output: comment
        ? `User confirmed the action is done. Comment: ${comment}`
        : "User confirmed the action is done.",
      meta: { action },
    };
  },
};

export const fetchUrlTool: Tool = {
  name: "fetch_url",
  description: "Fetch a URL and return text content. HTML is converted to readable text.",
  risk: "network",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      max_chars: { type: "number" },
    },
    required: ["url"],
  },
  target(args) {
    return String(args.url ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const url = String(args.url ?? "");
    const max = typeof args.max_chars === "number" ? args.max_chars : 20_000;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ToolError(`Invalid URL: ${url}`, "invalid_args");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new ToolError(`Unsupported protocol: ${parsed.protocol}`, "invalid_args");
    }

    let res: Response;
    try {
      res = await fetch(url, {
        signal: ctx.signal ?? AbortSignal.timeout(30_000),
        redirect: "follow",
        headers: { "User-Agent": "NinjaCode/0.1 (+https://ninjacode.dev)" },
      });
    } catch (e) {
      throw new ToolError(`Fetch failed: ${(e as Error).message}`, "runtime");
    }

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    let text = raw;
    if (contentType.includes("html") || /^\s*</.test(raw)) {
      text = htmlToText(raw);
    }
    return {
      output: `status: ${res.status}\ncontent-type: ${contentType}\n\n${truncateForModel(text, max)}`,
      meta: { status: res.status, url, contentType, chars: text.length },
    };
  },
};

function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<(br|p|div|h[1-6]|li|tr)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
