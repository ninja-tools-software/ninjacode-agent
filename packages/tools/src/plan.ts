import type { Tool, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { planIdForSession, resolvePlanFile, writePlan } from "./plans.js";

export const writePlanTool: Tool = {
  name: "write_plan",
  description:
    "Create or update the implementation plan for the current session. " +
    "Always overwrites the session's existing plan — there is exactly one plan per session, never create a second one. " +
    "In PLAN mode the harness ends the run after a successful write_plan; later user messages can call it again to overwrite.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short descriptive title for the plan",
      },
      content: {
        type: "string",
        description: "Full plan body in markdown (headings, steps, file lists, diagrams)",
      },
    },
    required: ["title", "content"],
  },
  target() {
    return "plan";
  },
  async execute(ctx, args): Promise<ToolResult> {
    const sessionId = ctx.sessionId?.trim();
    if (!sessionId) {
      throw new ToolError("write_plan requires an active session", "runtime");
    }
    const title = String(args.title ?? "").trim();
    const content = String(args.content ?? "");
    if (!title) {
      throw new ToolError("write_plan requires a non-empty title", "invalid_args");
    }
    if (!content.trim()) {
      throw new ToolError("write_plan requires non-empty content", "invalid_args");
    }
    const planId = ctx.planId?.trim() || planIdForSession(sessionId);
    const existing = await resolvePlanFile(ctx.agentDir, planId);
    const record = await writePlan(ctx.agentDir, { planId, sessionId, title, content });
    return {
      output: `Wrote plan "${record.title}" to ${record.relPath}`,
      meta: {
        planId: record.id,
        path: record.file,
        relPath: record.relPath,
        title: record.title,
        created: !existing,
      },
    };
  },
};
