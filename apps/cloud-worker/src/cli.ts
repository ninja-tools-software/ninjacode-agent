#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { buildAgentRuntime } from "@ninjacode/core";
import {
  createProvider,
  type ProviderKind,
} from "@ninjacode/providers";
import { FileSystemArtifactStore } from "./artifacts.js";
import { createCoreAgentExecutor } from "./executor.js";
import { FileSystemJobQueue } from "./filesystemQueue.js";
import { DenyByDefaultPolicy } from "./policy.js";
import { CloudWorker } from "./worker.js";
import { TempWorkspaceProvisioner } from "./workspace.js";

const PROVIDERS = new Set<ProviderKind>([
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "moonshot",
  "glm",
  "mistral",
  "xai",
  "mammouth",
  "openai-compatible",
  "local",
  "gateway",
  "mock",
  "echo",
]);

function providerKind(): ProviderKind {
  const value = process.env.NINJACODE_WORKER_PROVIDER ?? "mock";
  if (!PROVIDERS.has(value as ProviderKind)) throw new Error(`unsupported provider: ${value}`);
  return value as ProviderKind;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function usage(): never {
  console.error("Usage: ninjacode-cloud-worker <once|loop> [--state-dir PATH] [--poll-ms N]");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command !== "once" && command !== "loop") usage();
  const stateDir = path.resolve(
    option(args, "--state-dir") ??
      process.env.NINJACODE_WORKER_STATE_DIR ??
      ".ninjacode-worker",
  );
  const pollMs = Number(option(args, "--poll-ms") ?? "1000");
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error("--poll-ms must be positive");
  const kind = providerKind();
  const policy = new DenyByDefaultPolicy();
  const executor = createCoreAgentExecutor({
    buildRuntime: buildAgentRuntime,
    providerForJob: (job) =>
      createProvider({
        kind,
        apiKey: process.env.NINJACODE_WORKER_API_KEY,
        model: job.task.model ?? process.env.NINJACODE_WORKER_MODEL,
        baseUrl: process.env.NINJACODE_WORKER_BASE_URL,
      }),
    policy,
  });
  const worker = new CloudWorker({
    workerId: `${os.hostname()}-${process.pid}`,
    queue: new FileSystemJobQueue(path.join(stateDir, "queue")),
    workspaces: new TempWorkspaceProvisioner(path.join(stateDir, "workspaces")),
    artifacts: new FileSystemArtifactStore(path.join(stateDir, "artifacts")),
    executor,
    policy,
    pollMs,
  });
  if (command === "once") {
    await worker.runOnce();
    return;
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await worker.runLoop(controller.signal);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
