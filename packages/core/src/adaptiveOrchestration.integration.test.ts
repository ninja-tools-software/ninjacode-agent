import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MockProvider } from "@ninjacode/providers";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import { Agent } from "./agent.js";
import { defaultPermissionPolicy, PermissionEngine } from "./permissions.js";
import type { AgentEvent } from "./types.js";

describe("adaptive orchestration integration", () => {
  it("launches one governed read-only planner for independent areas and records phases", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-adaptive-"));
    try {
      await fs.mkdir(path.join(workspaceRoot, "packages/core"), { recursive: true });
      await fs.mkdir(path.join(workspaceRoot, "packages/tools"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, "packages/core/a.ts"), "export const a = 1;\n");
      await fs.writeFile(path.join(workspaceRoot, "packages/tools/b.ts"), "export const b = 2;\n");

      const provider = new MockProvider([
        {
          text: "Inspect core.",
          toolCalls: [{
            id: "read-core",
            name: "read_file",
            arguments: { path: "packages/core/a.ts" },
          }],
        },
        {
          text: "Inspect tools.",
          toolCalls: [{
            id: "read-tools",
            name: "read_file",
            arguments: { path: "packages/tools/b.ts" },
          }],
        },
        { text: "Planner evidence: the two modules can be updated through one shared contract." },
        { text: "Used the bounded planner evidence and completed the assessment." },
      ]);
      const tools = createDefaultToolRegistry();
      const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
      permissions.update({ allowlist: tools.names() });
      const events: AgentEvent[] = [];
      const agent = new Agent({
        provider,
        tools,
        permissions,
        workspaceRoot,
        agentDir: path.join(workspaceRoot, ".ninjacode"),
        maxTurns: 8,
        enableCheckpoints: false,
        persistSessions: false,
        enableCompletionVerification: false,
        enableVerificationSubAgent: false,
        enableSubagents: true,
        orchestrationProfile: "adaptive",
        adaptiveOrchestration: { maxAutomaticDelegations: 1 },
        subagentGovernance: {
          maxConcurrency: 1,
          maxCostUsd: 0.05,
          maxTurns: 2,
          timeoutMs: 5_000,
        },
        trajectory: { enabled: true },
        onEvent: (event) => {
          events.push(event);
        },
      });

      const outcome = await agent.run("Assess the integration across the core and tools modules.");

      expect(outcome.completed).toBe(true);
      expect(events.filter((event) => event.type === "subagent_start")).toHaveLength(1);
      expect(events.filter((event) => event.type === "subagent_end")).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({
        type: "phase_change",
        payload: expect.objectContaining({ phase: "explore", complexity: "complex" }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: "phase_change",
        payload: expect.objectContaining({ phase: "verify", reason: "completion" }),
      }));
      expect(outcome.trajectory?.events.some((event) => event.type === "phase")).toBe(true);
      expect(outcome.trajectory?.events.filter((event) => event.type === "subagent")).toHaveLength(1);
      expect(
        outcome.turns.flatMap((turn) => turn.toolInvocations).map((invocation) => invocation.toolCall.name),
      ).toEqual(["read_file", "read_file"]);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("allows at most two correction-verification cycles, then fails deterministically", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-adaptive-verify-"));
    const agentDir = path.join(workspaceRoot, ".ninjacode");
    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "verify.json"),
        JSON.stringify({
          requireCleanDiagnostics: false,
          commands: ['node -e "process.exit(1)"'],
        }),
      );
      const provider = new MockProvider([
        {
          text: "Apply the fix.",
          toolCalls: [{
            id: "write-one",
            name: "write_file",
            arguments: { path: "result.txt", content: "first\n" },
          }],
        },
        { text: "The first fix is complete." },
        {
          text: "Use the single recovery cycle.",
          toolCalls: [{
            id: "write-two",
            name: "write_file",
            arguments: { path: "result.txt", content: "second\n" },
          }],
        },
        { text: "The correction is complete." },
      ]);
      const tools = createDefaultToolRegistry();
      const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
      permissions.update({ allowlist: tools.names() });
      const events: AgentEvent[] = [];
      const agent = new Agent({
        provider,
        tools,
        permissions,
        workspaceRoot,
        agentDir,
        maxTurns: 6,
        enableCheckpoints: false,
        persistSessions: false,
        enableSubagents: false,
        enableVerificationSubAgent: false,
        sandboxMode: "danger-full-access",
        orchestrationProfile: "adaptive",
        onEvent: (event) => {
          events.push(event);
        },
      });

      const outcome = await agent.run("Create result.txt and verify it.");

      expect(outcome.completed).toBe(false);
      expect(outcome.answer).toContain("two adaptive correction-verification cycles");
      expect(events.filter((event) =>
        event.type === "phase_change" &&
        (event.payload as { phase?: string }).phase === "recover"
      )).toHaveLength(2);
      expect(events).toContainEqual(expect.objectContaining({
        type: "error",
        payload: expect.objectContaining({ category: "verification_recovery_exhausted" }),
      }));
      expect(await fs.readFile(path.join(workspaceRoot, "result.txt"), "utf8")).toBe("second\n");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
