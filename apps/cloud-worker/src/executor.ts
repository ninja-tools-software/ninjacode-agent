import type {
  AgentRuntime,
  BuildAgentRuntimeOptions,
} from "@ninjacode/core";
import type { LlmProvider } from "@ninjacode/providers";
import type { CloudJobV1 } from "./contract.js";
import type { JobPolicyEnforcer, ResolvedJobPolicy } from "./policy.js";

export interface AgentExecutionResult {
  completed: boolean;
  answer: string;
  turns: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCostUsd: number;
  };
}

export interface AgentJobExecutor {
  execute(input: {
    job: CloudJobV1;
    attempt: number;
    workspaceRoot: string;
    policy: ResolvedJobPolicy;
    signal: AbortSignal;
  }): Promise<AgentExecutionResult>;
}

export type AgentRuntimeBuilder = (
  options: BuildAgentRuntimeOptions,
) => Promise<AgentRuntime>;

export interface CoreAgentExecutorOptions {
  buildRuntime: AgentRuntimeBuilder;
  providerForJob: (job: CloudJobV1) => LlmProvider;
  policy: JobPolicyEnforcer;
}

export function createCoreAgentExecutor(
  options: CoreAgentExecutorOptions,
): AgentJobExecutor {
  return {
    async execute(input): Promise<AgentExecutionResult> {
      const provider = options.providerForJob(input.job);
      const runtime = await options.buildRuntime({
        workspaceRoot: input.workspaceRoot,
        provider,
        approvalMode: "balanced",
        includeNetwork: false,
        includeDebug: false,
        agent: {
          sessionId: `${input.job.id}-attempt-${input.attempt}`,
          model: input.job.task.model,
          maxTurns: input.job.task.maxTurns,
          runTimeoutMs: input.job.execution.timeoutMs,
          sandboxMode: "workspace-write",
          persistSessions: false,
          enableCheckpoints: false,
          enableSubagents: false,
          enableWorkspaceHooks: false,
          signal: input.signal,
          onApproval: (request) => options.policy.approve(request),
        },
      });
      runtime.permissions.update({
        denylist: [
          "ask_user",
          "request_user_action",
          "fetch_url",
          "web_search",
          "run_shell",
        ],
      });
      const agent = runtime.createAgent();
      const outcome = await agent.run(input.job.task.prompt);
      const usage = agent.getCacheStats();
      return {
        completed: outcome.completed,
        answer: outcome.answer,
        turns: outcome.turns.length,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
        },
      };
    },
  };
}
