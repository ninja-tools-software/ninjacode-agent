import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import type {
  Completion,
  CompletionRequest,
  LlmProvider,
  Message,
  StreamSink,
} from "@ninjacode/providers";
import { Agent } from "./agent.js";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { isVolatileContextMessage } from "./volatileContext.js";

interface Script {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

/** Replays scripted turns while keeping every request, so we can diff prefixes. */
class RecordingProvider implements LlmProvider {
  readonly name = "recording";
  readonly requests: CompletionRequest[] = [];
  private index = 0;

  constructor(private readonly scripts: Script[]) {}

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(req: CompletionRequest, _sink?: StreamSink): Promise<Completion> {
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const script = this.scripts[Math.min(this.index, this.scripts.length - 1)] ?? { text: "done" };
    this.index += 1;
    const toolCalls = script.toolCalls ?? [];
    return {
      text: script.text,
      toolCalls,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "recording",
      stopReason: toolCalls.length ? "tool_use" : "end",
    };
  }
}

function systemOf(req: CompletionRequest): string {
  return req.messages.find((m) => m.role === "system")?.content ?? "";
}

function volatileMessages(req: CompletionRequest): Message[] {
  return req.messages.filter(isVolatileContextMessage);
}

async function runWithScratchpadWrite(scripts: Script[]): Promise<RecordingProvider> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-cache-prefix-"));
  const agentDir = path.join(dir, ".ninjacode");
  await fs.mkdir(agentDir, { recursive: true });
  try {
    const provider = new RecordingProvider(scripts);
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: dir,
      agentDir,
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
      enableCompletionVerification: false,
    });

    await agent.run("Take a note, then finish");
    return provider;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const WRITE_NOTE: Script = {
  text: "Noting it down.",
  toolCalls: [
    {
      id: "call_1",
      name: "write_scratchpad",
      arguments: { content: "REMEMBER-THIS-NOTE" },
    },
  ],
};

describe("prompt cache prefix", () => {
  it("keeps the system prompt byte-identical after the scratchpad changes", async () => {
    const provider = await runWithScratchpadWrite([WRITE_NOTE, { text: "Done." }]);

    expect(provider.requests.length).toBeGreaterThanOrEqual(2);
    const systems = provider.requests.map(systemOf);
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).not.toContain("REMEMBER-THIS-NOTE");
  });

  it("delivers the new scratchpad through the message tail instead", async () => {
    const provider = await runWithScratchpadWrite([WRITE_NOTE, { text: "Done." }]);

    const last = provider.requests.at(-1)!;
    const snapshots = volatileMessages(last);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.content).toContain("REMEMBER-THIS-NOTE");
  });

  it("only grows the history by appending, so the cached prefix still matches", async () => {
    const provider = await runWithScratchpadWrite([WRITE_NOTE, { text: "Done." }]);

    const [first, second] = provider.requests;
    expect(first && second).toBeTruthy();
    const before = first!.messages;
    const after = second!.messages;
    expect(after.length).toBeGreaterThan(before.length);
    for (const [i, message] of before.entries()) {
      expect(after[i]?.role).toBe(message.role);
      expect(after[i]?.content).toBe(message.content);
    }
  });

  it("sends no workspace-state message when the scratchpad stays empty", async () => {
    const provider = await runWithScratchpadWrite([{ text: "Nothing to note." }]);

    expect(volatileMessages(provider.requests[0]!)).toHaveLength(0);
  });
});
