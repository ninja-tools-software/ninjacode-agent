import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MockProvider } from "@ninjacode/providers";
import type { AgentFactory, SubAgentSpawnOptions } from "./agentFactory.js";
import {
  INDEPENDENT_VERIFIER_SCHEMA_VERSION,
  parseIndependentVerifierVerdict,
  runVerificationSubAgent,
} from "./agentSupport.js";
import { SubAgentOrchestrator } from "./subagentOrchestrator.js";
import type { VerificationResult } from "./verify.js";
import { BudgetTracker } from "./reliability.js";

function localVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    ok: true,
    messages: [],
    diagnostics: { checked: true, entries: [] },
    commands: [{
      command: "pnpm test",
      exitCode: 0,
      passed: true,
      output: "tests passed",
    }],
    ambiguous: false,
    ...overrides,
  };
}

const lgtm = JSON.stringify({
  schemaVersion: INDEPENDENT_VERIFIER_SCHEMA_VERSION,
  lgtm: true,
  issues: [],
  missingTests: [],
  evidence: ["targeted tests passed"],
  confidence: 0.92,
});

describe("independent verifier", () => {
  it("passes only bounded implementation evidence and never the parent response", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-verifier-private-"));
    try {
      await fs.mkdir(path.join(workspaceRoot, "src"));
      await fs.writeFile(path.join(workspaceRoot, "src/fix.ts"), "export const fixed = true;\n");
      let spawned: SubAgentSpawnOptions | undefined;
      let childTask = "";
      const parentResponse = "PARENT_FINAL_SECRET_DO_NOT_TRANSMIT";
      const createAgent: AgentFactory = (options) => {
        spawned = options;
        return {
          run: async (task) => {
            childTask = task;
            return { answer: lgtm, completed: true };
          },
        };
      };

      const result = await runVerificationSubAgent({
        provider: new MockProvider(),
        workspaceRoot,
        agentDir: path.join(workspaceRoot, ".ninjacode"),
        signal: new AbortController().signal,
        modifiedFiles: new Set(["src/fix.ts"]),
        verification: localVerification(),
        mode: "blind",
        verifier: {
          maxRunCostRatio: 0.1,
          maxCostUsd: 0.2,
          maxTurns: 3,
          timeoutMs: 5_000,
          maxDiffChars: 2_000,
        },
        utilityModel: "economy-test-model",
        budget: new BudgetTracker(),
        createAgent,
        orchestrator: new SubAgentOrchestrator(),
      });

      expect(result).toMatchObject({
        invoked: true,
        trigger: "blind",
        verdict: { lgtm: true, confidence: 0.92 },
      });
      expect(childTask).toContain("src/fix.ts");
      expect(childTask).toContain("tests passed");
      expect(childTask).not.toContain(parentResponse);
      expect(childTask.length).toBeLessThan(10_000);
      expect(spawned).toMatchObject({
        model: "economy-test-model",
        maxTurns: 3,
        runTimeoutMs: 5_000,
        budget: { maxCostUsd: 0.2 },
        sandboxMode: "read-only",
        enableSubagents: false,
      });
      expect(spawned?.tools.names()).toEqual([]);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("skips the LLM in adaptive mode for a trivial mutation with clean local signals", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-verifier-adaptive-"));
    try {
      await fs.writeFile(path.join(workspaceRoot, "small.ts"), "export const value = 1;\n");
      const createAgent: AgentFactory = () => {
        throw new Error("adaptive verifier should not have been spawned");
      };
      const result = await runVerificationSubAgent({
        provider: new MockProvider(),
        workspaceRoot,
        agentDir: path.join(workspaceRoot, ".ninjacode"),
        signal: new AbortController().signal,
        modifiedFiles: new Set(["small.ts"]),
        verification: localVerification(),
        mode: "adaptive",
        verifier: {
          maxRunCostRatio: 0.1,
          maxCostUsd: 0.1,
          maxTurns: 2,
          timeoutMs: 2_000,
          maxDiffChars: 2_000,
        },
        budget: new BudgetTracker(),
        createAgent,
        orchestrator: new SubAgentOrchestrator(),
      });

      expect(result.invoked).toBe(false);
      expect(result.verdict).toBeUndefined();
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("invokes the adaptive verifier after a local failure", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-verifier-failure-"));
    try {
      await fs.writeFile(path.join(workspaceRoot, "small.ts"), "export const value = 1;\n");
      const createAgent: AgentFactory = () => ({
        run: async () => ({ answer: lgtm, completed: true }),
      });
      const result = await runVerificationSubAgent({
        provider: new MockProvider(),
        workspaceRoot,
        agentDir: path.join(workspaceRoot, ".ninjacode"),
        signal: new AbortController().signal,
        modifiedFiles: new Set(["small.ts"]),
        verification: localVerification({
          ok: false,
          messages: ["typecheck failed"],
          commands: [{
            command: "pnpm typecheck",
            exitCode: 1,
            passed: false,
            output: "TS2322",
          }],
        }),
        mode: "adaptive",
        verifier: {
          maxRunCostRatio: 0.1,
          maxCostUsd: 0.1,
          maxTurns: 2,
          timeoutMs: 2_000,
          maxDiffChars: 2_000,
        },
        budget: new BudgetTracker(),
        createAgent,
        orchestrator: new SubAgentOrchestrator(),
      });

      expect(result).toMatchObject({ invoked: true, trigger: "local_failure" });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("validates and normalizes the versioned verdict", () => {
    expect(parseIndependentVerifierVerdict(lgtm)).toMatchObject({
      schemaVersion: "1.0",
      lgtm: true,
      issues: [],
      missingTests: [],
    });
    expect(parseIndependentVerifierVerdict("LGTM")).toMatchObject({
      lgtm: false,
      confidence: 0,
      issues: [{ summary: "Verifier returned malformed JSON." }],
    });
    expect(parseIndependentVerifierVerdict(JSON.stringify({
      schemaVersion: "1.0",
      lgtm: true,
      issues: [],
      missingTests: ["regression test"],
      evidence: [],
      confidence: 2,
    }))).toMatchObject({
      lgtm: false,
      missingTests: ["regression test"],
      confidence: 1,
    });
  });
});
