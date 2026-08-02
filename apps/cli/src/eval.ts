import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Agent, PermissionEngine, defaultPermissionPolicy } from "@ninjacode/core";
import { MockProvider, createProvider, type ProviderKind } from "@ninjacode/providers";
import { createDefaultToolRegistry } from "@ninjacode/tools";

interface EvalCase {
  id: string;
  description: string;
  setup: (dir: string) => Promise<void>;
  /** For mock mode */
  scripts?: Array<{
    text?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }>;
  /** Prompt for real models */
  prompt: string;
  assert: (dir: string, answer: string) => Promise<boolean>;
  /** Optional shell test command after agent run */
  verifyCmd?: string;
}

const cases: EvalCase[] = [
  {
    id: "write-hello",
    description: "Create hello.txt with Hello NinjaCode",
    setup: async () => undefined,
    prompt: "Create a file hello.txt containing exactly: Hello NinjaCode",
    scripts: [
      {
        text: "Creating file",
        toolCalls: [
          {
            id: "c1",
            name: "write_file",
            arguments: { path: "hello.txt", content: "Hello NinjaCode\n" },
          },
        ],
      },
      { text: "Created hello.txt" },
    ],
    assert: async (dir) => {
      const content = await fs.readFile(path.join(dir, "hello.txt"), "utf8");
      return content.includes("Hello NinjaCode");
    },
  },
  {
    id: "edit-config",
    description: "Edit version in package.json",
    setup: async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "demo", version: "0.0.1" }, null, 2) + "\n",
      );
    },
    prompt: 'In package.json, change the version field from "0.0.1" to "0.1.0".',
    scripts: [
      {
        toolCalls: [
          {
            id: "c1",
            name: "edit_file",
            arguments: {
              path: "package.json",
              old_string: '"version": "0.0.1"',
              new_string: '"version": "0.1.0"',
            },
          },
        ],
      },
      { text: "Bumped version" },
    ],
    assert: async (dir) => {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
        version: string;
      };
      return pkg.version === "0.1.0";
    },
  },
  {
    id: "fix-bug",
    description: "Fix off-by-one in sum.js so tests pass",
    setup: async (dir) => {
      await fs.writeFile(
        path.join(dir, "sum.js"),
        `export function sum(a, b) {\n  return a + b + 1; // bug\n}\n`,
      );
      await fs.writeFile(
        path.join(dir, "sum.test.mjs"),
        `import { sum } from './sum.js';\nimport assert from 'node:assert';\nassert.equal(sum(2, 3), 5);\nconsole.log('ok');\n`,
      );
    },
    prompt:
      "Fix sum.js so that sum(a,b) returns a+b (remove the off-by-one bug). Do not change the test file.",
    scripts: [
      {
        toolCalls: [
          {
            id: "c1",
            name: "edit_file",
            arguments: {
              path: "sum.js",
              old_string: "return a + b + 1; // bug",
              new_string: "return a + b;",
            },
          },
        ],
      },
      { text: "Fixed" },
    ],
    assert: async (dir) => {
      const content = await fs.readFile(path.join(dir, "sum.js"), "utf8");
      return content.includes("return a + b") && !content.includes("+ 1");
    },
    verifyCmd: "node sum.test.mjs",
  },
];

async function runCmd(cmd: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function runEvalCase(c: EvalCase, useReal: boolean, kind: ProviderKind): Promise<{ ok: boolean; cost: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ninjacode-eval-${c.id}-`));
  try {
    await c.setup(dir);
    const tools = createDefaultToolRegistry({ includeNetwork: false });
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const provider = useReal
      ? createProvider({
          kind,
          apiKey: process.env.NINJACODE_EVAL_KEY!,
          model: process.env.NINJACODE_EVAL_MODEL,
        })
      : new MockProvider(c.scripts ?? [{ text: "done" }]);

    const agent = new Agent({
      provider,
      tools,
      permissions,
      workspaceRoot: dir,
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
      maxTurns: useReal ? 20 : 8,
    });

    const outcome = await agent.run(c.prompt);
    const stats = agent.getCacheStats();

    let ok = outcome.completed && (await c.assert(dir, outcome.answer));
    if (ok && c.verifyCmd) ok = await runCmd(c.verifyCmd, dir);

    return { ok, cost: stats.estimatedCostUsd };
  } catch {
    return { ok: false, cost: 0 };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function runEvals(): Promise<void> {
  const useReal = Boolean(process.env.NINJACODE_EVAL_KEY);
  const kind = (process.env.NINJACODE_EVAL_PROVIDER as ProviderKind) || "anthropic";
  console.log(useReal ? `Running REAL evals (${kind})` : "Running MOCK evals (set NINJACODE_EVAL_KEY for live)");

  let passed = 0;
  let totalCostHint = 0;

  for (const c of cases) {
    try {
      const { ok, cost } = await runEvalCase(c, useReal, kind);
      totalCostHint += cost;
      console.log(`${ok ? "PASS" : "FAIL"}  ${c.id} — ${c.description}`);
      if (ok) passed += 1;
    } catch (e) {
      console.log(`FAIL  ${c.id} — ${(e as Error).message}`);
    }
  }

  console.log(`\n${passed}/${cases.length} passed`);
  if (useReal) console.log(`Estimated cost: $${totalCostHint.toFixed(4)}`);
  if (passed !== cases.length) process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("eval.js") || process.argv[1].endsWith("eval.ts"));
if (isMain) {
  runEvals().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
