import { describe, expect, it } from "vitest";
import { ToolError } from "@ninjacode/tools";
import { classifyToolFailure } from "./toolErrors.js";

describe("classifyToolFailure", () => {
  it("uses the ToolError code rather than the message wording", () => {
    const classified = classifyToolFailure(
      "edit_file",
      new ToolError("something the heuristics cannot read", "invalid_args"),
    );
    expect(classified.category).toBe("InvalidArguments");
    expect(classified.retryable).toBe(true);
  });

  it("maps every code that carries a category", () => {
    const cases: Array<[ToolError["code"], string]> = [
      ["not_found", "NotFound"],
      ["permission", "PermissionDenied"],
      ["timeout", "Timeout"],
      ["aborted", "UserAborted"],
    ];
    for (const [code, category] of cases) {
      expect(classifyToolFailure("run_shell", new ToolError("x", code)).category).toBe(category);
    }
  });

  it("falls back to message heuristics for a runtime ToolError", () => {
    const classified = classifyToolFailure("run_shell", new ToolError("circuit-open", "runtime"));
    expect(classified.category).toBe("CircuitOpen");
  });

  it("classifies plain errors by message", () => {
    expect(classifyToolFailure("run_shell", new Error("Command aborted")).category).toBe(
      "UserAborted",
    );
    expect(classifyToolFailure("edit_file", "old_string not found").category).toBe(
      "InvalidArguments",
    );
    expect(classifyToolFailure("write_file", "blocked by PreToolUse hook").category).toBe(
      "BlockedByHook",
    );
  });

  it("treats truncated arguments as invalid args", () => {
    const classified = classifyToolFailure("apply_patch", new Error("weird failure"), {
      _truncated: true,
    });
    expect(classified.category).toBe("InvalidArguments");
    expect(classified.retryable).toBe(true);
  });

  it("prefixes the tool name when nothing matches", () => {
    const classified = classifyToolFailure("my_tool", undefined);
    expect(classified.category).toBe("Unknown");
    expect(classified.message).toBe("my_tool: unknown error");
  });
});
