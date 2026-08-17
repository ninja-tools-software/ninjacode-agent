import { describe, expect, it } from "vitest";
import type { ToolInvocation } from "./types.js";
import {
  classifyTaskComplexity,
  createPhasePolicyState,
  enterVerificationPhase,
  explorationBudgetFor,
  markAutomaticDelegation,
  observePhaseTurn,
  recordVerificationFailure,
  takeInitialPhaseTransition,
} from "./phasePolicy.js";

function invocation(
  name: string,
  args: Record<string, unknown> = {},
  opts: { error?: string; output?: string; meta?: Record<string, unknown> } = {},
): ToolInvocation {
  return {
    toolCall: { id: `${name}-id`, name, arguments: args },
    approved: true,
    durationMs: 1,
    output: opts.output ?? "ok",
    error: opts.error,
    meta: opts.meta,
  };
}

describe("adaptive phase policy", () => {
  it("classifies task complexity and keeps exploration inside maxTurns", () => {
    expect(classifyTaskComplexity("Fix src/a.ts")).toBe("simple");
    expect(
      classifyTaskComplexity(
        "Implement and wire packages/core/src/a.ts, packages/tools/src/b.ts, apps/cli/src/c.ts with integration tests",
      ),
    ).toBe("complex");
    expect(explorationBudgetFor("complex", 6, 1.5)).toBe(4);
  });

  it("moves deterministically from explore to execute and verify", () => {
    const state = createPhasePolicyState({
      task: "Fix src/a.ts",
      maxTurns: 20,
      goal: "edit",
    });
    expect(takeInitialPhaseTransition(state)).toMatchObject({ to: "explore", turn: 0 });
    expect(takeInitialPhaseTransition(state)).toBeUndefined();

    const edit = observePhaseTurn(state, [invocation("edit_file", { path: "src/a.ts" })], 2);
    expect(edit.transition).toMatchObject({ from: "explore", to: "execute" });

    const verify = observePhaseTurn(
      state,
      [invocation("run_shell", { command: "pnpm test" }, { meta: { exitCode: 0 } })],
      3,
    );
    expect(verify.transition).toMatchObject({ from: "execute", to: "verify" });
  });

  it("uses an adaptive exploration budget instead of late nudges", () => {
    const state = createPhasePolicyState({
      task: "Fix the typo",
      maxTurns: 64,
      goal: "edit",
      options: { automaticDelegation: false },
    });
    expect(state.explorationBudget).toBe(3);

    const decision = observePhaseTurn(state, [invocation("read_file", { path: "src/a.ts" })], 3);
    expect(decision.transition).toMatchObject({
      from: "explore",
      to: "execute",
      reason: "exploration_budget_exhausted",
    });
    expect(decision.guidance).toContain("budget 3");
  });

  it("counts shell rereads of the same artefact path", () => {
    const state = createPhasePolicyState({
      task: "Write image.c",
      maxTurns: 20,
      goal: "edit",
      options: { automaticDelegation: false },
    });
    observePhaseTurn(state, [invocation("run_shell", { command: "python3 -c 'print(1)' image.ppm" })], 1);
    expect(state.rereadCount).toBe(0);
    observePhaseTurn(state, [invocation("run_shell", { command: "head image.ppm" })], 2);
    expect(state.rereadCount).toBe(1);
    expect(state.readTargets["image.ppm"]).toBe(2);
  });

  it("delegates only on justified signals and respects the parent ceiling", () => {
    const state = createPhasePolicyState({
      task: "Refactor integration wiring",
      maxTurns: 40,
      goal: "edit",
      options: { maxAutomaticDelegations: 1 },
    });

    observePhaseTurn(state, [invocation("read_file", { path: "packages/core/src/a.ts" })], 1);
    const decision = observePhaseTurn(
      state,
      [invocation("read_file", { path: "packages/tools/src/b.ts" })],
      2,
    );
    expect(decision.delegation).toEqual({ role: "planner", reason: "independent_areas" });

    markAutomaticDelegation(state);
    expect(
      observePhaseTurn(state, [invocation("read_file", { path: "apps/cli/src/c.ts" })], 3).delegation,
    ).toBeUndefined();
  });

  it("recovers from classified tool errors without unchanged retries", () => {
    const state = createPhasePolicyState({
      task: "Fix src/a.ts",
      maxTurns: 20,
      goal: "edit",
    });
    const failure = observePhaseTurn(
      state,
      [invocation("run_shell", {}, { error: "timeout", output: "Tool error [Timeout]" })],
      1,
    );
    expect(failure.transition).toMatchObject({ to: "recover", reason: "tool_Timeout" });
    expect(failure.guidance).toContain("narrow the operation");

    const recovered = observePhaseTurn(
      state,
      [invocation("read_file", { path: "src/a.ts" })],
      2,
    );
    expect(recovered.transition).toMatchObject({ from: "recover", to: "explore" });
  });

  it("closes exploration on NotFound at the budget and does not reopen it", () => {
    const state = createPhasePolicyState({
      task: "Fix the typo",
      maxTurns: 64,
      goal: "edit",
      options: { automaticDelegation: false },
    });
    observePhaseTurn(state, [invocation("read_file", { path: "src/a.ts" })], 1);
    expect(state.explorationBudget).toBe(3);
    expect(state.explorationClosed).toBe(false);
    const missing = observePhaseTurn(
      state,
      [invocation("read_file", { path: "missing.ts" }, { error: "Cannot read missing.ts", meta: { error: { category: "NotFound" } } })],
      3,
    );
    expect(state.explorationBudget).toBe(3);
    expect(state.explorationClosed).toBe(true);
    expect(missing.transition).toMatchObject({ to: "recover", reason: "tool_NotFound" });

    const recovered = observePhaseTurn(state, [invocation("read_file", { path: "src/a.ts" })], 4);
    expect(recovered.transition).toMatchObject({ from: "recover", to: "execute" });
    expect(state.phase).toBe("execute");
  });

  it("returns to execute, never explore, after NotFound/success alternation once the budget is closed", () => {
    const state = createPhasePolicyState({
      task: "Fix the typo",
      maxTurns: 64,
      goal: "edit",
      options: { automaticDelegation: false },
    });
    const missing = (turn: number) =>
      observePhaseTurn(
        state,
        [invocation("read_file", { path: "src/a.ts" }, { error: "Cannot read src/a.ts", meta: { error: { category: "NotFound" } } })],
        turn,
      );

    expect(missing(1).transition).toMatchObject({ to: "recover", reason: "tool_NotFound" });
    expect(state.explorationClosed).toBe(false);
    expect(observePhaseTurn(state, [invocation("read_file", { path: "src/a.ts" })], 2).transition).toMatchObject({
      from: "recover",
      to: "explore",
    });

    expect(missing(3).transition).toMatchObject({ to: "recover", reason: "tool_NotFound" });
    expect(state.explorationClosed).toBe(true);
    expect(observePhaseTurn(state, [invocation("read_file", { path: "src/a.ts" })], 4).transition).toMatchObject({
      from: "recover",
      to: "execute",
    });
    expect(state.phase).toBe("execute");
  });

  it("does not recover from a successful shell whose output mentions not found", () => {
    const state = createPhasePolicyState({
      task: "Fix src/a.ts",
      maxTurns: 20,
      goal: "edit",
      options: { automaticDelegation: false },
    });
    const decision = observePhaseTurn(
      state,
      [
        invocation("run_shell", { command: "which gcc python3" }, {
          output: "gcc not found\n/usr/bin/python3",
          meta: { exitCode: 0, error: { category: "NotFound" } },
        }),
      ],
      1,
    );
    expect(decision.transition).toBeUndefined();
    expect(state.phase).toBe("explore");
  });

  it("raises the exploration budget when independent areas make the task complex", () => {
    const state = createPhasePolicyState({
      task: "Fix the typo",
      maxTurns: 64,
      goal: "edit",
      options: { automaticDelegation: false },
    });
    expect(state.explorationBudget).toBe(3);
    observePhaseTurn(state, [invocation("read_file", { path: "packages/core/src/a.ts" })], 1);
    observePhaseTurn(state, [invocation("read_file", { path: "packages/tools/src/b.ts" })], 2);
    expect(state.complexity).toBe("complex");
    expect(state.explorationBudget).toBe(9);
  });

  it("allows at most two correction-verification cycles", () => {
    const state = createPhasePolicyState({
      task: "Fix src/a.ts",
      maxTurns: 20,
      goal: "edit",
    });
    enterVerificationPhase(state, 4);

    expect(recordVerificationFailure(state, 4)).toMatchObject({
      retry: true,
      transition: { from: "verify", to: "recover" },
    });
    expect(recordVerificationFailure(state, 6)).toMatchObject({
      retry: true,
    });
    expect(recordVerificationFailure(state, 8)).toMatchObject({
      retry: false,
      terminalFailure: expect.stringContaining("two adaptive correction-verification cycles"),
    });
  });
});
